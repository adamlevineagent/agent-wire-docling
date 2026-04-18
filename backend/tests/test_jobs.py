"""Jobs: batch flow, cancellation, resume, leases, taste, export."""

from __future__ import annotations

import asyncio
import sys
import types
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend import db as _db
from backend.jobs import batch as _batch
from backend.jobs import queue as q


def _seed_scan(conn: Any, scan_id: str, folder: str, docs: list[dict]) -> None:
    conn.execute(
        "INSERT INTO scans (id, folder_root, total_files, created_at) VALUES (?, ?, ?, ?)",
        (scan_id, folder, len(docs), q.now_iso()),
    )
    strata_sizes: dict[str, int] = {}
    for d in docs:
        strata_sizes[d["stratum"]] = strata_sizes.get(d["stratum"], 0) + 1
    for name, size in strata_sizes.items():
        conn.execute(
            "INSERT INTO strata (scan_id, name, size, exhaustive) VALUES (?, ?, ?, ?)",
            (scan_id, name, size, 1 if size <= 6 else 0),
        )
    for d in docs:
        conn.execute(
            """INSERT INTO scan_docs
                 (scan_id, source_sha256, source_path, source_format, stratum,
                  size_bytes, page_count, signals_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                scan_id, d["source_sha256"], d["source_path"], d["source_format"],
                d["stratum"], d.get("size_bytes", 0), d.get("page_count"), None,
            ),
        )
    conn.commit()


def _install_fake_conversion(behavior: str = "ok") -> None:
    """Install a stub for backend.conversion.convert with convert_doc."""
    pkg_name = "backend.conversion"
    conv_pkg = sys.modules.get(pkg_name)
    if conv_pkg is None:
        conv_pkg = types.ModuleType(pkg_name)
        conv_pkg.__path__ = []  # type: ignore[attr-defined]
        sys.modules[pkg_name] = conv_pkg

    mod = types.ModuleType(f"{pkg_name}.convert")

    call_count = {"n": 0}

    async def convert_doc(source_path: str, output_dir: str, pipeline: dict):  # type: ignore
        call_count["n"] += 1
        if behavior == "fail":
            raise RuntimeError("forced fail")
        if behavior == "flaky" and call_count["n"] < 3:
            raise RuntimeError("transient")
        # Simulate a bit of work + atomic tmp-rename doc dir
        import hashlib
        sha = hashlib.sha256(source_path.encode()).hexdigest()[:16]
        out = Path(output_dir) / sha
        tmp = Path(output_dir) / f"{sha}.tmp"
        tmp.mkdir(parents=True, exist_ok=True)
        (tmp / "content.md").write_text(f"# {source_path}\n")
        (tmp / "content.json").write_text("{}")
        import os
        os.replace(tmp, out)
        return {
            "source_sha256": sha,
            "source_path": source_path,
            "source_format": "pdf",
            "docling_version": "test",
            "pipeline_params": pipeline,
            "pipeline_hash": "test",
            "runtime_ms": 1,
            "status": "ok",
            "stats": {"md_char_count": 10, "json_size_bytes": 2},
            "quality_signals": {"warnings": [], "empty_pages": [], "ocr_confidence_per_page": []},
            "converted_at": q.now_iso(),
        }

    mod.convert_doc = convert_doc  # type: ignore[attr-defined]
    sys.modules[f"{pkg_name}.convert"] = mod
    conv_pkg.convert = mod  # type: ignore[attr-defined]


def _client() -> TestClient:
    # Import lazily so the DB path is redirected before router import
    from backend.main import app
    return TestClient(app)


def test_lease_acquire_and_release(tmp_db: Path) -> None:
    conn = _db.connect()
    try:
        got1 = q.acquire_lease(conn, "/out", "sha", "ph", "j1")
        got2 = q.acquire_lease(conn, "/out", "sha", "ph", "j2")
        assert got1 is True
        assert got2 is False
        q.release_lease(conn, "/out", "sha", "ph")
        got3 = q.acquire_lease(conn, "/out", "sha", "ph", "j3")
        assert got3 is True
    finally:
        conn.close()


def test_cleanup_tmp_dirs(tmp_path: Path) -> None:
    (tmp_path / "aaaa.tmp").mkdir()
    (tmp_path / "aaaa.tmp" / "x.md").write_text("x")
    (tmp_path / "bbbb").mkdir()
    cleaned = q.cleanup_tmp_dirs(tmp_path)
    assert cleaned == ["aaaa.tmp"]
    assert not (tmp_path / "aaaa.tmp").exists()
    assert (tmp_path / "bbbb").exists()


def test_resume_cleanup_clears_leases_and_tmp(tmp_db: Path, tmp_path: Path) -> None:
    out = tmp_path / "out"
    out.mkdir()
    (out / "xxx.tmp").mkdir()
    (out / "xxx.tmp" / "a").write_text("a")

    conn = _db.connect()
    try:
        # Register a known output_dir via docs
        conn.execute(
            """INSERT INTO docs (output_dir, source_sha256, pipeline_hash,
                                  source_path, source_format, status)
               VALUES (?, 's1', 'p1', '/x', 'pdf', 'processing')""",
            (str(out),),
        )
        # Stale lease
        q.acquire_lease(conn, str(out), "s1", "p1", "jold")
        # In-progress job
        q.insert_job(conn, kind="batch", status="running", output_dir=str(out))
        conn.commit()
    finally:
        conn.close()

    summary = q.resume_cleanup()
    assert summary["leases_released"] >= 1
    assert summary["jobs_failed"] >= 1
    assert any(".tmp" in s for s in summary["tmp_dirs_cleaned"])
    assert not (out / "xxx.tmp").exists()


@pytest.mark.asyncio
async def test_batch_runs_end_to_end(tmp_db: Path, tmp_path: Path) -> None:
    _install_fake_conversion("ok")
    out = tmp_path / "out"
    scan_id = "scan1"
    conn = _db.connect()
    try:
        _seed_scan(conn, scan_id, str(tmp_path / "src"), [
            {"source_sha256": "a" * 16, "source_path": "/src/a.pdf",
             "source_format": "pdf", "stratum": "pdf-native-1-10"},
            {"source_sha256": "b" * 16, "source_path": "/src/b.pdf",
             "source_format": "pdf", "stratum": "pdf-native-1-10"},
        ])
        jid = q.insert_job(
            conn, kind="batch", status="queued",
            output_dir=str(out), scan_id=scan_id, docs_total=2,
        )
    finally:
        conn.close()

    q.runner().register(jid)
    await _batch.run_batch(
        jid, scan_id, str(out),
        [{"stratum": "pdf-native-1-10", "pipeline": {}}],
        concurrency=2,
    )
    conn = _db.connect()
    try:
        row = q.read_job(conn, jid)
        assert row is not None
        assert row["status"] == "completed"
        assert row["docs_done"] == 2
        assert row["docs_failed"] == 0
    finally:
        conn.close()

    manifest = out / "manifest.json"
    assert manifest.exists()
    import json
    m = json.loads(manifest.read_text())
    assert len(m["docs"]) == 2


@pytest.mark.asyncio
async def test_batch_retry_then_succeed(tmp_db: Path, tmp_path: Path) -> None:
    _install_fake_conversion("flaky")
    out = tmp_path / "out"
    scan_id = "scan2"
    conn = _db.connect()
    try:
        _seed_scan(conn, scan_id, str(tmp_path / "src"), [
            {"source_sha256": "c" * 16, "source_path": "/src/c.pdf",
             "source_format": "pdf", "stratum": "s"},
        ])
        jid = q.insert_job(
            conn, kind="batch", status="queued",
            output_dir=str(out), scan_id=scan_id, docs_total=1,
        )
    finally:
        conn.close()

    q.runner().register(jid)
    await _batch.run_batch(
        jid, scan_id, str(out),
        [{"stratum": "s", "pipeline": {}}], concurrency=1,
    )
    conn = _db.connect()
    try:
        row = q.read_job(conn, jid)
        assert row is not None
        assert row["status"] == "completed"
        assert row["docs_done"] == 1
    finally:
        conn.close()


@pytest.mark.asyncio
async def test_batch_cancel(tmp_db: Path, tmp_path: Path) -> None:
    # A slow fake convert so we can cancel mid-flight
    pkg_name = "backend.conversion"
    conv_pkg = sys.modules.get(pkg_name) or types.ModuleType(pkg_name)
    conv_pkg.__path__ = []  # type: ignore[attr-defined]
    sys.modules[pkg_name] = conv_pkg
    mod = types.ModuleType(f"{pkg_name}.convert")

    async def convert_doc(source_path, output_dir, pipeline):  # type: ignore
        await asyncio.sleep(0.2)
        return {
            "source_sha256": "z",
            "source_path": source_path,
            "source_format": "pdf",
            "docling_version": "t",
            "pipeline_params": pipeline,
            "pipeline_hash": "t",
            "runtime_ms": 1,
            "status": "ok",
        }

    mod.convert_doc = convert_doc  # type: ignore[attr-defined]
    sys.modules[f"{pkg_name}.convert"] = mod
    conv_pkg.convert = mod  # type: ignore[attr-defined]

    out = tmp_path / "out"
    scan_id = "scan3"
    conn = _db.connect()
    try:
        _seed_scan(conn, scan_id, str(tmp_path / "src"), [
            {"source_sha256": f"{i:016x}", "source_path": f"/src/{i}.pdf",
             "source_format": "pdf", "stratum": "s"} for i in range(6)
        ])
        jid = q.insert_job(
            conn, kind="batch", status="queued",
            output_dir=str(out), scan_id=scan_id, docs_total=6,
        )
    finally:
        conn.close()

    q.runner().register(jid)
    task = asyncio.create_task(_batch.run_batch(
        jid, scan_id, str(out),
        [{"stratum": "s", "pipeline": {}}], concurrency=1,
    ))
    await asyncio.sleep(0.05)
    q.runner().cancel(jid)
    await task

    conn = _db.connect()
    try:
        row = q.read_job(conn, jid)
        assert row is not None
        assert row["status"] == "cancelled"
        assert (row["docs_done"] + row["docs_failed"]) < 6
    finally:
        conn.close()


def test_taste_session_crud(tmp_db: Path) -> None:
    conn = _db.connect()
    try:
        conn.execute(
            "INSERT INTO scans (id, folder_root, total_files, created_at) VALUES ('s','/f',0,?)",
            (q.now_iso(),),
        )
        conn.execute(
            "INSERT INTO strata (scan_id, name, size, exhaustive) VALUES ('s','grp',3,1)"
        )
        conn.commit()
    finally:
        conn.close()

    from backend.jobs import taste
    sess = taste.create_session("s", "/out")
    assert len(sess["strata"]) == 1
    assert sess["version"] == 1
    sid = sess["id"]

    patched = taste.patch_session(sid, {
        "version": 1,
        "pipeline_assignment": {"stratum": "grp", "pipeline": {"ocr": {"enabled": False}}},
    })
    assert patched is not None
    assert patched["version"] == 2
    assert patched["strata"][0]["pipeline"]["ocr"]["enabled"] is False

    # Wrong version -> conflict
    with pytest.raises(taste.VersionConflict):
        taste.patch_session(sid, {"version": 99, "lock_stratum": {"stratum": "grp", "locked": True}})

    # Approval
    approved = taste.patch_session(sid, {
        "version": 2,
        "approval": {
            "stratum": "grp",
            "approval": {
                "source_sha256": "sha1",
                "status": "approved",
                "pipeline_hash": "p1",
                "reviewed_at": q.now_iso(),
            },
        },
        "lock_stratum": {"stratum": "grp", "locked": True},
    })
    assert approved is not None
    assert approved["strata"][0]["locked"] is True
    assert len(approved["strata"][0]["approvals"]) == 1

    # Round-trip
    again = taste.read_session(sid)
    assert again is not None
    assert again["strata"][0]["locked"] is True


@pytest.mark.asyncio
async def test_crash_restart_resume(tmp_db: Path, tmp_path: Path) -> None:
    """Simulate: start batch, it writes a .tmp/ dir, crash, restart cleans up."""
    out = tmp_path / "out"
    out.mkdir()
    # Seed: a job that was running + a lease + a stray .tmp/
    (out / "abcd1234.tmp").mkdir()
    (out / "abcd1234.tmp" / "partial.md").write_text("x")

    conn = _db.connect()
    try:
        jid = q.insert_job(
            conn, kind="batch", status="running",
            output_dir=str(out), scan_id="sc",
        )
        conn.execute(
            """INSERT INTO docs (output_dir, source_sha256, pipeline_hash,
                                  source_path, source_format, status)
               VALUES (?, 'abcd1234', 'p', '/x', 'pdf', 'processing')""",
            (str(out),),
        )
        q.acquire_lease(conn, str(out), "abcd1234", "p", jid)
        conn.commit()
    finally:
        conn.close()

    # Restart
    summary = q.resume_cleanup()
    assert summary["leases_released"] >= 1
    assert summary["jobs_failed"] >= 1
    assert not (out / "abcd1234.tmp").exists()

    conn = _db.connect()
    try:
        row = q.read_job(conn, jid)
        assert row is not None
        assert row["status"] == "failed"
        leases = conn.execute("SELECT COUNT(*) AS n FROM doc_leases").fetchone()["n"]
        assert leases == 0
    finally:
        conn.close()


def test_http_endpoints_smoke(tmp_db: Path, tmp_path: Path) -> None:
    _install_fake_conversion("ok")
    client = _client()

    # Seed scan
    conn = _db.connect()
    try:
        _seed_scan(conn, "scanH", str(tmp_path / "src"), [
            {"source_sha256": "d" * 16, "source_path": "/src/d.pdf",
             "source_format": "pdf", "stratum": "s"},
        ])
    finally:
        conn.close()

    # Taste create
    r = client.post("/taste_sessions", json={"scan_id": "scanH", "output_dir": str(tmp_path / "o")})
    assert r.status_code == 200, r.text
    sess = r.json()
    assert sess["version"] == 1

    r2 = client.get(f"/taste_sessions/{sess['id']}")
    assert r2.status_code == 200

    # Batch
    r3 = client.post("/batch", json={
        "scan_id": "scanH",
        "output_dir": str(tmp_path / "o"),
        "concurrency": 1,
        "stratum_pipelines": [{"stratum": "s", "pipeline": {}}],
    })
    assert r3.status_code == 200, r3.text
    job = r3.json()

    # Poll
    import time
    for _ in range(40):
        jr = client.get(f"/jobs/{job['id']}")
        if jr.json()["status"] in ("completed", "failed", "cancelled"):
            break
        time.sleep(0.05)
    assert jr.json()["status"] == "completed"

    # Manifest
    mr = client.get("/manifest", params={"output_dir": str(tmp_path / "o")})
    assert mr.status_code == 200
    assert len(mr.json()["docs"]) == 1

    # Export manifest_only
    dest = tmp_path / "exports" / "m.json"
    er = client.post("/export", json={
        "output_dir": str(tmp_path / "o"),
        "kind": "manifest_only",
        "destination": str(dest),
    })
    assert er.status_code == 200
    ejid = er.json()["id"]
    for _ in range(20):
        er2 = client.get(f"/exports/{ejid}")
        if er2.json()["status"] in ("completed", "failed"):
            break
        time.sleep(0.05)
    assert er2.json()["status"] == "completed"
    assert dest.exists()
