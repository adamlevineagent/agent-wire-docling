"""In-process async job queue + doc-lease mutex.

One singleton JobRunner per process. Jobs are persisted to the `jobs`
table so status survives restarts (as 'failed' if we crashed mid-run
and resume chooses not to restart them).

Per-doc mutex uses the `doc_leases` table — an INSERT with PK
(output_dir, source_sha256, pipeline_hash) either wins the lease or
signals that another task owns it.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from backend import db as _db

# Callback signature: (job_id, progress_dict) -> None. Invoked from worker thread-safe context.
ProgressCallback = Callable[[str, dict[str, Any]], Awaitable[None]]


def now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def new_id() -> str:
    return uuid.uuid4().hex


# ─── Doc lease helpers ───────────────────────────────────────────────────────


def acquire_lease(
    conn: sqlite3.Connection,
    output_dir: str,
    source_sha256: str,
    pipeline_hash: str,
    job_id: str | None,
) -> bool:
    """Return True if this caller won the lease."""
    try:
        conn.execute(
            """
            INSERT INTO doc_leases (output_dir, source_sha256, pipeline_hash, job_id, acquired_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (output_dir, source_sha256, pipeline_hash, job_id, now_iso()),
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False


def release_lease(
    conn: sqlite3.Connection,
    output_dir: str,
    source_sha256: str,
    pipeline_hash: str,
) -> None:
    conn.execute(
        "DELETE FROM doc_leases WHERE output_dir=? AND source_sha256=? AND pipeline_hash=?",
        (output_dir, source_sha256, pipeline_hash),
    )
    conn.commit()


def release_all_leases_for_job(conn: sqlite3.Connection, job_id: str) -> int:
    cur = conn.execute("DELETE FROM doc_leases WHERE job_id = ?", (job_id,))
    conn.commit()
    return cur.rowcount or 0


# ─── Job record helpers ──────────────────────────────────────────────────────


def insert_job(
    conn: sqlite3.Connection,
    *,
    kind: str,
    status: str = "queued",
    output_dir: str | None = None,
    scan_id: str | None = None,
    stratum_pipelines: list[dict[str, Any]] | None = None,
    concurrency: int = 2,
    docs_total: int = 0,
) -> str:
    jid = new_id()
    conn.execute(
        """
        INSERT INTO jobs (id, kind, status, output_dir, scan_id,
                          stratum_pipelines_json, concurrency, docs_total,
                          docs_done, docs_failed, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
        """,
        (
            jid,
            kind,
            status,
            output_dir,
            scan_id,
            json.dumps(stratum_pipelines) if stratum_pipelines is not None else None,
            concurrency,
            docs_total,
            now_iso(),
        ),
    )
    conn.commit()
    return jid


def update_job_status(
    conn: sqlite3.Connection,
    job_id: str,
    *,
    status: str | None = None,
    started_at: str | None = None,
    completed_at: str | None = None,
    error: str | None = None,
    result_path: str | None = None,
    docs_total: int | None = None,
    docs_done: int | None = None,
    docs_failed: int | None = None,
) -> None:
    sets: list[str] = []
    vals: list[Any] = []
    for col, v in (
        ("status", status),
        ("started_at", started_at),
        ("completed_at", completed_at),
        ("error", error),
        ("result_path", result_path),
        ("docs_total", docs_total),
        ("docs_done", docs_done),
        ("docs_failed", docs_failed),
    ):
        if v is not None:
            sets.append(f"{col} = ?")
            vals.append(v)
    if not sets:
        return
    vals.append(job_id)
    conn.execute(f"UPDATE jobs SET {', '.join(sets)} WHERE id = ?", vals)
    conn.commit()


def read_job(conn: sqlite3.Connection, job_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if not row:
        return None
    return dict(row)


# ─── Structured log ──────────────────────────────────────────────────────────


def log_event(job_id: str, event: dict[str, Any]) -> None:
    """Append an NDJSON line to data/logs/batch-<id>.ndjson."""
    logs_dir = _db._ROOT / "data" / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    path = logs_dir / f"batch-{job_id}.ndjson"
    line = json.dumps({"t": now_iso(), **event})
    with open(path, "a", encoding="utf-8") as f:
        f.write(line + "\n")


# ─── Resume / startup cleanup ────────────────────────────────────────────────


def cleanup_tmp_dirs(output_dir: Path) -> list[str]:
    """Remove any <hash>.tmp/ directories under output_dir. Returns names cleaned."""
    cleaned: list[str] = []
    if not output_dir.exists() or not output_dir.is_dir():
        return cleaned
    for child in output_dir.iterdir():
        if child.is_dir() and child.name.endswith(".tmp"):
            try:
                # Recursive delete
                _rmtree(child)
                cleaned.append(child.name)
            except OSError:
                pass
    return cleaned


def _rmtree(path: Path) -> None:
    for child in path.iterdir():
        if child.is_dir() and not child.is_symlink():
            _rmtree(child)
        else:
            try:
                child.unlink()
            except OSError:
                pass
    path.rmdir()


def resume_cleanup() -> dict[str, Any]:
    """Run on startup: kill stale .tmp/ dirs, release stale leases,
    mark running jobs as failed. Returns a summary."""
    summary: dict[str, Any] = {
        "output_dirs_scanned": 0,
        "tmp_dirs_cleaned": [],
        "leases_released": 0,
        "jobs_failed": 0,
    }
    conn = _db.connect()
    try:
        dirs: set[str] = set()
        for row in conn.execute("SELECT DISTINCT output_dir FROM docs"):
            if row["output_dir"]:
                dirs.add(row["output_dir"])
        for row in conn.execute(
            "SELECT DISTINCT output_dir FROM jobs WHERE output_dir IS NOT NULL"
        ):
            if row["output_dir"]:
                dirs.add(row["output_dir"])

        for d in dirs:
            summary["output_dirs_scanned"] += 1
            cleaned = cleanup_tmp_dirs(Path(d))
            if cleaned:
                summary["tmp_dirs_cleaned"].extend([f"{d}/{n}" for n in cleaned])

        # Release ALL leases — on restart nothing is actually running.
        cur = conn.execute("DELETE FROM doc_leases")
        summary["leases_released"] = cur.rowcount or 0

        # Mark any jobs that were running as failed (crash recovery).
        cur2 = conn.execute(
            "UPDATE jobs SET status='failed', error=COALESCE(error,'interrupted by restart'),"
            " completed_at=? WHERE status IN ('running','queued')",
            (now_iso(),),
        )
        summary["jobs_failed"] = cur2.rowcount or 0
        conn.commit()
    finally:
        conn.close()
    return summary


# ─── Job runner (in-process singleton) ───────────────────────────────────────


class JobRunner:
    """Holds a per-process registry of cancellation events + progress broadcasters."""

    def __init__(self) -> None:
        self._cancel: dict[str, asyncio.Event] = {}
        self._progress_subs: dict[str, list[asyncio.Queue[dict[str, Any]]]] = {}
        self._tasks: dict[str, asyncio.Task[Any]] = {}
        self._lock = asyncio.Lock()

    def register(self, job_id: str) -> asyncio.Event:
        ev = asyncio.Event()
        self._cancel[job_id] = ev
        return ev

    def cancel(self, job_id: str) -> bool:
        """Set the cancel flag AND interrupt the tracked asyncio task.

        The flag-only path was leaving long batches stuck mid-doc — the
        worker checks `is_cancelled` only between docs, and Docling runs
        inside `asyncio.to_thread` which can't be killed externally.
        Cancelling the parent task at minimum interrupts at the next
        await boundary (typically once the in-flight doc returns).
        """
        ev = self._cancel.get(job_id)
        any_signal = False
        if ev is not None:
            ev.set()
            any_signal = True
        task = self._tasks.get(job_id)
        if task is not None and not task.done():
            task.cancel()
            any_signal = True
        return any_signal

    def is_cancelled(self, job_id: str) -> bool:
        ev = self._cancel.get(job_id)
        return ev.is_set() if ev else False

    def subscribe(self, job_id: str) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=256)
        self._progress_subs.setdefault(job_id, []).append(q)
        return q

    def unsubscribe(self, job_id: str, q: asyncio.Queue[dict[str, Any]]) -> None:
        subs = self._progress_subs.get(job_id)
        if subs and q in subs:
            subs.remove(q)

    def publish(self, job_id: str, payload: dict[str, Any]) -> None:
        for q in list(self._progress_subs.get(job_id, ())):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                # Drop oldest
                try:
                    q.get_nowait()
                    q.put_nowait(payload)
                except Exception:
                    pass

    def track(self, job_id: str, task: asyncio.Task[Any]) -> None:
        self._tasks[job_id] = task
        task.add_done_callback(lambda _t: self._tasks.pop(job_id, None))

    def cleanup(self, job_id: str) -> None:
        self._cancel.pop(job_id, None)
        self._progress_subs.pop(job_id, None)


_runner = JobRunner()


def runner() -> JobRunner:
    return _runner
