"""Tests for triage patch/read behavior."""

from __future__ import annotations

from pathlib import Path

from backend.jobs import triage as _triage


def test_patch_triage_merges_by_sha(tmp_path: Path) -> None:
    out = tmp_path / "out"
    results = [
        {
            "source_path": "/tmp/a.pdf",
            "source_sha256": "aaa",
            "detected_content_type": "pdf",
            "detected_stratum": "pdf-native-1-10",
            "pipeline_used": {},
            "status": "error",
            "error": "422 Unprocessable Entity",
            "attempt_count": 3,
            "first_attempted_at": "2026-04-18T00:00:00Z",
            "last_attempted_at": "2026-04-18T00:00:01Z",
            "filemap_folder": "/tmp",
        },
        {
            "source_path": "/tmp/b.pdf",
            "source_sha256": "bbb",
            "detected_content_type": "pdf",
            "detected_stratum": "pdf-native-1-10",
            "pipeline_used": {},
            "status": "error",
            "error": "parse error",
            "attempt_count": 1,
            "first_attempted_at": "2026-04-18T00:00:00Z",
            "last_attempted_at": "2026-04-18T00:00:01Z",
            "filemap_folder": "/tmp",
        },
    ]
    _triage.write_triage(out, "batch-1", results)

    updated = _triage.patch_triage(
        out,
        [
            {
                "source_sha256": "aaa",
                "retry_with_pipeline": {"ocr": {"enabled": False}},
            },
            {"source_sha256": "bbb", "mark_as_excluded": True, "notes": "bad"},
        ],
    )
    fs = {f["source_sha256"]: f for f in updated["failures"]}
    assert fs["aaa"]["retry_with_pipeline"] == {"ocr": {"enabled": False}}
    assert fs["bbb"]["mark_as_excluded"] is True
    assert fs["bbb"]["notes"] == "bad"

    # Round-trip via read
    on_disk = _triage.read_triage(out)
    assert on_disk is not None
    on_disk_fs = {f["source_sha256"]: f for f in on_disk["failures"]}
    assert on_disk_fs["aaa"]["retry_with_pipeline"] == {"ocr": {"enabled": False}}
    assert on_disk_fs["bbb"]["mark_as_excluded"] is True
