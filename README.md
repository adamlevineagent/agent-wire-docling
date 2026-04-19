# agent-wire-docling

A **local web app** that turns a folder of messy documents — PDFs, Word files, Excel, PowerPoint, HTML, plain text — into a matching folder of clean Markdown + JSON. Two processes (a Python backend + a Next.js frontend) run on your own machine; you interact via a browser tab pointed at `http://localhost:3000`. Nothing is uploaded.

Designed for people who have thousands of documents they need an AI system to actually understand — most urgently, legal discoveries, research corpora, and personal archives.

> **Status: working prototype.** End-to-end flow validated on real-world 1000+ document corpora. Known rough edges are listed under [Known limits](#known-limits) below.

---

## For the assistant installing this on someone's machine

**You are an agent (Claude Code or similar) setting this up for a user on their own Mac.** Read this whole document end to end before starting. Your job in order:

1. **Install prerequisites** (Homebrew, native deps, Python, Node package managers). Sections below give exact commands.
2. **Clone the repo** and install Python + Node dependencies.
3. **Launch the servers** and verify they're healthy.
4. **Explain to the user** what you set up, what the tool does, and how to use it (the operating guide below is written for a human — paraphrase it, don't dump it verbatim).
5. **Stay available** for questions as they work through their first scan and batch.

The user may be non-technical. They're expecting you to handle the mechanical parts. If something fails, diagnose it from the [Troubleshooting](#troubleshooting) section; if you can't resolve it, say so clearly and ask them to help.

### Step 1 — Prerequisites (all commands for macOS)

Run these checks and install whatever's missing. Don't skip a check — missing deps fail silently later.

```bash
# Homebrew — package manager for all native deps
command -v brew || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Native document-processing tools (Docling depends on these)
brew install poppler tesseract

# Python 3.11 (Docling pins to <3.13)
command -v python3.11 || brew install python@3.11

# uv — fast Python dependency manager (installs backend deps)
command -v uv || curl -LsSf https://astral.sh/uv/install.sh | sh

# Node + pnpm (frontend deps)
command -v node || brew install node
command -v pnpm || npm install -g pnpm

# Verify everything landed
which brew python3.11 uv node pnpm tesseract pdfinfo pdftotext
```

If any `which` line comes back empty, resolve it before moving on. Common failure: `uv` installs into `~/.local/bin` which may not be on PATH — tell the user to run `source ~/.zshrc` or open a new terminal.

### Step 2 — Clone and install

```bash
# Clone into the user's preferred workspace (ask them, or use ~/code)
cd ~                              # or wherever
git clone https://github.com/adamlevineagent/agent-wire-docling.git
cd agent-wire-docling

# Backend: creates a .venv and pulls Python deps (includes Docling, FastAPI, torch)
# This is the biggest step — torch alone is ~2 GB. Expect 3–10 minutes.
cd backend && uv sync --extra dev && cd ..

# Frontend: installs Next.js + React + everything
cd frontend && pnpm install && cd ..
```

Verify:
```bash
cd backend && uv run pytest -q 2>&1 | tail -3    # Expect "54 passed"
cd ../frontend && pnpm typecheck                  # Expect no output = clean
cd ..
```

If tests fail, something in Step 1 was missed. Check `backend/.venv/bin/python --version` is 3.11 or 3.12.

### Step 3 — First launch (downloads the AI models)

```bash
./scripts/start.sh
```

Expect to see:
- "Starting backend on :8000…"
- "Starting frontend on :3000…"
- After ~10 seconds: "Backend up. Opening browser…"
- A browser tab opens at `http://localhost:3000` with a dark UI showing "Point me at a folder."

**On first launch only:** the very first document conversion will download ~500 MB of AI models (DocLayNet for layout detection, TableFormer for tables, plus HuggingFace tokenizer bits). Those get cached under `data/cache/` inside the repo and are reused forever after. The first doc will feel slow (~45s); subsequent docs in the same session are ~0.6s/page for native PDFs, 2–5s/page for scanned PDFs that need OCR.

To stop the servers: `Ctrl+C` in the terminal running `start.sh`.

### Step 4 — Tell the user what they have

Paraphrase [What it does](#what-it-does) and [The taste test](#the-taste-test) in your own words, in plain English. Then walk them through [Operating guide](#operating-guide) as they actually use it. Stay beside them for the first folder scan — the terminology (strata, pipelines, tuning) is specific to this tool and will feel unfamiliar.

---

## For the user

### What it does

You point it at a folder. It scans every file, figures out what they are, and tells you how many it found. You click **Start converting**. It walks through every document, turns it into clean Markdown, and shows you live progress. When it's done, anything that failed lands in a short triage list with one-click fixes. The clean output is a sibling folder full of Markdown + JSON files that AI systems like [Wire Node](https://github.com/adamlevineagent/agent-wire-node) can read.

Nothing is uploaded. Everything happens on your own machine.

### How it actually works

Three big buttons, in order: **Scan a folder · Start converting · Apply retries on failures**.

That's the whole product. There's an optional "Preview a few first" path for the cautious — sample some docs and verify quality before committing — but the default flow is just: point, start, walk away, come back to a triage list.

If you want to drive it from a chat with your AI agent instead of clicking buttons, the agent can run everything via the `awd` command-line. Your browser tab will pick up the agent's job automatically and show you progress as it happens. ("Boss mode" — see below.)

### When to use it

- You have a folder (or a tree of folders) full of mixed document types
- You want the content as plain text / Markdown, readable by any text-based tool or AI
- You're OK with letting it run on your machine for a few hours (on a 1000-doc corpus, expect 1–3 hours of conversion time)

It's not useful if:
- You only have a handful of documents (just open them)
- Your documents are already in Markdown or plain text
- You need cloud processing (this is local-only by design)

---

## Operating guide

The UI sidebar has three stages: **Scan · Preview (optional) · Convert**. The default flow is Scan → Convert. Preview is a sideways branch you can take if you want to spot-check quality before committing.

### Stage 1 — Scan (pick a folder)

On first launch you see **"Point me at a folder."**

- **Click the Scan button with the path field empty** → opens a folder picker where you can navigate your filesystem and pick your corpus folder.
- Or paste an absolute path (e.g. `/Users/sarah/Documents/condo-case`) directly into the field and hit Enter.

The scan walks the folder, computes a SHA-256 of every file, and groups documents by detected type. On a 1000-doc corpus this takes 30–90 seconds. (The Next.js dev-server proxy timeout is set to 10 minutes, so even very large corpora won't hit a false "500" error.)

What you get back:

- A **spectrum bar** at the top — each colored band is a document group ("stratum"), sized by how many documents it contains. Visual summary of your folder.
- **Detail cards** below — one per group with name, document count, an example filename.
- **Skipped files** at the bottom — binary files, images over 100MB, system files, our own `.understanding/` and `.docling-out/` dirs.

The groups you'll typically see:

| Group name | What it means |
|---|---|
| `pdf-native-1-10` | PDFs with real extractable text, 1–10 pages |
| `pdf-native-11-50` | Native-text PDFs, 11–50 pages |
| `pdf-native-51-200`, `201+` | Longer native PDFs |
| `pdf-scanned-*` | Scanned PDFs (no extractable text layer) — will use OCR |
| `docx`, `pptx`, `xlsx` | Office documents |
| `html` | Saved web pages, emails |
| `text`, `md`, `latex` | Plain-text-like files |

When ready, the action bar at the top right has three buttons:

- **Change folder…** — pick a different folder, re-scan.
- **Preview a few first** (ghost) — go to the optional Preview stage to spot-check quality.
- **Start converting →** (big cyan primary) — fire the batch immediately. Locks all groups at default pipelines, kicks off the conversion, jumps you straight to the Convert/Watch view.

### Stage 2 — Convert (the main event)

Whether you clicked **Start converting** on Scan, or your AI agent kicked off a batch via CLI, this is where you watch the work happen.

The Watch view shows:

- A narrative headline: **"Converting 612 of 1,141 documents. About 1 hour 12 minutes remaining at 0.19 docs/s."**
- Four big stats: **Converted · Failed · Throughput · ETA**.
- A thick cyan progress bar.
- An **activity log** scrolling live (newest at the bottom). Each line shows when something completed:
  - `✓ Converted a document · docx · 3.2s` — success
  - `⚠ Couldn't convert · pdf-scanned · will retry / triage pending` — failure (will be auto-retried up to 2 times; if still failing, lands in triage)
- Per-group mini-bars so you can see which groups have finished.
- **Cancel** button (top right). Click it to stop. Cancellation is acknowledged immediately; the worker halts at the next document boundary (typically within 30 seconds — Docling docs run inside a thread pool that can't be killed externally, but the loop exits cleanly between docs).

You can close the browser tab and come back hours later — the backend keeps running. When you reload, the UI auto-detects the in-flight job and resumes the Watch view.

The conversion itself runs at roughly:
- **0.6 seconds per page** for native-text PDFs and DOCX (no OCR needed)
- **2–5 seconds per page** for scanned PDFs (Tesseract OCR is the slow part)
- **~3 seconds total** for HTML, MD, plain text (no parsing required)

So a 1000-document corpus that's mostly scanned legal exhibits realistically takes 1–4 hours. Mostly native-text takes 30–60 minutes. The estimate at the top of the Watch view updates live based on actual throughput.

### Stage 2-Optional — Preview (spot-check before committing)

If you'd rather verify a few sample conversions before running the whole thing, click **"Preview a few first"** on Scan instead of Start converting. This puts you on the Preview stage (formerly called "taste test"), where you can:

1. Pick a group from the sidebar.
2. Click **Sample N docs** (or press `Shift+S`). The tool converts 5 sample documents from that group.
3. The reviewer opens: **source on the left, Markdown on the right, with a narrow "confidence gutter" between them**. Each gutter segment is one page of the source, color-coded by OCR confidence (green = high, yellow = medium, red = low).
4. Approve (`y`), reject (`x`), skip (`s`), or flag (`f`) each sample. Approving writes `user_included: true` to the per-folder filemap on disk.
5. If a group's conversions look bad, press `c` to open the **Advanced panel** and change the pipeline (e.g. enable the VLM for tough scans), then save and re-sample.
6. When you're happy with a group, **lock** it and move to the next.
7. When all groups you care about are locked, switch to the **Convert** stage and start the full batch.

The tuning controls in Preview do change real Docling settings per group (OCR engine, VLM on/off, table extraction, etc.). They don't train any model — they just commit specific pipeline knobs that will be used during the full conversion.

For most users, default settings work fine and the Preview stage is unnecessary. It exists for when something looks visibly wrong and you want to fix it before running 2 hours of conversion.

### Stage 3 — Triage (handle the failures)

When the batch completes, the UI shows:

- **"1,491 converted cleanly."** (or whatever your success count was)
- Three stat tiles: succeeded, failed, output size
- A **triage table** listing every doc that failed, with columns: filename, reason, attempts, fix

For each failure you have three choices via the dropdown in the fix column:

- **↻ Retry with vision** — try again using the VLM pipeline (best for OCR-hard docs)
- **↻ Retry without tables** — skip table extraction (fixes corrupted table edge cases)
- **× Exclude from corpus** — give up on this doc; it won't be in the final output

Click **Apply retries** and the tool re-runs only the docs you asked it to. Failures that still fail stay in the triage list.

There's also a **"Retry all with recommended"** button that auto-picks a fix per row based on the failure reason.

### Stage 4 — Hand off the output

At the bottom of the post-run screen there's a **"Next"** card:

> Open Wire Node and add `/your/path/.docling-out` as a corpus. Your pyramid build will find the manifest automatically.

The output folder mirrors your source folder's directory structure. Each document becomes four files:

```
your-folder/
  .docling-out/
    wire-archive/
      12-interviews-talks/
        Accelerator Application.docx.md             ← cleaned markdown
        Accelerator Application.docx.json           ← structured document (for AI)
        Accelerator Application.docx.anchors.json   ← sidecar for UI interactions
        Accelerator Application.docx.meta.json      ← conversion metadata
      ...
    manifest.yaml       ← index of every successful conversion
    triage.yaml         ← list of anything that failed
```

Copy the path, give it to Wire Node, or point any other Markdown-consuming tool at it. You're done.

---

## Boss mode (your agent drives, you watch)

You don't have to click any buttons yourself. If you have an AI agent (e.g. Claude Code) running on your machine, it can drive the whole conversion via the `awd` command-line tool:

```bash
# One-shot: scan a folder, lock all groups at defaults, batch, write the manifest
uv run awd end-to-end /path/to/your/corpus
```

Or step-by-step (so the agent can narrate progress between steps):

```bash
uv run awd scan /path/to/corpus              # writes filemaps in each subfolder
uv run awd batch /path/to/output --root /path/to/corpus
uv run awd triage /path/to/output            # see what failed
```

**Your browser tab automatically discovers what the agent is doing.** Open `http://localhost:3000` once and leave it. Every 3 seconds it polls the backend for the most recent batch job; when one appears that wasn't initiated by your browser, a toast pops ("Batch detected · Switching to Convert") and the UI auto-navigates to the Watch view. You see the same activity log + progress bar + stats whether you clicked Start yourself or your agent did.

This means a typical agent-driven session looks like:

1. **You:** "Hey, convert all the docs in `~/legal/condo-case` and tell me when you're done."
2. **Agent (in chat):** "Scanning… 1,141 files in 12 groups. Starting conversion now. Should take about 90 minutes."
3. **Agent (via CLI):** runs `awd end-to-end ~/legal/condo-case` in the background.
4. **You** (optionally): open the browser tab, see Watch view populate within 3 seconds, walk away.
5. **Agent (when done):** "Converted 1,127 of 1,141. 14 failed — mostly large scanned PDFs. Want me to retry them with the vision model?"
6. **You:** "Yes."
7. **Agent:** edits `triage.yaml` to set `retry_with_pipeline: { vlm: { enabled: true } }` on each failure, runs `awd retry-triage /path/to/output`. Reports back.

The browser tab is for situations where you want to *see* progress yourself; the agent doesn't need it to do its work.

---

## Keyboard shortcuts (full)

### Global (anywhere in the app)
| Key | Action |
|---|---|
| `?` | Show keyboard help overlay |
| `/` | Focus the path input |
| `Esc` | Close any open dialog or overlay |
| `g s` / `g t` / `g b` | Go to Scan / Taste / Batch stage |

### Preview reviewer (when a sample document is open)
| Key | Action |
|---|---|
| `y` | Approve |
| `x` | Reject |
| `s` | Skip |
| `f` | Flag |
| `r` | Re-run (opens Advanced for this group) |
| `j` / `k` | Next / previous page |
| `n` / `p` | Next / previous document |
| `1` / `2` / `3` | Rendered MD / Raw MD / JSON tab |

### Preview sidebar
| Key | Action |
|---|---|
| `a` | Toggle approved-docs drawer |
| `l` | Lock / unlock the current group |
| `⇧S` (Shift+S) | Sample more docs from the current group |
| `c` | Open Advanced panel |

### Convert
| Key | Action |
|---|---|
| `c` | Cancel the running batch |
| `e` | Export manifest |

---

## CLI — `awd`

Every UI operation is also available as a command-line tool called `awd` (agent-wire-docling). Useful for scripting, agent-driven operation, or running unattended on a remote machine.

From the repo root, prefix everything with `cd backend && uv run` unless you've activated the venv.

```bash
cd backend
uv run awd doctor                                    # Check prerequisites + backend health
uv run awd health                                    # Backend status

# Full flow — scan, create session, lock all strata at defaults, batch, manifest
uv run awd end-to-end /path/to/corpus

# Or step by step:
uv run awd scan /path/to/corpus                      # Walk folder + emit filemaps
uv run awd filetree /path/to/corpus                  # Summary of what's included
uv run awd filemap /path/to/corpus/some/subfolder    # Inspect a specific folder's filemap
uv run awd batch /path/to/output --root /path/to/corpus
uv run awd manifest /path/to/output                  # Read manifest.yaml
uv run awd triage /path/to/output                    # Read triage.yaml

# After a batch with failures, edit /path/to/output/triage.yaml to set
# `retry_with_pipeline` on rows you want to retry, then:
uv run awd retry-triage /path/to/output
```

Run `uv run awd <command> --help` for each command's full options.

---

## Output structure

For every source document that converts successfully, four files land at the mirrored path inside your output directory:

- `<filename>.md` — the canonical Markdown export. Page breaks marked with `<!--- page-break --->`.
- `<filename>.json` — the lossless [DoclingDocument](https://github.com/docling-project/docling-core) structure. Preserves layout, tables, figures, reading order with per-element provenance (page, bounding box, character span).
- `<filename>.anchors.json` — a sidecar mapping byte ranges in the Markdown to elements in the JSON, used by the UI for click-sync and highlight.
- `<filename>.meta.json` — conversion metadata: timing, pipeline used, quality signals, any warnings.

Plus, at the output root:

- `manifest.yaml` — index of every converted doc (source path → hash → output paths).
- `triage.yaml` — after any batch run, the rollup of failures with retry hooks.

In the source folder, every subdirectory also gets a `.understanding/folder.yaml` file — a per-folder checklist that tracks which files were included, with scanner-detected metadata plus your user-level approve/reject decisions. This is the scanner's canonical state; you can edit these files directly in any text editor and the tool will respect your edits on the next scan.

---

## Troubleshooting

### The UI comes up unstyled (plain HTML with no colors or layout)
This is a stale Next.js development build. Kill the servers and restart clean:
```bash
# Kill any running servers
pkill -f "next dev"
pkill -f "next-server"
pkill -f uvicorn

# Clean the Next.js build cache
rm -rf frontend/.next

# Relaunch
./scripts/start.sh
```

### "Backend not reachable" toast appears
The Python backend isn't running. Check `/tmp/awd-backend.log` for errors, or run the backend manually:
```bash
cd backend && uv run uvicorn backend.main:app --reload --port 8000
```
Look for import errors or missing deps. Re-run `uv sync --extra dev` if anything looks off.

### Health indicator stays "not_ready · warming" for a long time
Should flip to green "ok" after the first successful conversion. If it doesn't, the `data/cache/` directory may be empty — the first scan will trigger the initial model download (~500 MB). Tool works fine regardless of this indicator.

### A DOCX/PPTX source preview spins forever
The backend likely went down mid-session. The right-pane Markdown renders from cache; the left pane needs a live backend to fetch source bytes. Restart the backend. If it persists, check `/tmp/awd-backend.log`.

### Batch conversions are very slow on scanned PDFs
Expected. OCR is CPU-heavy. A 50-page scanned PDF can take 2–4 minutes. If you need faster, enable the VLM pipeline in Preview's Advanced panel — uses your Mac's GPU, about 2× faster on scans.

### "Convert failed — 422 Unprocessable Entity"
Docling couldn't handle that specific document. Most common on very large PowerPoints with heavy graphics, or malformed PDFs. These land in the triage table after batch — retry with vision, or exclude. Not a system-wide failure; just that specific file.

### Cancel shows "Cancelling…" for a while, then finishes
Expected. Docling runs inside a thread pool that can't be killed externally. The cancel is acknowledged immediately in the DB (UI will show `cancelled` status), but the worker needs to finish the in-flight document before fully exiting. That takes up to 2–3 minutes for a big scanned PDF.

### Scan takes a long time (60+ seconds) on a large folder
Expected. The scan computes a SHA-256 hash of every file. On a 1000-doc corpus this takes 30–90 seconds. The Next.js dev proxy timeout is set to 10 minutes so you won't hit a false "500" — you'll just see a spinner.

### Your laptop closed / went to sleep mid-batch
macOS will suspend the Python backend when the laptop sleeps. It does NOT cleanly resume when you open the lid — the process gets frozen in a weird state. Recipe:

1. `Ctrl+C` the `start.sh` terminal window (or `pkill -f uvicorn` in a new terminal).
2. Run `./scripts/start.sh` again.
3. On startup, the backend marks the interrupted batch as `failed` and cleans up partial writes. Your browser auto-detects the state and shows the "Batch interrupted" UI.
4. Click **Resume converting →** — the 100+ docs already converted get dedup-skipped, conversion picks up.

For long overnight runs, use `caffeinate -i ./scripts/start.sh` to prevent sleep. macOS only.

### Batch seems stuck (progress hasn't changed for 5+ minutes)
Rare, but possible — the worker can occasionally get stuck on a pathological document. Recipe to recover:

1. Click **Cancel** in the top-right (cancel is acknowledged immediately).
2. Go back to Scan, then click **Start converting →** again.
3. The dedup logic skips every document that was already successfully converted. Only the stuck doc + anything remaining gets processed. The stuck doc will likely fail after retries and land in triage, which is where it should be.

You won't re-do any completed work. `source_sha256 + pipeline_hash` is the dedup key; already-complete docs are skipped instantly.

### Disk fills up during batch
Docling caches model weights and intermediate outputs under `data/cache/`. Large corpora can also produce gigabytes of output. Make sure you have 10+ GB free before running a 1000-doc batch.

### "brew: command not found" on fresh Mac
You haven't installed Homebrew. Follow Step 1 above.

### Frontend port 3000 or backend port 8000 already in use
Another app is squatting the port. Either kill that app or configure ports:
```bash
# Find what's on :3000
lsof -iTCP:3000 -sTCP:LISTEN
# Or change ports in scripts/start.sh and frontend/next.config.mjs
```

---

## Known limits

This is a working prototype, not shrinkwrap software. Known rough edges:

- **macOS only, tested on Apple Silicon.** It will likely run on Linux with minor tweaks (the `brew install` commands become `apt install`). Windows is untested.
- **It's a localhost web app, not a native desktop app.** Two servers run on your machine (Python backend on :8000, Next.js frontend on :3000). You interact via a browser tab. A proper Tauri wrap is on the roadmap but not built.
- **First-run model download** is ~500 MB and can fail on flaky networks. If it does, just re-run the first scan.
- **Some PowerPoints** with heavy graphics hit Docling's 422 edge case. Excluded via triage.
- **Activity log shows group-level events, not per-filename.** The log reads "Converted a document · docx · 3.2s" rather than the specific filename. Filenames are preserved in the output; adding them to the live stream requires a backend event channel that's not built yet.
- **Cancel is not instant.** Acknowledged in the UI immediately; the worker may take up to a few minutes to exit if it's mid-document (Docling runs in a thread pool that can't be killed externally).
- **Pause button** on batch is a display-only no-op; use Cancel + restart if you need to pause.
- **Command palette (⌘K)** is aspirational, not wired.
- **Dual-write** between the old taste_sessions table and the new filemap.yaml files is intentional overlap — keeps both interfaces working during the prototype phase. Will be consolidated later.

For the full running list of known scope cuts with functional-impact descriptions, see [`plans/deferral-ledger.md`](plans/deferral-ledger.md).

---

## How it works (brief, for the curious)

### The conversion engine

[Docling](https://github.com/docling-project/docling) is an IBM-developed, MIT-licensed document conversion library. It uses **specialized computer-vision models, not large language models**:

- [DocLayNet](https://github.com/DS4SD/DocLayNet) / Heron — layout analysis (regions, reading order)
- [TableFormer](https://arxiv.org/abs/2203.01017) — table structure recovery
- Tesseract or RapidOCR for optical character recognition on scans
- Optional [GraniteDocling](https://huggingface.co/ibm-granite/granite-docling-258M) vision-language model (258M params, MLX-accelerated on Apple Silicon) for tough scans

No API calls. No per-document cost. Fully offline after the first-run model download.

### The taste test concept

Adapted from a specification in [agent-wire-node's self-describing-filesystem vision](https://github.com/adamlevineagent/agent-wire-node/blob/main/docs/vision/self-describing-filesystem.md) — the idea that every folder should carry its own understanding as a sibling `.understanding/` directory, with a `folder.yaml` filemap that lists every file, whether the scanner thinks it should be included, and whether the user has overridden that decision. This tool is a concrete implementation of that spec for the folder-ingestion-to-Markdown step.

### Architecture

```
backend/    FastAPI + Docling sidecar (Python 3.11)
  backend/conversion/        — Docling wrapper + mirrored-tree output writer
  backend/stratification/    — folder walker, filemap emission, /fs/list picker
  backend/jobs/              — job queue, batch runner, manifest writer, triage
  backend/cli.py             — awd CLI
frontend/   Next.js 15 + React 19 + Tailwind + design tokens (TypeScript)
  components/shell/          — window chrome, sidebar, folder entry
  components/VizDiff/        — two-pane diff viewer + confidence gutter
  components/Renderers/      — per-format source renderers (pdf, docx, xlsx, pptx, html, text)
  components/TasteTest/      — tuning sidebar, reviewer, action bar, advanced panel
  components/BatchRun/       — pre-launch, live progress, post-run triage
contracts/                   — OpenAPI spec, shared TypeScript interfaces, SQLite schema
data/                        — runtime state: SQLite, model cache, NDJSON logs (gitignored)
```

UI ↔ backend is strictly HTTP. The same backend powers the CLI and could power an MCP server for agent-driven operation.

### Related documentation

- [`docs/design-brief.md`](docs/design-brief.md) — product vision, UX principles, tone
- [`docs/filemap-model.md`](docs/filemap-model.md) — the filemap + triage spec
- [`docs/docling-probes.md`](docs/docling-probes.md) — empirical findings about Docling's surface behavior
- [`plans/build-plan.md`](plans/build-plan.md) — implementation plan (historical)
- [`plans/deferral-ledger.md`](plans/deferral-ledger.md) — running log of scope cuts

---

## License

MIT.

## Credits

Built on [Docling](https://github.com/docling-project/docling) (IBM Research, MIT license). Visual design pass generated via Claude Design. Implementation by Claude Code.
</content>
