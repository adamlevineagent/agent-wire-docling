# Filemap Model — Level B Adoption

Aligns agent-wire-docling with `agent-wire-node/docs/vision/self-describing-filesystem.md` and `handoff-2026-04-11-folder-nodes-as-checklists.md`. The filesystem becomes canonical; SQLite becomes a derived cache.

## The mental model

- Every folder in the scanned tree gets its own `.understanding/folder.yaml` — a **checklist file** that the scanner writes and the user curates.
- Scanner writes scanner-owned fields (hashes, sizes, detected types, suggestions). User writes user-owned fields (include y/n, overrides, notes). **Re-scans only touch scanner fields.**
- Build reads the filemap files across the tree and converts only the files the user marked `user_included: true` (or that the scanner suggested `include` and the user hasn't explicitly unchecked).
- Output is a **mirrored tree** under the output directory; nested structure is preserved.

## Where `.understanding/` lives

**In the source tree** — alongside the files it describes. Scanner creates `.understanding/folder.yaml` inside every folder it walks.

Rationale: this matches the spec's portability claim ("move a folder, its understanding moves"). The output-dir-only alternative breaks that.

*Caveat for sensitive corpora:* add a `--readonly-source` flag later that writes filemaps into the output dir mirrored tree instead. Not shipping in v1; source-write is the default.

## `.understanding/folder.yaml` schema

```yaml
schema_version: 1
folder: /absolute/path/to/this/folder
scan_id: <uuid>                           # last scan's id
scanned_at: "2026-04-18T20:00:00Z"
scanner_version: "0.1.0"

# Per-folder defaults — user-editable
defaults:
  user_included: null                     # null (inherit scanner suggestion) | true | false
  user_content_type: null

# Files directly in this folder (not subfolders — each subfolder has its own folder.yaml)
files:
  - path: "report.pdf"                    # relative to `folder`, always
    sha256: "abc123..."
    size_bytes: 1234567
    mtime: "2026-04-10T12:00:00Z"

    # Scanner-owned — rewritten on every rescan
    detected_content_type: "pdf"
    detected_stratum: "pdf-native-11-50"  # retained for aggregation views
    scanner_suggestion: "include"         # include | exclude_by_pattern | exclude_by_size | exclude_by_type | unsupported | failed_extraction
    exclusion_reason: null                # e.g. "node_modules pattern", "file > 200MB"

    # User-owned — NEVER touched by rescan
    user_included: null                   # null (inherit suggestion) | true | false
    user_content_type: null               # override detected_content_type
    user_notes: null

    # Post-build (scanner-written, but only after a build)
    last_build_at: null
    last_build_pipeline_hash: null
    last_build_output_path: null          # absolute path to the output_dir entry
    last_build_error: null

  - path: "README.md"
    # ...

# Files that existed in a prior scan but are gone from disk — never removed
deleted:
  - path: "old.pdf"
    sha256: "def456..."
    deleted_at: "2026-04-18T20:00:00Z"
    last_build_output_path: "..."
    last_detected_content_type: "pdf"
```

## Output layout (mirrored)

Convert writes into `<output_dir>` preserving the source structure. No flat hash dirs.

```
<output_dir>/
  wire-archive/
    12-interviews-talks/
      Accelerator Application.docx.md
      Accelerator Application.docx.json
      Accelerator Application.docx.anchors.json
      Accelerator Application.docx.meta.json
      images/
        Accelerator Application.docx/
          pic-0.png
```

- Source files are **not copied** into the output (source tree already has them; we don't duplicate)
- Each converted file gets four sidecars: `.md`, `.json` (DoclingDocument), `.anchors.json`, `.meta.json`
- Figure images (if emitted by Docling) live at `images/<source_stem>/*.png`
- Top-level `<output_dir>/manifest.yaml` (replaces `manifest.json`) indexes every converted doc by source path

`content_hash` semantic: `source_sha256` is still used for dedup and change detection (in filemap entries + manifest), but it's NOT the directory name anymore.

## HTTP surface additions

- `GET /filemap?folder=<path>` → filemap YAML parsed as JSON
- `PATCH /filemap?folder=<path>` → merge user-owned fields (body: `{ files: [{ path, user_included?, user_content_type?, user_notes? }], defaults?: {...} }`)
- `GET /filetree?root=<path>` → hierarchical view: `{ path, folder.yaml metadata, children: [...], files_included: N, files_pending: N, files_excluded: N }` recursively, for frontend tree rendering

`POST /batch` semantics change: the request body no longer takes `scan_id` + `stratum_pipelines`. It takes `root` + `output_dir` + optional `pipeline_by_content_type` (or `pipeline_by_stratum` for backward-compat). The batch walks the tree, reads every `.understanding/folder.yaml`, collects files where `user_included == true` OR (`user_included == null` AND `scanner_suggestion == "include"`), and dispatches.

`POST /scan` semantics change: walks the tree, writes `.understanding/folder.yaml` in every folder (creating `.understanding/` dir if absent), merges with any existing filemap (preserving user fields), returns a summary (`files_total`, `files_new`, `files_deleted`, `folders_with_filemaps`).

`POST /strata/sample` stays as an aggregate view — samples across folders by `detected_stratum`. Useful for cross-cutting taste-testing ("review 5 native-text PDFs regardless of which folder they're in").

## UI implications (minimum)

1. **Scan result pane** shows stratum breakdown AND a collapsible folder tree with per-folder coverage chips.
2. **Taste stage** keeps the current per-stratum sampling flow as-is; approve/reject/skip writes `user_included` to the filemap (via PATCH /filemap) instead of taste_sessions. The taste_sessions table can be dropped in a follow-up.
3. **Batch stage** shows aggregate plan: total files to build, by detected_content_type, with warnings for anything with `user_included: null` (user-not-explicit). Run button dispatches.
4. **New: "Folders" stage** (post-v1 polish) — folder-tree browser with per-file checkboxes. Users who prefer the file-level view live here. Not required for v1.

## Migration from current state

Forward-only. Existing `scans`/`strata`/`scan_docs`/`taste_sessions` SQLite tables retained but deprecated. New scans write filemaps. Prior outputs at `<hash>/` paths remain accessible but new conversions use mirrored paths. Drop deprecated tables in a cleanup pass after one week of soak.

## Triage — corpus-wide failure rollup

After every batch run, write `<output_dir>/triage.yaml` at the top of the output tree. This is the **single artifact** the user consults to see what didn't work and decide what to do about it. Failures scattered across per-folder `meta.json` and log NDJSON are invisible; the triage file makes them first-class.

### Batch retry policy

Each doc gets up to **2 automatic retries** within the same batch before it's marked failed (current N=3 → reduce to N=2 per user intent "one-two retries before skip"). A doc that fails all retries lands in `triage.yaml` with attempt count and the latest error.

### Schema

```yaml
batch_id: <uuid>
completed_at: "2026-04-18T20:45:00Z"
output_dir: /absolute/path
docs_succeeded: 1119
docs_failed: 47

by_reason:
  convert_422: 14                         # Docling 422 — format edge cases (big PPTX, etc)
  ocr_timeout: 8
  parse_error: 6
  unsupported_content_type: 0             # these never hit batch (filtered at scan)
  unknown: 19

by_content_type:
  pptx: 22
  pdf-scanned-201+: 8
  docx: 4
  pdf-scanned-11-50: 3
  # ...

failures:
  - source_path: "/Users/.../breathless figures draft 29 sept 2019.pptx"
    source_sha256: "abc123..."
    detected_content_type: pptx
    detected_stratum: pptx
    pipeline_used:
      ocr: { enabled: true, engine: tesseract }
      tables: { enabled: true }
      vlm: { enabled: false }
    error: "422 Unprocessable Entity — Docling rejected input"
    error_category: convert_422
    attempt_count: 3                      # 1 initial + 2 retries
    first_attempted_at: "2026-04-18T19:05:12Z"
    last_attempted_at: "2026-04-18T19:07:44Z"
    filemap_folder: "/Users/.../wire-archive/06-breathless"

    # Retry hooks — user edits these, awd retry-triage picks them up
    retry_with_pipeline: null             # set to a pipeline dict to retry; null = don't retry
    mark_as_excluded: false               # set true to write user_included=false back to filemap and stop trying
    notes: null

  # ... more failures
```

### Retry-from-triage

New CLI command + HTTP endpoint:

- `POST /triage/retry` with body `{ output_dir }` → reads triage.yaml, for each failure with `retry_with_pipeline != null` dispatches a single-doc convert using that pipeline. On success, removes from `failures`, increments `docs_succeeded`. On failure, updates `attempt_count` and `error`.
- `POST /triage/exclude` with body `{ output_dir }` → for each failure with `mark_as_excluded: true`, writes `user_included: false` back to the filemap.yaml for that file, removes from triage.
- `awd retry-triage <output_dir>` wraps both, applying whichever edits the user made to the triage file.

Workflow:
```bash
awd batch <scan_id> <output_dir>           # 47 failures
$EDITOR <output_dir>/triage.yaml            # user fills in retry_with_pipeline on 14 PPTX, sets mark_as_excluded on 19 unknown
awd retry-triage <output_dir>              # retries the 14, excludes the 19, updates triage
```

### triage.yaml is the source of truth for failure state

- Per-folder `filemap.yaml` entries carry `last_build_error` for local inspection
- `meta.json` per-doc retains the raw Docling error for deep debugging
- `triage.yaml` is the **rollup** — the one place a human goes to understand corpus-wide coverage gaps
- When `awd retry-triage` succeeds a doc, it's removed from triage AND the per-folder filemap entry's `last_build_error` is cleared

## Not in scope for v1

- Full `.understanding/` tree (nodes/, edges/, evidence/, configs/, conversations/, cache/) — only `folder.yaml` for now
- Inheritance / `children_default` cascading
- Git integration / diffs
- Rename detection (delete + add treated as two events)
- UI for direct filemap editing (users who want that edit `.understanding/folder.yaml` in their editor)

## Concrete rewrite targets

Backend:
- `backend/backend/stratification/scanner.py` — emit filemap.yaml per folder; keep SQLite writes for aggregate queries
- `backend/backend/stratification/filemap.py` (new) — filemap read/write/merge, atomic tmp-rename
- `backend/backend/stratification/router.py` — add /filemap GET+PATCH, /filetree GET
- `backend/backend/conversion/converter.py` — output layout changes (mirrored tree, source_stem-based naming)
- `backend/backend/jobs/batch.py` — batch reads filemaps instead of scan_docs
- `backend/backend/manifest.py` — manifest.yaml instead of manifest.json; mirrored path keys

Frontend:
- `frontend/components/shell/scan-view.tsx` — add folder tree below strata list
- `frontend/components/TasteTest/session.ts` — decision mutations PATCH filemap instead of taste_sessions
- `frontend/components/BatchRun/PreLaunch.tsx` — aggregate plan view
- `frontend/lib/api-client.ts` — add filemap/filetree methods

CLI:
- `backend/backend/cli.py` — `awd filemap <folder>`, `awd filetree <root>`, update `awd end-to-end` for new batch shape
