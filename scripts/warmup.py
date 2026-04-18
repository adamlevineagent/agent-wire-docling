"""One-shot Docling model warmup — runs a trivial conversion to trigger weight downloads.

Called from scripts/start.sh on first run (when the cache dir is empty).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "cache"
CACHE.mkdir(parents=True, exist_ok=True)
os.environ["HF_HOME"] = str(CACHE / "hf")
os.environ["TRANSFORMERS_CACHE"] = str(CACHE / "transformers")
os.environ["DOCLING_CACHE_DIR"] = str(CACHE / "docling")

from docling.document_converter import DocumentConverter  # noqa: E402


def main() -> int:
    fixture = ROOT / "data" / "fixtures" / "attention.pdf"
    if not fixture.exists():
        print(f"Warmup fixture missing: {fixture}", file=sys.stderr)
        print("Run: curl -sL -o data/fixtures/attention.pdf https://arxiv.org/pdf/1706.03762")
        return 1

    print(f"Warming Docling against {fixture.name}…", flush=True)
    converter = DocumentConverter()
    result = converter.convert(fixture)
    pages = len(getattr(result.document, "pages", {}) or {})
    print(f"Warmup complete. {pages} pages processed. Models cached in data/cache/.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
