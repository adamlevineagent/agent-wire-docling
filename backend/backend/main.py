"""FastAPI entrypoint — wiring stub.

Wave 1 agents flesh out the routers:
  - Agent A → /convert, /docs/{hash}/rerun
  - Agent B → /scan, /strata/sample
  - Agent C → /batch, /jobs, /manifest, /taste_sessions, /export

This file wires the health check, OpenAPI serving, CORS, and cache env vars.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

# Route model caches into data/cache/ BEFORE any Docling import
# (enforces the decision from pre-flight P1).
_ROOT = Path(__file__).resolve().parent.parent.parent
_CACHE = _ROOT / "data" / "cache"
_CACHE.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("HF_HOME", str(_CACHE / "hf"))
os.environ.setdefault("TRANSFORMERS_CACHE", str(_CACHE / "transformers"))
os.environ.setdefault("DOCLING_CACHE_DIR", str(_CACHE / "docling"))

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel  # noqa: E402

app = FastAPI(
    title="agent-wire-docling",
    version="0.1.0",
    description="Folder in → folder out. Taste test for heterogeneous document corpora.",
)

# Allow local Next.js dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Health(BaseModel):
    status: str
    docling_version: str
    model_ready: bool
    model_download_progress: float | None = None
    tesseract_present: bool
    poppler_present: bool
    free_disk_gb: float


@app.get("/health", response_model=Health)
async def health() -> Health:
    try:
        from importlib.metadata import version as _ver
        dv = _ver("docling")
    except Exception:
        dv = "unknown"

    tesseract = shutil.which("tesseract") is not None
    poppler = shutil.which("pdfinfo") is not None

    free_gb = 0.0
    try:
        st = os.statvfs(str(_ROOT))
        free_gb = (st.f_bavail * st.f_frsize) / 1e9
    except Exception:
        pass

    # Model readiness: Docling uses HuggingFace's transformers library under
    # the hood, so weights land under data/cache/hf/ (not data/cache/docling/).
    # Also honor the in-process flag set by the conversion module once a
    # successful convert has run — that's the most authoritative signal.
    try:
        from backend.conversion import convert as _convert_mod
        convert_flag = bool(getattr(_convert_mod, "_any_convert_succeeded", False))
    except Exception:
        convert_flag = False

    def _nonempty(p: Path) -> bool:
        try:
            return p.exists() and any(p.iterdir())
        except Exception:
            return False

    cache_has_content = (
        _nonempty(_CACHE / "docling")
        or _nonempty(_CACHE / "hf")
        or _nonempty(_CACHE / "transformers")
    )
    model_ready = convert_flag or cache_has_content

    return Health(
        status="ok" if model_ready else "not_ready",
        docling_version=dv,
        model_ready=model_ready,
        tesseract_present=tesseract,
        poppler_present=poppler,
        free_disk_gb=round(free_gb, 2),
    )


# Wave 1 routers — each module owns its own router.py. Agents fill in endpoints.
from backend.conversion.router import router as conversion_router  # noqa: E402
from backend.jobs.router import router as jobs_router  # noqa: E402
from backend.stratification.router import router as scan_router  # noqa: E402

app.include_router(conversion_router)
app.include_router(scan_router)
app.include_router(jobs_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
