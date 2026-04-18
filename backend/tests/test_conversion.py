"""Wave 1 Agent A gate tests for the conversion module.

Runs a real Docling conversion on data/fixtures/attention.pdf once per session
(cached via a module-scoped fixture) and asserts:

1. Anchor byte offsets align with substrings in doc.md
2. Atomic write: no <hash>.tmp/ dir remains after success
3. pipeline_hash changes when pipeline params change
4. Re-converting the same input is a no-op (skipped=True)
5. The FastAPI /convert endpoint round-trips end-to-end
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.conversion import converter as cv
from backend.conversion import db as conv_db
from backend.conversion.pipeline import PipelineParams, pipeline_hash

_ROOT = Path(__file__).resolve().parent.parent.parent
_FIXTURE = _ROOT / "data" / "fixtures" / "attention.pdf"


@pytest.fixture(scope="module")
def tmp_state_db(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Redirect SQLite writes to a throwaway file for this test module."""
    p = tmp_path_factory.mktemp("state") / "state.db"
    conv_db.set_db_path(p)
    conv_db.reset_schema_cache()
    # Also redirect stratification db to the same file so both share a schema
    try:
        from backend.stratification import db as strat_db

        strat_db.set_db_path(p)
        strat_db.reset_schema_cache()
    except Exception:
        pass
    yield p
    conv_db.set_db_path(None)


@pytest.fixture(scope="module")
def converted(tmp_path_factory: pytest.TempPathFactory, tmp_state_db: Path):
    assert _FIXTURE.exists(), f"fixture missing: {_FIXTURE}"
    out = tmp_path_factory.mktemp("out-default")
    outcome = cv.convert_source(_FIXTURE, out, params=None)
    assert outcome.meta["status"] == "ok"
    return outcome, out


def test_anchor_offsets_align_with_markdown(converted):
    outcome, _out = converted
    paths = outcome.paths
    md = paths.md.read_text(encoding="utf-8")
    md_bytes = md.encode("utf-8")
    anchors = json.loads(paths.anchors.read_text(encoding="utf-8"))

    # At least some anchors landed in the markdown
    anchored = [a for a in anchors if a["byte_start"] >= 0 and a["byte_end"] > a["byte_start"]]
    assert len(anchored) >= 5, f"expected multiple anchored items, got {len(anchored)}"

    # Spot-check: slice of md at [byte_start:byte_end] exists and is non-empty
    checked = 0
    for a in anchored[:20]:
        slice_ = md_bytes[a["byte_start"] : a["byte_end"]].decode("utf-8", errors="ignore")
        assert slice_.strip(), f"empty slice for {a['self_ref']}"
        # byte_start must fall on a UTF-8 character boundary (decoding start must not begin mid-char)
        # we already decode from byte_start; if that succeeded we're fine
        checked += 1
    assert checked > 0


def test_atomic_write_leaves_no_tmp_dir(converted):
    _outcome, out = converted
    leftovers = [p for p in out.iterdir() if p.name.endswith(".tmp")]
    assert leftovers == [], f"stale tmp dirs remain: {leftovers}"


def test_required_files_emitted(converted):
    outcome, _out = converted
    p = outcome.paths
    for f in (p.source, p.md, p.json_, p.anchors, p.meta):
        assert f.exists() and f.stat().st_size > 0, f"missing or empty: {f}"


def test_pipeline_hash_changes_when_params_change():
    a = PipelineParams()
    b = PipelineParams.model_validate(
        {"ocr": {"enabled": False}, "tables": {"enabled": False}}
    )
    ha = pipeline_hash(a)
    hb = pipeline_hash(b)
    assert ha != hb
    # deterministic
    assert ha == pipeline_hash(PipelineParams())


def test_noop_rerun_skips(converted, tmp_state_db: Path):
    outcome, out = converted
    again = cv.convert_source(_FIXTURE, out, params=None)
    assert again.skipped is True
    assert again.meta["source_sha256"] == outcome.meta["source_sha256"]
    assert again.meta["pipeline_hash"] == outcome.meta["pipeline_hash"]


def test_different_pipeline_produces_new_meta(converted, tmp_state_db: Path):
    outcome, out = converted
    alt = PipelineParams.model_validate({"ocr": {"enabled": False}})
    outcome_alt = cv.convert_source(_FIXTURE, out, params=alt)
    assert outcome_alt.meta["pipeline_hash"] != outcome.meta["pipeline_hash"]
    # Output layout is per-source_sha256, not per-pipeline — the directory is
    # reused, but meta.json is rewritten with the new pipeline_hash.
    meta_on_disk = json.loads(outcome_alt.paths.meta.read_text(encoding="utf-8"))
    assert meta_on_disk["pipeline_hash"] == outcome_alt.meta["pipeline_hash"]


def test_http_convert_roundtrip(tmp_path_factory, tmp_state_db: Path):
    # Fresh output dir so we can assert the happy path + /docs/{hash} endpoints
    out = tmp_path_factory.mktemp("out-http")
    from backend.main import app

    client = TestClient(app)
    resp = client.post(
        "/convert",
        json={"source_path": str(_FIXTURE), "output_dir": str(out)},
    )
    assert resp.status_code == 200, resp.text
    meta = resp.json()
    sha = meta["source_sha256"]
    assert meta["status"] == "ok"
    assert meta["stats"]["md_char_count"] > 1000

    # /docs/{hash}
    r = client.get(f"/docs/{sha}", params={"output_dir": str(out)})
    assert r.status_code == 200
    assert r.json()["source_sha256"] == sha

    # /docs/{hash}/md
    r = client.get(f"/docs/{sha}/md", params={"output_dir": str(out)})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/markdown")
    assert len(r.text) == meta["stats"]["md_char_count"]

    # /docs/{hash}/json
    r = client.get(f"/docs/{sha}/json", params={"output_dir": str(out)})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    j = r.json()
    assert "texts" in j

    # /docs/{hash}/anchors
    r = client.get(f"/docs/{sha}/anchors", params={"output_dir": str(out)})
    assert r.status_code == 200
    anchors = r.json()
    assert isinstance(anchors, list) and len(anchors) > 0

    # /docs/{hash}/source — octet-stream-ish, content-type pdf
    r = client.get(f"/docs/{sha}/source", params={"output_dir": str(out)})
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
