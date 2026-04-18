# agent-wire-docling

A desktop-local prototype for converting folders of heterogeneous documents (PDF, DOCX, XLSX, PPTX, HTML, plain text, LaTeX, Markdown) into a folder of clean Markdown + JSON files — with a **stratified-sampling taste test** so you can verify conversion quality on a representative sample before committing to a full batch run.

> **Status: pre-alpha.** Planning complete, pre-flight in progress. Nothing runs yet.

## Why it exists

You have 1500 legal PDFs. You want to build a knowledge pyramid from them. If you just run them through a converter blind, you discover 20 hours in that half the tables came out mangled and you wasted a day.

This tool's job is to make you **confident before you commit.** You point it at a folder, it buckets the docs into strata by cheap signals, you review a small sample from each stratum side-by-side against the source, and you tune the per-stratum pipeline config until every stratum looks good. Then you kick off the full run with confidence and walk away.

**The taste test is the product.** [Docling](https://github.com/docling-project/docling) is just the engine.

## How it fits

This is a **prototype**. Folder in → folder out. That's the whole integration story.

- You point it at `~/legal-case/pdfs/`
- It writes clean Markdown + JSON + metadata to `~/legal-case/output/`
- You point [Wire Node](https://github.com/adamlevineagent/agent-wire-node)'s existing pyramid build at `~/legal-case/output/` and let it ingest the folder

No shared database, no shared schema, no cross-project API calls. If this tool proves valuable, embedding it as a first-class pipeline stage is a separate future project.

## Supported formats

**Tier 1** — side-by-side viz diff (source rendering + markdown):
- PDF (native text + scanned, with OCR)
- DOCX, PPTX, XLSX
- HTML

**Tier 2** — text diff only (no rendered source needed):
- Plain text, Markdown, LaTeX

**Not supported** (deferred until needed):
- Audio (ASR), standalone images as corpus docs, specialized XML (XBRL/JATS/USPTO)

## Under the hood

Docling's default pipeline is **specialized CV models, not LLMs**:
- [DocLayNet](https://github.com/DS4SD/DocLayNet) / Heron — layout analysis (regions, reading order)
- [TableFormer](https://arxiv.org/abs/2203.01017) — table structure recovery
- Native PDF text extraction or OCR (Tesseract / RapidOCR) for scanned content
- Optional [GraniteDocling](https://huggingface.co/ibm-granite/granite-docling-258M) VLM pipeline (258M params, local, MLX-accelerated on Apple Silicon) for tough scans

No API calls to frontier models. No per-document cost. Fully offline after first-run model download.

## Architecture

```
backend/    FastAPI + Docling sidecar (Python 3.11+)
frontend/   Next.js 15 + Tailwind + shadcn/ui (TypeScript)
contracts/  Locked API shapes — single source of truth for both sides
data/       Runtime state (SQLite, model cache, logs) — gitignored
```

UI ↔ backend is strictly HTTP. Same backend can drive a CLI or an MCP server.

## Running it

Not yet. See [plans/build-plan.md](plans/build-plan.md) for the build schedule.

Once built:
```bash
./scripts/start.sh      # launches backend:8000 + frontend:3000
open http://localhost:3000
```

## Documentation

- [docs/design-brief.md](docs/design-brief.md) — product vision, UX principles, tone
- [plans/build-plan.md](plans/build-plan.md) — implementation plan, wave structure, pre-flight
- `docs/docling-probes.md` — written during pre-flight; documents Docling's surface behavior on the target machine
- `plans/deferral-ledger.md` — running log of scope cuts with functional impact

## Status

- [x] Design brief
- [x] Build plan (audited)
- [ ] Pre-flight (Docling probes, contract lock, scaffold)
- [ ] Wave 1 — conversion, stratification, manifest, shell
- [ ] Wave 2a — VizDiff + per-format renderers
- [ ] Wave 2b — taste test + batch run
- [ ] Wave 3 — verification, wanderer, fix pass
- [ ] Real-world test — 1500-PDF legal corpus

## License

MIT (pending).
