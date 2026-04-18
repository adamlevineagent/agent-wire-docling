"""Conversion router — Wave 1 Agent A.

Implements per contracts/openapi.yaml:
  - POST /convert
  - POST /docs/{hash}/rerun
  - GET  /docs/{hash}
  - GET  /docs/{hash}/source
  - GET  /docs/{hash}/md
  - GET  /docs/{hash}/json
  - GET  /docs/{hash}/anchors

The `output_dir` for GET /docs/* is not in the URL; we resolve by scanning the
`docs` table (populated on convert) for the most-recent entry matching the
source hash. Tests inject a specific output_dir via the `?output_dir=` query
param escape hatch honored on every doc endpoint.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from pydantic import BaseModel

from .converter import (
    ConversionOutcome,
    DocPaths,
    content_type_for,
    convert_source,
)
from .db import connect
from .pipeline import PipelineParams

router = APIRouter(tags=["convert"])


class ConvertRequest(BaseModel):
    source_path: str
    output_dir: str
    pipeline: PipelineParams | None = None


def _infer_format_from_dir(doc_root: Path) -> str:
    for p in doc_root.iterdir():
        if p.is_file() and p.stem == "source":
            return p.suffix.lstrip(".")
    return "bin"


def _resolve_doc(hash_: str, output_dir: str | None) -> tuple[Path, str]:
    if output_dir:
        od = Path(output_dir).resolve()
        root = od / hash_
        if not root.exists():
            raise HTTPException(status_code=404, detail=f"no output for {hash_} in {od}")
        return od, _infer_format_from_dir(root)

    conn = connect()
    try:
        row = conn.execute(
            """
            SELECT output_dir, source_format FROM docs
            WHERE source_sha256 = ?
            ORDER BY converted_at DESC
            LIMIT 1
            """,
            (hash_,),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail=f"no doc with hash {hash_}")
    return Path(row[0]), row[1]


def _paths(hash_: str, output_dir: str | None) -> DocPaths:
    od, fmt = _resolve_doc(hash_, output_dir)
    return DocPaths.for_hash(od, hash_, fmt)


def _outcome_payload(outcome: ConversionOutcome) -> dict[str, Any]:
    return outcome.meta


@router.post("/convert")
def post_convert(req: ConvertRequest) -> JSONResponse:
    try:
        outcome = convert_source(
            Path(req.source_path),
            Path(req.output_dir),
            params=req.pipeline,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"convert_failed: {exc}") from exc

    if outcome.meta.get("status") == "error":
        return JSONResponse(
            status_code=422,
            content={
                "code": "convert_failed",
                "message": outcome.meta.get("error") or "unknown",
            },
        )
    return JSONResponse(status_code=200, content=_outcome_payload(outcome))


@router.post("/docs/{hash}/rerun")
def post_rerun(
    hash: str,
    pipeline: PipelineParams,
    output_dir: str | None = Query(default=None),
) -> JSONResponse:
    od, fmt = _resolve_doc(hash, output_dir)

    conn = connect()
    try:
        row = conn.execute(
            """
            SELECT source_path FROM docs
            WHERE output_dir = ? AND source_sha256 = ?
            ORDER BY converted_at DESC
            LIMIT 1
            """,
            (str(od), hash),
        ).fetchone()
    finally:
        conn.close()

    preserved = od / hash / f"source.{fmt}"
    if row and Path(row[0]).exists():
        source_path = Path(row[0])
    elif preserved.exists():
        source_path = preserved
    else:
        raise HTTPException(status_code=404, detail=f"no source bytes for {hash}")

    try:
        outcome = convert_source(source_path, od, params=pipeline)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"rerun_failed: {exc}") from exc

    if outcome.meta.get("status") == "error":
        return JSONResponse(
            status_code=422,
            content={
                "code": "convert_failed",
                "message": outcome.meta.get("error") or "unknown",
            },
        )
    return JSONResponse(status_code=200, content=_outcome_payload(outcome))


@router.get("/docs/{hash}")
def get_doc_meta(hash: str, output_dir: str | None = Query(default=None)) -> JSONResponse:
    paths = _paths(hash, output_dir)
    if not paths.meta.exists():
        raise HTTPException(status_code=404, detail=f"meta.json missing for {hash}")
    return JSONResponse(content=json.loads(paths.meta.read_text(encoding="utf-8")))


@router.get("/docs/{hash}/source")
def get_doc_source(hash: str, output_dir: str | None = Query(default=None)) -> FileResponse:
    paths = _paths(hash, output_dir)
    if not paths.source.exists():
        raise HTTPException(status_code=404, detail=f"source missing for {hash}")
    fmt = paths.source.suffix.lstrip(".")
    return FileResponse(
        str(paths.source),
        media_type=content_type_for(fmt),
        filename=paths.source.name,
    )


@router.get("/docs/{hash}/md")
def get_doc_md(hash: str, output_dir: str | None = Query(default=None)) -> PlainTextResponse:
    paths = _paths(hash, output_dir)
    if not paths.md.exists():
        raise HTTPException(status_code=404, detail=f"doc.md missing for {hash}")
    return PlainTextResponse(
        content=paths.md.read_text(encoding="utf-8"),
        media_type="text/markdown; charset=utf-8",
    )


@router.get("/docs/{hash}/json")
def get_doc_json(hash: str, output_dir: str | None = Query(default=None)) -> Response:
    paths = _paths(hash, output_dir)
    if not paths.json_.exists():
        raise HTTPException(status_code=404, detail=f"doc.json missing for {hash}")
    return Response(
        content=paths.json_.read_bytes(),
        media_type="application/json",
    )


@router.get("/docs/{hash}/anchors")
def get_doc_anchors(hash: str, output_dir: str | None = Query(default=None)) -> JSONResponse:
    paths = _paths(hash, output_dir)
    if not paths.anchors.exists():
        raise HTTPException(status_code=404, detail=f"anchors missing for {hash}")
    return JSONResponse(content=json.loads(paths.anchors.read_text(encoding="utf-8")))
