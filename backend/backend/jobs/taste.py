"""Taste session CRUD — backend for Wave 2 Agent G.

Tables: taste_sessions, taste_strata, taste_approvals.

PATCH uses optimistic locking on taste_sessions.version. A successful
PATCH increments version.
"""

from __future__ import annotations

import json
from typing import Any

from backend import db as _db
from backend.jobs import queue as q


def _serialize(conn: Any, session_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM taste_sessions WHERE id = ?", (session_id,)
    ).fetchone()
    if not row:
        return None
    strata_rows = conn.execute(
        "SELECT * FROM taste_strata WHERE session_id = ? ORDER BY name", (session_id,)
    ).fetchall()
    approvals_rows = conn.execute(
        "SELECT * FROM taste_approvals WHERE session_id = ? ORDER BY reviewed_at", (session_id,)
    ).fetchall()

    approvals_by_stratum: dict[str, list[dict[str, Any]]] = {}
    for a in approvals_rows:
        approvals_by_stratum.setdefault(a["stratum"], []).append({
            "source_sha256": a["source_sha256"],
            "status": a["action"],
            "notes": a["notes"],
            "reviewed_at": a["reviewed_at"],
            "pipeline_hash": a["pipeline_hash"],
        })

    strata: list[dict[str, Any]] = []
    for s in strata_rows:
        pipeline = {}
        try:
            pipeline = json.loads(s["pipeline_json"] or "{}")
        except json.JSONDecodeError:
            pipeline = {}
        strata.append({
            "name": s["name"],
            "size": s["size"],
            "pipeline": pipeline,
            "approvals": approvals_by_stratum.get(s["name"], []),
            "locked": bool(s["locked"]),
            "status": s["status"],
        })

    return {
        "id": row["id"],
        "folder_root": row["folder_root"],
        "output_dir": row["output_dir"],
        "scan_id": row["scan_id"],
        "strata": strata,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "version": row["version"],
    }


def create_session(scan_id: str, output_dir: str) -> dict[str, Any]:
    conn = _db.connect()
    try:
        scan = conn.execute(
            "SELECT folder_root FROM scans WHERE id = ?", (scan_id,)
        ).fetchone()
        if not scan:
            raise ValueError(f"scan_id not found: {scan_id}")
        folder_root = scan["folder_root"]

        sid = q.new_id()
        now = q.now_iso()
        conn.execute(
            """INSERT INTO taste_sessions (id, scan_id, output_dir, folder_root,
                                            version, created_at, updated_at)
               VALUES (?, ?, ?, ?, 1, ?, ?)""",
            (sid, scan_id, output_dir, folder_root, now, now),
        )
        # Seed taste_strata from the scan's strata rows
        strata = conn.execute(
            "SELECT name, size FROM strata WHERE scan_id = ?", (scan_id,)
        ).fetchall()
        default_pipeline = json.dumps({})
        for s in strata:
            conn.execute(
                """INSERT INTO taste_strata (session_id, name, size, pipeline_json,
                                             locked, status)
                   VALUES (?, ?, ?, ?, 0, 'under_review')""",
                (sid, s["name"], s["size"], default_pipeline),
            )
        conn.commit()
        result = _serialize(conn, sid)
        assert result is not None
        return result
    finally:
        conn.close()


def read_session(session_id: str) -> dict[str, Any] | None:
    conn = _db.connect()
    try:
        return _serialize(conn, session_id)
    finally:
        conn.close()


class VersionConflictError(Exception):
    """PATCH version mismatch (optimistic lock failure)."""


# Back-compat alias
VersionConflict = VersionConflictError


def patch_session(session_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    conn = _db.connect()
    try:
        row = conn.execute(
            "SELECT version FROM taste_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if not row:
            return None
        expected = patch.get("version")
        if expected is not None and int(expected) != int(row["version"]):
            raise VersionConflict(
                f"version mismatch: client={expected}, server={row['version']}"
            )

        now = q.now_iso()

        if patch.get("approval"):
            ap = patch["approval"]
            stratum = ap.get("stratum")
            approval = ap.get("approval", {})
            if not stratum or not approval.get("source_sha256"):
                raise ValueError("approval requires stratum + approval.source_sha256")
            conn.execute(
                """INSERT OR REPLACE INTO taste_approvals
                   (session_id, stratum, source_sha256, pipeline_hash,
                    action, notes, reviewed_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    session_id,
                    stratum,
                    approval["source_sha256"],
                    approval.get("pipeline_hash", ""),
                    approval.get("status", "approved"),
                    approval.get("notes"),
                    approval.get("reviewed_at", now),
                ),
            )

        if patch.get("pipeline_assignment"):
            pa = patch["pipeline_assignment"]
            stratum = pa.get("stratum")
            pipeline = pa.get("pipeline", {})
            if not stratum:
                raise ValueError("pipeline_assignment requires stratum")
            conn.execute(
                """UPDATE taste_strata SET pipeline_json = ?
                   WHERE session_id = ? AND name = ?""",
                (json.dumps(pipeline), session_id, stratum),
            )

        if patch.get("lock_stratum"):
            ls = patch["lock_stratum"]
            stratum = ls.get("stratum")
            locked = 1 if ls.get("locked") else 0
            if not stratum:
                raise ValueError("lock_stratum requires stratum")
            conn.execute(
                """UPDATE taste_strata SET locked = ?
                   WHERE session_id = ? AND name = ?""",
                (locked, session_id, stratum),
            )

        conn.execute(
            "UPDATE taste_sessions SET version = version + 1, updated_at = ? WHERE id = ?",
            (now, session_id),
        )
        conn.commit()
        return _serialize(conn, session_id)
    finally:
        conn.close()
