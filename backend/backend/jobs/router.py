"""Jobs / batch / manifest / taste / export HTTP surface."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from backend import db as _db
from backend.jobs import batch as _batch
from backend.jobs import export as _export
from backend.jobs import queue as q
from backend.jobs import taste as _taste
from backend.jobs import triage as _triage
from backend.manifest import read_manifest

router = APIRouter(tags=["batch"])


# Resume cleanup runs once at router import (i.e. app boot).
# Safe: idempotent, operates on DB + output folders only, no network.
_RESUME_DONE = False


def _run_resume_once() -> None:
    global _RESUME_DONE
    if _RESUME_DONE:
        return
    _RESUME_DONE = True
    try:
        summary = q.resume_cleanup()
        import logging
        logging.getLogger("backend.jobs").info("resume_cleanup: %s", summary)
    except Exception as e:
        import logging
        logging.getLogger("backend.jobs").warning("resume_cleanup failed: %s", e)


_run_resume_once()


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _job_to_payload(row: dict[str, Any]) -> dict[str, Any]:
    progress = {
        "docs_total": row.get("docs_total", 0) or 0,
        "docs_done": row.get("docs_done", 0) or 0,
        "docs_failed": row.get("docs_failed", 0) or 0,
    }
    return {
        "id": row["id"],
        "kind": row["kind"],
        "status": row["status"],
        "progress": progress,
        "started_at": row.get("started_at"),
        "completed_at": row.get("completed_at"),
        "error": row.get("error"),
        "result_path": row.get("result_path"),
    }


# ─── Models ──────────────────────────────────────────────────────────────────


class StratumPipeline(BaseModel):
    stratum: str
    pipeline: dict[str, Any] = Field(default_factory=dict)


class BatchRequest(BaseModel):
    # Legacy fields (Wave 1-3) - backward-compat
    scan_id: str | None = None
    stratum_pipelines: list[StratumPipeline] | None = None
    # New fields (Level B)
    root: str | None = None
    pipeline_by_stratum: dict[str, dict[str, Any]] | None = None
    pipeline_by_content_type: dict[str, dict[str, Any]] | None = None
    # Shared
    output_dir: str
    concurrency: int = 2


class TriageRetryRequest(BaseModel):
    output_dir: str


class TasteSessionCreate(BaseModel):
    scan_id: str
    output_dir: str


class TasteSessionPatch(BaseModel):
    version: int
    approval: dict[str, Any] | None = None
    pipeline_assignment: dict[str, Any] | None = None
    lock_stratum: dict[str, Any] | None = None


class ExportRequest(BaseModel):
    output_dir: str
    kind: str  # manifest_only | manifest_plus_md | full_archive
    destination: str


# ─── Batch ───────────────────────────────────────────────────────────────────


@router.post("/batch")
async def create_batch(req: BatchRequest) -> dict[str, Any]:
    # Level B filemap mode: `root` present
    if req.root:
        from backend.stratification import filemap as _fm
        try:
            included = _fm.collect_included_files(req.root)
        except Exception:
            included = []
        total = len(included)
        conn = _db.connect()
        try:
            jid = q.insert_job(
                conn,
                kind="batch",
                status="queued",
                output_dir=req.output_dir,
                scan_id=None,
                stratum_pipelines=[],
                concurrency=req.concurrency,
                docs_total=total,
            )
            job_row = q.read_job(conn, jid)
        finally:
            conn.close()
        q.runner().register(jid)
        task = asyncio.create_task(
            _batch.run_batch_from_filemaps(
                jid, req.root, req.output_dir,
                req.pipeline_by_stratum or {},
                req.pipeline_by_content_type or {},
                req.concurrency,
            )
        )
        q.runner().track(jid, task)
        assert job_row is not None
        return _job_to_payload(job_row)

    # Legacy stratum mode
    if not req.scan_id or req.stratum_pipelines is None:
        raise HTTPException(
            status_code=400,
            detail="batch requires either 'root' (filemap mode) or 'scan_id' + 'stratum_pipelines' (legacy)",
        )
    sp = [spx.model_dump() for spx in req.stratum_pipelines]
    conn = _db.connect()
    try:
        strata = [s["stratum"] for s in sp]
        total = 0
        if strata:
            placeholders = ",".join("?" * len(strata))
            row = conn.execute(
                f"SELECT COUNT(*) AS n FROM scan_docs WHERE scan_id=? AND stratum IN ({placeholders})",
                (req.scan_id, *strata),
            ).fetchone()
            total = int(row["n"]) if row else 0

        jid = q.insert_job(
            conn,
            kind="batch",
            status="queued",
            output_dir=req.output_dir,
            scan_id=req.scan_id,
            stratum_pipelines=sp,
            concurrency=req.concurrency,
            docs_total=total,
        )
        job_row = q.read_job(conn, jid)
    finally:
        conn.close()

    q.runner().register(jid)
    task = asyncio.create_task(
        _batch.run_batch(jid, req.scan_id, req.output_dir, sp, req.concurrency)
    )
    q.runner().track(jid, task)
    assert job_row is not None
    return _job_to_payload(job_row)


# ── Triage ──────────────────────────────────────────────────────────────────


@router.get("/triage")
async def get_triage(output_dir: str = Query(...)) -> dict[str, Any]:
    t = _triage.read_triage(output_dir)
    if t is None:
        raise HTTPException(status_code=404, detail=f"no triage.yaml at {output_dir}")
    return t


@router.post("/triage/retry")
async def retry_triage(req: TriageRetryRequest) -> dict[str, Any]:
    try:
        return _triage.apply_triage_retries(req.output_dir)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.post("/batch/{job_id}/cancel")
async def cancel_batch(job_id: str) -> dict[str, Any]:
    ok = q.runner().cancel(job_id)
    conn = _db.connect()
    try:
        row = q.read_job(conn, job_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"job not found: {job_id}")
        if row["status"] in ("queued",):
            q.update_job_status(conn, job_id, status="cancelled", completed_at=q.now_iso())
            row = q.read_job(conn, job_id)
        q.log_event(job_id, {"event": "cancel_requested", "ok": ok})
        assert row is not None
        return _job_to_payload(row)
    finally:
        conn.close()


@router.get("/jobs/{job_id}")
async def get_job(job_id: str) -> dict[str, Any]:
    conn = _db.connect()
    try:
        row = q.read_job(conn, job_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"job not found: {job_id}")
        return _job_to_payload(row)
    finally:
        conn.close()


@router.get("/jobs/{job_id}/stream")
async def stream_job(job_id: str) -> EventSourceResponse:
    conn = _db.connect()
    try:
        row = q.read_job(conn, job_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"job not found: {job_id}")
    finally:
        conn.close()

    subscriber = q.runner().subscribe(job_id)

    async def _gen() -> Any:
        conn2 = _db.connect()
        try:
            snap = q.read_job(conn2, job_id)
            if snap:
                yield {"event": "job", "data": json.dumps(_job_to_payload(snap))}
        finally:
            conn2.close()

        while True:
            try:
                payload = await asyncio.wait_for(subscriber.get(), timeout=15.0)
                yield {"event": "job", "data": json.dumps(payload)}
                if payload.get("status") in ("completed", "cancelled", "failed"):
                    break
            except TimeoutError:
                yield {"event": "ping", "data": "{}"}

    return EventSourceResponse(_gen())


@router.get("/manifest")
async def get_manifest(output_dir: str = Query(...)) -> dict[str, Any]:
    return read_manifest(output_dir)


# ─── Taste sessions ──────────────────────────────────────────────────────────


@router.post("/taste_sessions")
async def create_taste_session(req: TasteSessionCreate) -> dict[str, Any]:
    try:
        return _taste.create_session(req.scan_id, req.output_dir)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/taste_sessions/{session_id}")
async def get_taste_session(session_id: str) -> dict[str, Any]:
    out = _taste.read_session(session_id)
    if out is None:
        raise HTTPException(status_code=404, detail=f"taste session not found: {session_id}")
    return out


@router.patch("/taste_sessions/{session_id}")
async def patch_taste_session(session_id: str, patch: TasteSessionPatch) -> dict[str, Any]:
    try:
        out = _taste.patch_session(session_id, patch.model_dump(exclude_none=False))
    except _taste.VersionConflict as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if out is None:
        raise HTTPException(status_code=404, detail=f"taste session not found: {session_id}")
    return out


# ─── Export ──────────────────────────────────────────────────────────────────


@router.post("/export")
async def create_export(req: ExportRequest) -> dict[str, Any]:
    if req.kind not in ("manifest_only", "manifest_plus_md", "full_archive"):
        raise HTTPException(status_code=400, detail=f"invalid export kind: {req.kind}")
    conn = _db.connect()
    try:
        jid = q.insert_job(
            conn,
            kind="export",
            status="queued",
            output_dir=req.output_dir,
        )
        row = q.read_job(conn, jid)
    finally:
        conn.close()
    task = asyncio.create_task(_export.run_export(jid, req.output_dir, req.kind, req.destination))
    q.runner().track(jid, task)
    assert row is not None
    return _job_to_payload(row)


@router.get("/exports/{job_id}")
async def get_export(job_id: str) -> dict[str, Any]:
    conn = _db.connect()
    try:
        row = q.read_job(conn, job_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"export not found: {job_id}")
        return _job_to_payload(row)
    finally:
        conn.close()
