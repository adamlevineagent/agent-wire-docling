"""Export jobs — manifest-only by default.

Kinds:
  - manifest_only      : copy manifest.json to destination
  - manifest_plus_md   : manifest.json + every <hash>/*.md under output_dir
  - full_archive       : zip of the whole output_dir

manifest_plus_md and full_archive may be deferred if they don't fit in
the Wave 1 gate budget — they're implemented here since it's cheap.
"""

from __future__ import annotations

import asyncio
import shutil
import zipfile
from pathlib import Path

from backend import db as _db
from backend.jobs import queue as q


async def run_export(job_id: str, output_dir: str, kind: str, destination: str) -> None:
    q.log_event(job_id, {"event": "export_start", "kind": kind, "destination": destination})
    src = Path(output_dir)
    dst = Path(destination)

    conn = _db.connect()
    try:
        q.update_job_status(conn, job_id, status="running", started_at=q.now_iso())
    finally:
        conn.close()

    try:
        result_path: str
        if kind == "manifest_only":
            dst.parent.mkdir(parents=True, exist_ok=True)
            manifest_src = src / "manifest.json"
            if not manifest_src.exists():
                raise FileNotFoundError(f"manifest.json missing in {src}")
            # If dst is a directory, write manifest.json inside it.
            if dst.exists() and dst.is_dir():
                final = dst / "manifest.json"
            elif dst.suffix == "" and not dst.exists():
                dst.mkdir(parents=True, exist_ok=True)
                final = dst / "manifest.json"
            else:
                final = dst
            shutil.copy2(manifest_src, final)
            result_path = str(final)

        elif kind == "manifest_plus_md":
            dst.mkdir(parents=True, exist_ok=True)
            manifest_src = src / "manifest.json"
            if manifest_src.exists():
                shutil.copy2(manifest_src, dst / "manifest.json")
            for md in src.rglob("*.md"):
                rel = md.relative_to(src)
                target = dst / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(md, target)
                await asyncio.sleep(0)
            result_path = str(dst)

        elif kind == "full_archive":
            dst.parent.mkdir(parents=True, exist_ok=True)
            # Ensure .zip suffix
            zpath = dst if dst.suffix == ".zip" else dst.with_suffix(".zip")
            with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as zf:
                for p in src.rglob("*"):
                    if p.is_file():
                        zf.write(p, p.relative_to(src))
                        await asyncio.sleep(0)
            result_path = str(zpath)

        else:
            raise ValueError(f"unknown export kind: {kind}")

        conn = _db.connect()
        try:
            q.update_job_status(
                conn, job_id,
                status="completed", completed_at=q.now_iso(),
                result_path=result_path,
            )
        finally:
            conn.close()
        q.log_event(job_id, {"event": "export_done", "result_path": result_path})
    except Exception as e:
        conn = _db.connect()
        try:
            q.update_job_status(
                conn, job_id,
                status="failed", completed_at=q.now_iso(), error=str(e),
            )
        finally:
            conn.close()
        q.log_event(job_id, {"event": "export_fail", "error": str(e)})
