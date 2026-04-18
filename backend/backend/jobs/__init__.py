"""Job queue + batch runner + manifest writer + taste sessions + export.

Wave 1 Agent C owns this package.
Implements: POST /batch, GET /jobs/{id}, GET /manifest,
            POST /taste_sessions (+ GET/PATCH), POST /export, /exports/{id},
            POST /batch/{id}/cancel
See contracts/openapi.yaml for the HTTP surface.
"""
