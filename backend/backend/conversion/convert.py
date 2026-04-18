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

from backend.conversion.converter import convert_source


async def convert_doc(
    source_path: str | Path,
    output_dir: str | Path,
    pipeline: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Async adapter used by the batch worker.

    Runs the blocking Docling conversion in a worker thread and returns the
    DocMeta dict that the batch layer writes into the docs table + manifest.
    """

    def _run() -> dict[str, Any]:
        outcome = convert_source(
            Path(source_path),
            Path(output_dir),
            params=pipeline or {},
        )
        return dict(outcome.meta or {})

    return await asyncio.to_thread(_run)
