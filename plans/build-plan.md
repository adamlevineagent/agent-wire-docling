# agent-wire-docling — Build Plan (one-session swarm, v2)

Companion to [design-brief.md](../docs/design-brief.md). Read that first.

**v2 (post-audit):** scope clarified as **prototype**. Folder-in → folder-out. Wire integration is out of scope; output is plain files on disk. Audit corrections applied: expanded pre-flight, seven contract files, Wave 2 split into W2a/W2b, full deferral-ledger seed, dev-mode test gates per agent.

## Goal
Standalone desktop-local tool: convert folders of mixed-format documents (PDF, DOCX, XLSX, PPTX, HTML, plain text, LaTeX, Markdown) into a **folder of markdown + JSON files**. Stratified-sampling **taste test** UX so the user converges on per-stratum pipeline settings before committing to a full batch run. The output folder is something Wire Node's existing pyramid build can select as a source — no live integration, no shared database.

Proving ground: ~1500 legal PDFs. Kick off before bed, review results in the morning.

## Non-goals
- Integration with Wire Node (shared DB, shared schema, API calls between projects). Output is plain files.
- Cloud / multi-user / auth.
- Tier 3 formats: audio (ASR), standalone images as corpus docs, specialized XML (XBRL/JATS/USPTO).
- Matching `wire_source_documents` schema constraints (body_hash, format enum, byte-offset spans). Out of scope; not needed for folder-based handoff.
- Storing approvals/flags as Wire-style contributions. Prototype uses plain SQLite rows; throwaway.
- Retraining or fine-tuning Docling models.

## Architecture

```
agent-wire-docling/
├── backend/              Python 3.11+, FastAPI, Docling
│   ├── main.py           API surface
│   ├── conversion/       Docling sidecar wrapper
│   ├── stratification/   Format detection + clustering
│   ├── jobs/             Queue + state (SQLite)
│   └── manifest.py       Output manifest writer
├── frontend/             Next.js 15, TS, Tailwind, shadcn/ui
│   ├── app/
│   ├── components/
│   │   ├── VizDiff/      Shared two-pane reviewer
│   │   ├── Renderers/    Per-format source renderers
│   │   ├── TasteTest/    Sampling + approval UI
│   │   └── BatchRun/     Full run progress + review
│   └── lib/api-client.ts OpenAPI-generated typed client
├── contracts/            Locked before Wave 1 — see pre-flight P2
├── data/                 Runtime state (gitignored)
│   ├── state.db
│   ├── cache/            Docling/HF/Tesseract model cache (explicit path)
│   └── logs/
├── docs/, plans/, scripts/, fixtures/
```

**Boundary:** UI ↔ backend over HTTP. Not because of transplant — because it's the right architecture and it lets the same backend drive a CLI.

## Output contract

For each converted doc:
```
output_dir/
  <source_sha256>/
    source.<ext>     Original file (kept)
    doc.md           Markdown export
    doc.json         DoclingDocument JSON (lossless)
    meta.json        Pipeline used, runtime, quality signals, warnings, Docling version, hashes
  manifest.json      Index across all docs — see contracts/manifest.ts
```

`source_sha256` is the SHA-256 of the source file bytes. Single hash for dedup + directory naming + resume key. No Wire-schema alignment attempted; a future integration can translate if needed.

## Shape of the build

One overnight session. Pre-flight → Wave 1 (4 parallel agents) → Wave 2a (2 parallel) + Wave 2b (2 parallel) → Wave 3 verifier + wanderer + fix pass (repeat until clean). Realistic 10–14h end-to-end; kick the 1500-PDF batch overnight *after* the build.

---

## Pre-flight (me, ~1.5–2h) — do sequentially, myself, before spawning any agent

### P1 — Docling surface smoke test + timing probe (45 min)
In a scratch venv, install Docling, run the full probe checklist. Record results in `docs/docling-probes.md` so Wave 1 can reference them.

**Probes:**
1. `DocumentConverter().convert(path)` works on a native-text PDF, a scanned PDF, a DOCX, an XLSX, a PPTX, an HTML.
2. `.export_to_markdown()` produces reasonable output on each.
3. `.export_to_dict()` / `.document.export_to_dict()` returns a JSON tree with:
   - Per-element **bounding boxes** on paragraphs, headings, tables, figures
   - **Page references** per element
   - Table structure (cell-level bboxes or structured rows/cols — not just markdown pipe tables)
4. **Bbox → markdown anchor round-trip.** Convert one PDF. Pick an element from the JSON. Find the same content in the markdown. Can you identify which MD element came from which JSON element without ambiguity? If Docling's markdown export doesn't carry anchors, record the coarsest fallback (page-level) and update Agent E's scope to page-sync, not element-sync.
5. **Image/figure extraction.** How are figures emitted — base64 inline, separate files, references only? Affects frontend render.
6. **DoclingDocument JSON size** for a 100-page PDF. Logs disk size; decides whether frontend can load the full JSON or needs streaming.
7. **Timing:** convert a 100-page scanned PDF with OCR. Measure wall time + peak RAM. Extrapolate to 1500 docs at projected concurrency. If projection exceeds 12h on target hardware, adjust concurrency design in Agent C's scope.
8. **OCR engines:** Tesseract install on macOS (document `brew install tesseract` step). RapidOCR via pip (verify no extra native deps).
9. **VLM pipeline toggle** (`--pipeline vlm --vlm-model granite_docling`) — does it require extra deps? Runtime per page?
10. **Model cache locations.** Set `HF_HOME`, `TRANSFORMERS_CACHE`, `DOCLING_CACHE_DIR` explicitly to `data/cache/`. Confirm no pollution of `~/.cache`.

**Deliverable:** `docs/docling-probes.md` with 10 probe results. Pin Docling version in backend `pyproject.toml`.

### P2 — Lock the contracts (45 min)
Seven files. These are the seams. Every agent codes against these.

1. **`contracts/openapi.yaml`** — full HTTP surface, not a minimum. Endpoints:
   - `POST /scan` — folder scan → stratum breakdown
   - `POST /strata/sample` — stratified sample pick (seeded, deterministic)
   - `POST /convert` — single-doc conversion with pipeline params
   - `POST /batch` — full run against stratum→pipeline map
   - `POST /batch/{id}/cancel` — cancel in-flight batch
   - `GET /jobs/{id}` — polled progress (1s cadence)
   - `GET /jobs/{id}/stream` — SSE live progress (if codegen is painless; otherwise poll only)
   - `GET /docs/{hash}` — meta + refs
   - `GET /docs/{hash}/source` — raw source bytes
   - `GET /docs/{hash}/md` — markdown
   - `GET /docs/{hash}/json` — DoclingDocument JSON
   - `POST /docs/{hash}/rerun` — reconvert with different pipeline
   - `POST /taste_sessions` / `GET /taste_sessions/{id}` / `PATCH /taste_sessions/{id}`
   - `POST /export` — async export job; `GET /exports/{id}` for status
   - `GET /health` — model-ready state, Tesseract presence
   - Also serve `GET /openapi.json` at runtime (small thing, enables future CLI/MCP)

2. **`contracts/vizdiff.ts`** — full interface:
   - `SourceRenderer` interface: `renderPage(n)`, `scrollToBbox(bbox)`, `scrollToOffset(offset)`, `getCurrentViewport()`, `onElementClick(handler)`
   - `VizDiffProps`: sourceRenderer, doclingDoc, markdown, qualityBadges, onApprove/onReject/onFlag/onSkip/onReRun, shortcuts scope
   - `BBox` type (after P1 locks the Docling coord system)
   - `QualityBadge` type: `{page, kind, value?, message?}`
   - `PipelineParams` type (shared with OpenAPI)

3. **`contracts/meta.ts`** — per-doc `meta.json` schema. Consumed by Agent H (outlier detection) and Agent E (badges). Includes: source_sha256, docling_version, pipeline_params, runtime_ms, quality signals (per-page OCR conf, empty pages, table count, warnings).

4. **`contracts/manifest.ts`** — `manifest.json` schema. Top-level index: `{docs: [{hash, source_path, source_format, status, stratum, pipeline_hash, error?}], created_at, folder_root}`.

5. **`contracts/taste-session.ts`** — session state: `{id, folder, strata: [{name, size, pipeline, approvals: [{hash, status, notes}], locked, status}], created_at, updated_at}`.

6. **`contracts/db-schema.sql`** — SQLite DDL for `jobs`, `docs`, `strata`, `manifest_entries`, `taste_sessions`. Agents A/B/C all read this; only Agent C writes migrations.

7. **`contracts/docling-types.ts`** — minimal shape of DoclingDocument fields the frontend consumes (page, bbox, element refs). Isolates us from full Docling schema drift.

Plus:
- **`tailwind.config.ts` + `app/globals.css`** — dark-first token palette (colors, spacing, type scale). Agent D's first commit, but locked in pre-flight list so other frontend agents don't re-style.
- **`contracts/shortcuts.ts`** — `useShortcutScope(scope: 'global' | 'vizdiff' | 'tastetest', bindings)` API. One owner (Agent D), scoped consumers (E, G). Rebind: `y` approve, `x` reject (avoids `n` collision with next-doc), `s` skip, `f` flag, `n/p` next/prev doc, `j/k` page, `r` rerun, `?` help.

### P3 — Scaffold, seed, commit base (20–30 min)
- `uv init backend`, `pnpm create next-app frontend`
- Wire `openapi-typescript` codegen
- Commit `contracts/db-schema.sql` + initial migration
- Commit `tailwind.config.ts` tokens
- Write `plans/deferral-ledger.md` seeded with the known candidates (see below)
- Lock `pyproject.toml` (Docling pinned) and `pnpm-lock.yaml`
- One clean base commit all agents branch from

**Deferral ledger seed** (everything goes in with functional impact described):
- Bidirectional MD↔source highlight — defer to page-sync if P1 bbox anchors unreliable. Impact: user can jump to source page but not to specific paragraph/table within.
- PPTX full-fidelity render — defer to slide-image-only if library fights back. Impact: reviewer sees slide thumbnails, can't interact with slide elements.
- Native folder picker — defer; path text field only. Impact: user pastes a path instead of clicking.
- LaTeX render — source-only view (KaTeX render deferred). Impact: reviewer compares LaTeX source to MD, not rendered equations.
- Large XLSX (>20 sheets) — may lag in browser render. Impact: reviewer waits 1–2s per sheet switch.
- VLM GPU requirement — if VLM needs GPU not available, skip that pipeline option in UI. Impact: scanned-PDF strata limited to OCR pipelines.
- Multi-config parallel comparison (OCR vs VLM side-by-side) — not in prototype. Impact: reviewer picks one pipeline per stratum and iterates; no side-by-side config A/B.
- Config presets across corpora — not in prototype. Impact: each new folder starts from defaults.
- Pre-fetch next sample in background — not in prototype. Impact: reviewer waits briefly when moving to next sample.
- Structured observability / metrics dashboard — logs to `data/logs/` only. Impact: no real-time metrics; grep logs if something goes wrong.

---

## Wave 1 — foundations (4 parallel agents, ~2–3h)

### Agent A — Conversion sidecar (`backend/conversion/`)
- Wrap `DocumentConverter` with configurable pipeline (OCR on/off + engine, VLM on/off, table on/off, enrichments)
- Implement `POST /convert`, `POST /docs/{hash}/rerun`
- Extract quality signals per `contracts/meta.ts`; write `meta.json`
- **Long-running Python worker model** (not per-job subprocess); recycle every N jobs to bound memory
- Tests: one fixture each of native-text PDF, scanned PDF, DOCX, XLSX, PPTX, HTML; pytest green
- **Dev-mode gate:** `scripts/start.sh` launches; `curl -X POST /convert` on a fixture returns meta + writes output dir correctly; visible in browser at `/docs/{hash}/md`

### Agent B — Stratification + intake (`backend/stratification/`)
- Folder walker, format detect (extension + magic bytes)
- Cheap probes: `pdfinfo` page_count, `pdftotext | wc -c` text-layer signal, file size, mime
- **Explicit stratification thresholds** (locked in Agent B prompt):
  - Native vs scanned: `pdftotext_bytes / page_count > 50` → native
  - Page bins: `1–10`, `11–50`, `51–200`, `201+`
  - Format groups: `pdf-native-{bin}`, `pdf-scanned-{bin}`, `docx`, `xlsx`, `pptx`, `html`, `text`, `md`, `latex`
- **Tiny-stratum rule:** strata with size ≤ 6 → "exhaustively reviewed, not sampled" status; sample returns all docs
- **Seeded deterministic sampling** — same seed + stratum → same picks; seed returned to client
- **Path validation:** absolute, exists, no `..` segments, symlinks off by default, cap total file count with early error
- Implement `POST /scan`, `POST /strata/sample`
- Tests: fixture folder with known stratum assignments; pytest green
- **Dev-mode gate:** `/scan` on the fixture folder shows expected strata in the shell UI

### Agent C — Manifest + job queue + resume (`backend/jobs/`, `backend/manifest.py`)
- SQLite migration from `contracts/db-schema.sql`; owns the migration system
- In-process job queue; **concurrency default = 2** (exposed in Advanced); per-hash mutex so `/convert` and `/batch` can't duplicate work
- **Atomic per-doc write:** convert into `output_dir/<hash>.tmp/`, rename to `output_dir/<hash>/` only after all three files flushed; manifest entry written after rename
- **Resume logic:** scan for and clean `*.tmp/` directories on startup before accepting jobs; skip-key = `(source_sha256, pipeline_hash)` so pipeline change re-processes
- Failure: retry N times, then mark `error` with captured reason in manifest
- **Cancel:** `POST /batch/{id}/cancel` stops claiming new jobs, finishes in-flight
- Structured logs to `data/logs/batch-<id>.ndjson`
- Implement `POST /batch`, `GET /jobs/{id}`, optional `GET /jobs/{id}/stream` SSE, `GET /manifest`, cancel
- Tests: start batch, `kill -9` mid-run, restart, confirm tmp cleanup + resume
- **Dev-mode gate:** 10-doc fixture batch completes end-to-end via shell UI

### Agent D — Frontend shell + design system (`frontend/app/`, `frontend/components/shell/`)
- Next.js app shell, dark mode default, Tailwind tokens from pre-flight
- Layout: left sidebar (folder input + strata), top bar (stage: scan/taste/batch), main pane (view slot)
- **State management: TanStack Query** (server state) + React Context for UI-local
- OpenAPI client codegen wired into `lib/api-client.ts`
- **Shortcut manager** from `contracts/shortcuts.ts` — owns scope routing
- Toast + error boundary (retry + preserve state)
- Empty states per stage owned by each view (not shell) — shell is just stage switching
- Health probe: poll `/health`, show "downloading models…" until ready
- **Dev-mode gate:** shell boots, dark theme applied, clicking into "scan" stage shows Agent B's output rendered

### Wave 1 gate
- All four agents green on pytest/typecheck + dev-mode boot per-agent
- I run the full flow manually: point at fixture folder → strata appear → trigger /convert via UI on one doc → manifest entry written
- Deferral ledger reviewed for any new entries
- Commit gate: agents commit atomically when their gate passes (`feedback_parallel_agent_atomicity`)

---

## Wave 2a — VizDiff + renderers (2 parallel agents, ~2–3h)

Wave 2a ships independently. Agent E must commit a **runnable `<VizDiff />` stub with fixture data** within its first hour, so Wave 2b can start against real (not mocked) VizDiff.

### Agent E — VizDiff core + PDF renderer (`frontend/components/VizDiff/`, `frontend/components/Renderers/pdf.tsx`)
- Two-pane layout per `contracts/vizdiff.ts`
- pdf.js source renderer (pinned version — check CVE list), virtualized page render
- react-markdown + remark-gfm output; virtualized for long docs
- Output tabs: Rendered MD | Raw MD | JSON tree
- Synced scrolling via DoclingDocument page refs
- Bidirectional highlight if P1 confirmed element anchors; else page-sync fallback
- Per-page quality badges overlaid on source
- Keyboard via `contracts/shortcuts.ts` `vizdiff` scope
- **Stub commit (hour 1):** VizDiff shell + fake props render an empty shell that Agents G/H can compose against

### Agent F — Other format renderers (`frontend/components/Renderers/{docx,xlsx,pptx,html,text}.tsx`)
- Each implements `SourceRenderer` interface
- DOCX: docx-preview; XLSX: SheetJS with worksheet tabs; PPTX: pptx-preview (fallback to server-side slide images if fights back); HTML: sandboxed iframe with tight CSP; text/MD/LaTeX: syntax-highlighted source
- Each renderer independently verifiable against a fixture
- **LaTeX note:** source-only view; KaTeX render deferred per ledger

### Wave 2a gate
- VizDiff renders each format end-to-end on fixtures
- Keyboard shortcuts work in vizdiff scope without conflicting with global
- I click through one doc per format before Wave 2b launches

---

## Wave 2b — TasteTest + BatchRun (2 parallel agents, ~2–3h)

Consume real VizDiff from Wave 2a.

### Agent G — Taste test loop (`frontend/components/TasteTest/`)
- "Sample N per stratum" control (default N=5, user-tunable)
- Call `/strata/sample` (seeded), run batch on samples via `/batch`, stream results into VizDiff
- **Sampling without replacement within a session** — approved/rejected docs excluded from future samples
- Approve / reject / **skip** / flag + freeform notes
- **Lock-stratum action** — commits pipeline for batch, stratum frozen
- Per-stratum pipeline assignment UI: default | VLM | custom (opens Advanced panel)
- **Advanced panel** — explicit knobs: OCR engine, VLM on/off, table mode, enrichments
- Convergence guidance (not enforcement): "≥8 approved, ≥80% approval rate" surface as nudge
- Re-sample with different docs; "approved drawer" so user sees what's already green
- Session persisted via `/taste_sessions` — rehydrates on reload

### Agent H — Batch run + post-run review (`frontend/components/BatchRun/`)
- "Go" button consumes locked taste-session pipeline map, calls `/batch`
- Live progress: docs/sec, ETA, per-stratum bar, failure count (SSE if shipped, else 1s poll)
- **Cancel/pause** buttons wire to Agent C endpoints
- Post-run outlier list: thresholds **explicit** — OCR avg < 0.7, warnings non-empty, empty-page ratio > 20%; surfaced with VizDiff jump-to
- **Export options** — manifest-only (default, small, fast), manifest + MD, full archive (async job, streamed, cancellable); no in-process tar

### Wave 2b gate
- Full taste-test → batch-run → export flow works on 10-doc fixture
- Session persists across reload
- Outlier list surfaces on a doc with low OCR conf

---

## Wave 3 — verification + fix pass (serial, ~2–3h)

Per `feedback_audit_until_clean`, this may loop. Budget for it.

### Round 1
1. **Serial verifier** (punch-list-driven) — every endpoint in openapi.yaml implemented + called, every VizDiff prop wired, every shortcut works, taste session persists, batch resumes across `kill -9`. Fixes in place.
2. **Wanderer** (no punch list) — "point agent-wire-docling at a folder, run the full flow, report what's broken." Traces end-to-end. Fixes in place.

### Round 2 (if Round 1 wanderer flagged anything)
- Second wanderer scoped to fix pass. Confirms fixes didn't regress. Repeat until clean.

### Built-system check
- `feedback_always_test_dev`: me running `scripts/start.sh`, clicking through on a real 20-doc sample, feeling the UX.

---

## Scripts / CLI (sliced into Agent C)
- `scripts/start.sh` — launches backend + frontend + health-check loop; opens browser
- `scripts/warmup.py` — pre-downloads Docling models; `start.sh --check` runs it first
- `scripts/run-batch.sh` — CLI wrapper around `/scan` → `/strata/sample` → `/batch` → manifest print. Proves the HTTP surface is complete. Minor scope (`feedback_agent_first_cli` at prototype level — nice to have, not blocking).

## Success criteria
- `scripts/start.sh` launches clean
- Point at 10-doc mixed-format fixture → scan → taste test → approve → batch → export manifest
- `kill -9` mid-batch, restart, resume works, no orphan tmp dirs
- Wanderer Round 2+ comes back clean
- Real-world test: Adam runs it on the 1500-PDF legal corpus, approves overnight, comes back to a usable output folder

## Aggregate timeline
- Pre-flight: 1.5–2h (me)
- Wave 1: 2–3h (4 parallel)
- Wave 2a: 2–3h (2 parallel)
- Wave 2b: 2–3h (2 parallel)
- Wave 3: 2–3h (serial, with loop)

**Total: 10–14h.** Worst-case driver: Docling timing probe surprises OR Wave 3 needing a second fix-round.
