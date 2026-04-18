"""Tests for Level B filemap model."""

from __future__ import annotations

from pathlib import Path

import yaml

from backend.stratification import filemap as fm
from backend.stratification.scanner import emit_filemaps_for_scan, scan_folder


def _write(p: Path, content: bytes = b"hello") -> None:
    p.write_bytes(content)


def test_merge_preserves_user_fields(tmp_path: Path) -> None:
    folder = tmp_path / "docs"
    folder.mkdir()
    # Seed an existing filemap with user_included=true on a.pdf
    seed = {
        "schema_version": 1,
        "folder": str(folder),
        "scan_id": "prior",
        "scanned_at": "2026-04-01T00:00:00Z",
        "scanner_version": "0.1.0",
        "defaults": {"user_included": None, "user_content_type": None},
        "files": [
            {
                "path": "a.pdf",
                "sha256": "old",
                "size_bytes": 10,
                "mtime": "x",
                "detected_content_type": "pdf",
                "detected_stratum": "pdf",
                "scanner_suggestion": "include",
                "exclusion_reason": None,
                "user_included": True,
                "user_content_type": "pdf",
                "user_notes": "keep this",
                "last_build_at": "2026-04-01T00:00:00Z",
                "last_build_pipeline_hash": "abc",
                "last_build_output_path": "/out/a.pdf.md",
                "last_build_error": None,
            }
        ],
        "deleted": [],
    }
    fm.write_filemap(folder, seed)

    new_scanner_data = {
        "folder": str(folder),
        "scan_id": "new",
        "scanned_at": "2026-04-18T00:00:00Z",
        "files": [
            {
                "path": "a.pdf",
                "sha256": "NEW_HASH",
                "size_bytes": 99,
                "mtime": "newmtime",
                "detected_content_type": "pdf",
                "detected_stratum": "pdf-native-1-10",
                "scanner_suggestion": "include",
                "exclusion_reason": None,
            }
        ],
    }
    merged = fm.merge_filemap(folder, new_scanner_data)
    a = merged["files"][0]
    # Scanner fields updated
    assert a["sha256"] == "NEW_HASH"
    assert a["size_bytes"] == 99
    assert a["detected_stratum"] == "pdf-native-1-10"
    # User fields preserved
    assert a["user_included"] is True
    assert a["user_notes"] == "keep this"
    # Post-build preserved
    assert a["last_build_pipeline_hash"] == "abc"
    assert a["last_build_output_path"] == "/out/a.pdf.md"


def test_new_files_get_null_user_included(tmp_path: Path) -> None:
    folder = tmp_path / "d"
    folder.mkdir()
    _write(folder / "one.txt", b"one")
    _write(folder / "two.txt", b"two")

    out = scan_folder(str(folder))
    emit_filemaps_for_scan(out, "scan-1", root=folder)

    data = fm.read_filemap(folder)
    assert data is not None
    entries = {e["path"]: e for e in data["files"]}
    assert set(entries) == {"one.txt", "two.txt"}
    for e in entries.values():
        assert e["user_included"] is None
        assert e["scanner_suggestion"] == "include"


def test_deleted_files_go_to_tombstone(tmp_path: Path) -> None:
    folder = tmp_path / "d"
    folder.mkdir()
    _write(folder / "keep.txt")
    _write(folder / "gone.txt")

    # First scan
    out1 = scan_folder(str(folder))
    emit_filemaps_for_scan(out1, "s1", root=folder)

    # Remove one file + rescan
    (folder / "gone.txt").unlink()
    out2 = scan_folder(str(folder))
    emit_filemaps_for_scan(out2, "s2", root=folder)

    data = fm.read_filemap(folder)
    assert data is not None
    live_paths = {e["path"] for e in data["files"]}
    assert live_paths == {"keep.txt"}
    deleted_paths = {e["path"] for e in data["deleted"]}
    assert "gone.txt" in deleted_paths


def test_collect_included_respects_user_false(tmp_path: Path) -> None:
    folder = tmp_path / "d"
    folder.mkdir()
    _write(folder / "a.txt")
    _write(folder / "b.txt")
    _write(folder / "c.txt")

    out = scan_folder(str(folder))
    emit_filemaps_for_scan(out, "s1", root=folder)

    # User excludes b.txt explicitly; leaves a and c as null (scanner says include)
    fm.update_user_fields(
        folder,
        [{"path": "b.txt", "user_included": False},
         {"path": "a.txt", "user_included": True}],
    )

    included = fm.collect_included_files(folder)
    paths = sorted(e["path"] for e in included)
    assert paths == ["a.txt", "c.txt"]


def test_filetree_counts_roll_up(tmp_path: Path) -> None:
    root = tmp_path / "root"
    sub = root / "sub"
    sub.mkdir(parents=True)
    _write(root / "r.txt")
    _write(sub / "s1.txt")
    _write(sub / "s2.txt")

    out = scan_folder(str(root))
    emit_filemaps_for_scan(out, "s1", root=root)

    tree = fm.build_filetree(root)
    assert tree["counts"]["total"] == 3
    assert tree["counts"]["included"] == 3  # all null + scanner-include


def test_triage_written_on_empty_results(tmp_path: Path) -> None:
    from backend.jobs import triage as tr

    out = tmp_path / "out"
    out.mkdir()
    doc = tr.write_triage(out, "batch-xyz", results=[])
    assert doc["batch_id"] == "batch-xyz"
    assert doc["docs_succeeded"] == 0
    assert doc["docs_failed"] == 0
    # File exists and parses
    assert (out / "triage.yaml").exists()
    reloaded = yaml.safe_load((out / "triage.yaml").read_text())
    assert reloaded["batch_id"] == "batch-xyz"


def test_triage_classifies_errors(tmp_path: Path) -> None:
    from backend.jobs import triage as tr

    out = tmp_path / "out"
    out.mkdir()
    results = [
        {"source_path": "/a.pdf", "status": "error", "error": "422 Unprocessable Entity"},
        {"source_path": "/b.pdf", "status": "error", "error": "OCR timeout after 30s"},
        {"source_path": "/c.pdf", "status": "complete", "error": None},
    ]
    doc = tr.write_triage(out, "b1", results=results)
    assert doc["docs_succeeded"] == 1
    assert doc["docs_failed"] == 2
    assert doc["by_reason"].get("convert_422") == 1
    assert doc["by_reason"].get("ocr_timeout") == 1
