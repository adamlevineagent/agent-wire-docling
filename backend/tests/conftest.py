"""Shared test fixtures — redirect DB + cleanup caches per test."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from backend import db as _db
from backend.stratification import db as _stratdb


@pytest.fixture
def tmp_db(tmp_path: Path) -> Iterator[Path]:
    db_path = tmp_path / "state.db"
    _db.set_db_path(db_path)
    _stratdb.set_db_path(db_path)
    _stratdb.reset_schema_cache()
    _db.reset_schema_cache()
    try:
        yield db_path
    finally:
        _db.set_db_path(None)
        _stratdb.set_db_path(None)
        _db.reset_schema_cache()
        _stratdb.reset_schema_cache()
