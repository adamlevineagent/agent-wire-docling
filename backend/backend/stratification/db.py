"""SQLite helpers for the stratification router.

Agent C owns migration authority, but Agent B needs to read+write the
`scans`, `strata`, and `scan_docs` tables defined in contracts/db-schema.sql.

To keep Wave 1 agents decoupled we apply the schema on first connect
(idempotent — the contract file uses `CREATE TABLE IF NOT EXISTS` and
bakes in the initial `_schema_migrations` row).
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_DATA_DIR = _ROOT / "data"
_DB_PATH_DEFAULT = _DATA_DIR / "state.db"
_SCHEMA_PATH = _ROOT / "contracts" / "db-schema.sql"

# Allow tests to override via module attribute
_db_path_override: Path | None = None


def set_db_path(path: Path | None) -> None:
    """Tests call this to redirect writes to a temp file."""
    global _db_path_override
    _db_path_override = path


def _db_path() -> Path:
    return _db_path_override if _db_path_override is not None else _DB_PATH_DEFAULT


def connect() -> sqlite3.Connection:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    _ensure_schema(conn)
    return conn


_SCHEMA_APPLIED: set[str] = set()


def _ensure_schema(conn: sqlite3.Connection) -> None:
    key = str(_db_path())
    if key in _SCHEMA_APPLIED:
        return
    if _SCHEMA_PATH.exists():
        conn.executescript(_SCHEMA_PATH.read_text())
        conn.commit()
    _SCHEMA_APPLIED.add(key)


def reset_schema_cache() -> None:
    """Tests: force re-apply after switching db path."""
    _SCHEMA_APPLIED.clear()
