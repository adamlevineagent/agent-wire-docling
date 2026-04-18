"""Thin adapter module exposing the contract the batch worker expects.

Wave-1 contract (batch.py):

    from backend.conversion import convert as _conv
    meta = await _conv.convert_doc(source_path, output_dir, pipeline)

The real implementation lives in ``backend.conversion.converter.convert_source``
which returns a ``ConversionOutcome``. Here we normalize: accept str/Path,
call the sync converter in a thread (so the async batch worker doesn't block
the event loop), and return the ``meta`` dict directly.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from backend.conversion.converter import convert_source, convert_source_mirrored

# Module-level flag consumed by /health: flips True once any convert has
# completed successfully. Gives the UI a definitive "models loaded, pipeline
# verified end-to-end" signal rather than a cache-directory heuristic.
_any_convert_succeeded: bool = False


async def convert_doc(
    source_path: str | Path,
    output_dir: str | Path,
    pipeline: dict[str, Any] | None = None,
    *,
    output_root: str | Path | None = None,
    mirrored: bool = False,
) -> dict[str, Any]:
    """Async adapter used by the batch worker.

    `mirrored=True` writes into the mirrored Level-B layout keyed by the
    source path relative to `output_root`. Default (False) preserves the
    legacy hash-dir layout for single-doc callers.
    """

    def _run() -> dict[str, Any]:
        if mirrored:
            outcome_m = convert_source_mirrored(
                Path(source_path),
                Path(output_dir),
                params=pipeline or {},
                output_root=Path(output_root) if output_root else None,
            )
            return dict(outcome_m.meta or {})
        outcome = convert_source(
            Path(source_path),
            Path(output_dir),
            params=pipeline or {},
        )
        return dict(outcome.meta or {})

    meta = await asyncio.to_thread(_run)
    # Flip the readiness flag on any "ok" outcome — failed conversions don't
    # count, since they may fail for model-loading reasons.
    if meta.get("status") == "ok":
        global _any_convert_succeeded
        _any_convert_succeeded = True
    return meta
