-- SQLite schema for agent-wire-docling — frozen in pre-flight P2.
--
-- Owner: Agent C (writes migrations). Consumers: Agents A, B, C.
-- Single source of truth for the runtime DB. WAL mode + busy_timeout set on connect.
--
-- Conventions:
--   - TEXT for all ids and hashes (hex strings; human-inspectable)
--   - ISO8601 strings for timestamps (TEXT)
--   - JSON stored as TEXT, documented per-column

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────────────────────
-- Scans: one row per `POST /scan` call

CREATE TABLE IF NOT EXISTS scans (
    id                  TEXT PRIMARY KEY,              -- uuid
    folder_root         TEXT NOT NULL,
    total_files         INTEGER NOT NULL,
    skipped_count       INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Strata: one row per stratum within a scan

CREATE TABLE IF NOT EXISTS strata (
    scan_id             TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,                 -- e.g. "pdf-native-11-50"
    size                INTEGER NOT NULL,
    exhaustive          INTEGER NOT NULL DEFAULT 0,    -- boolean: size ≤ 6
    PRIMARY KEY (scan_id, name)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Scanned docs: one row per input file per scan
-- `source_sha256` is NOT unique globally — same file can appear in multiple scans

CREATE TABLE IF NOT EXISTS scan_docs (
    scan_id             TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    source_sha256       TEXT NOT NULL,
    source_path         TEXT NOT NULL,
    source_format       TEXT NOT NULL,                 -- pdf | docx | xlsx | pptx | html | txt | md | latex
    stratum             TEXT NOT NULL,
    size_bytes          INTEGER NOT NULL,
    page_count          INTEGER,                       -- nullable: only set for PDFs
    signals_json        TEXT,                          -- JSON: cheap probe signals used for stratification
    PRIMARY KEY (scan_id, source_sha256)
);

CREATE INDEX IF NOT EXISTS ix_scan_docs_stratum ON scan_docs (scan_id, stratum);

-- ─────────────────────────────────────────────────────────────────────────────
-- Converted docs: one row per (source_sha256, pipeline_hash) combo per output_dir
-- Resume key: (output_dir, source_sha256, pipeline_hash)

CREATE TABLE IF NOT EXISTS docs (
    output_dir          TEXT NOT NULL,
    source_sha256       TEXT NOT NULL,
    pipeline_hash       TEXT NOT NULL,
    source_path         TEXT NOT NULL,
    source_format       TEXT NOT NULL,
    status              TEXT NOT NULL CHECK (status IN ('pending','processing','complete','error','skipped')),
    stratum             TEXT,
    docling_version     TEXT,
    runtime_ms          INTEGER,
    md_char_count       INTEGER,
    json_size_bytes     INTEGER,
    quality_json        TEXT,                          -- JSON: quality summary (ocr_avg, warning_count, empty_page_count)
    error               TEXT,
    converted_at        TEXT,
    PRIMARY KEY (output_dir, source_sha256, pipeline_hash)
);

CREATE INDEX IF NOT EXISTS ix_docs_status ON docs (output_dir, status);
CREATE INDEX IF NOT EXISTS ix_docs_stratum ON docs (output_dir, stratum);

-- ─────────────────────────────────────────────────────────────────────────────
-- Jobs: batch + export jobs

CREATE TABLE IF NOT EXISTS jobs (
    id                  TEXT PRIMARY KEY,              -- uuid
    kind                TEXT NOT NULL CHECK (kind IN ('batch','export')),
    status              TEXT NOT NULL CHECK (status IN ('queued','running','completed','cancelled','failed')),
    output_dir          TEXT,
    scan_id             TEXT,
    stratum_pipelines_json TEXT,                       -- JSON: [{stratum, pipeline}]
    concurrency         INTEGER DEFAULT 2,
    docs_total          INTEGER DEFAULT 0,
    docs_done           INTEGER DEFAULT 0,
    docs_failed         INTEGER DEFAULT 0,
    started_at          TEXT,
    completed_at        TEXT,
    error               TEXT,
    result_path         TEXT,                          -- for exports: artifact path
    created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_jobs_status ON jobs (status);

-- ─────────────────────────────────────────────────────────────────────────────
-- Per-hash mutex lease — prevents /convert and /batch from duplicating work

CREATE TABLE IF NOT EXISTS doc_leases (
    output_dir          TEXT NOT NULL,
    source_sha256       TEXT NOT NULL,
    pipeline_hash       TEXT NOT NULL,
    job_id              TEXT,                          -- nullable: set when lease held by a batch
    acquired_at         TEXT NOT NULL,
    PRIMARY KEY (output_dir, source_sha256, pipeline_hash)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Taste sessions

CREATE TABLE IF NOT EXISTS taste_sessions (
    id                  TEXT PRIMARY KEY,              -- uuid
    scan_id             TEXT NOT NULL REFERENCES scans(id),
    output_dir          TEXT NOT NULL,
    folder_root         TEXT NOT NULL,
    version             INTEGER NOT NULL DEFAULT 1,    -- for PATCH optimistic locking
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS taste_strata (
    session_id          TEXT NOT NULL REFERENCES taste_sessions(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    size                INTEGER NOT NULL,
    pipeline_json       TEXT NOT NULL,                 -- JSON: PipelineParams
    locked              INTEGER NOT NULL DEFAULT 0,    -- boolean
    status              TEXT NOT NULL DEFAULT 'under_review' CHECK (status IN ('under_review','converged','non_convergent','exhausted')),
    PRIMARY KEY (session_id, name)
);

CREATE TABLE IF NOT EXISTS taste_approvals (
    session_id          TEXT NOT NULL REFERENCES taste_sessions(id) ON DELETE CASCADE,
    stratum             TEXT NOT NULL,
    source_sha256       TEXT NOT NULL,
    pipeline_hash       TEXT NOT NULL,                 -- pipeline under which this doc was reviewed
    action              TEXT NOT NULL CHECK (action IN ('approved','rejected','skipped','flagged')),
    notes               TEXT,
    reviewed_at         TEXT NOT NULL,
    PRIMARY KEY (session_id, stratum, source_sha256, pipeline_hash)
);

CREATE INDEX IF NOT EXISTS ix_taste_approvals_session ON taste_approvals (session_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Schema version marker

CREATE TABLE IF NOT EXISTS _schema_migrations (
    version             INTEGER PRIMARY KEY,
    applied_at          TEXT NOT NULL
);

INSERT OR IGNORE INTO _schema_migrations (version, applied_at)
VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
