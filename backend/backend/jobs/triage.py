"""Triage — corpus-wide batch failure rollup.

Spec: `docs/filemap-model.md` §Triage. Writes `<output_dir>/triage.yaml`
after every batch; provides retry-from-triage and exclude-from-triage.
"""

from __future__ import annotations

import datetime as _dt
import os
import uuid
from pathlib import Path
from typing import Any

import yaml  # type: ignore[import-untyped]

TRIAGE_NAME = "triage.yaml"


def _now_iso() -> str:
    return _dt.datetime.now(_dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _triage_path(output_dir: Path | str) -> Path:
    return Path(output_dir) / TRIAGE_NAME


def classify_error(err: str | None) -> str:
    if not err:
        return "unknown"
    low = err.lower()
    if "422" in err or "unprocessable" in low:
        return "convert_422"
    if "timeout" in low and ("ocr" in low or "tesseract" in low):
        return "ocr_timeout"
    if "timeout" in low:
        return "ocr_timeout"
    if "parse" in low or "parser" in low or "xml" in low:
        return "parse_error"
    return "unknown"


def write_triage(
    output_dir: Path | str,
    batch_id: str,
    results: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build + atomically write `triage.yaml` from a list of per-doc result dicts.

    Each `result` must carry at least:
      - source_path, source_sha256, detected_content_type, detected_stratum,
        pipeline_used (dict), status ("complete" | "error"), error (str | None),
        attempt_count, first_attempted_at, last_attempted_at, filemap_folder
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    succeeded = sum(1 for r in results if r.get("status") == "complete")
    failed = [r for r in results if r.get("status") != "complete"]

    by_reason: dict[str, int] = {}
    by_ct: dict[str, int] = {}
    failures: list[dict[str, Any]] = []

    for r in failed:
        cat = classify_error(r.get("error"))
        by_reason[cat] = by_reason.get(cat, 0) + 1
        ct = r.get("detected_content_type") or "unknown"
        by_ct[ct] = by_ct.get(ct, 0) + 1
        failures.append(
            {
                "source_path": r.get("source_path"),
                "source_sha256": r.get("source_sha256"),
                "detected_content_type": r.get("detected_content_type"),
                "detected_stratum": r.get("detected_stratum"),
                "pipeline_used": r.get("pipeline_used") or {},
                "error": r.get("error"),
                "error_category": cat,
                "attempt_count": int(r.get("attempt_count") or 1),
                "first_attempted_at": r.get("first_attempted_at"),
                "last_attempted_at": r.get("last_attempted_at"),
                "filemap_folder": r.get("filemap_folder"),
                "retry_with_pipeline": None,
                "mark_as_excluded": False,
                "notes": None,
            }
        )

    doc = {
        "batch_id": batch_id,
        "completed_at": _now_iso(),
        "output_dir": str(output_dir),
        "docs_succeeded": succeeded,
        "docs_failed": len(failures),
        "by_reason": by_reason,
        "by_content_type": by_ct,
        "failures": failures,
    }

    final = _triage_path(output_dir)
    tmp = output_dir / f".{TRIAGE_NAME}.tmp-{uuid.uuid4().hex}"
    tmp.write_text(yaml.safe_dump(doc, sort_keys=False, allow_unicode=True), encoding="utf-8")
    os.replace(tmp, final)
    return doc


def read_triage(output_dir: Path | str) -> dict[str, Any] | None:
    p = _triage_path(output_dir)
    if not p.exists():
        return None
    try:
        data = yaml.safe_load(p.read_text(encoding="utf-8"))
    except yaml.YAMLError:
        return None
    return data if isinstance(data, dict) else None


def _write(output_dir: Path, doc: dict[str, Any]) -> None:
    final = _triage_path(output_dir)
    tmp = output_dir / f".{TRIAGE_NAME}.tmp-{uuid.uuid4().hex}"
    tmp.write_text(yaml.safe_dump(doc, sort_keys=False, allow_unicode=True), encoding="utf-8")
    os.replace(tmp, final)


def patch_triage(output_dir: Path | str, edits: list[dict[str, Any]]) -> dict[str, Any]:
    """Merge user edits into triage.yaml failures by source_sha256.

    Each edit dict: { source_sha256, retry_with_pipeline?, mark_as_excluded?, notes? }.
    Returns the updated triage doc.
    """
    output_dir = Path(output_dir)
    doc = read_triage(output_dir)
    if doc is None:
        raise FileNotFoundError(f"no triage.yaml at {output_dir}")
    by_sha = {e.get("source_sha256"): e for e in (edits or []) if e.get("source_sha256")}
    for failure in doc.get("failures") or []:
        sha = failure.get("source_sha256")
        if not sha or sha not in by_sha:
            continue
        edit = by_sha[sha]
        if "retry_with_pipeline" in edit:
            failure["retry_with_pipeline"] = edit["retry_with_pipeline"]
        if "mark_as_excluded" in edit:
            failure["mark_as_excluded"] = bool(edit["mark_as_excluded"])
        if "notes" in edit:
            failure["notes"] = edit["notes"]
    _write(output_dir, doc)
    return doc


def apply_triage_retries(output_dir: Path | str) -> dict[str, Any]:
    """Process the triage file: retry failures marked with `retry_with_pipeline`,
    and exclude failures marked `mark_as_excluded: true`.

    - Excludes: writes user_included=false back to the filemap, drops from triage
    - Retries: synchronously dispatches a single-doc convert with the given pipeline.
      On success: removes from failures, bumps docs_succeeded, clears the filemap
      entry's last_build_error.
      On failure: updates attempt_count + error + last_attempted_at.
    """
    from backend.conversion.converter import convert_source_mirrored
    from backend.stratification import filemap as _fm

    output_dir = Path(output_dir)
    doc = read_triage(output_dir)
    if doc is None:
        raise FileNotFoundError(f"no triage.yaml at {output_dir}")

    failures: list[dict[str, Any]] = list(doc.get("failures") or [])
    still_failed: list[dict[str, Any]] = []
    retried = succeeded = excluded = 0

    for entry in failures:
        if entry.get("mark_as_excluded"):
            folder = entry.get("filemap_folder")
            sp = entry.get("source_path")
            if folder and sp:
                path_rel = Path(sp).name
                try:
                    _fm.update_user_fields(
                        folder,
                        [{"path": path_rel, "user_included": False}],
                    )
                except Exception:
                    pass
            excluded += 1
            continue

        retry_pipeline = entry.get("retry_with_pipeline")
        if retry_pipeline is None:
            still_failed.append(entry)
            continue

        retried += 1
        src = entry.get("source_path")
        folder = entry.get("filemap_folder")
        if not src or not folder:
            still_failed.append(entry)
            continue
        # Compute output_root: the output_dir key is the batch root. We don't have
        # it directly in triage; use the folder_root from filemap as a best-effort.
        # Simplest: use the filemap folder's common ancestor with source_path. For
        # retry correctness we just use output_dir with no root (sidecars land in
        # the same mirrored location as the original batch).
        try:
            # We need output_root; stored at triage.output_dir; but the original
            # batch used root_base = filemap walk root. Best signal: use the
            # longest common prefix of all filemap_folders in the batch.
            # Fallback: single-folder scenario uses the filemap_folder as root.
            output_root = _infer_output_root(doc)
            outcome = convert_source_mirrored(
                Path(src),
                output_dir,
                params=retry_pipeline,
                output_root=Path(output_root) if output_root else None,
                force=True,
            )
            if outcome.meta.get("status") == "ok":
                succeeded += 1
                # Clear last_build_error
                try:
                    _fm.record_build_result(
                        folder,
                        Path(src).name,
                        pipeline_hash=outcome.meta.get("pipeline_hash"),
                        output_path=str(outcome.paths.md),
                        error=None,
                    )
                except Exception:
                    pass
                continue
            entry["attempt_count"] = int(entry.get("attempt_count") or 0) + 1
            entry["error"] = outcome.meta.get("error") or entry.get("error")
            entry["last_attempted_at"] = _now_iso()
            still_failed.append(entry)
        except Exception as e:
            entry["attempt_count"] = int(entry.get("attempt_count") or 0) + 1
            entry["error"] = f"{type(e).__name__}: {e}"
            entry["last_attempted_at"] = _now_iso()
            still_failed.append(entry)

    doc["failures"] = still_failed
    doc["docs_succeeded"] = int(doc.get("docs_succeeded") or 0) + succeeded
    doc["docs_failed"] = len(still_failed)
    # Recompute by_reason / by_content_type from still_failed
    by_reason: dict[str, int] = {}
    by_ct: dict[str, int] = {}
    for f in still_failed:
        cat = f.get("error_category") or classify_error(f.get("error"))
        by_reason[cat] = by_reason.get(cat, 0) + 1
        ct = f.get("detected_content_type") or "unknown"
        by_ct[ct] = by_ct.get(ct, 0) + 1
    doc["by_reason"] = by_reason
    doc["by_content_type"] = by_ct

    _write(output_dir, doc)
    return {
        "retried": retried,
        "succeeded": succeeded,
        "still_failed": len(still_failed),
        "excluded": excluded,
    }


def _infer_output_root(doc: dict[str, Any]) -> str | None:
    """Best-effort: common prefix of failure filemap_folders."""
    folders = [f.get("filemap_folder") for f in doc.get("failures") or []]
    folders = [f for f in folders if f]
    if not folders:
        return None
    prefix = os.path.commonpath(folders)
    return prefix or None
