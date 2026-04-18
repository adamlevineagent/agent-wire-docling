"""Scan / stratification router — Wave 1 Agent B fills this in.

Implements per contracts/openapi.yaml:
  - POST /scan
  - POST /strata/sample
"""

from fastapi import APIRouter

router = APIRouter(tags=["scan"])
