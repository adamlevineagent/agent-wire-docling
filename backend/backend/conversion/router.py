"""Conversion router — Wave 1 Agent A fills this in.

Implements per contracts/openapi.yaml:
  - POST /convert
  - POST /docs/{hash}/rerun
  - GET  /docs/{hash}
  - GET  /docs/{hash}/source
  - GET  /docs/{hash}/md
  - GET  /docs/{hash}/json
  - GET  /docs/{hash}/anchors
"""

from fastapi import APIRouter

router = APIRouter(tags=["convert"])
