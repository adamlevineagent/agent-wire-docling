"""Jobs / batch / manifest / taste_sessions / export router — Wave 1 Agent C fills this in.

Implements per contracts/openapi.yaml:
  - POST /batch
  - POST /batch/{id}/cancel
  - GET  /jobs/{id}
  - GET  /jobs/{id}/stream       (SSE; optional)
  - GET  /manifest
  - POST /taste_sessions         (schema owned by C; endpoints can be filled by G in Wave 2)
  - GET  /taste_sessions/{id}
  - PATCH /taste_sessions/{id}
  - POST /export                 (endpoint can be filled by H in Wave 2)
  - GET  /exports/{id}

Also owns: SQLite schema migrations, atomic tmp-rename per-doc writes,
resume logic (cleanup of *.tmp/ dirs on startup), concurrency default=2.
"""

from fastapi import APIRouter

router = APIRouter(tags=["batch"])
