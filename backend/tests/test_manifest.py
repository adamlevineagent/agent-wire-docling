"""Manifest writer tests."""

from __future__ import annotations

import json
from pathlib import Path

from backend.manifest import append_manifest_entry, read_manifest, write_manifest


def _entry(sha: str, phash: str = "p1", status: str = "complete") -> dict:
    return {
        "source_sha256": sha,
        "source_path": f"/x/{sha}.pdf",
        "source_format": "pdf",
        "status": status,
        "stratum": "pdf-native-1-10",
        "pipeline_hash": phash,
        "error": None,
        "quality_summary": {"warning_count": 0, "empty_page_count": 0},
        "converted_at": "2026-04-18T00:00:00.000Z",
    }


def test_read_missing_returns_fresh(tmp_path: Path) -> None:
    m = read_manifest(tmp_path)
    assert m["docs"] == []
    assert m["schema_version"] == 1
    # Not written
    assert not (tmp_path / "manifest.json").exists()


def test_append_creates_and_upserts(tmp_path: Path) -> None:
    append_manifest_entry(tmp_path, _entry("a"))
    append_manifest_entry(tmp_path, _entry("b"))
    m = read_manifest(tmp_path)
    assert {d["source_sha256"] for d in m["docs"]} == {"a", "b"}

    # Upsert same key
    append_manifest_entry(tmp_path, _entry("a", status="error"))
    m = read_manifest(tmp_path)
    statuses = {d["source_sha256"]: d["status"] for d in m["docs"]}
    assert statuses["a"] == "error"
    assert len(m["docs"]) == 2


def test_write_is_atomic(tmp_path: Path) -> None:
    write_manifest(tmp_path, {"docs": [_entry("a")], "folder_root": "/src"})
    raw = json.loads((tmp_path / "manifest.json").read_text())
    assert raw["folder_root"] == "/src"
    # tmp file cleaned up
    assert not (tmp_path / "manifest.json.tmp").exists()


def test_corrupt_manifest_is_salvaged(tmp_path: Path) -> None:
    (tmp_path / "manifest.json").write_text("{not json")
    m = read_manifest(tmp_path)
    assert m["docs"] == []
    # corrupt file moved aside
    corrupt = list(tmp_path.glob("manifest.corrupt.*.json"))
    assert len(corrupt) == 1
