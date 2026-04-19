"""Batch worker loop — Level B.

Two dispatch modes:
  1. Filemap mode (new): batch walks `.understanding/folder.yaml` files under a
     root and converts every `user_included` (or null-but-scanner-include) file,
     writing output into a mirrored tree under output_dir.
  2. Legacy stratum mode: scan_id + stratum_pipelines (kept for backward-compat).

On completion writes `<output_dir>/triage.yaml` and updates per-folder filemap
`last_build_*` fields.
"""

from __future__ import annotations

import asyncio
import datetime as _dt
import hashlib
import json
import os
import time
import traceback
from pathlib import Path
from typing import Any

from backend import db as _db
from backend.jobs import queue as q
from backend.jobs import triage as _triage
from backend.manifest import append_manifest_entry
from backend.stratification import filemap as _filemap

# 1 initial + 2 retries = 3 total attempts
MAX_RETRIES = 3


def pipeline_hash(pipeline: dict[str, Any]) -> str:
    payload = json.dumps(pipeline or {}, sort_keys=True, default=str).encode()
    return hashlib.sha256(payload).hexdigest()[:16]


def _now_iso() -> str:
    return _dt.datetime.now(_dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


# Per-doc convert timeout. Even a 200-page scanned PDF with VLM should
# never exceed this. If a doc hangs (Docling deadlock, infinite OCR loop,
# etc) we abandon it after PER_DOC_TIMEOUT_S; the leaked worker thread
# will eventually finish in the background but the batch keeps moving.
# Override with env var DOCLING_PER_DOC_TIMEOUT_S if a workload needs it.
PER_DOC_TIMEOUT_S = float(os.environ.get("DOCLING_PER_DOC_TIMEOUT_S", "600"))


async def _await_with_doc_timeout(coro: Any) -> dict[str, Any]:
    """Await a convert coroutine with a hard per-doc timeout.

    On timeout, raises asyncio.TimeoutError so the caller's retry/triage
    path kicks in. The underlying thread continues running (we can't kill
    Python threads externally) but the batch worker is unblocked.
    """
    try:
        result = await asyncio.wait_for(coro, timeout=PER_DOC_TIMEOUT_S)
    except TimeoutError as e:
        raise TimeoutError(
            f"convert_timeout: doc exceeded {int(PER_DOC_TIMEOUT_S)}s — "
            "Docling probably deadlocked on this file. Triage and retry "
            "with a different pipeline (try VLM, or exclude)."
        ) from e
    return dict(result) if result is not None else {}


async def _call_convert_mirrored(
    source_path: str,
    output_dir: str,
    pipeline: dict[str, Any],
    *,
    output_root: str | None,
) -> dict[str, Any]:
    try:
        from backend.conversion import convert as _conv
    except ImportError as e:
        raise RuntimeError(f"conversion module unavailable: {e}") from e
    fn: Any = _conv.convert_doc
    result = fn(
        source_path, output_dir, pipeline,
        output_root=output_root, mirrored=True,
    )
    if asyncio.iscoroutine(result):
        return await _await_with_doc_timeout(result)
    return dict(result) if result is not None else {}


async def _call_convert_legacy(
    source_path: str, output_dir: str, pipeline: dict[str, Any]
) -> dict[str, Any]:
    try:
        from backend.conversion import convert as _conv
    except ImportError as e:
        raise RuntimeError(f"conversion module unavailable: {e}") from e
    fn: Any = _conv.convert_doc
    result = fn(source_path, output_dir, pipeline)
    if asyncio.iscoroutine(result):
        return await _await_with_doc_timeout(result)
    return dict(result) if result is not None else {}


# ── Filemap-mode dispatch ───────────────────────────────────────────────────


def _pick_pipeline_for(
    entry: dict[str, Any],
    pipeline_by_stratum: dict[str, dict[str, Any]],
    pipeline_by_content_type: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    stratum = entry.get("detected_stratum")
    if stratum and stratum in pipeline_by_stratum:
        return pipeline_by_stratum[stratum]
    ct = entry.get("user_content_type") or entry.get("detected_content_type")
    if ct and ct in pipeline_by_content_type:
        return pipeline_by_content_type[ct]
    return {}


async def _process_filemap_doc(
    job_id: str,
    output_dir: str,
    output_root: str,
    entry: dict[str, Any],
    pipeline: dict[str, Any],
    counters: dict[str, int],
    counters_lock: asyncio.Lock,
    results: list[dict[str, Any]],
    results_lock: asyncio.Lock,
) -> None:
    source_path = entry["_absolute_path"]
    folder = entry["_folder"]
    path_rel = entry.get("path") or Path(source_path).name
    phash = pipeline_hash(pipeline)

    if q.runner().is_cancelled(job_id):
        return

    first_attempt = _now_iso()
    last_err: str | None = None
    meta: dict[str, Any] | None = None
    attempt = 0

    for attempt in range(1, MAX_RETRIES + 1):
        if q.runner().is_cancelled(job_id):
            last_err = "cancelled"
            break
        try:
            q.log_event(
                job_id,
                {"event": "convert_start", "path": source_path, "attempt": attempt},
            )
            m = await _call_convert_mirrored(
                source_path, output_dir, pipeline, output_root=output_root
            )
            if m.get("status") == "ok":
                meta = m
                last_err = None
                break
            # Docling returned but with an error string
            last_err = m.get("error") or "unknown_error"
            meta = m
            q.log_event(
                job_id,
                {"event": "convert_fail", "path": source_path,
                 "attempt": attempt, "error": last_err},
            )
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            q.log_event(
                job_id,
                {"event": "convert_fail", "path": source_path, "attempt": attempt,
                 "error": last_err, "traceback": traceback.format_exc()[-2000:]},
            )
            await asyncio.sleep(min(2**attempt, 5))

    last_attempt = _now_iso()
    status = "complete" if (meta and not last_err) else "error"
    output_path = meta.get("output_path") if meta else None

    # Filemap post-build writeback
    try:
        _filemap.record_build_result(
            folder, path_rel,
            pipeline_hash=phash,
            output_path=output_path,
            error=last_err,
        )
    except Exception as e:
        q.log_event(job_id, {"event": "filemap_writeback_fail", "error": str(e)})

    # Manifest entry
    try:
        manifest_entry = {
            "source_sha256": (meta or {}).get("source_sha256") or entry.get("sha256") or "",
            "source_path": source_path,
            "source_format": entry.get("detected_content_type"),
            "status": "complete" if status == "complete" else "error",
            "stratum": entry.get("detected_stratum"),
            "pipeline_hash": phash,
            "error": last_err,
            "converted_at": last_attempt,
            "output_path": output_path,
        }
        append_manifest_entry(output_dir, manifest_entry, folder_root=output_root)
    except Exception as e:
        q.log_event(job_id, {"event": "manifest_write_fail", "error": str(e)})

    async with results_lock:
        results.append({
            "source_path": source_path,
            "source_sha256": entry.get("sha256"),
            "detected_content_type": entry.get("detected_content_type"),
            "detected_stratum": entry.get("detected_stratum"),
            "pipeline_used": pipeline,
            "status": status,
            "error": last_err,
            "attempt_count": attempt,
            "first_attempted_at": first_attempt,
            "last_attempted_at": last_attempt,
            "filemap_folder": folder,
        })

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


async def run_batch_from_filemaps(
    job_id: str,
    root: str,
    output_dir: str,
    pipeline_by_stratum: dict[str, dict[str, Any]],
    pipeline_by_content_type: dict[str, dict[str, Any]],
    concurrency: int = 2,
) -> None:
    root = str(Path(root).resolve())
    output_dir = str(Path(output_dir).resolve())
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    q.log_event(job_id, {"event": "batch_start", "root": root, "output_dir": output_dir, "mode": "filemap"})

    try:
        included = _filemap.collect_included_files(root)
    except Exception as e:
        q.log_event(job_id, {"event": "collect_fail", "error": str(e)})
        included = []

    # Attach pipeline
    for entry in included:
        entry["_pipeline"] = _pick_pipeline_for(
            entry, pipeline_by_stratum, pipeline_by_content_type
        )

    conn = _db.connect()
    try:
        q.update_job_status(
            conn, job_id,
            status="running", started_at=q.now_iso(), docs_total=len(included),
        )
        _publish_progress(job_id, conn)
    finally:
        conn.close()

    counters = {"done": 0, "failed": 0}
    counters_lock = asyncio.Lock()
    results: list[dict[str, Any]] = []
    results_lock = asyncio.Lock()
    sem = asyncio.Semaphore(max(1, concurrency))

    async def _worker(entry: dict[str, Any]) -> None:
        async with sem:
            if q.runner().is_cancelled(job_id):
                return
            await _process_filemap_doc(
                job_id, output_dir, root, entry, entry["_pipeline"],
                counters, counters_lock, results, results_lock,
            )

    try:
        tasks = [asyncio.create_task(_worker(e)) for e in included]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        cancelled = q.runner().is_cancelled(job_id)
        final_status = "cancelled" if cancelled else "completed"

        # Write triage rollup
        try:
            _triage.write_triage(output_dir, job_id, results)
        except Exception as e:
            q.log_event(job_id, {"event": "triage_write_fail", "error": str(e)})

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
        q.log_event(job_id, {"event": "batch_end", "status": final_status, **counters})
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


# ── Legacy stratum-mode (backward compat) ───────────────────────────────────


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
    job_id: str, output_dir: str, doc: dict[str, Any],
    counters: dict[str, int], counters_lock: asyncio.Lock,
) -> None:
    source_sha = doc["source_sha256"]
    source_path = doc["source_path"]
    stratum = doc["stratum"]
    pipeline = doc.get("pipeline") or {}
    phash = pipeline_hash(pipeline)

    if q.runner().is_cancelled(job_id):
        return

    conn = _db.connect()
    try:
        got = q.acquire_lease(conn, output_dir, source_sha, phash, job_id)
        if not got:
            q.log_event(job_id, {"event": "lease_skip", "sha": source_sha})
            return
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
            meta = await _call_convert_legacy(source_path, output_dir, pipeline)
            last_err = None
            break
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
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
        scan = conn.execute(
            "SELECT folder_root FROM scans WHERE id = ?", (scan_id,)
        ).fetchone()
        folder_root = scan["folder_root"] if scan else None
    finally:
        conn.close()

    if folder_root:
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
        q.log_event(job_id, {"event": "batch_end", "status": final_status, **counters})
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
