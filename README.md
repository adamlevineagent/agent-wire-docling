# agent-wire-docling

A local desktop tool that turns a folder of messy documents — PDFs, Word files, Excel, PowerPoint, HTML, plain text — into a matching folder of clean Markdown + JSON. With a **taste test** step in the middle so the user can verify the conversion quality on a small sample before committing to a long overnight batch.

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

You give this tool a folder full of documents. It goes through every file, figures out what kind of document it is, and groups similar documents together (PDFs-with-text, scanned PDFs, Word docs, spreadsheets, and so on). These groups are called **strata**.

For each group, it lets you look at a few sample documents — the original on the left, the cleaned-up version on the right — so you can see whether the conversion is good. If it's good, you approve the group. If it's not, you can tweak some settings and try again. Once you're happy with a group, you **lock** it.

When all your groups are locked, you hit **Run**. The tool converts every document in every group using the settings you approved, and lands the clean output in a sibling folder. Then it shows you a short list of anything that didn't work (probably a handful out of thousands), and you can either retry those with different settings or mark them as skipped.

The clean output is Markdown + JSON — a format that AI systems like [Wire Node](https://github.com/adamlevineagent/agent-wire-node) can read and build a searchable knowledge base from.

Nothing is uploaded. Everything happens on your own machine.

### The taste test

The core idea: **don't commit to a 15-hour overnight conversion until you know it's going to work**.

If you just throw 1,500 documents at any converter and walk away, you often come back to discover it handled your tables wrong, or butchered your scanned faxes, or lost the formatting on your exhibits. You wasted a night. Worse: you didn't notice.

The taste test prevents that. You look at 5 examples from each group, approve them, and *then* walk away. If something is going to go wrong, it goes wrong in the first 10 minutes where you're watching, not overnight where you're not.

This is why the tool feels more deliberate than just a file converter. That's the point.

### When to use it

- You have a folder (or a tree of folders) full of mixed document types
- You want the content as plain text / Markdown, readable by any text-based tool or AI
- You care about quality enough to spot-check
- You're OK with letting it run on your machine for a few hours (on a 1000-doc corpus, expect 1–3 hours of conversion time)

It's not useful if:
- You only have a handful of documents (just open them)
- Your documents are already in Markdown or plain text
- You need cloud processing (this is local-only by design)

---

## Operating guide

The UI has three stages, shown as a vertical sidebar on the left: **Scan · Taste · Batch**. You move through them in order. You can always go back.

### Stage 1 — Scan (pick a folder)

On first launch you see **"Point me at a folder."**

- **Click the Scan button with the path field empty** → opens a folder picker where you can navigate your filesystem and pick your corpus folder.
- Or paste an absolute path (e.g. `/Users/sarah/Documents/condo-case`) directly into the field and hit Enter.

The scan runs in a few seconds, even for thousands of files. What you get back:

- A **spectrum bar** at the top — each colored band is a stratum (document group), sized by how many documents it contains. This is the visual summary of what's in your folder.
- **Detail cards** below — one per stratum with the group name, document count, and an example filename.
- **Skipped files** at the bottom — things that were intentionally ignored (binary files, images over 100MB, system files).

The strata you'll typically see:

| Stratum name | What it means |
|---|---|
| `pdf-native-1-10` | PDFs with real extractable text, 1–10 pages |
| `pdf-native-11-50` | Native-text PDFs, 11–50 pages |
| `pdf-native-51-200`, `201+` | Longer native PDFs |
| `pdf-scanned-*` | Scanned PDFs (no extractable text layer) — will use OCR |
| `docx` | Word documents |
| `pptx` | PowerPoint presentations |
| `xlsx` | Excel spreadsheets |
| `html` | Saved web pages, emails |
| `text`, `md`, `latex` | Plain-text-like files |

When you're ready, click **"Continue to taste"** in the top right, or press Enter.

### Stage 2 — Taste test (verify quality per stratum)

This is the most important stage. You're going to look at a handful of documents from each stratum and decide whether the conversion looks good enough to run on all of them.

On the left, the **tuning progress** sidebar shows every stratum with 5 dots under each name. The dots fill in as you approve samples. When a stratum has enough approvals, you **lock** it — that commits the conversion settings you approved to be used on the whole group.

#### Reviewing a doc

1. **Click a stratum** in the sidebar to select it. The center pane shows a prompt: "Sample N docs · ⇧S".
2. **Click "Sample N docs"** (or press Shift+S). The tool converts 5 example documents from that stratum (this takes 10–60 seconds per doc depending on type).
3. Once conversions finish, the reviewer opens: **source on the left, cleaned Markdown on the right, and a narrow "confidence gutter" in the middle**. Each colored segment in the gutter represents one page of the source, with color showing OCR confidence (green = very confident, yellow/orange = less confident, red = probably wrong).
4. Compare the two panes. Does the Markdown on the right faithfully capture the content of the source on the left? Are tables intact? Are headings preserved? Is the reading order sensible?

#### Making a verdict

Use the **action bar at the bottom** of the reviewer, or the keyboard:

| Key | Action |
|---|---|
| `y` | Approve — yes this conversion is good |
| `x` | Reject — this one's wrong; won't count toward tuning |
| `s` | Skip — defer decision |
| `f` | Flag — approve but mark for later attention |
| `r` | Re-run — open the Advanced panel to tweak settings |
| `j` / `k` | Next / previous page within the current doc |
| `n` / `p` | Next / previous doc in the sample |
| `1` / `2` / `3` | Switch between Rendered Markdown / Raw Markdown / JSON tabs |
| `?` | Keyboard help overlay |

After each verdict, it auto-advances to the next doc.

#### Tuning with the Advanced panel

If the conversion is poor, press `c` or click **Advanced (c)** to open the pipeline settings for the current stratum. Common knobs:

- **OCR engine** — Tesseract (default, reliable) or RapidOCR (sometimes better on poor scans)
- **Vision model** — turn on a dedicated AI visual language model (GraniteDocling). Much better on smudged handwritten or low-quality scans, about 2× slower, uses your Mac's GPU. The panel shows a gold "Recommended" badge on this knob for scanned-PDF strata.
- **Structure** — toggle recognition of tables, formulas, code blocks, charts.

Save the settings and the tool re-runs your samples against the new pipeline.

#### Locking a stratum

When you've approved enough samples (5 approvals, or all of them if the stratum is tiny), click **Lock**. The stratum becomes "locked" — its pipeline is committed for the batch run. You can still unlock it later if you change your mind.

You don't have to tune every stratum exhaustively. Sample 3–5 docs, if they look good, lock it and move on.

### Stage 3 — Batch run (convert everything)

Once you have at least one locked stratum, switch to the **Batch** tab.

**Pre-launch view** shows you the plan: how many docs will be converted, broken down by content type, and what pipeline will be used for each. The output directory defaults to `<your-folder>/.docling-out` but you can change it.

Click **Start**. The UI switches to the live progress view:

- A single big sentence: "Converting 612 of 2,496 documents. About 1 hour 12 minutes remaining at 0.19 docs/s."
- Per-group progress bars so you can see which strata are advancing
- A small "Recent" log of the last 7 docs processed
- **Cancel** button at the top-right if you need to stop

You can close the browser tab — the backend keeps running. When you come back, the status is still there.

### Stage 4 — Post-run triage

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

### Stage 5 — Hand off the output

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

## Keyboard shortcuts (full)

### Global (anywhere in the app)
| Key | Action |
|---|---|
| `?` | Show keyboard help overlay |
| `/` | Focus the path input |
| `Esc` | Close any open dialog or overlay |
| `g s` / `g t` / `g b` | Go to Scan / Taste / Batch stage |

### Taste reviewer (when a document is open)
| Key | Action |
|---|---|
| `y` | Approve |
| `x` | Reject |
| `s` | Skip |
| `f` | Flag |
| `r` | Re-run (opens Advanced for this stratum) |
| `j` / `k` | Next / previous page |
| `n` / `p` | Next / previous document |
| `1` / `2` / `3` | Rendered MD / Raw MD / JSON tab |

### Taste sidebar
| Key | Action |
|---|---|
| `a` | Toggle approved-docs drawer |
| `l` | Lock / unlock the current stratum |
| `⇧S` (Shift+S) | Sample more docs from the current stratum |
| `c` | Open Advanced panel |

### Batch
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

### Health indicator shows "not_ready · warming"
Cosmetic — the readiness check looks for a Docling-specific cache directory that isn't populated until first conversion. The tool works fine. Ignore.

### A DOCX/PPTX source preview spins forever
The backend likely went down mid-session. The right-pane Markdown renders from cache; the left pane needs a live backend to fetch source bytes. Restart the backend. If it persists, check `/tmp/awd-backend.log`.

### Batch conversions are very slow on scanned PDFs
Expected. OCR is CPU-heavy. A 50-page scanned PDF can take 2–4 minutes. If you need faster, enable the VLM pipeline in Advanced — uses your Mac's GPU, about 2× faster on scans.

### "Convert failed — 422 Unprocessable Entity"
Docling couldn't handle that specific document. Most common on very large PowerPoints with heavy graphics, or malformed PDFs. These land in the triage table after batch — retry with vision, or exclude.

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
- **First-run model download** is ~500 MB and can fail on flaky networks. If it does, just re-run the first scan.
- **Some PowerPoints** with heavy graphics hit Docling's 422 edge case. Excluded via triage.
- **OCR confidence signals** are not per-element yet — the gutter colors pages based on page-level approximations. Fidelity improves in future Docling releases.
- **Pause button** on batch is a display-only no-op; use Cancel + restart if you need to pause. Known deferral.
- **Command palette (⌘K)** is aspirational, not wired.
- **`not_ready · warming` indicator** in the top-right is always showing; cosmetic only.
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
