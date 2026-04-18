"""Docling sidecar wrapper.

Implements the per-doc output contract locked in docs/docling-probes.md:

  output_dir/<source_sha256>/
    source.<ext>        original bytes
    doc.md              markdown (page-break-marked)
    doc.json            DoclingDocument
    doc.anchors.json    element→offset sidecar for bidirectional highlight
    meta.json           DocMeta (pipeline used, stats, quality signals, timings)
    images/...          figures, if any emitted

Atomic write: everything lands in `<output_dir>/<hash>.tmp/`, then the whole
dir is renamed to `<output_dir>/<hash>/`. Resume semantics (Agent C) rely on
this — a stray `.tmp` dir means a partial/crashed conversion.

Cache env vars are set in backend/main.py BEFORE any Docling import. We
import Docling lazily inside functions so tests don't pay the import cost
unless they actually convert.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from importlib.metadata import version as pkg_version
from pathlib import Path
from typing import Any

from .pipeline import PipelineParams, normalize, pipeline_hash

# ─────────────────────────────────────────────────────────────────────────────
# Format + hashing utilities

_EXT_TO_FORMAT: dict[str, str] = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".xlsx": "xlsx",
    ".pptx": "pptx",
    ".html": "html",
    ".htm": "html",
    ".txt": "txt",
    ".md": "md",
    ".markdown": "md",
    ".tex": "latex",
    ".latex": "latex",
    ".csv": "csv",
}

_FORMAT_TO_CONTENT_TYPE: dict[str, str] = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "html": "text/html",
    "txt": "text/plain",
    "md": "text/markdown",
    "latex": "application/x-latex",
    "csv": "text/csv",
}


def detect_format(path: Path) -> str:
    return _EXT_TO_FORMAT.get(path.suffix.lower(), path.suffix.lstrip(".").lower() or "bin")


def content_type_for(fmt: str) -> str:
    return _FORMAT_TO_CONTENT_TYPE.get(fmt, "application/octet-stream")


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


# ─────────────────────────────────────────────────────────────────────────────
# Output layout


@dataclass(frozen=True)
class DocPaths:
    root: Path  # output_dir/<hash>/
    source: Path
    md: Path
    json_: Path
    anchors: Path
    meta: Path
    images_dir: Path

    @classmethod
    def for_hash(cls, output_dir: Path, source_sha256: str, source_format: str) -> DocPaths:
        root = output_dir / source_sha256
        return cls(
            root=root,
            source=root / f"source.{source_format}",
            md=root / "doc.md",
            json_=root / "doc.json",
            anchors=root / "doc.anchors.json",
            meta=root / "meta.json",
            images_dir=root / "images",
        )


@dataclass(frozen=True)
class MirroredPaths:
    """Mirrored layout (Level B): output files sit alongside a mirror of the source tree.

    Example: source `/root/a/b/report.pdf`, output_dir `/out`, root_base `/root` →
        /out/a/b/report.pdf.md
        /out/a/b/report.pdf.json
        /out/a/b/report.pdf.anchors.json
        /out/a/b/report.pdf.meta.json
        /out/a/b/images/report.pdf/*.png
    """

    dir: Path  # the folder the sidecars live in
    stem: str  # `<source_basename_with_ext>` (e.g. "report.pdf")
    md: Path
    json_: Path
    anchors: Path
    meta: Path
    images_dir: Path

    @classmethod
    def for_source(
        cls,
        source_path: Path,
        output_dir: Path,
        output_root: Path | None = None,
    ) -> MirroredPaths:
        source_path = Path(source_path).resolve()
        if output_root is not None:
            output_root = Path(output_root).resolve()
            try:
                rel_parent = source_path.parent.relative_to(output_root)
            except ValueError:
                rel_parent = Path(source_path.parent.name)
            target_dir = output_dir / rel_parent
        else:
            target_dir = output_dir
        stem = source_path.name  # basename with extension
        return cls(
            dir=target_dir,
            stem=stem,
            md=target_dir / f"{stem}.md",
            json_=target_dir / f"{stem}.json",
            anchors=target_dir / f"{stem}.anchors.json",
            meta=target_dir / f"{stem}.meta.json",
            images_dir=target_dir / "images" / stem,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Pipeline → Docling DocumentConverter construction


def _build_converter(params: PipelineParams) -> Any:
    """Build a Docling DocumentConverter honoring PipelineParams.

    Imported lazily so cache env vars (set in main.py) are live before
    Docling loads.
    """
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (
        PdfPipelineOptions,
        RapidOcrOptions,
        TesseractCliOcrOptions,
    )
    from docling.document_converter import DocumentConverter, PdfFormatOption

    pdf_opts = PdfPipelineOptions()
    pdf_opts.do_ocr = bool(params.ocr.enabled)
    pdf_opts.do_table_structure = bool(params.tables.enabled)
    pdf_opts.do_formula_enrichment = bool(params.enrichments.formulas)
    pdf_opts.do_code_enrichment = bool(params.enrichments.code)
    pdf_opts.do_chart_extraction = bool(params.enrichments.charts)

    if params.ocr.enabled:
        engine = (params.ocr.engine or "tesseract").lower()
        if engine == "rapidocr":
            pdf_opts.ocr_options = RapidOcrOptions()
        else:
            # "tesseract" → use the CLI variant which calls /opt/homebrew/bin/tesseract
            pdf_opts.ocr_options = TesseractCliOcrOptions()

    format_options: dict[Any, Any] = {
        InputFormat.PDF: PdfFormatOption(pipeline_options=pdf_opts),
    }

    # VLM pipeline is deferred (see ledger); flag is accepted but not wired here.
    return DocumentConverter(format_options=format_options)


# ─────────────────────────────────────────────────────────────────────────────
# Anchor sidecar emission


def _bbox_to_dict(bbox: Any) -> dict[str, Any] | None:
    if bbox is None:
        return None
    # Docling BoundingBox is a pydantic model; handle both it and plain dicts
    if hasattr(bbox, "model_dump"):
        d = bbox.model_dump()
    elif isinstance(bbox, dict):
        d = dict(bbox)
    else:
        return None
    out: dict[str, Any] = {
        "l": float(d.get("l", 0.0)),
        "t": float(d.get("t", 0.0)),
        "r": float(d.get("r", 0.0)),
        "b": float(d.get("b", 0.0)),
    }
    co = d.get("coord_origin", "BOTTOMLEFT")
    # Docling uses an enum; stringify
    out["coord_origin"] = getattr(co, "value", co) if co is not None else "BOTTOMLEFT"
    if isinstance(out["coord_origin"], str):
        out["coord_origin"] = out["coord_origin"].upper()
    return out


def _build_anchors(doc: Any, md_text: str) -> tuple[list[dict[str, Any]], list[int]]:
    """Emit one Anchor per iterable item.

    Strategy (per P1.4 probe): for each item, render its markdown in isolation,
    then locate its first occurrence in the full `md_text` starting from our
    running cursor. When the item doesn't render to markdown (e.g. some
    groups/containers), skip it. Returns (anchors, empty_pages_per_probe).
    """
    anchors: list[dict[str, Any]] = []
    pages_with_text: set[int] = set()
    cursor = 0

    items = list(doc.iterate_items())
    for i, (item, _level) in enumerate(items):
        self_ref = getattr(item, "self_ref", None)
        label = getattr(item, "label", None)
        label_str = getattr(label, "value", label) if label is not None else ""

        # Per-item markdown slice
        try:
            slice_md = doc.export_to_markdown(from_element=i, to_element=i + 1).strip()
        except Exception:
            slice_md = ""

        page_no = 1
        bbox_dict: dict[str, Any] | None = None
        prov = getattr(item, "prov", None) or []
        if prov:
            p0 = prov[0]
            page_no = int(getattr(p0, "page_no", 1) or 1)
            bbox_dict = _bbox_to_dict(getattr(p0, "bbox", None))

        byte_start = -1
        byte_end = -1
        if slice_md:
            # Take first non-whitespace line fragment for robust locating
            needle = slice_md.splitlines()[0][:80]
            if needle:
                idx = md_text.find(needle, cursor)
                if idx < 0:
                    idx = md_text.find(needle)
                if idx >= 0:
                    byte_start = len(md_text[:idx].encode("utf-8"))
                    byte_end = byte_start + len(slice_md.encode("utf-8"))
                    cursor = idx + len(needle)
                    pages_with_text.add(page_no)

        if self_ref is None:
            continue

        anchors.append(
            {
                "self_ref": str(self_ref),
                "byte_start": byte_start,
                "byte_end": byte_end,
                "page": page_no,
                "label": str(label_str),
                "bbox": bbox_dict,
            }
        )

    # compute empty pages from doc.pages vs pages_with_text
    pages_attr = getattr(doc, "pages", None) or {}
    all_pages: list[int] = []
    if isinstance(pages_attr, dict):
        for k, v in pages_attr.items():
            try:
                all_pages.append(int(getattr(v, "page_no", None) or k))
            except Exception:
                continue
    empty_pages = sorted(p for p in all_pages if p not in pages_with_text)
    return anchors, empty_pages


# ─────────────────────────────────────────────────────────────────────────────
# Meta.json assembly


def _collect_stats(doc: Any, md_text: str, json_size: int) -> dict[str, Any]:
    pages_attr = getattr(doc, "pages", None) or {}
    page_count = len(pages_attr) if isinstance(pages_attr, dict) else 0
    texts = getattr(doc, "texts", None) or []
    tables = getattr(doc, "tables", None) or []
    pictures = getattr(doc, "pictures", None) or []
    return {
        "page_count": int(page_count),
        "text_element_count": len(texts),
        "table_count": len(tables),
        "picture_count": len(pictures),
        "md_char_count": len(md_text),
        "json_size_bytes": int(json_size),
    }


def _collect_quality(
    doc: Any,
    empty_pages: list[int],
) -> dict[str, Any]:
    """Extract per-page OCR confidence (when available) + build warnings."""
    ocr_per_page: list[float] = []
    # Docling exposes confidence on ConversionResult, not the doc itself.
    # We surface empty_pages + parse warnings here and leave OCR conf to meta
    # assembly which has the ConversionResult.
    warnings: list[dict[str, Any]] = [
        {"page": p, "kind": "empty_page", "value": None, "message": None}
        for p in empty_pages
    ]
    pictures = getattr(doc, "pictures", None) or []
    for pic in pictures:
        # figure_missing is our marker for pictures we couldn't render to file.
        # Actual image-rendering is deferred (placeholder mode only, per ledger).
        prov = getattr(pic, "prov", None) or []
        if not prov:
            warnings.append(
                {
                    "page": 1,
                    "kind": "figure_missing",
                    "value": None,
                    "message": f"picture {getattr(pic, 'self_ref', '')} has no provenance",
                }
            )
    return {
        "ocr_confidence_per_page": ocr_per_page,
        "empty_pages": empty_pages,
        "warnings": warnings,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Public API


@dataclass
class ConversionOutcome:
    meta: dict[str, Any]
    paths: DocPaths
    skipped: bool  # True if the output existed and we returned the cached meta


def convert_source(
    source_path: Path,
    output_dir: Path,
    params: PipelineParams | dict[str, Any] | None = None,
    *,
    force: bool = False,
) -> ConversionOutcome:
    """Convert a single source file into the locked per-doc output layout.

    Returns the DocMeta dict (contract shape from openapi.yaml) + on-disk paths.
    If the output already exists for (source_sha256, pipeline_hash) and `force`
    is False, the existing `meta.json` is returned as-is (no-op resume).
    """
    source_path = Path(source_path).resolve()
    if not source_path.is_file():
        raise FileNotFoundError(f"source_path does not exist or is not a file: {source_path}")

    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    pp = normalize(params)
    ph = pipeline_hash(pp)
    sha = sha256_file(source_path)
    fmt = detect_format(source_path)
    paths = DocPaths.for_hash(output_dir, sha, fmt)

    # No-op resume: same hash + same pipeline + complete meta on disk
    if not force and paths.meta.exists() and paths.md.exists() and paths.json_.exists():
        try:
            existing = json.loads(paths.meta.read_text())
            if existing.get("pipeline_hash") == ph:
                _upsert_docs_row(
                    output_dir=output_dir,
                    meta=existing,
                )
                return ConversionOutcome(meta=existing, paths=paths, skipped=True)
        except Exception:
            # fall through — we'll overwrite a corrupt meta
            pass

    # Build a fresh tmp dir and clean any stragglers
    tmp_root = output_dir / f"{sha}.tmp"
    if tmp_root.exists():
        shutil.rmtree(tmp_root, ignore_errors=True)
    tmp_root.mkdir(parents=True, exist_ok=True)
    tmp_paths = DocPaths(
        root=tmp_root,
        source=tmp_root / paths.source.name,
        md=tmp_root / "doc.md",
        json_=tmp_root / "doc.json",
        anchors=tmp_root / "doc.anchors.json",
        meta=tmp_root / "meta.json",
        images_dir=tmp_root / "images",
    )
    tmp_paths.images_dir.mkdir(parents=True, exist_ok=True)

    # Copy source first so it's always preserved even if Docling crashes
    shutil.copyfile(source_path, tmp_paths.source)

    started_at = datetime.now(UTC)
    t0 = time.perf_counter()
    status = "ok"
    error_msg: str | None = None
    md_text = ""
    json_obj: dict[str, Any] = {}
    anchors: list[dict[str, Any]] = []
    empty_pages: list[int] = []
    doc_for_stats: Any = None
    json_size = 0

    try:
        converter = _build_converter(pp)
        result = converter.convert(str(tmp_paths.source))
        doc = result.document
        doc_for_stats = doc
        md_text = doc.export_to_markdown(page_break_placeholder="<!--- page-break --->")
        json_obj = doc.export_to_dict()
        anchors, empty_pages = _build_anchors(doc, md_text)
    except Exception as exc:
        status = "error"
        error_msg = f"{type(exc).__name__}: {exc}"

    # Always write the artifacts we do have — partial failures still leave
    # a useful source.<ext> + meta.json describing what went wrong.
    tmp_paths.md.write_text(md_text, encoding="utf-8")
    # json.dump with indent=None for compactness (DoclingDocument JSON can be large)
    tmp_paths.json_.write_text(
        json.dumps(json_obj, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    tmp_paths.anchors.write_text(
        json.dumps(anchors, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    json_size = tmp_paths.json_.stat().st_size

    runtime_ms = int((time.perf_counter() - t0) * 1000)

    stats = (
        _collect_stats(doc_for_stats, md_text, json_size)
        if doc_for_stats is not None
        else {
            "page_count": 0,
            "text_element_count": 0,
            "table_count": 0,
            "picture_count": 0,
            "md_char_count": len(md_text),
            "json_size_bytes": json_size,
        }
    )
    quality = (
        _collect_quality(doc_for_stats, empty_pages)
        if doc_for_stats is not None
        else {"ocr_confidence_per_page": [], "empty_pages": [], "warnings": []}
    )

    try:
        docling_ver = pkg_version("docling")
    except Exception:
        docling_ver = "unknown"

    meta: dict[str, Any] = {
        "source_sha256": sha,
        "source_path": str(source_path),
        "source_format": fmt,
        "docling_version": docling_ver,
        "pipeline_params": pp.model_dump(),
        "pipeline_hash": ph,
        "runtime_ms": runtime_ms,
        "status": status,
        "error": error_msg,
        "stats": stats,
        "quality_signals": quality,
        "converted_at": started_at.isoformat().replace("+00:00", "Z"),
    }
    tmp_paths.meta.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # Fsync files before rename — belt-and-suspenders durability
    for p in (tmp_paths.md, tmp_paths.json_, tmp_paths.anchors, tmp_paths.meta, tmp_paths.source):
        try:
            fd = os.open(str(p), os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        except OSError:
            pass

    # Atomic rename: remove any stale final dir then move tmp into place.
    if paths.root.exists():
        shutil.rmtree(paths.root)
    os.replace(str(tmp_root), str(paths.root))

    _upsert_docs_row(output_dir=output_dir, meta=meta)
    return ConversionOutcome(meta=meta, paths=paths, skipped=False)


# ─────────────────────────────────────────────────────────────────────────────
# Mirrored output (Level B)


@dataclass
class MirroredOutcome:
    meta: dict[str, Any]
    paths: MirroredPaths
    skipped: bool


def convert_source_mirrored(
    source_path: Path,
    output_dir: Path,
    params: PipelineParams | dict[str, Any] | None = None,
    *,
    output_root: Path | None = None,
    force: bool = False,
) -> MirroredOutcome:
    """Convert a source file into the mirrored output layout (Level B).

    Output layout: `<output_dir>/<rel_parent>/<source_name>.{md,json,anchors.json,meta.json}`
    where `rel_parent = source_path.parent.relative_to(output_root)`. If
    `output_root` is None, sidecars land directly under `output_dir`.

    Atomic write: render into a `.tmp-<uuid>` sibling dir, then move files
    into place.
    """
    import uuid as _uuid

    source_path = Path(source_path).resolve()
    if not source_path.is_file():
        raise FileNotFoundError(f"source_path does not exist: {source_path}")
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    pp = normalize(params)
    ph = pipeline_hash(pp)
    sha = sha256_file(source_path)
    fmt = detect_format(source_path)

    mpaths = MirroredPaths.for_source(source_path, output_dir, output_root)
    mpaths.dir.mkdir(parents=True, exist_ok=True)

    # No-op resume: same pipeline_hash already written
    if not force and mpaths.meta.exists() and mpaths.md.exists() and mpaths.json_.exists():
        try:
            existing = json.loads(mpaths.meta.read_text())
            if existing.get("pipeline_hash") == ph:
                return MirroredOutcome(meta=existing, paths=mpaths, skipped=True)
        except Exception:
            pass

    tmp_dir = mpaths.dir / f".tmp-{_uuid.uuid4().hex}-{mpaths.stem}"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_md = tmp_dir / f"{mpaths.stem}.md"
    tmp_json = tmp_dir / f"{mpaths.stem}.json"
    tmp_anchors = tmp_dir / f"{mpaths.stem}.anchors.json"
    tmp_meta = tmp_dir / f"{mpaths.stem}.meta.json"
    tmp_images = tmp_dir / "images" / mpaths.stem
    tmp_images.mkdir(parents=True, exist_ok=True)

    started_at = datetime.now(UTC)
    t0 = time.perf_counter()
    status = "ok"
    error_msg: str | None = None
    md_text = ""
    json_obj: dict[str, Any] = {}
    anchors: list[dict[str, Any]] = []
    empty_pages: list[int] = []
    doc_for_stats: Any = None

    try:
        converter = _build_converter(pp)
        result = converter.convert(str(source_path))
        doc = result.document
        doc_for_stats = doc
        md_text = doc.export_to_markdown(page_break_placeholder="<!--- page-break --->")
        json_obj = doc.export_to_dict()
        anchors, empty_pages = _build_anchors(doc, md_text)
    except Exception as exc:
        status = "error"
        error_msg = f"{type(exc).__name__}: {exc}"

    tmp_md.write_text(md_text, encoding="utf-8")
    tmp_json.write_text(
        json.dumps(json_obj, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    tmp_anchors.write_text(
        json.dumps(anchors, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    json_size = tmp_json.stat().st_size
    runtime_ms = int((time.perf_counter() - t0) * 1000)

    stats = (
        _collect_stats(doc_for_stats, md_text, json_size)
        if doc_for_stats is not None
        else {
            "page_count": 0,
            "text_element_count": 0,
            "table_count": 0,
            "picture_count": 0,
            "md_char_count": len(md_text),
            "json_size_bytes": json_size,
        }
    )
    quality = (
        _collect_quality(doc_for_stats, empty_pages)
        if doc_for_stats is not None
        else {"ocr_confidence_per_page": [], "empty_pages": [], "warnings": []}
    )

    try:
        docling_ver = pkg_version("docling")
    except Exception:
        docling_ver = "unknown"

    meta: dict[str, Any] = {
        "source_sha256": sha,
        "source_path": str(source_path),
        "source_format": fmt,
        "docling_version": docling_ver,
        "pipeline_params": pp.model_dump(),
        "pipeline_hash": ph,
        "runtime_ms": runtime_ms,
        "status": status,
        "error": error_msg,
        "stats": stats,
        "quality_signals": quality,
        "converted_at": started_at.isoformat().replace("+00:00", "Z"),
        "output_path": str(mpaths.md),
    }
    tmp_meta.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Move each into place atomically (files individually).
    for src, dst in [
        (tmp_md, mpaths.md),
        (tmp_json, mpaths.json_),
        (tmp_anchors, mpaths.anchors),
        (tmp_meta, mpaths.meta),
    ]:
        os.replace(str(src), str(dst))
    # Move images dir (replacing existing)
    if mpaths.images_dir.exists():
        shutil.rmtree(mpaths.images_dir, ignore_errors=True)
    mpaths.images_dir.parent.mkdir(parents=True, exist_ok=True)
    os.replace(str(tmp_images), str(mpaths.images_dir))
    shutil.rmtree(tmp_dir, ignore_errors=True)

    _upsert_docs_row(output_dir=output_dir, meta=meta)
    return MirroredOutcome(meta=meta, paths=mpaths, skipped=False)


# ─────────────────────────────────────────────────────────────────────────────
# docs-table upsert (Agent C owns migrations; we INSERT per the contract)


def _upsert_docs_row(*, output_dir: Path, meta: dict[str, Any]) -> None:
    try:
        from .db import connect
    except Exception:
        return

    stats = meta.get("stats") or {}
    quality = meta.get("quality_signals") or {}
    warnings = quality.get("warnings") or []
    ocr_list = quality.get("ocr_confidence_per_page") or []
    ocr_avg: float | None = (sum(ocr_list) / len(ocr_list)) if ocr_list else None

    quality_summary = {
        "ocr_avg": ocr_avg,
        "warning_count": len(warnings),
        "empty_page_count": len(quality.get("empty_pages") or []),
    }

    try:
        conn = connect()
        try:
            conn.execute(
                """
                INSERT INTO docs (
                    output_dir, source_sha256, pipeline_hash,
                    source_path, source_format, status, stratum,
                    docling_version, runtime_ms, md_char_count, json_size_bytes,
                    quality_json, error, converted_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(output_dir, source_sha256, pipeline_hash) DO UPDATE SET
                    source_path     = excluded.source_path,
                    source_format   = excluded.source_format,
                    status          = excluded.status,
                    docling_version = excluded.docling_version,
                    runtime_ms      = excluded.runtime_ms,
                    md_char_count   = excluded.md_char_count,
                    json_size_bytes = excluded.json_size_bytes,
                    quality_json    = excluded.quality_json,
                    error           = excluded.error,
                    converted_at    = excluded.converted_at
                """,
                (
                    str(output_dir),
                    meta["source_sha256"],
                    meta["pipeline_hash"],
                    meta["source_path"],
                    meta["source_format"],
                    "complete" if meta.get("status") == "ok" else "error",
                    None,
                    meta.get("docling_version"),
                    int(meta.get("runtime_ms") or 0),
                    int(stats.get("md_char_count") or 0),
                    int(stats.get("json_size_bytes") or 0),
                    json.dumps(quality_summary),
                    meta.get("error"),
                    meta.get("converted_at"),
                ),
            )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        # DB unavailable shouldn't break conversion; main.py health check
        # surfaces DB state. Conversion artifacts on disk are the source of truth.
        pass
