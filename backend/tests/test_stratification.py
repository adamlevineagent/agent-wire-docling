"""Tests for Wave 1 Agent B: scan + stratification + deterministic sampling."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.stratification import db as strat_db
from backend.stratification.sampling import DocRow, default_seed, pick_sample
from backend.stratification.scanner import (
    FileProbe,
    detect_format,
    stratum_for,
)

# ─── Redirect DB to a tmp path per test ─────────────────────────────────────


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path: Path) -> None:
    strat_db.set_db_path(tmp_path / "state.db")
    strat_db.reset_schema_cache()
    yield
    strat_db.set_db_path(None)
    strat_db.reset_schema_cache()


# ─── Helpers to build fake files ────────────────────────────────────────────


_MINIMAL_PDF = (
    b"%PDF-1.4\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
    b"xref\n0 4\n0000000000 65535 f\n"
    b"trailer<</Size 4/Root 1 0 R>>\n"
    b"startxref\n0\n%%EOF\n"
)

_MINIMAL_DOCX = b"PK\x03\x04" + b"\x00" * 20  # ZIP magic


def _mkfile(root: Path, name: str, data: bytes) -> Path:
    p = root / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    return p


# ─── Unit tests: stratum naming ─────────────────────────────────────────────


def test_stratum_name_native_text_pdf() -> None:
    # 100 pages, plenty of text → native
    probe = FileProbe(page_count=30, pdftotext_bytes=30 * 100, size_bytes=1000)
    assert stratum_for("pdf", probe) == "pdf-native-11-50"


def test_stratum_name_scanned_pdf() -> None:
    # 100 pages, ~zero text layer → scanned
    probe = FileProbe(page_count=100, pdftotext_bytes=50, size_bytes=1000)
    assert stratum_for("pdf", probe) == "pdf-scanned-51-200"


def test_stratum_name_docx_no_binning() -> None:
    probe = FileProbe(size_bytes=5000)
    assert stratum_for("docx", probe) == "docx"


def test_stratum_name_pdf_poppler_missing() -> None:
    probe = FileProbe(poppler_missing=True, size_bytes=10000)
    assert stratum_for("pdf", probe) == "pdf"

    probe2 = FileProbe(poppler_missing=True, page_count=75, size_bytes=10000)
    assert stratum_for("pdf", probe2) == "pdf-unknown-51-200"


def test_page_bin_edges() -> None:
    for pages, expected in [(1, "1-10"), (10, "1-10"), (11, "11-50"),
                            (50, "11-50"), (51, "51-200"), (200, "51-200"),
                            (201, "201+"), (5000, "201+")]:
        probe = FileProbe(page_count=pages, pdftotext_bytes=pages * 100)
        assert stratum_for("pdf", probe) == f"pdf-native-{expected}"


# ─── Format detection ───────────────────────────────────────────────────────


def test_detect_format_pdf_by_magic(tmp_path: Path) -> None:
    # Pretend to be a .bin extension — magic bytes still win
    p = _mkfile(tmp_path, "foo.bin", _MINIMAL_PDF)
    assert detect_format(p) == "pdf"


def test_detect_format_docx_by_extension(tmp_path: Path) -> None:
    p = _mkfile(tmp_path, "doc.docx", _MINIMAL_DOCX)
    assert detect_format(p) == "docx"


def test_detect_format_tier3_image_is_none(tmp_path: Path) -> None:
    p = _mkfile(tmp_path, "photo.jpg", b"\xff\xd8\xff\xe0")
    assert detect_format(p) is None


# ─── Sampling determinism ───────────────────────────────────────────────────


def _mkdocs(n: int) -> list[DocRow]:
    return [
        DocRow(
            source_sha256=f"{i:064x}",
            source_path=f"/tmp/file_{i}.pdf",
            source_format="pdf",
            size_bytes=1000,
            page_count=10,
        )
        for i in range(n)
    ]


def test_sampling_determinism() -> None:
    docs = _mkdocs(50)
    picks1 = pick_sample(docs, n=5, seed=42, stratum_name="pdf-native-1-10", exclude_hashes=set())
    picks2 = pick_sample(docs, n=5, seed=42, stratum_name="pdf-native-1-10", exclude_hashes=set())
    assert [d.source_sha256 for d in picks1] == [d.source_sha256 for d in picks2]
    assert len(picks1) == 5


def test_sampling_different_seeds_diverge() -> None:
    docs = _mkdocs(50)
    picks1 = pick_sample(docs, n=5, seed=1, stratum_name="s", exclude_hashes=set())
    picks2 = pick_sample(docs, n=5, seed=2, stratum_name="s", exclude_hashes=set())
    assert [d.source_sha256 for d in picks1] != [d.source_sha256 for d in picks2]


def test_sampling_excludes_honored() -> None:
    docs = _mkdocs(20)
    picks = pick_sample(
        docs, n=5, seed=7, stratum_name="s",
        exclude_hashes={docs[0].source_sha256, docs[1].source_sha256},
    )
    for p in picks:
        assert p.source_sha256 not in {docs[0].source_sha256, docs[1].source_sha256}


def test_sampling_small_pool_returns_all() -> None:
    docs = _mkdocs(3)
    picks = pick_sample(docs, n=5, seed=7, stratum_name="s", exclude_hashes=set())
    assert len(picks) == 3


def test_default_seed_stable() -> None:
    assert default_seed("abc") == default_seed("abc")
    assert default_seed("abc") != default_seed("abd")


# ─── End-to-end via TestClient ──────────────────────────────────────────────


def _make_fixture_folder(tmp_path: Path) -> Path:
    folder = tmp_path / "corpus"
    folder.mkdir()
    _mkfile(folder, "paper.pdf", _MINIMAL_PDF)
    _mkfile(folder, "notes.docx", _MINIMAL_DOCX)
    _mkfile(folder, "readme.md", b"# hi\n")
    _mkfile(folder, "plain.txt", b"hello world\n")
    # Tier 3 → skipped
    _mkfile(folder, "cover.png", b"\x89PNG\r\n\x1a\n")
    return folder


def test_scan_endpoint_happy_path(tmp_path: Path) -> None:
    folder = _make_fixture_folder(tmp_path)
    client = TestClient(app)
    r = client.post("/scan", json={"folder": str(folder)})
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["total_files"] == 5
    stratum_names = {s["name"] for s in body["strata"]}
    # poppler may or may not be installed on CI
    assert any(n.startswith("pdf") for n in stratum_names)
    assert "docx" in stratum_names
    assert "md" in stratum_names
    assert "text" in stratum_names
    assert any(s["reason"].startswith("tier3_image") for s in body["skipped"])

    # Tiny strata → exhaustive=True (all these are size 1)
    for s in body["strata"]:
        if s["size"] <= 6:
            assert s["exhaustive"] is True


def test_scan_rejects_relative_path() -> None:
    client = TestClient(app)
    r = client.post("/scan", json={"folder": "./relative"})
    assert r.status_code == 400


def test_scan_rejects_dotdot_segments() -> None:
    client = TestClient(app)
    r = client.post("/scan", json={"folder": "/tmp/../etc"})
    assert r.status_code == 400


def test_scan_rejects_nonexistent() -> None:
    client = TestClient(app)
    r = client.post("/scan", json={"folder": "/nonexistent/path/xyz123"})
    assert r.status_code == 400


def test_scan_symlink_handling(tmp_path: Path) -> None:
    real = tmp_path / "real"
    real.mkdir()
    _mkfile(real, "a.md", b"# hi")
    link = tmp_path / "link"
    os.symlink(real, link)

    client = TestClient(app)

    # Default: follow_symlinks=false → pointing folder AT a symlink is rejected
    r = client.post("/scan", json={"folder": str(link)})
    assert r.status_code == 400

    # follow_symlinks=true → accepted
    r2 = client.post("/scan", json={"folder": str(link), "follow_symlinks": True})
    assert r2.status_code == 200
    assert r2.json()["total_files"] == 1


def test_scan_max_files_enforced(tmp_path: Path) -> None:
    folder = tmp_path / "many"
    folder.mkdir()
    for i in range(5):
        _mkfile(folder, f"f{i}.md", b"x")
    client = TestClient(app)
    r = client.post("/scan", json={"folder": str(folder), "max_files": 2})
    assert r.status_code == 400
    assert "max_files" in r.text


def test_sample_endpoint_determinism(tmp_path: Path) -> None:
    folder = tmp_path / "corpus"
    folder.mkdir()
    # 20 unique md files → non-exhaustive stratum
    for i in range(20):
        _mkfile(folder, f"doc_{i}.md", f"content {i}".encode())
    client = TestClient(app)
    r = client.post("/scan", json={"folder": str(folder)})
    assert r.status_code == 200
    scan_id = r.json()["scan_id"]

    r1 = client.post(
        "/strata/sample",
        json={"scan_id": scan_id, "n": 5, "seed": 12345},
    )
    r2 = client.post(
        "/strata/sample",
        json={"scan_id": scan_id, "n": 5, "seed": 12345},
    )
    assert r1.status_code == 200
    assert r2.status_code == 200
    body1, body2 = r1.json(), r2.json()
    assert body1["seed"] == 12345
    assert body1 == body2

    md_stratum = next(s for s in body1["strata"] if s["name"] == "md")
    assert len(md_stratum["docs"]) == 5


def test_sample_exhaustive_stratum_returns_all(tmp_path: Path) -> None:
    folder = tmp_path / "corpus"
    folder.mkdir()
    # 3 md files → exhaustive
    for i in range(3):
        _mkfile(folder, f"doc_{i}.md", f"c{i}".encode())
    client = TestClient(app)
    scan_id = client.post("/scan", json={"folder": str(folder)}).json()["scan_id"]
    r = client.post("/strata/sample", json={"scan_id": scan_id, "n": 5})
    body = r.json()
    md = next(s for s in body["strata"] if s["name"] == "md")
    assert len(md["docs"]) == 3


def test_sample_unknown_scan_id() -> None:
    client = TestClient(app)
    r = client.post("/strata/sample", json={"scan_id": "nope", "n": 5})
    assert r.status_code == 404
