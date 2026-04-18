"""Filemap (`.understanding/folder.yaml`) — Level B canonical per-folder state.

The filemap is the checklist file the scanner writes and the user curates.
Scanner-owned fields are rewritten on every rescan; user-owned fields are
preserved; post-build fields are preserved until the batch runner writes them.

Schema per `docs/filemap-model.md`. Writes are atomic tmp+os.replace.
"""

from __future__ import annotations

import datetime as _dt
import os
import uuid
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import yaml  # type: ignore[import-untyped]

SCHEMA_VERSION = 1
SCANNER_VERSION = "0.1.0"
UNDERSTANDING_DIR = ".understanding"
FILEMAP_NAME = "folder.yaml"


# ── Field ownership ─────────────────────────────────────────────────────────

SCANNER_FIELDS = {
    "sha256",
    "size_bytes",
    "mtime",
    "detected_content_type",
    "detected_stratum",
    "scanner_suggestion",
    "exclusion_reason",
}

USER_FIELDS = {
    "user_included",
    "user_content_type",
    "user_notes",
}

POST_BUILD_FIELDS = {
    "last_build_at",
    "last_build_pipeline_hash",
    "last_build_output_path",
    "last_build_error",
}


def _now_iso() -> str:
    return _dt.datetime.now(_dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _understanding_dir(folder: Path) -> Path:
    return folder / UNDERSTANDING_DIR


def filemap_path(folder: Path | str) -> Path:
    return _understanding_dir(Path(folder)) / FILEMAP_NAME


def read_filemap(folder: Path | str) -> dict[str, Any] | None:
    p = filemap_path(folder)
    if not p.exists():
        return None
    try:
        data = yaml.safe_load(p.read_text(encoding="utf-8"))
    except yaml.YAMLError:
        return None
    return data if isinstance(data, dict) else None


def write_filemap(folder: Path | str, data: dict[str, Any]) -> None:
    folder_p = Path(folder)
    und = _understanding_dir(folder_p)
    und.mkdir(parents=True, exist_ok=True)
    final = und / FILEMAP_NAME
    tmp = und / f".{FILEMAP_NAME}.tmp-{uuid.uuid4().hex}"
    text = yaml.safe_dump(data, sort_keys=False, allow_unicode=True)
    tmp.write_text(text, encoding="utf-8")
    try:
        with open(tmp, "rb") as fh:
            os.fsync(fh.fileno())
    except OSError:
        pass
    os.replace(tmp, final)


def _blank_entry(path_rel: str) -> dict[str, Any]:
    return {
        "path": path_rel,
        "sha256": None,
        "size_bytes": None,
        "mtime": None,
        "detected_content_type": None,
        "detected_stratum": None,
        "scanner_suggestion": "include",
        "exclusion_reason": None,
        "user_included": None,
        "user_content_type": None,
        "user_notes": None,
        "last_build_at": None,
        "last_build_pipeline_hash": None,
        "last_build_output_path": None,
        "last_build_error": None,
    }


def _normalize_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """Fill missing keys from the canonical blank template."""
    tpl = _blank_entry(entry.get("path", ""))
    for k, v in entry.items():
        tpl[k] = v
    return tpl


def merge_filemap(
    folder: Path | str,
    new_scanner_data: dict[str, Any],
) -> dict[str, Any]:
    """Merge fresh scanner output with any existing filemap.

    `new_scanner_data` shape:
        {
            "folder": str,
            "scan_id": str,
            "scanned_at": str iso,
            "files": list[dict],       # scanner-owned fields populated per-entry
        }

    Merge policy:
      - scanner fields: rewritten from new_scanner_data
      - user fields: preserved from existing
      - post-build fields: preserved from existing
      - defaults: preserved from existing
      - new files (in new_scanner_data, not in existing) → added with user_included=null
      - files in existing but missing from new_scanner_data → moved to `deleted:` tombstones
    """
    existing = read_filemap(folder) or {}
    existing_files: list[dict[str, Any]] = existing.get("files") or []
    existing_by_path: dict[str, dict[str, Any]] = {
        e.get("path", ""): e for e in existing_files if e.get("path")
    }
    existing_deleted: list[dict[str, Any]] = list(existing.get("deleted") or [])

    new_files_in: list[dict[str, Any]] = new_scanner_data.get("files") or []
    new_by_path: dict[str, dict[str, Any]] = {
        e.get("path", ""): e for e in new_files_in if e.get("path")
    }

    merged_files: list[dict[str, Any]] = []
    for path_rel, new_entry in new_by_path.items():
        base = _normalize_entry(existing_by_path.get(path_rel, {"path": path_rel}))
        # Rewrite scanner fields from new
        for f in SCANNER_FIELDS:
            if f in new_entry:
                base[f] = new_entry[f]
        # Ensure path is set
        base["path"] = path_rel
        merged_files.append(base)

    # Tombstone deletes
    now = _now_iso()
    for path_rel, old_entry in existing_by_path.items():
        if path_rel not in new_by_path:
            existing_deleted.append(
                {
                    "path": path_rel,
                    "sha256": old_entry.get("sha256"),
                    "deleted_at": now,
                    "last_build_output_path": old_entry.get("last_build_output_path"),
                    "last_detected_content_type": old_entry.get("detected_content_type"),
                }
            )

    defaults = existing.get("defaults") or {
        "user_included": None,
        "user_content_type": None,
    }

    merged: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "folder": new_scanner_data.get("folder", str(folder)),
        "scan_id": new_scanner_data.get("scan_id", existing.get("scan_id")),
        "scanned_at": new_scanner_data.get("scanned_at", now),
        "scanner_version": SCANNER_VERSION,
        "defaults": defaults,
        "files": merged_files,
        "deleted": existing_deleted,
    }
    return merged


def walk_filemaps(root: Path | str) -> Iterable[tuple[Path, dict[str, Any]]]:
    """Yield (folder_path, filemap_dict) for every folder under root that has one."""
    root_p = Path(root)
    for dirpath, dirnames, _files in os.walk(root_p):
        # Prune the .understanding dirs themselves from recursion (nothing there to walk).
        dirnames[:] = [d for d in dirnames if d != UNDERSTANDING_DIR]
        folder = Path(dirpath)
        fm = read_filemap(folder)
        if fm is not None:
            yield folder, fm


def collect_included_files(root: Path | str) -> list[dict[str, Any]]:
    """Walk filemaps under root, return files the user wants built.

    Included when `user_included == true` OR (`user_included is None` AND
    `scanner_suggestion == "include"`).
    """
    out: list[dict[str, Any]] = []
    for folder, fm in walk_filemaps(root):
        for entry in fm.get("files") or []:
            ui = entry.get("user_included")
            sugg = entry.get("scanner_suggestion")
            if ui is True or (ui is None and sugg == "include"):
                enriched = dict(entry)
                enriched["_folder"] = str(folder)
                enriched["_absolute_path"] = str(folder / entry.get("path", ""))
                out.append(enriched)
    return out


def update_user_fields(
    folder: Path | str,
    updates: list[dict[str, Any]],
    defaults: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Partial merge of user-owned fields. Each update must have `path`."""
    fm = read_filemap(folder)
    if fm is None:
        raise FileNotFoundError(f"no filemap at {folder}")
    by_path = {e.get("path"): e for e in (fm.get("files") or [])}
    for upd in updates:
        p = upd.get("path")
        if not p:
            continue
        entry = by_path.get(p)
        if entry is None:
            # Unknown file — skip (user shouldn't be patching paths we don't know)
            continue
        for f in USER_FIELDS:
            if f in upd:
                entry[f] = upd[f]
    if defaults:
        d = fm.setdefault("defaults", {})
        for k, v in defaults.items():
            d[k] = v
    write_filemap(folder, fm)
    return fm


def record_build_result(
    folder: Path | str,
    path_rel: str,
    *,
    pipeline_hash: str | None,
    output_path: str | None,
    error: str | None,
) -> dict[str, Any] | None:
    """Post-build writeback to the filemap entry for `path_rel`."""
    fm = read_filemap(folder)
    if fm is None:
        return None
    now = _now_iso()
    for entry in fm.get("files") or []:
        if entry.get("path") == path_rel:
            entry["last_build_at"] = now
            entry["last_build_pipeline_hash"] = pipeline_hash
            entry["last_build_output_path"] = output_path
            entry["last_build_error"] = error
            break
    else:
        return None
    write_filemap(folder, fm)
    return fm


# ── Filetree recursive view (for UI) ────────────────────────────────────────

def folder_counts(fm: dict[str, Any]) -> dict[str, int]:
    included = pending = excluded = 0
    for e in fm.get("files") or []:
        ui = e.get("user_included")
        sugg = e.get("scanner_suggestion")
        if ui is True:
            included += 1
        elif ui is False:
            excluded += 1
        else:
            # null — inherits scanner suggestion
            if sugg == "include":
                included += 1
            else:
                pending += 1
    total = len(fm.get("files") or [])
    return {
        "included": included,
        "pending": pending,
        "excluded": excluded,
        "total": total,
    }


def build_filetree(root: Path | str) -> dict[str, Any]:
    """Return a recursive tree of folders under `root` that have filemaps."""
    root_p = Path(root).resolve()

    def _node(folder: Path) -> dict[str, Any]:
        fm = read_filemap(folder)
        children: list[dict[str, Any]] = []
        try:
            subs = sorted(
                (p for p in folder.iterdir() if p.is_dir() and p.name != UNDERSTANDING_DIR),
                key=lambda p: p.name.lower(),
            )
        except OSError:
            subs = []
        for sub in subs:
            child = _node(sub)
            # Only include sub if it has a filemap OR deeper descendants have
            if child.get("filemap") or child.get("children"):
                children.append(child)
        counts = folder_counts(fm) if fm else {"included": 0, "pending": 0, "excluded": 0, "total": 0}
        # Roll up descendant counts
        for c in children:
            cc = c.get("counts", {})
            for k in counts:
                counts[k] += int(cc.get(k, 0))
        try:
            rel = str(folder.relative_to(root_p))
        except ValueError:
            rel = str(folder)
        return {
            "path": str(folder),
            "folder_relative": "" if rel == "." else rel,
            "counts": counts,
            "filemap": bool(fm),
            "children": children,
        }

    return _node(root_p)
