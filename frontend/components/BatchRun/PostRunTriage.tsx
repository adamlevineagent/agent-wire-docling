"use client";

/**
 * PostRunTriage — Level B post-run UX.
 *
 * Headline ("1,491 converted cleanly.") + mini stat tiles. Triage table with
 * per-row fix-preset badges (Retry with vision / Retry without tables /
 * Exclude from corpus / Pick fix…). "Next" card with output path + Open in
 * Wire Node button.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Job, PipelineParams, Triage } from "../../lib/api-client";
import { api, ApiError } from "../../lib/api-client";
import { Button } from "../ui/button";
import { useToast } from "../ui/toast";
import { formatDuration } from "./estimates";

type PipelinePreset =
  | "keep"
  | "default"
  | "vlm_on"
  | "ocr_rapidocr"
  | "tables_off"
  | "ocr_off";

const PIPELINE_PRESETS: Record<Exclude<PipelinePreset, "keep">, PipelineParams> = {
  default: {},
  vlm_on: { vlm: { enabled: true, model: "granite_docling" } },
  ocr_rapidocr: { ocr: { enabled: true, engine: "rapidocr" } },
  tables_off: { tables: { enabled: false } },
  ocr_off: { ocr: { enabled: false, engine: "tesseract" } },
};

const PRESET_LABELS: Record<PipelinePreset, string> = {
  keep: "— no retry —",
  default: "Retry: default",
  vlm_on: "Retry with vision",
  ocr_rapidocr: "Retry with RapidOCR",
  tables_off: "Retry without tables",
  ocr_off: "Retry without OCR",
};

interface Failure {
  source_path?: string;
  source_sha256?: string;
  detected_content_type?: string;
  detected_stratum?: string | null;
  error?: string;
  error_category?: string;
  attempt_count?: number;
  retry_with_pipeline?: PipelineParams | null;
  mark_as_excluded?: boolean;
  filemap_folder?: string;
}

interface PendingEdit {
  preset: PipelinePreset;
  mark_as_excluded: boolean;
}

interface Props {
  job: Job;
  outputDir: string;
  onRequestExport: () => void;
  onStartOver: () => void;
  onShowOutliers: () => void;
}

function basename(p: string | undefined): string {
  if (!p) return "";
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

// Recommend a preset given a content type + error category.
function recommendPreset(f: Failure): PipelinePreset {
  const cat = f.error_category ?? "";
  const ct = f.detected_content_type ?? "";
  if (cat === "ocr_low_confidence") return "vlm_on";
  if (cat === "table_extraction") return "tables_off";
  if (cat === "parse_error" || cat === "protected_password") return "keep"; // exclude
  if (cat === "timeout" && ct === "pdf") return "vlm_on";
  return "default";
}

export function PostRunTriage({
  job,
  outputDir,
  onRequestExport,
  onStartOver,
  onShowOutliers,
}: Props) {
  const qc = useQueryClient();
  const toast = useToast();

  const triageQ = useQuery<Triage, ApiError>({
    queryKey: ["triage", outputDir],
    queryFn: () => api.triage(outputDir),
    enabled: !!outputDir && job.status === "completed",
    retry: false,
  });

  const failures = (triageQ.data?.failures ?? []) as Failure[];
  const docsSucceeded = triageQ.data?.docs_succeeded ?? 0;
  const docsFailed = triageQ.data?.docs_failed ?? 0;

  const [edits, setEdits] = useState<Record<string, PendingEdit>>({});

  const pendingCount = useMemo(
    () =>
      Object.values(edits).filter(
        (e) => e.preset !== "keep" || e.mark_as_excluded,
      ).length,
    [edits],
  );

  const duration = useMemo(() => {
    if (!job.started_at || !job.completed_at) return null;
    const a = new Date(job.started_at).getTime();
    const b = new Date(job.completed_at).getTime();
    if (!isFinite(a) || !isFinite(b)) return null;
    return formatDuration((b - a) / 1000);
  }, [job.started_at, job.completed_at]);

  const apply = useMutation({
    mutationFn: async () => {
      const payload = failures
        .map((f) => {
          const e = f.source_sha256 ? edits[f.source_sha256] : undefined;
          if (!e || (e.preset === "keep" && !e.mark_as_excluded)) return null;
          return {
            source_sha256: f.source_sha256 as string,
            retry_with_pipeline:
              e.preset === "keep" ? null : PIPELINE_PRESETS[e.preset],
            mark_as_excluded: e.mark_as_excluded || false,
          };
        })
        .filter(Boolean) as Array<{
        source_sha256: string;
        retry_with_pipeline: PipelineParams | null;
        mark_as_excluded: boolean;
      }>;
      if (payload.length === 0) throw new ApiError(0, "noop", "No edits queued");
      await api.patchTriage(outputDir, payload);
      const summary = await api.retryTriage(outputDir);
      return summary;
    },
    onSuccess: (summary) => {
      toast.push({
        kind: "success",
        title: `Retry complete: ${summary.succeeded} succeeded`,
        detail: `${summary.still_failed} still failed, ${summary.excluded} excluded`,
      });
      setEdits({});
      qc.invalidateQueries({ queryKey: ["triage", outputDir] });
    },
    onError: (err) => {
      const detail =
        err instanceof ApiError ? `${err.code}: ${err.message}` : String(err);
      toast.push({ kind: "danger", title: "Apply retries failed", detail });
    },
  });

  // "Retry all with recommended" — seeds the edits map from recommendPreset.
  const recommendAll = () => {
    const next: Record<string, PendingEdit> = {};
    for (const f of failures) {
      if (!f.source_sha256) continue;
      const preset = recommendPreset(f);
      if (preset === "keep") {
        next[f.source_sha256] = { preset: "keep", mark_as_excluded: true };
      } else {
        next[f.source_sha256] = { preset, mark_as_excluded: false };
      }
    }
    setEdits(next);
  };

  const copyOutputPath = () => {
    if (!outputDir) return;
    navigator.clipboard?.writeText(outputDir).then(
      () => toast.push({ kind: "info", title: "Output path copied" }),
      () => toast.push({ kind: "warning", title: "Couldn't copy — no clipboard" }),
    );
  };

  if (job.status === "failed") {
    return (
      <div className="p-6 max-w-2xl space-y-3">
        <div className="border border-danger rounded bg-danger-bg/30 p-4 space-y-2">
          <div className="font-medium text-danger-fg">Batch failed</div>
          <div className="text-sm text-fg-secondary font-mono">
            {job.error ?? "Unknown error"}
          </div>
        </div>
        <Button variant="primary" onClick={onStartOver}>
          Start new batch
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Action bar */}
      <div
        style={{
          height: 44,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 20px",
          borderBottom: "1px solid var(--b0)",
          background: "var(--s0)",
          flexShrink: 0,
        }}
      >
        <span className="label-eyebrow">Post-run</span>
        <span className="text-fg-disabled" style={{ fontSize: 11 }}>·</span>
        <span className="text-fg-muted" style={{ fontSize: 11 }}>
          {job.status === "cancelled" ? "cancelled in" : "finished in"}
        </span>
        <span className="mono" style={{ fontSize: 11.5, color: "var(--fg1)" }}>
          {duration ?? "—"}
        </span>
        <div style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" onClick={copyOutputPath}>
          Reveal output folder
        </Button>
        <Button size="sm" variant="ghost" onClick={onShowOutliers}>
          Outliers (legacy)
        </Button>
        <Button size="sm" variant="primary" onClick={onRequestExport}>
          Export manifest ↓
        </Button>
        <Button size="sm" variant="secondary" onClick={onStartOver}>
          New batch
        </Button>
      </div>

      <div className="flex-1 overflow-auto" style={{ padding: "32px 40px" }}>
        {triageQ.isLoading && (
          <div className="text-sm text-fg-muted">Loading triage…</div>
        )}
        {triageQ.error && (
          <div
            className="border border-border-default rounded bg-surface-1 p-3 text-sm text-fg-muted"
            style={{ marginBottom: 20 }}
          >
            No triage file yet for{" "}
            <code className="font-mono break-all">{outputDir}</code>. This is
            expected if the batch ran in legacy mode.
            <div className="mt-2">
              <Button size="sm" variant="secondary" onClick={onShowOutliers}>
                View manifest outliers instead
              </Button>
            </div>
          </div>
        )}

        {triageQ.data && (
          <>
            {/* Success headline row */}
            <div
              style={{
                marginBottom: 30,
                display: "flex",
                gap: 28,
                alignItems: "flex-start",
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 1, minWidth: 260 }}>
                <div
                  style={{
                    fontSize: 26,
                    lineHeight: 1.2,
                    letterSpacing: -0.4,
                    fontWeight: 500,
                    marginBottom: 6,
                  }}
                >
                  <span className="num" style={{ color: "var(--ok)" }}>
                    {docsSucceeded.toLocaleString()}
                  </span>
                  <span className="text-fg-muted"> converted cleanly.</span>
                </div>
                <div style={{ fontSize: 14, color: "var(--fg2)" }}>
                  {docsFailed > 0 ? (
                    <>
                      {docsFailed} failure{docsFailed === 1 ? "" : "s"} landed
                      on the triage list below — all addressable. The output
                      folder is ready to point your pyramid at.
                    </>
                  ) : (
                    <>
                      No failures. The output folder is ready to point your
                      pyramid at.
                    </>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <Tile label="succeeded" value={docsSucceeded.toLocaleString()} tone="ok" />
                <Tile
                  label="failed"
                  value={docsFailed.toLocaleString()}
                  tone={docsFailed > 0 ? "warn" : "neutral"}
                />
                <Tile
                  label="output"
                  value={basename(outputDir) || "—"}
                  mono
                />
              </div>
            </div>

            {/* Triage section */}
            {docsFailed > 0 && (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 12,
                  }}
                >
                  <span className="label-eyebrow">Triage</span>
                  <span className="text-fg-muted" style={{ fontSize: 11 }}>
                    — pick a fix, I&apos;ll retry just these
                  </span>
                  <div style={{ flex: 1 }} />
                  {pendingCount > 0 && (
                    <span
                      className="mono text-fg-muted"
                      style={{ fontSize: 11 }}
                    >
                      {pendingCount} edit{pendingCount === 1 ? "" : "s"} queued
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={recommendAll}
                    title="Fill all rows with recommended fix"
                  >
                    Retry all with recommended
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={pendingCount === 0 || apply.isPending}
                    onClick={() => apply.mutate()}
                  >
                    {apply.isPending ? "Applying…" : "Apply retries ⏎"}
                  </Button>
                </div>

                {/* Triage table card */}
                <div
                  style={{
                    background: "var(--s1)",
                    border: "1px solid var(--b0)",
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  {/* Header row */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.6fr 130px 70px 220px",
                      padding: "9px 14px",
                      gap: 12,
                      borderBottom: "1px solid var(--b0)",
                      fontFamily: "JetBrains Mono, monospace",
                      fontSize: 10.5,
                      color: "var(--fg2)",
                      letterSpacing: 0.4,
                      textTransform: "uppercase",
                    }}
                  >
                    <span>file</span>
                    <span>reason</span>
                    <span>tries</span>
                    <span>fix</span>
                  </div>
                  {failures.map((f) => (
                    <TriageRow
                      key={(f.source_sha256 || "") + (f.source_path || "")}
                      f={f}
                      edit={
                        (f.source_sha256 && edits[f.source_sha256]) || {
                          preset: "keep",
                          mark_as_excluded: false,
                        }
                      }
                      onChange={(next) => {
                        const sha = f.source_sha256;
                        if (!sha) return;
                        setEdits((prev) => ({ ...prev, [sha]: next }));
                      }}
                    />
                  ))}
                </div>
              </>
            )}

            {/* "Next" card */}
            {outputDir && (
              <div
                style={{
                  marginTop: 28,
                  padding: "14px 18px",
                  background: "var(--s1)",
                  border: "1px solid var(--b0)",
                  borderRadius: 8,
                }}
              >
                <div className="label-eyebrow" style={{ marginBottom: 6 }}>
                  Next
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--fg1)",
                    lineHeight: 1.55,
                  }}
                >
                  Open{" "}
                  <span className="mono" style={{ color: "var(--fg0)" }}>
                    Wire Node
                  </span>{" "}
                  and add{" "}
                  <span className="mono" style={{ color: "var(--gold)" }}>
                    {outputDir}
                  </span>{" "}
                  as a corpus. Your pyramid build will find the manifest
                  automatically.
                </div>
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                  <Button size="sm" onClick={copyOutputPath}>
                    Copy output path
                  </Button>
                  <Button size="sm" variant="ghost" onClick={onRequestExport}>
                    Open in Wire Node →
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
  mono,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "neutral";
  mono?: boolean;
}) {
  const color =
    tone === "ok"
      ? "var(--ok)"
      : tone === "warn"
        ? "var(--warn)"
        : "var(--fg0)";
  return (
    <div
      style={{
        padding: "10px 14px",
        minWidth: 100,
        background: "var(--s1)",
        border: "1px solid var(--b0)",
        borderRadius: 8,
      }}
    >
      <div
        className="label-eyebrow"
        style={{ fontSize: 9.5, marginBottom: 4 }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 600,
          color,
          fontFamily: mono
            ? "JetBrains Mono, monospace"
            : "Inter, system-ui, sans-serif",
          letterSpacing: -0.2,
        }}
        className={mono ? "truncate" : undefined}
        title={mono ? value : undefined}
      >
        {value}
      </div>
    </div>
  );
}

function TriageRow({
  f,
  edit,
  onChange,
}: {
  f: Failure;
  edit: PendingEdit;
  onChange: (e: PendingEdit) => void;
}) {
  const reasonTone =
    f.error_category === "parse_error" ||
    f.error_category === "protected_password"
      ? "danger"
      : "warn";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.6fr 130px 70px 220px",
        padding: "11px 14px",
        gap: 12,
        borderBottom: "1px solid var(--b0)",
        alignItems: "center",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          className="mono truncate"
          style={{ fontSize: 12, color: "var(--fg0)" }}
          title={f.source_path}
        >
          {basename(f.source_path)}
        </div>
        <div
          className="mono"
          style={{ fontSize: 10.5, color: "var(--fg3)" }}
        >
          {f.detected_content_type ?? "unknown"}
        </div>
      </div>
      <div>
        <span
          className="mono"
          style={{
            fontSize: 10.5,
            padding: "2px 7px",
            borderRadius: 10,
            background:
              reasonTone === "danger" ? "var(--danger-soft)" : "var(--warn-soft)",
            color:
              reasonTone === "danger" ? "var(--danger)" : "var(--warn)",
            whiteSpace: "nowrap",
          }}
        >
          {f.error_category ?? "error"}
        </span>
      </div>
      <div
        className="num mono"
        style={{ fontSize: 12, color: "var(--fg2)" }}
      >
        {f.attempt_count ?? 1}
      </div>
      <div>
        <FixDropdown edit={edit} onChange={onChange} />
      </div>
    </div>
  );
}

function FixDropdown({
  edit,
  onChange,
}: {
  edit: PendingEdit;
  onChange: (e: PendingEdit) => void;
}) {
  // Decide badge appearance based on current edit state.
  let tone: "cyan" | "neutral" | "ghost" = "ghost";
  let label = "Pick fix…";
  if (edit.mark_as_excluded) {
    tone = "neutral";
    label = "× Exclude from corpus";
  } else if (edit.preset !== "keep") {
    tone = "cyan";
    label = "↻ " + PRESET_LABELS[edit.preset];
  }

  // Inline select overlay — native select for reliability.
  const style =
    tone === "cyan"
      ? {
          background: "var(--cyan-soft)",
          color: "var(--cyan)",
          border: "1px solid rgba(34, 211, 238, 0.3)",
        }
      : tone === "neutral"
        ? {
            background: "var(--s3)",
            color: "var(--fg1)",
            border: "1px solid var(--b1)",
          }
        : {
            background: "transparent",
            color: "var(--fg2)",
            border: "1px dashed var(--b1)",
          };

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <span
        className="mono"
        style={{
          fontSize: 11,
          padding: "4px 10px",
          borderRadius: 12,
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          ...style,
        }}
      >
        {label}
      </span>
      <select
        value={edit.mark_as_excluded ? "__exclude__" : edit.preset}
        onChange={(ev) => {
          const v = ev.target.value;
          if (v === "__exclude__") {
            onChange({ preset: "keep", mark_as_excluded: true });
          } else {
            onChange({
              preset: v as PipelinePreset,
              mark_as_excluded: false,
            });
          }
        }}
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0,
          cursor: "pointer",
          width: "100%",
          height: "100%",
        }}
        aria-label="Pick fix"
      >
        {(Object.keys(PRESET_LABELS) as PipelinePreset[]).map((k) => (
          <option key={k} value={k}>
            {PRESET_LABELS[k]}
          </option>
        ))}
        <option value="__exclude__">× Exclude from corpus</option>
      </select>
    </div>
  );
}
