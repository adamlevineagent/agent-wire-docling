"""Migration / schema tests."""

from __future__ import annotations

from pathlib import Path

from backend import db as _db


def test_schema_applies_on_connect(tmp_db: Path) -> None:
    conn = _db.connect()
    try:
        tables = {
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        for t in [
            "scans", "strata", "scan_docs", "docs", "jobs", "doc_leases",
            "taste_sessions", "taste_strata", "taste_approvals",
            "_schema_migrations",
        ]:
            assert t in tables, f"missing table: {t}"
    finally:
        conn.close()


def test_wal_and_busy_timeout(tmp_db: Path) -> None:
    conn = _db.connect()
    try:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
        assert int(conn.execute("PRAGMA busy_timeout").fetchone()[0]) == 5000
    finally:
        conn.close()


def test_schema_version_recorded(tmp_db: Path) -> None:
    assert _db.schema_version() == 1
