# Docling Surface Probes

Run during pre-flight P1. Results here are the canonical reference for Wave 1/2 agents — what Docling actually does on this machine, not what the README promises.

## Environment
- **Docling:** `2.90.0` (pin in `backend/pyproject.toml`)
- **Python:** 3.11.15 (via uv)
- **Platform:** macOS arm64, Darwin 24.6.0
- **Tesseract:** `/opt/homebrew/bin/tesseract` (present)
- **poppler-utils (pdfinfo/pdftotext):** **NOT installed** — must `brew install poppler` during Wave 1 Agent B setup
- **Torch:** 2.11.0, transformers 5.5.4 (pulled as Docling deps)

## Fixtures used
- `data/fixtures/attention.pdf` — 2.2 MB, 15 pages, native text, standard academic layout (arxiv/1706.03762)
- `data/fixtures/docling-paper.pdf` — 5.3 MB, native text (arxiv/2408.09869)

## Probe results

### P1.1 — Basic conversion works
`DocumentConverter().convert(path)` succeeds on native-text PDFs. First run downloads weights (~770 layout-model weights) silently; record them into `data/cache/` via `HF_HOME`/`TRANSFORMERS_CACHE`/`DOCLING_CACHE_DIR` env vars.

**Lock:** scaffold script sets these env vars explicitly before any Docling call, so the cache always lives under `data/cache/`.

### P1.2 — Markdown export works
`doc.export_to_markdown()` returns clean UTF-8 markdown. For attention.pdf: 49,452 chars / 462 lines.

**Signature** (pinned for Wave 1 Agent A):
```python
export_to_markdown(
    delim='\n\n',
    from_element=0, to_element=<big>,
    labels=None, strict_text=False,
    escape_html=True, escape_underscores=True,
    image_placeholder='<!-- image -->',
    enable_chart_tables=True,
    image_mode=ImageRefMode.PLACEHOLDER,
    indent=4, text_width=-1,
    page_no=None,                          # ← per-page export
    included_content_layers=None,
    page_break_placeholder=None,           # ← between-page marker
    include_annotations=True,
    mark_annotations=False,
    compact_tables=False,
    traverse_pictures=False,
    *,
    use_legacy_annotations=None,
    allowed_meta_names=None, blocked_meta_names=None,
    mark_meta=False,
) -> str
```

### P1.3 — JSON export and provenance structure
`doc.export_to_dict()` returns a 770 KB JSON for a 15-page PDF. Extrapolated: ~80 KB/page, so 1500 docs × 15 pages avg = **~1.1 GB total JSON on disk** — manageable.

**Top-level keys:** `schema_name`, `version`, `name`, `origin`, `furniture`, `body`, `groups`, `texts`, `pictures`, `tables`, `key_value_items`, `form_items`, `pages`

**Per-element provenance is universal:**
- `doc.iterate_items()` → 226 items for the attention.pdf; **226/226 have `.prov`** (100% coverage)
- Each item has:
  - `self_ref`: string like `#/texts/42` — unique and addressable
  - `label`: e.g. `text`, `section_header`, `list_item`, `table`, `picture`
  - `prov`: list of `{page_no, bbox, charspan}`
  - `parent`: reference to parent item
- `bbox` shape: `{l, t, r, b, coord_origin}` — coords in PDF points, origin `BOTTOMLEFT` (standard PDF convention — frontend will flip for top-left screen coords)

**Sample:**
```json
{
  "self_ref": "#/texts/2",
  "label": "section_header",
  "text": "Attention Is All You Need",
  "prov": [{
    "page_no": 1,
    "bbox": {"l": 18.76, "t": 578.08, "r": 36.21, "b": 237.0, "coord_origin": "BOTTOMLEFT"},
    "charspan": [0, 27]
  }]
}
```

### P1.4 — Bbox → markdown anchor round-trip (CRITICAL — load-bearing for VizDiff)

**Tested four strategies:**

| Strategy | Result | Use |
|---|---|---|
| A. `page_break_placeholder="..."` | 14 breaks for 15 pages (between-page markers) | Page-level sync baseline |
| B. `mark_annotations=True` / `mark_meta=True` | No-op on plain docs (same length as baseline) | Only useful on annotated inputs |
| C. `export_to_markdown(page_no=N)` | Per-page markdown, clean | Alternate page-level sync |
| D. Custom emission via `iterate_items()` + HTML comment anchors | 211 anchored elements, full element-level mapping | **Element-level sync + bidirectional highlight** |

**Strategy D anchor format** (locked):
```markdown
<!-- #/texts/1 page=1 label=text -->
Provided proper attribution is provided, Google hereby grants permission...

<!-- #/texts/2 page=1 label=section_header -->
Attention Is All You Need

<!-- #/texts/3 page=1 label=text -->
Ashish Vaswani ∗ Google Brain avaswani@google.com
```

**Decision for VizDiff:**
- **Canonical `doc.md`** uses Strategy A (`page_break_placeholder="<!--- page-break --->"`) — clean, readable, consumable by downstream Wire Node ingest.
- **Sidecar `doc.anchors.json`** (also emitted by Agent A) is the element→offset map: `[{self_ref, byte_start, byte_end, page, bbox, label}, ...]` keyed by self_ref. Frontend loads this alongside the markdown for bidirectional highlight without cluttering the markdown itself.

This **kills the C1 risk from the plan audit**: bbox→MD round-trip is confirmed feasible, element-level precision. Bidirectional highlight stays in scope; no degradation to page-sync needed.

### P1.5 — Image / figure extraction
Default `image_mode=ImageRefMode.PLACEHOLDER` → markdown contains `<!-- image -->` text placeholders.
For attention.pdf: 6 pictures detected in JSON under `pictures[]` with full bbox/page prov.

**Decision:** Agent A exports images to `output_dir/<hash>/images/{self_ref}.png` using Docling's ImageRefMode.REFERENCED (to be verified in Wave 1), markdown gets `![fig](images/#_pictures_0.png)` style refs. Defer if it fights back — placeholder-only is acceptable fallback.

### P1.6 — JSON size on real input
Attention.pdf (2.2 MB, 15 pages) → 770 KB JSON. Ratio ~0.35× source size. Storing JSON inline in SQLite is feasible for individual lookups but **Agent C should path-reference it**, not inline-blob, per the plan.

### P1.7 — Timing (native text, CPU, no OCR)
**Cold start** (includes weight download + model warmup): 44.9s
**Warm run**: 9.1s for 15 pages = **0.60 s/page**

Extrapolation for 1500 legal PDFs:
- Optimistic (all native text, 15 pg avg): 1500 × 9s = **~3.75h** at concurrency 1
- Realistic (mix of native + scanned, OCR ~3–5× slower): **8–15h** at concurrency 1
- At concurrency 2 on a 32GB Mac: **4–8h** likely

**Overnight run is feasible.** Concurrency default = 2 as planned; add hardware probe in Wave 1 Agent C (peak RAM per worker × concurrency ≤ available RAM - 4 GB reserve).

### P1.8 — OCR engines
- **Tesseract** present at `/opt/homebrew/bin/tesseract` (via homebrew)
- **RapidOCR** via pip — install on demand in backend
- Not timed on scanned fixture (no scanned PDF on hand); Docling's pipeline auto-falls-back to OCR for pages without extractable text. Quality will be empirically surfaced via the taste test — that's the whole point of the product.

### P1.9 — VLM pipeline toggle
Not probed in detail this session. `--pipeline vlm --vlm-model granite_docling` is documented; MLX-accelerated on Apple Silicon. Deferred to empirical testing against a tough-scan fixture when one appears. Noted in deferral ledger as "VLM pipeline option available but not validated end-to-end in prototype."

### P1.10 — Cache locations
Set explicitly before any Docling import:
```python
os.environ["HF_HOME"] = str(data/cache/hf)
os.environ["TRANSFORMERS_CACHE"] = str(data/cache/transformers)
os.environ["DOCLING_CACHE_DIR"] = str(data/cache/docling)
```
Verified these prevent pollution of `~/.cache`. Weight download size: ~770 shards, ~a few hundred MB total.

## Decisions locked from probes

1. **Docling pinned at 2.90.0** in `backend/pyproject.toml`.
2. **Anchor strategy:** sidecar `doc.anchors.json` + page-break-marked `doc.md`. No markdown mangled with inline HTML comments.
3. **Output contract expanded:** per-doc directory now contains `source.<ext>`, `doc.md`, `doc.json`, `doc.anchors.json`, `meta.json`, and an `images/` subdir when figures present.
4. **poppler-utils** must be installed at scaffold time (`brew install poppler`). Without it, Agent B's cheap PDF probes fail.
5. **HuggingFace token** not required but logged warning about rate limits — add optional `HF_TOKEN` env var for first-run speedup in `scripts/warmup.py`.
6. **Cache env vars** set by `scripts/start.sh` and `scripts/warmup.py` before any Docling import.
7. **Concurrency default 2**, tunable in Advanced.
8. **Bidirectional highlight STAYS IN SCOPE** — not a deferral.

## What's NOT yet probed
- Scanned-PDF OCR pipeline (Tesseract engine) end-to-end timing + quality — needs a real scanned fixture.
- VLM (GraniteDocling) pipeline on same doc for comparison.
- DOCX / XLSX / PPTX / HTML conversion — structural surface is universal (`iterate_items`, `prov`, `self_ref`) so should work, but specific quirks per format TBD.
- LaTeX parsing quality.

These runtime-quality questions are the taste test's job to surface, not pre-flight's. Noted here so Wave 1 Agent A's fixture set expands to cover them.
