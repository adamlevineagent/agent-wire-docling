# backend/

Python 3.11+, FastAPI, Docling 2.90.0 (pinned).

## Setup

```bash
cd backend
uv sync --extra dev
```

## Running

```bash
uv run uvicorn backend.main:app --reload --port 8000
```

Health check: `curl http://localhost:8000/health`

## Testing

```bash
uv run pytest            # unit tests
uv run ruff check        # lint
uv run mypy backend      # types
```

## Layout

```
backend/
├── backend/
│   ├── main.py              FastAPI entrypoint (health, CORS, OpenAPI)
│   ├── conversion/          Wave 1 Agent A (Docling wrapper, /convert)
│   ├── stratification/      Wave 1 Agent B (folder walk, /scan, /strata/sample)
│   ├── jobs/                Wave 1 Agent C (queue, /batch, /manifest, /taste_sessions)
│   └── manifest.py          Manifest writer (shared by A and C)
├── tests/
└── pyproject.toml
```

## Conventions

- All Docling imports must happen **after** `backend/main.py` sets the cache env vars.
- Every endpoint matches the shape in `contracts/openapi.yaml`. Don't edit shapes without ledger entry.
- Atomic writes: write to `output_dir/<hash>.tmp/`, rename to `output_dir/<hash>/` only when complete.
- Structured logs as NDJSON to `data/logs/`.

## External deps

- `tesseract` via `brew install tesseract` (OCR)
- `poppler` via `brew install poppler` (pdfinfo/pdftotext for stratification probes)

`/health` reports whether each is present.
