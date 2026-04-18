"""Folder walk + format detect + cheap probes + stratification.

Pure functions where possible; only `scan_folder` touches the filesystem.
No FastAPI / pydantic types here — router converts.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# ─────────────────────────────────────────────────────────────────────────────
# Format detection

# Extension → source_format label used in contracts + stratum name.
_EXT_MAP: dict[str, str] = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".xlsx": "xlsx",
    ".pptx": "pptx",
    ".html": "html",
    ".htm": "html",
    ".txt": "text",
    ".md": "md",
    ".markdown": "md",
    ".tex": "latex",
    ".latex": "latex",
}

# Magic byte signatures for the formats we care about. Kept short on purpose.
_MAGIC_SIGNATURES: list[tuple[bytes, str]] = [
    (b"%PDF-", "pdf"),
    # ZIP-based OOXML — can't distinguish docx/xlsx/pptx from the first 4 bytes
    # alone; treat as "zip-ooxml" and let the extension decide the variant.
]

# Tier 3 extensions (skipped, not stratified).
_TIER3_EXTS: dict[str, str] = {
    # Audio
    ".mp3": "tier3_audio",
    ".wav": "tier3_audio",
    ".m4a": "tier3_audio",
    ".flac": "tier3_audio",
    ".ogg": "tier3_audio",
    # Standalone images
    ".jpg": "tier3_image",
    ".jpeg": "tier3_image",
    ".png": "tier3_image",
    ".gif": "tier3_image",
    ".tiff": "tier3_image",
    ".tif": "tier3_image",
    ".bmp": "tier3_image",
    ".webp": "tier3_image",
    # Specialized XML corpora
    ".xbrl": "tier3_xml_special",
    ".jats": "tier3_xml_special",
}


def detect_format(path: Path) -> str | None:
    """Return source_format label, or None if unrecognized / tier-3.

    Tier-3 returns None (caller looks up reason in `tier3_reason`).
    Strategy: check magic bytes first for PDFs (authoritative), then extension.
    """
    ext = path.suffix.lower()

    # Tier 3 → not a valid format for stratification
    if ext in _TIER3_EXTS:
        return None

    # Magic-bytes check for PDFs (small read)
    try:
        with path.open("rb") as fh:
            head = fh.read(8)
    except OSError:
        head = b""

    if head.startswith(b"%PDF-"):
        return "pdf"

    # Extension fallback
    return _EXT_MAP.get(ext)


def tier3_reason(path: Path) -> str | None:
    return _TIER3_EXTS.get(path.suffix.lower())


# ─────────────────────────────────────────────────────────────────────────────
# Cheap probes

@dataclass
class FileProbe:
    page_count: int | None = None
    pdftotext_bytes: int | None = None
    mime: str | None = None
    size_bytes: int = 0
    # Populated when pdf probes couldn't run
    poppler_missing: bool = False


def poppler_available() -> bool:
    return shutil.which("pdfinfo") is not None and shutil.which("pdftotext") is not None


def _run(cmd: list[str], timeout: float = 30.0) -> tuple[int, bytes, bytes]:
    try:
        proc = subprocess.run(
            cmd, capture_output=True, timeout=timeout, check=False
        )
        return proc.returncode, proc.stdout, proc.stderr
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return 1, b"", b""


def probe_pdf_pages(path: Path) -> int | None:
    if not shutil.which("pdfinfo"):
        return None
    code, out, _ = _run(["pdfinfo", str(path)])
    if code != 0:
        return None
    for line in out.decode("utf-8", errors="ignore").splitlines():
        if line.startswith("Pages:"):
            try:
                return int(line.split(":", 1)[1].strip())
            except ValueError:
                return None
    return None


def probe_pdf_text_bytes(path: Path) -> int | None:
    if not shutil.which("pdftotext"):
        return None
    code, out, _ = _run(["pdftotext", "-q", "-enc", "UTF-8", str(path), "-"])
    if code != 0:
        return None
    return len(out)


def probe_mime(path: Path) -> str | None:
    if not shutil.which("file"):
        return None
    code, out, _ = _run(["file", "--mime-type", "-b", str(path)])
    if code != 0:
        return None
    return out.decode("utf-8", errors="ignore").strip() or None


def probe_file(path: Path, fmt: str) -> FileProbe:
    probe = FileProbe()
    try:
        probe.size_bytes = path.stat().st_size
    except OSError:
        probe.size_bytes = 0
    probe.mime = probe_mime(path)
    if fmt == "pdf":
        if poppler_available():
            probe.page_count = probe_pdf_pages(path)
            probe.pdftotext_bytes = probe_pdf_text_bytes(path)
        else:
            probe.poppler_missing = True
    return probe


# ─────────────────────────────────────────────────────────────────────────────
# Stratum assignment

_PAGE_BINS: list[tuple[int, int, str]] = [
    (1, 10, "1-10"),
    (11, 50, "11-50"),
    (51, 200, "51-200"),
    (201, 10**9, "201+"),
]


def _page_bin_label(page_count: int | None) -> str:
    if page_count is None or page_count < 1:
        return "1-10"
    for lo, hi, label in _PAGE_BINS:
        if lo <= page_count <= hi:
            return label
    return "201+"


def stratum_for(fmt: str, probe: FileProbe) -> str:
    """Deterministic stratum name per contracts."""
    if fmt == "pdf":
        if probe.poppler_missing:
            # Degraded mode: still bin by page_count if another path discovered it,
            # else bucket into a single "pdf" stratum.
            if probe.page_count is None:
                return "pdf"
            return f"pdf-unknown-{_page_bin_label(probe.page_count)}"
        bin_label = _page_bin_label(probe.page_count)
        pages = probe.page_count or 1
        text_bytes = probe.pdftotext_bytes or 0
        per_page = text_bytes / pages if pages > 0 else 0
        if per_page > 50:
            return f"pdf-native-{bin_label}"
        return f"pdf-scanned-{bin_label}"
    # Non-PDFs have no binning
    return fmt


# ─────────────────────────────────────────────────────────────────────────────
# Folder walk + scan

@dataclass
class ScannedDoc:
    source_sha256: str
    source_path: str
    source_format: str
    stratum: str
    size_bytes: int
    page_count: int | None
    signals: dict[str, Any]


@dataclass
class SkippedFile:
    path: str
    reason: str


@dataclass
class ScanOutput:
    folder: str
    total_files: int
    docs: list[ScannedDoc] = field(default_factory=list)
    skipped: list[SkippedFile] = field(default_factory=list)
    poppler_missing: bool = False


class ScanError(ValueError):
    """Surfaces as 400 BadRequest in the router."""


def _validate_folder(folder: str, *, follow_symlinks: bool) -> Path:
    if not folder or not folder.startswith("/"):
        raise ScanError("folder must be an absolute path")
    # Reject any `..` segments in the raw input
    parts = Path(folder).parts
    if any(p == ".." for p in parts):
        raise ScanError("folder must not contain '..' segments")
    p = Path(folder)
    if not p.exists():
        raise ScanError(f"folder does not exist: {folder}")
    if p.is_symlink() and not follow_symlinks:
        raise ScanError("folder is a symlink; follow_symlinks=false")
    if not p.is_dir():
        raise ScanError(f"not a directory: {folder}")
    return p


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


_EXCLUDED_DIRS: frozenset[str] = frozenset(
    {
        ".understanding",   # our own filemap dir
        ".docling-out",     # our own default output dir
        ".git",
        ".hg",
        ".svn",
        ".venv",
        "venv",
        "node_modules",
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        ".next",
        ".nuxt",
        ".turbo",
        ".DS_Store",
        ".idea",
        ".vscode",
    }
)


def _iter_files(root: Path, follow_symlinks: bool) -> list[Path]:
    out: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=follow_symlinks):
        # In-place filter — prevents descent into excluded dirs.
        dirnames[:] = [d for d in dirnames if d not in _EXCLUDED_DIRS]
        for name in filenames:
            # Null-byte guard
            if "\x00" in name:
                # Skip silently — caller logs via SkippedFile
                continue
            p = Path(dirpath) / name
            if not follow_symlinks and p.is_symlink():
                continue
            out.append(p)
    return out


def scan_folder(
    folder: str,
    *,
    follow_symlinks: bool = False,
    max_files: int = 50000,
) -> ScanOutput:
    root = _validate_folder(folder, follow_symlinks=follow_symlinks)

    files = _iter_files(root, follow_symlinks)
    if len(files) > max_files:
        raise ScanError(
            f"folder contains {len(files)} files; exceeds max_files={max_files}"
        )

    out = ScanOutput(folder=str(root), total_files=len(files))
    poppler_ok = poppler_available()
    out.poppler_missing = not poppler_ok

    for path in files:
        name = path.name
        if "\x00" in name:
            out.skipped.append(SkippedFile(str(path), "null_byte_in_name"))
            continue

        tier3 = tier3_reason(path)
        if tier3:
            out.skipped.append(SkippedFile(str(path), tier3))
            continue

        fmt = detect_format(path)
        if fmt is None:
            out.skipped.append(SkippedFile(str(path), "unrecognized_format"))
            continue

        try:
            probe = probe_file(path, fmt)
        except Exception as e:  # pragma: no cover
            out.skipped.append(SkippedFile(str(path), f"probe_error:{e}"))
            continue

        try:
            sha = _sha256_file(path)
        except OSError:
            out.skipped.append(SkippedFile(str(path), "unreadable"))
            continue

        stratum = stratum_for(fmt, probe)
        signals: dict[str, Any] = {
            "mime": probe.mime,
            "size_bytes": probe.size_bytes,
        }
        if fmt == "pdf":
            signals["page_count"] = probe.page_count
            signals["pdftotext_bytes"] = probe.pdftotext_bytes
            signals["poppler_missing"] = probe.poppler_missing

        out.docs.append(
            ScannedDoc(
                source_sha256=sha,
                source_path=str(path),
                source_format=fmt,
                stratum=stratum,
                size_bytes=probe.size_bytes,
                page_count=probe.page_count if fmt == "pdf" else None,
                signals=signals,
            )
        )

    return out


# ─────────────────────────────────────────────────────────────────────────────
# Filemap emission — Level B

import datetime as dt  # noqa: E402


def _iso_now() -> str:
    return dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _iso_mtime(path: Path) -> str | None:
    try:
        ts = path.stat().st_mtime
    except OSError:
        return None
    return dt.datetime.fromtimestamp(ts, dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def emit_filemaps_for_scan(scan_out: ScanOutput, scan_id: str, *, root: Path) -> int:
    """Write/merge `.understanding/folder.yaml` in every folder under root.

    Groups `scan_out.docs` + `scan_out.skipped` by parent folder, merges with
    any existing filemap (preserves user + post-build fields), writes atomically.
    Returns the count of filemaps written.
    """
    from backend.stratification import filemap as fm

    now = _iso_now()
    root = root.resolve()
    by_folder: dict[Path, list[dict[str, Any]]] = {}

    for d in scan_out.docs:
        p = Path(d.source_path)
        entry: dict[str, Any] = {
            "path": p.name,
            "sha256": d.source_sha256,
            "size_bytes": d.size_bytes,
            "mtime": _iso_mtime(p),
            "detected_content_type": d.source_format,
            "detected_stratum": d.stratum,
            "scanner_suggestion": "include",
            "exclusion_reason": None,
        }
        by_folder.setdefault(p.parent, []).append(entry)

    for s in scan_out.skipped:
        p = Path(s.path)
        reason = s.reason
        if reason.startswith("tier3_"):
            sugg = "exclude_by_type"
        elif reason == "unrecognized_format":
            sugg = "unsupported"
        elif reason == "unreadable":
            sugg = "failed_extraction"
        elif reason == "null_byte_in_name":
            sugg = "exclude_by_pattern"
        else:
            sugg = "unsupported"
        try:
            size: int | None = p.stat().st_size
        except OSError:
            size = None
        entry = {
            "path": p.name,
            "sha256": None,
            "size_bytes": size,
            "mtime": _iso_mtime(p),
            "detected_content_type": None,
            "detected_stratum": None,
            "scanner_suggestion": sugg,
            "exclusion_reason": reason,
        }
        by_folder.setdefault(p.parent, []).append(entry)

    # Ensure every folder under root gets a filemap (even empty/subfolder-only).
    for dirpath, _dirs, _files in os.walk(root):
        folder = Path(dirpath)
        if folder.name == fm.UNDERSTANDING_DIR:
            continue
        by_folder.setdefault(folder, [])

    written = 0
    for folder, files in by_folder.items():
        if folder.name == fm.UNDERSTANDING_DIR:
            continue
        scanner_data = {
            "folder": str(folder),
            "scan_id": scan_id,
            "scanned_at": now,
            "files": files,
        }
        merged = fm.merge_filemap(folder, scanner_data)
        fm.write_filemap(folder, merged)
        written += 1
    return written
