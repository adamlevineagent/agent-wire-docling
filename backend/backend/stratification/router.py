"""Scan / stratification router — Wave 1 Agent B.

Implements per contracts/openapi.yaml:
  - POST /scan
  - POST /strata/sample
"""

from __future__ import annotations

import datetime as dt
import json
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .db import connect
from .sampling import DocRow, default_seed, pick_sample
from .scanner import ScanError, scan_folder

router = APIRouter(tags=["scan"])


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


@router.post("/scan", response_model=ScanResult)
def scan(req: ScanRequest) -> ScanResult:
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

    return ScanResult(
        scan_id=scan_id,
        folder=out.folder,
        total_files=out.total_files,
        strata=strata_out,
        skipped=[SkippedOut(path=s.path, reason=s.reason) for s in out.skipped],
        poppler_missing=out.poppler_missing,
    )


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
