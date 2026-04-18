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
import subprocess
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

    # Model readiness: cheap check for the docling cache dir being non-empty
    docling_cache = _CACHE / "docling"
    model_ready = docling_cache.exists() and any(docling_cache.iterdir())

    return Health(
        status="ok" if model_ready else "not_ready",
        docling_version=dv,
        model_ready=model_ready,
        tesseract_present=tesseract,
        poppler_present=poppler,
        free_disk_gb=round(free_gb, 2),
    )


# Routers added in Wave 1:
# from backend.conversion.router import router as conversion_router
# from backend.stratification.router import router as scan_router
# from backend.jobs.router import router as jobs_router
#
# app.include_router(conversion_router)
# app.include_router(scan_router)
# app.include_router(jobs_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
