"""Manifest writer — Agent C.

The manifest is the portable, human-readable record of every doc
converted into a given output folder. SQLite is the live state;
manifest.json is the on-disk artifact that ships with the output.

File format matches contracts/openapi.yaml Manifest schema:

    {
      "schema_version": 1,
      "folder_root": "...",
      "output_dir": "...",
      "created_at": "...",
      "updated_at": "...",
      "docling_version": "...",
      "docs": [ ManifestEntry, ... ]
    }

Writes are atomic: serialize to `manifest.json.tmp`, then os.replace().
A per-output-dir lock serializes concurrent appenders in-process.
"""

from __future__ import annotations

import json
import os
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml  # type: ignore[import-untyped]

SCHEMA_VERSION = 1

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(output_dir: Path) -> threading.Lock:
    key = str(output_dir.resolve())
    with _locks_guard:
        lock = _locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _locks[key] = lock
        return lock


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _manifest_path(output_dir: Path) -> Path:
    return output_dir / "manifest.json"


def _docling_version() -> str:
    try:
        from importlib.metadata import version as _v

        return _v("docling")
    except Exception:
        return "unknown"


def read_manifest(output_dir: str | Path) -> dict[str, Any]:
    """Return the manifest dict; if missing, a fresh empty one (not written)."""
    out = Path(output_dir)
    p = _manifest_path(out)
    if p.exists():
        try:
            data = json.loads(p.read_text())
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            # Corrupt manifest — rename aside so we don't clobber evidence
            backup = out / f"manifest.corrupt.{int(datetime.now(UTC).timestamp())}.json"
            try:
                p.rename(backup)
            except OSError:
                pass
    now = _now()
    return {
        "schema_version": SCHEMA_VERSION,
        "folder_root": "",
        "output_dir": str(out),
        "created_at": now,
        "updated_at": now,
        "docling_version": _docling_version(),
        "docs": [],
    }


def _atomic_write(path: Path, data: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def write_manifest(output_dir: str | Path, manifest: dict[str, Any]) -> None:
    """Atomically overwrite manifest.json."""
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    manifest = dict(manifest)
    manifest["updated_at"] = _now()
    manifest.setdefault("schema_version", SCHEMA_VERSION)
    manifest.setdefault("created_at", manifest["updated_at"])
    manifest.setdefault("output_dir", str(out))
    manifest.setdefault("docling_version", _docling_version())
    manifest.setdefault("docs", [])
    with _lock_for(out):
        _atomic_write(_manifest_path(out), json.dumps(manifest, indent=2, sort_keys=False))
        try:
            _atomic_write(
                out / "manifest.yaml",
                yaml.safe_dump(manifest, sort_keys=False, allow_unicode=True),
            )
        except Exception:
            pass


def append_manifest_entry(
    output_dir: str | Path,
    entry: dict[str, Any],
    *,
    folder_root: str | None = None,
) -> dict[str, Any]:
    """Upsert a ManifestEntry keyed by (source_sha256, pipeline_hash).

    Returns the full updated manifest dict.
    """
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    with _lock_for(out):
        manifest = read_manifest(out)
        if folder_root and not manifest.get("folder_root"):
            manifest["folder_root"] = folder_root
        manifest["output_dir"] = str(out)
        manifest["docling_version"] = manifest.get("docling_version") or _docling_version()
        key = (entry["source_sha256"], entry.get("pipeline_hash", ""))
        replaced = False
        for i, existing in enumerate(manifest["docs"]):
            if (
                existing["source_sha256"] == key[0]
                and existing.get("pipeline_hash", "") == key[1]
            ):
                manifest["docs"][i] = entry
                replaced = True
                break
        if not replaced:
            manifest["docs"].append(entry)
        manifest["updated_at"] = _now()
        _atomic_write(_manifest_path(out), json.dumps(manifest, indent=2, sort_keys=False))
        try:
            _atomic_write(
                out / "manifest.yaml",
                yaml.safe_dump(manifest, sort_keys=False, allow_unicode=True),
            )
        except Exception:
            pass
        return manifest
