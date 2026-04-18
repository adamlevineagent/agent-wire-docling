# Docling Prototype — Design Brief

## One-liner
A desktop-local tool for turning folders of heterogeneous documents into pyramid-ready corpus, with confidence the conversion is actually good — before burning a day on a full batch run.

## Who it's for
Single user with a folder of heterogeneous documents, running on their own machine. First proving ground: 1500 legal PDFs for a specific case.

This is a **prototype**. Its job is folder-in → folder-out. The output folder is something Wire Node's existing pyramid build can point at as a source. That's the whole integration story — no code transplant, no shared schema, no live data plumbing. Wire compatibility of the output is a nice-to-have bonus, not a design constraint.

## The insight
Docling itself is a mature converter. The interesting product surface isn't the conversion — it's **knowing the conversion worked.** For a 1500-document legal corpus, running blind and discovering 20 hours in that the tables all came out mangled is a disaster. The tool's job is to make the user confident *before* they commit.

**The taste test is the product.** Everything else is scaffolding around it.

## Core interaction
1. Point at a folder.
2. See it broken into strata — "327 native-text PDFs, 114 scanned PDFs, 42 spreadsheets, 18 DOCX…"
3. Sample N from each stratum, convert them, review side-by-side against the source.
4. Tune pipeline config per stratum until each one is approved.
5. Kick off the full run with confidence. Walk away.
6. Come back to a finished manifest and a short list of flagged outliers.

## UX principles

1. **Service, not mechanism.** "Turn it on and it works." Basis points, OCR thresholds, pipeline knobs live behind an Advanced panel. Default path: select folder → review samples → approve → go.

2. **Keyboard-first review.** The reviewer is going to eyeball hundreds of docs. `j/k/n/p/y/n/f` beats click-to-approve. Mouse is optional.

3. **Synced, not separate.** Source render and converted output are always side-by-side, always synced. Scrolling one moves the other. Clicking an element in one highlights its counterpart.

4. **Honesty about confidence.** Per-page quality badges visible by default, not hidden. "OCR conf 0.62 on this page" prevents false approvals.

5. **Dark mode from day one.** Long review sessions deserve it.

6. **No magic pauses.** Every operation shows progress. Nothing just sits there "working on it."

## Success criteria
The prototype succeeds if:
- User loads the 1500-PDF legal corpus, completes the taste test loop in <30 min, kicks off the full run with confidence.
- Full run completes overnight, resumable across crashes.
- Output is a folder of markdown + JSON files that Wire Node's existing pyramid build can select as its source and produce useful knowledge from.
- Useful enough that Adam reaches for it again on the next heterogeneous corpus.

## Tone & aesthetic
Feels like a tasteful desktop utility. Dark, monospace-friendly, dense without clutter. Not a landing page, not an admin console — closer to a diff viewer or a code review tool.

Reference points: GitHub PR review UI, Linear's keyboard density, Raycast's clarity. Not Slack, not Notion, not Figma.

## Non-goals
- Not a cloud service. Not multi-user. No accounts.
- Not retraining or fine-tuning Docling. Consumer of it, not collaborator.
- **Not a Wire Node integration.** Output is a plain folder of files. Wire Node points its existing pyramid ingest at that folder. No shared database, no shared schema, no `wire_source_documents`-shaped output, no API call from one project to the other.
- Not a format-exploration playground. Tier 1 (PDF, DOCX, XLSX, PPTX, HTML) and Tier 2 (plain text, Markdown, LaTeX) only. Tier 3 (audio ASR, standalone images, XBRL/JATS/USPTO) deferred until someone shows up with real need.

## What happens next
User points Wire Node's existing pyramid ingest at the output folder. Done. If this proves valuable enough to build in as a first-class pipeline stage later, that's a separate project with its own design.

## Name
`agent-wire-docling` — mirrors the `agent-wire-node` convention. Repo: https://github.com/adamlevineagent/agent-wire-docling.
