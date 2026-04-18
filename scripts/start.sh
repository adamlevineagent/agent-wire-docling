#!/usr/bin/env bash
# Launches backend + frontend for development.
# Checks that poppler and tesseract are installed before starting.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ─── Native-dep checks ───
missing=()
command -v tesseract >/dev/null 2>&1 || missing+=("tesseract (brew install tesseract)")
command -v pdfinfo   >/dev/null 2>&1 || missing+=("poppler (brew install poppler)")
if [ "${#missing[@]}" -gt 0 ]; then
  echo "Missing native deps:"
  printf '  - %s\n' "${missing[@]}"
  echo "Install and re-run. /health will also report these."
  exit 1
fi

# ─── Warmup models (only if cache is empty) ───
CACHE_DIR="$ROOT/data/cache/docling"
if [ ! -d "$CACHE_DIR" ] || [ -z "$(ls -A "$CACHE_DIR" 2>/dev/null || true)" ]; then
  echo "First run: warming Docling models (this downloads a few hundred MB)…"
  (cd backend && uv run python ../scripts/warmup.py)
fi

# ─── Spawn backend + frontend ───
cleanup() { jobs -p | xargs -r kill 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "Starting backend on :8000…"
(cd backend && uv run uvicorn backend.main:app --reload --port 8000) &
BACKEND_PID=$!

echo "Starting frontend on :3000…"
(cd frontend && pnpm dev) &
FRONTEND_PID=$!

# Poll health until ready, then open browser
for i in $(seq 1 60); do
  if curl -sf http://localhost:8000/health >/dev/null 2>&1; then
    echo "Backend up. Opening browser…"
    (sleep 1 && open http://localhost:3000) &
    break
  fi
  sleep 1
done

wait $BACKEND_PID $FRONTEND_PID
