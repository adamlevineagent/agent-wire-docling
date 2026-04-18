"""Shared SQLite connection helper — owned by Agent C.

Applies the canonical schema from contracts/db-schema.sql on first connect
and tracks applied version in _schema_migrations. Opens with WAL mode and
busy_timeout=5000. Agents A/B may import the read/write helpers here
instead of rolling their own.

Back-compat shim: the pre-existing backend/stratification/db.py used
an in-process cache keyed by db path. This module supersedes it;
stratification/db.py re-exports from here.
"""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent.parent
_DATA_DIR = _ROOT / "data"
_DB_PATH_DEFAULT = _DATA_DIR / "state.db"
_SCHEMA_PATH = _ROOT / "contracts" / "db-schema.sql"

_lock = threading.Lock()
_db_path_override: Path | None = None
_applied_paths: set[str] = set()


def set_db_path(path: Path | None) -> None:
    """Redirect writes to a different DB path (for tests). Resets schema cache."""
    global _db_path_override
    with _lock:
        _db_path_override = path
        # Force re-apply when the path changes.
        _applied_paths.clear()


def db_path() -> Path:
    return _db_path_override if _db_path_override is not None else _DB_PATH_DEFAULT


def reset_schema_cache() -> None:
    with _lock:
        _applied_paths.clear()


def _apply_schema(conn: sqlite3.Connection) -> None:
    key = str(db_path())
    with _lock:
        if key in _applied_paths:
            return
        if _SCHEMA_PATH.exists():
            conn.executescript(_SCHEMA_PATH.read_text())
            conn.commit()
        _applied_paths.add(key)


def connect() -> sqlite3.Connection:
    """Open a connection with WAL + busy_timeout + FKs. Applies schema lazily."""
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=5.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    _apply_schema(conn)
    return conn


def schema_version() -> int:
    conn = connect()
    try:
        row = conn.execute(
            "SELECT COALESCE(MAX(version), 0) AS v FROM _schema_migrations"
        ).fetchone()
        return int(row["v"]) if row else 0
    finally:
        conn.close()
