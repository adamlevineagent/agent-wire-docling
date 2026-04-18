"""Pipeline param normalization + hashing.

`PipelineParams` is the shape exchanged over HTTP (see contracts/openapi.yaml).
`pipeline_hash` is a stable SHA-256 of the normalized params — it's the
differentiator between rerun outputs for the same source.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from pydantic import BaseModel, Field


class OcrOpts(BaseModel):
    enabled: bool = True
    engine: str = "tesseract"  # tesseract | rapidocr


class VlmOpts(BaseModel):
    enabled: bool = False
    model: str = "granite_docling"


class TablesOpts(BaseModel):
    enabled: bool = True


class EnrichmentOpts(BaseModel):
    formulas: bool = False
    code: bool = False
    charts: bool = False


class PipelineParams(BaseModel):
    ocr: OcrOpts = Field(default_factory=OcrOpts)
    vlm: VlmOpts = Field(default_factory=VlmOpts)
    tables: TablesOpts = Field(default_factory=TablesOpts)
    enrichments: EnrichmentOpts = Field(default_factory=EnrichmentOpts)


def normalize(params: PipelineParams | dict[str, Any] | None) -> PipelineParams:
    if params is None:
        return PipelineParams()
    if isinstance(params, PipelineParams):
        return params
    return PipelineParams.model_validate(params)


def pipeline_hash(params: PipelineParams) -> str:
    """Stable SHA-256 of the normalized pipeline params."""
    canon = json.dumps(
        params.model_dump(),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    )
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()
