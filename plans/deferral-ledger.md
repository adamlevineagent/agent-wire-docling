# Deferral Ledger

Live log of scope cuts during the agent-wire-docling build. Every entry names the **functional impact** in plain English (not just the technical change). Reviewed at every wave gate per `feedback_no_deferral_creep`.

Format:
```
- [status] [phase] Title — Functional impact. Follow-up plan.
```

Status: `proposed` | `accepted` | `rejected` | `resolved` (later lifted)

## Seeded at P3 (pre-flight)

- [accepted] [P1] **Scanned-PDF pipeline not timed in pre-flight.** — Overnight run estimate (3.75h–15h) assumes mixed corpus; if the legal corpus is 95% heavy scans with tables, actual time could exceed 15h. Follow-up: taste-test surfaces timing per stratum; if a scanned stratum shows >5s/page, re-plan the batch.
- [accepted] [P1] **VLM pipeline (granite_docling) not validated end-to-end.** — User can select VLM in Advanced, but quality/speed on Apple Silicon not measured here. Follow-up: taste-test is the empirical check.
- [accepted] [P1] **DOCX/XLSX/PPTX/HTML/LaTeX structural probes not run** (only PDF was probed). — Assumes DoclingDocument surface (prov, self_ref, bbox) is format-agnostic based on Docling's claims. Follow-up: Wave 1 Agent A's fixture set includes one of each; if any format is missing provenance, page-sync fallback applies for that format.
- [accepted] [P3] **poppler-utils not bundled.** — If user runs without `brew install poppler`, `/scan` can't probe PDF text layers and stratification falls back to extension-only grouping (all PDFs go to one bucket). `scripts/start.sh` refuses to launch until installed. `/health` reports it.
- [accepted] [P3] **No HuggingFace token in default setup.** — First-run model download is rate-limited and slower. Follow-up: `scripts/warmup.py` reads optional `HF_TOKEN` env var; document in README once it matters.
- [accepted] [Wave 2] **Bidirectional highlight = element-level via sidecar anchors.** — P1 confirmed the Strategy D anchor mapping is clean. No degradation to page-only needed. (This is the **reversal** of the pre-audit C1 deferral — resolved in pre-flight.)
- [proposed] [Wave 2] **PPTX full-fidelity render may degrade to slide-image-only.** — If `pptx-preview` can't render text on slides reliably, Agent F falls back to server-side rasterized slide images. Impact: reviewer sees the slide but can't click individual text elements.
- [accepted] [Wave 2] **LaTeX render is source-only.** — Reviewer compares raw LaTeX source to converted markdown, no KaTeX render. Impact: equations in LaTeX source are unrendered on the left pane; user has to mentally compile. Acceptable for prototype.
- [accepted] [Wave 2] **Native folder picker not implemented.** — User pastes an absolute path into a text field, clicks Validate. Impact: mild friction. Follow-up: add browser folder picker via `webkitdirectory` in Wave 3 if time permits.
- [accepted] [Wave 2] **Multi-config side-by-side comparison not in prototype.** — Reviewer picks one pipeline per stratum and iterates; no A/B view of OCR vs VLM on the same doc. Impact: iteration takes one extra "re-run" per config variant tried.
- [accepted] [Wave 2] **Pipeline presets not persisted across folders.** — Each new corpus starts from defaults; the taste test learns anew each time. Impact: a user with 5 similar legal cases re-tunes 5 times.
- [accepted] [Wave 2] **Pre-fetch of next sample not implemented.** — Reviewer waits up to a second when moving to next sample. Impact: minor UX friction.
- [accepted] [Wave 2] **No visual-regression testing (Storybook/Chromatic).** — Renderer changes aren't caught automatically. Impact: UI drift possible; caught by wanderer + manual eyeballing only.
- [accepted] [Wave 2] **Observability = NDJSON logs only, no metrics dashboard.** — Per-doc progress and errors written to `data/logs/batch-<id>.ndjson`. Impact: debugging an overnight 1500-doc run means `jq` on logs, no at-a-glance dashboard. Acceptable.
- [accepted] [Wave 3] **CLI wrapper (`scripts/run-batch.sh`) is nice-to-have, not blocking.** — HTTP surface is complete and agent-drivable via `curl`; scripted CLI is polish. Impact: agents driving this prototype need to call endpoints directly vs a convenience wrapper.
- [accepted] [Wave 3] **Docling upgrade not auto-detected on outputs.** — If Docling ships 2.91 later, existing outputs don't know they could re-convert better. Impact: user must manually trigger re-runs. `meta.json` records the version used so it's visible.

## Added during Wave 1

- [accepted] [Wave 1 / Agent B] **PDF stratification degrades when poppler-utils is missing.** — Without `pdfinfo`/`pdftotext`, `/scan` can't distinguish native-text from scanned PDFs and can't determine page counts. All PDFs collapse into a single `pdf` stratum (or `pdf-unknown-{bin}` if page counts become available via another path later). Response includes `poppler_missing: true` so the frontend can surface an install hint. User impact: on a machine without poppler, the taste-test loses per-stratum fidelity for PDFs — reviewer must eyeball native vs scanned themselves and iterate once per whole-PDF bucket. Follow-up: `scripts/start.sh` should block launch until `brew install poppler` (already seeded in pre-flight deferral ledger).

## Added during Wave 2

(none yet)

## Added during Wave 3

(none yet)
