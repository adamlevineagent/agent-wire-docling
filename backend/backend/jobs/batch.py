"""Batch worker loop.

Pull scan_docs matching a stratum→pipeline map, convert each doc via
Agent A's conversion function, maintain manifest + docs table, respect
cancellation, retry failures N times.

Agent A's public call-site contract (agreed in Wave 1):

    await convert_doc(source_path: str, output_dir: str, pipeline: dict) -> dict

Returns a DocMeta-shaped dict. We import lazily to avoid a hard import
order dep at module load.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
import traceback
from pathlib import Path
from typing import Any

from backend import db as _db
from backend.jobs import queue as q
from backend.manifest import append_manifest_entry

MAX_RETRIES = 3


def pipeline_hash(pipeline: dict[str, Any]) -> str:
    """Deterministic hash of pipeline params. Matches what Agent A should use."""
    payload = json.dumps(pipeline or {}, sort_keys=True, default=str).encode()
    return hashlib.sha256(payload).hexdigest()[:16]


async def _call_convert(source_path: str, output_dir: str, pipeline: dict[str, Any]) -> dict[str, Any]:
    """Late-bind to Agent A's module. If A hasn't shipped yet, raise a clear error."""
    try:
        from backend.conversion import convert as _conv  # type: ignore
    except ImportError as e:  # pragma: no cover — Wave 1 integration path
        raise RuntimeError(f"conversion module unavailable: {e}") from e

    # Prefer a top-level async function `convert_doc`; fall back to others.
    fn = getattr(_conv, "convert_doc", None)
    if fn is None:
        # Search module for something obvious
        raise RuntimeError(
            "backend.conversion.convert has no convert_doc(source_path, output_dir, pipeline)"
        )
    result = fn(source_path, output_dir, pipeline)
    if asyncio.iscoroutine(result):
        result = await result
    return dict(result) if result is not None else {}


def _load_batch_docs(
    conn: Any, scan_id: str, stratum_pipelines: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    pipelines_by_stratum = {sp["stratum"]: sp["pipeline"] for sp in stratum_pipelines}
    strata = list(pipelines_by_stratum.keys())
    if not strata:
        return []
    placeholders = ",".join("?" * len(strata))
    rows = conn.execute(
        f"""SELECT source_sha256, source_path, source_format, stratum, size_bytes, page_count
            FROM scan_docs
            WHERE scan_id = ? AND stratum IN ({placeholders})
            ORDER BY source_path""",
        (scan_id, *strata),
    ).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        d = dict(r)
        d["pipeline"] = pipelines_by_stratum.get(d["stratum"], {})
        out.append(d)
    return out


def _publish_progress(job_id: str, conn: Any) -> None:
    job = q.read_job(conn, job_id)
    if not job:
        return
    payload = {
        "id": job["id"],
        "kind": job["kind"],
        "status": job["status"],
        "progress": {
            "docs_total": job.get("docs_total", 0) or 0,
            "docs_done": job.get("docs_done", 0) or 0,
            "docs_failed": job.get("docs_failed", 0) or 0,
        },
    }
    q.runner().publish(job_id, payload)


async def _process_one(
    job_id: str,
    output_dir: str,
    doc: dict[str, Any],
    counters: dict[str, int],
    counters_lock: asyncio.Lock,
) -> None:
    source_sha = doc["source_sha256"]
    source_path = doc["source_path"]
    stratum = doc["stratum"]
    pipeline = doc.get("pipeline") or {}
    phash = pipeline_hash(pipeline)

    if q.runner().is_cancelled(job_id):
        return

    # Acquire lease
    conn = _db.connect()
    try:
        got = q.acquire_lease(conn, output_dir, source_sha, phash, job_id)
        if not got:
            q.log_event(job_id, {"event": "lease_skip", "sha": source_sha})
            return

        # Seed the docs row
        conn.execute(
            """INSERT OR REPLACE INTO docs
               (output_dir, source_sha256, pipeline_hash, source_path, source_format,
                status, stratum)
               VALUES (?, ?, ?, ?, ?, 'processing', ?)""",
            (output_dir, source_sha, phash, source_path, doc["source_format"], stratum),
        )
        conn.commit()
    finally:
        conn.close()

    last_err: str | None = None
    meta: dict[str, Any] | None = None
    t0 = time.time()
    for attempt in range(1, MAX_RETRIES + 1):
        if q.runner().is_cancelled(job_id):
            last_err = "cancelled"
            break
        try:
            q.log_event(
                job_id,
                {"event": "convert_start", "sha": source_sha, "attempt": attempt,
                 "path": source_path},
            )
            meta = await _call_convert(source_path, output_dir, pipeline)
            last_err = None
            break
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            q.log_event(
                job_id,
                {"event": "convert_fail", "sha": source_sha, "attempt": attempt,
                 "error": last_err, "traceback": traceback.format_exc()[-2000:]},
            )
            await asyncio.sleep(min(2**attempt, 5))
    runtime_ms = int((time.time() - t0) * 1000)

    status = "complete" if meta and not last_err else "error"
    quality = {}
    if meta:
        qs = meta.get("quality_signals", {}) or {}
        warnings = qs.get("warnings", []) or []
        empties = qs.get("empty_pages", []) or []
        ocr = qs.get("ocr_confidence_per_page", []) or []
        quality = {
            "ocr_avg": (sum(ocr) / len(ocr)) if ocr else None,
            "warning_count": len(warnings),
            "empty_page_count": len(empties),
        }

    conn = _db.connect()
    try:
        conn.execute(
            """UPDATE docs SET status=?, docling_version=?, runtime_ms=?,
                   md_char_count=?, json_size_bytes=?, quality_json=?, error=?, converted_at=?
               WHERE output_dir=? AND source_sha256=? AND pipeline_hash=?""",
            (
                status,
                (meta or {}).get("docling_version"),
                runtime_ms,
                ((meta or {}).get("stats") or {}).get("md_char_count"),
                ((meta or {}).get("stats") or {}).get("json_size_bytes"),
                json.dumps(quality) if quality else None,
                last_err,
                q.now_iso(),
                output_dir,
                source_sha,
                phash,
            ),
        )
        conn.commit()
        q.release_lease(conn, output_dir, source_sha, phash)
    finally:
        conn.close()

    # Manifest entry
    entry = {
        "source_sha256": source_sha,
        "source_path": source_path,
        "source_format": doc["source_format"],
        "status": "complete" if status == "complete" else "error",
        "stratum": stratum,
        "pipeline_hash": phash,
        "error": last_err,
        "quality_summary": quality or None,
        "converted_at": q.now_iso(),
    }
    try:
        append_manifest_entry(output_dir, entry)
    except Exception as e:
        q.log_event(job_id, {"event": "manifest_write_fail", "error": str(e)})

    async with counters_lock:
        if status == "complete":
            counters["done"] += 1
        else:
            counters["failed"] += 1
        conn = _db.connect()
        try:
            q.update_job_status(
                conn, job_id,
                docs_done=counters["done"], docs_failed=counters["failed"],
            )
            _publish_progress(job_id, conn)
        finally:
            conn.close()


async def run_batch(
    job_id: str,
    scan_id: str,
    output_dir: str,
    stratum_pipelines: list[dict[str, Any]],
    concurrency: int = 2,
) -> None:
    """Top-level coroutine; launched as a Task by the router."""
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    q.log_event(job_id, {"event": "batch_start", "scan_id": scan_id, "output_dir": output_dir})

    conn = _db.connect()
    try:
        docs = _load_batch_docs(conn, scan_id, stratum_pipelines)
        q.update_job_status(
            conn, job_id,
            status="running", started_at=q.now_iso(), docs_total=len(docs),
        )
        _publish_progress(job_id, conn)

        # Seed folder_root on manifest if we can
        scan = conn.execute(
            "SELECT folder_root FROM scans WHERE id = ?", (scan_id,)
        ).fetchone()
        folder_root = scan["folder_root"] if scan else None
    finally:
        conn.close()

    if folder_root:
        # Ensure manifest exists with folder_root baked in
        try:
            from backend.manifest import read_manifest, write_manifest
            m = read_manifest(output_dir)
            if not m.get("folder_root"):
                m["folder_root"] = folder_root
                write_manifest(output_dir, m)
        except Exception:
            pass

    counters = {"done": 0, "failed": 0}
    counters_lock = asyncio.Lock()
    sem = asyncio.Semaphore(max(1, concurrency))

    async def _worker(doc: dict[str, Any]) -> None:
        async with sem:
            if q.runner().is_cancelled(job_id):
                return
            await _process_one(job_id, output_dir, doc, counters, counters_lock)

    try:
        tasks = [asyncio.create_task(_worker(d)) for d in docs]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        cancelled = q.runner().is_cancelled(job_id)
        final_status = "cancelled" if cancelled else "completed"
        conn = _db.connect()
        try:
            q.update_job_status(
                conn, job_id,
                status=final_status,
                completed_at=q.now_iso(),
                docs_done=counters["done"],
                docs_failed=counters["failed"],
            )
            q.release_all_leases_for_job(conn, job_id)
            _publish_progress(job_id, conn)
        finally:
            conn.close()
        q.log_event(
            job_id,
            {"event": "batch_end", "status": final_status, **counters},
        )
    except Exception as e:
        q.log_event(
            job_id,
            {"event": "batch_crash", "error": str(e),
             "traceback": traceback.format_exc()[-2000:]},
        )
        conn = _db.connect()
        try:
            q.update_job_status(
                conn, job_id, status="failed", error=str(e),
                completed_at=q.now_iso(),
            )
            q.release_all_leases_for_job(conn, job_id)
        finally:
            conn.close()
    finally:
        q.runner().cleanup(job_id)
