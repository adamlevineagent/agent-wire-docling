"""Scan / stratification router — Wave 1 Agent B.

Implements per contracts/openapi.yaml:
  - POST /scan
  - POST /strata/sample
  - GET  /fs/list          (added post-wave for folder-picker UX)
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import os
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from . import filemap as _filemap
from .db import connect
from .sampling import DocRow, default_seed, pick_sample
from .scanner import ScanError, emit_filemaps_for_scan, scan_folder

router = APIRouter(tags=["scan"])


# ─── Filesystem browsing (for folder-picker UX) ─────────────────────────────


class FsEntry(BaseModel):
    name: str
    path: str
    kind: str  # "dir" — we only surface directories; files are counted separately


class FsListResult(BaseModel):
    path: str
    parent: str | None
    entries: list[FsEntry]
    file_count: int  # count of non-dir children (hint for the UI)


@router.get("/fs/list", response_model=FsListResult)
def fs_list(path: str | None = Query(default=None)) -> FsListResult:
    """List directories under an absolute path.

    - `path` defaults to user $HOME when not provided.
    - Only directories are listed; files are counted for UI hinting.
    - Hidden entries (starting with ".") are skipped unless the path itself is a dotdir.
    - `..` segments in input are rejected.
    """
    raw = path or os.path.expanduser("~")
    if ".." in Path(raw).parts:
        raise HTTPException(status_code=400, detail="relative segments not allowed")
    p = Path(raw).expanduser().resolve()
    if not p.exists() or not p.is_dir():
        raise HTTPException(status_code=404, detail=f"not a directory: {p}")

    entries: list[FsEntry] = []
    file_count = 0
    try:
        for child in sorted(p.iterdir(), key=lambda c: c.name.lower()):
            if child.name.startswith(".") and not p.name.startswith("."):
                continue
            try:
                if child.is_dir():
                    entries.append(FsEntry(name=child.name, path=str(child), kind="dir"))
                else:
                    file_count += 1
            except OSError:
                # broken symlink, permission denied on stat — skip silently
                continue
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e

    parent = str(p.parent) if p.parent != p else None
    return FsListResult(path=str(p), parent=parent, entries=entries, file_count=file_count)


# ─── Pydantic request/response models (shapes match openapi.yaml) ───────────


class ScanRequest(BaseModel):
    folder: str
    follow_symlinks: bool = False
    max_files: int = 50000


class StratumOut(BaseModel):
    name: str
    size: int
    sample_size_hint: int
    exhaustive: bool
    example_paths: list[str]


class SkippedOut(BaseModel):
    path: str
    reason: str


class ScanResult(BaseModel):
    scan_id: str
    folder: str
    total_files: int
    strata: list[StratumOut]
    skipped: list[SkippedOut]
    poppler_missing: bool = False
    folders_with_filemaps: int = 0
    files_new: int = 0
    files_deleted: int = 0


class SampleRequest(BaseModel):
    scan_id: str
    n: int = 5
    seed: int | None = None
    exclude_hashes: list[str] = Field(default_factory=list)


class DocRefOut(BaseModel):
    source_sha256: str
    source_path: str
    source_format: str
    size_bytes: int | None = None
    page_count: int | None = None


class SampleStratumOut(BaseModel):
    name: str
    docs: list[DocRefOut]


class SampleResult(BaseModel):
    seed: int
    strata: list[SampleStratumOut]


# ─── Handlers ───────────────────────────────────────────────────────────────

_SAMPLE_HINT_DEFAULT = 5
_TINY_STRATUM_THRESHOLD = 6


@router.get("/scans/latest", response_model=ScanResult | None)
def get_latest_scan(folder: str = Query(...)) -> ScanResult | None:
    """Return the most recent successful scan for a folder, reconstructed
    from SQLite, or null if no scan has been run for it. Frontend uses
    this to skip a re-scan when the user re-enters or clicks a Recent item.
    """
    folder = str(Path(folder).expanduser().resolve())
    with connect() as conn:
        row = conn.execute(
            "SELECT id, folder_root, total_files, skipped_count "
            "FROM scans WHERE folder_root = ? ORDER BY datetime(created_at) DESC LIMIT 1",
            (folder,),
        ).fetchone()
        if not row:
            return None
        scan_id = row[0]
        # Reconstruct strata + skipped from sibling tables.
        strata_rows = conn.execute(
            "SELECT name, size, exhaustive FROM strata WHERE scan_id = ? ORDER BY name",
            (scan_id,),
        ).fetchall()
        # Examples per stratum: pull a few source paths from scan_docs
        strata_out: list[StratumOut] = []
        for sname, ssize, sexhaustive in strata_rows:
            ex = conn.execute(
                "SELECT source_path FROM scan_docs WHERE scan_id = ? AND stratum = ? LIMIT 3",
                (scan_id, sname),
            ).fetchall()
            exhaustive = bool(sexhaustive)
            hint = ssize if exhaustive else min(_SAMPLE_HINT_DEFAULT, ssize)
            strata_out.append(
                StratumOut(
                    name=sname,
                    size=ssize,
                    sample_size_hint=hint,
                    exhaustive=exhaustive,
                    example_paths=[r[0] for r in ex],
                )
            )
    return ScanResult(
        scan_id=scan_id,
        folder=row[1],
        total_files=row[2],
        strata=strata_out,
        skipped=[],  # Skipped list isn't reconstructible from the current schema; empty is fine for "Recent" UX.
        poppler_missing=False,
        folders_with_filemaps=0,
    )


# Per-folder scan dedupe: if multiple POST /scan requests arrive for the
# same folder, only run one scan; the rest await its result. Prevents the
# "user clicks Scan five times → backend serially runs five 90-second
# scans pegging CPU at 100%" failure mode.
_scan_locks: dict[str, asyncio.Lock] = {}
_scan_results_cache: dict[str, tuple[float, ScanResult]] = {}
_SCAN_DEDUPE_TTL_S = 30.0  # Within 30s of a successful scan, return cached.


def _do_scan_sync(req: ScanRequest) -> ScanResult:
    """Sync scan body (CPU-bound work in a thread). Same logic that the
    handler used pre-dedupe — extracted so we can run it via asyncio.to_thread.
    """
    out = scan_folder(
        req.folder,
        follow_symlinks=req.follow_symlinks,
        max_files=req.max_files,
    )

    scan_id = str(uuid.uuid4())
    now = dt.datetime.now(dt.UTC).isoformat()

    by_stratum: dict[str, list[Any]] = {}
    for d in out.docs:
        by_stratum.setdefault(d.stratum, []).append(d)

    strata_out: list[StratumOut] = []
    for name, docs in sorted(by_stratum.items()):
        size = len(docs)
        exhaustive = size <= _TINY_STRATUM_THRESHOLD
        hint = size if exhaustive else min(_SAMPLE_HINT_DEFAULT, size)
        examples = [d.source_path for d in docs[:3]]
        strata_out.append(
            StratumOut(
                name=name,
                size=size,
                sample_size_hint=hint,
                exhaustive=exhaustive,
                example_paths=examples,
            )
        )

    with connect() as conn:
        conn.execute(
            "INSERT INTO scans (id, folder_root, total_files, skipped_count, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (scan_id, out.folder, out.total_files, len(out.skipped), now),
        )
        for s in strata_out:
            conn.execute(
                "INSERT INTO strata (scan_id, name, size, exhaustive) VALUES (?, ?, ?, ?)",
                (scan_id, s.name, s.size, 1 if s.exhaustive else 0),
            )
        seen: set[str] = set()
        for d in out.docs:
            if d.source_sha256 in seen:
                continue
            seen.add(d.source_sha256)
            conn.execute(
                "INSERT INTO scan_docs "
                "(scan_id, source_sha256, source_path, source_format, stratum, "
                "size_bytes, page_count, signals_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    scan_id, d.source_sha256, d.source_path, d.source_format,
                    d.stratum, d.size_bytes, d.page_count, json.dumps(d.signals),
                ),
            )
        conn.commit()

    try:
        folders_written = emit_filemaps_for_scan(out, scan_id, root=Path(out.folder))
    except Exception:
        folders_written = 0

    return ScanResult(
        scan_id=scan_id,
        folder=out.folder,
        total_files=out.total_files,
        strata=strata_out,
        skipped=[SkippedOut(path=s.path, reason=s.reason) for s in out.skipped],
        poppler_missing=out.poppler_missing,
        folders_with_filemaps=folders_written,
    )


@router.post("/scan", response_model=ScanResult)
async def scan(req: ScanRequest) -> ScanResult:
    """Walk a folder, stratify, write filemaps. Deduplicated per folder so
    rapid repeated clicks collapse into one underlying scan."""
    import time as _time
    folder_key = str(Path(req.folder).expanduser().resolve())

    # Fast path: a recent successful scan exists in cache → return it.
    cached = _scan_results_cache.get(folder_key)
    if cached and (_time.time() - cached[0]) < _SCAN_DEDUPE_TTL_S:
        return cached[1]

    # Acquire per-folder lock. If another scan is in-flight for the same
    # folder, all callers serialize here; the first wins, the rest pick
    # up the cached result on lock acquire.
    lock = _scan_locks.setdefault(folder_key, asyncio.Lock())
    async with lock:
        cached = _scan_results_cache.get(folder_key)
        if cached and (_time.time() - cached[0]) < _SCAN_DEDUPE_TTL_S:
            return cached[1]
        try:
            result = await asyncio.to_thread(_do_scan_sync, req)
        except ScanError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        _scan_results_cache[folder_key] = (_time.time(), result)
        return result


# Old sync handler retained as `_legacy_scan_sync_unused` for reference; the
# active handler above wraps the same logic with async dedupe.
def _legacy_scan_sync_unused(req: ScanRequest) -> ScanResult:
    try:
        out = scan_folder(
            req.folder,
            follow_symlinks=req.follow_symlinks,
            max_files=req.max_files,
        )
    except ScanError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    scan_id = str(uuid.uuid4())
    now = dt.datetime.now(dt.UTC).isoformat()

    by_stratum: dict[str, list[Any]] = {}
    for d in out.docs:
        by_stratum.setdefault(d.stratum, []).append(d)

    strata_out: list[StratumOut] = []
    for name, docs in sorted(by_stratum.items()):
        size = len(docs)
        exhaustive = size <= _TINY_STRATUM_THRESHOLD
        hint = size if exhaustive else min(_SAMPLE_HINT_DEFAULT, size)
        examples = [d.source_path for d in docs[:3]]
        strata_out.append(
            StratumOut(
                name=name,
                size=size,
                sample_size_hint=hint,
                exhaustive=exhaustive,
                example_paths=examples,
            )
        )

    with connect() as conn:
        conn.execute(
            "INSERT INTO scans (id, folder_root, total_files, skipped_count, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (scan_id, out.folder, out.total_files, len(out.skipped), now),
        )
        for s in strata_out:
            conn.execute(
                "INSERT INTO strata (scan_id, name, size, exhaustive) VALUES (?, ?, ?, ?)",
                (scan_id, s.name, s.size, 1 if s.exhaustive else 0),
            )
        seen: set[str] = set()
        for d in out.docs:
            if d.source_sha256 in seen:
                continue
            seen.add(d.source_sha256)
            conn.execute(
                "INSERT INTO scan_docs "
                "(scan_id, source_sha256, source_path, source_format, stratum, "
                "size_bytes, page_count, signals_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    scan_id,
                    d.source_sha256,
                    d.source_path,
                    d.source_format,
                    d.stratum,
                    d.size_bytes,
                    d.page_count,
                    json.dumps(d.signals),
                ),
            )
        conn.commit()

    # Emit filemaps per folder (Level B).
    try:
        folders_written = emit_filemaps_for_scan(out, scan_id, root=Path(out.folder))
    except Exception:
        folders_written = 0

    return ScanResult(
        scan_id=scan_id,
        folder=out.folder,
        total_files=out.total_files,
        strata=strata_out,
        skipped=[SkippedOut(path=s.path, reason=s.reason) for s in out.skipped],
        poppler_missing=out.poppler_missing,
        folders_with_filemaps=folders_written,
    )


# ─── Filemap endpoints (Level B) ────────────────────────────────────────────


class FilemapUpdate(BaseModel):
    path: str
    user_included: bool | None = None
    user_content_type: str | None = None
    user_notes: str | None = None


class FilemapPatchRequest(BaseModel):
    files: list[FilemapUpdate] = Field(default_factory=list)
    defaults: dict[str, Any] | None = None


@router.get("/filemap")
def get_filemap(folder: str = Query(...)) -> dict[str, Any]:
    fm = _filemap.read_filemap(folder)
    if fm is None:
        raise HTTPException(status_code=404, detail=f"no filemap at {folder}")
    return fm


@router.patch("/filemap")
def patch_filemap(
    req: FilemapPatchRequest, folder: str = Query(...)
) -> dict[str, Any]:
    updates = [u.model_dump(exclude_unset=True) for u in req.files]
    try:
        return _filemap.update_user_fields(folder, updates, defaults=req.defaults)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/filetree")
def get_filetree(root: str = Query(...)) -> dict[str, Any]:
    p = Path(root)
    if not p.exists() or not p.is_dir():
        raise HTTPException(status_code=404, detail=f"not a directory: {root}")
    return _filemap.build_filetree(p)


@router.post("/strata/sample", response_model=SampleResult)
def sample(req: SampleRequest) -> SampleResult:
    seed = req.seed if req.seed is not None else default_seed(req.scan_id)
    exclude = set(req.exclude_hashes)

    with connect() as conn:
        cur = conn.execute(
            "SELECT name, exhaustive FROM strata WHERE scan_id = ? ORDER BY name",
            (req.scan_id,),
        )
        strata_rows = cur.fetchall()
        if not strata_rows:
            raise HTTPException(status_code=404, detail=f"scan_id not found: {req.scan_id}")

        results: list[SampleStratumOut] = []
        for name, exhaustive in strata_rows:
            dcur = conn.execute(
                "SELECT source_sha256, source_path, source_format, size_bytes, page_count "
                "FROM scan_docs WHERE scan_id = ? AND stratum = ?",
                (req.scan_id, name),
            )
            docs = [
                DocRow(
                    source_sha256=r[0],
                    source_path=r[1],
                    source_format=r[2],
                    size_bytes=r[3],
                    page_count=r[4],
                )
                for r in dcur.fetchall()
            ]

            if exhaustive:
                picked = [
                    d for d in sorted(docs, key=lambda x: x.source_sha256)
                    if d.source_sha256 not in exclude
                ]
            else:
                picked = pick_sample(
                    docs,
                    n=req.n,
                    seed=seed,
                    stratum_name=name,
                    exclude_hashes=exclude,
                )

            results.append(
                SampleStratumOut(
                    name=name,
                    docs=[
                        DocRefOut(
                            source_sha256=d.source_sha256,
                            source_path=d.source_path,
                            source_format=d.source_format,
                            size_bytes=d.size_bytes,
                            page_count=d.page_count,
                        )
                        for d in picked
                    ],
                )
            )

    return SampleResult(seed=seed, strata=results)
