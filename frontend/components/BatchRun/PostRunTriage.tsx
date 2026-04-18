"use client";

/**
 * PostRunTriage — Level B post-run UX backed by triage.yaml.
 *
 * - Top summary from /triage (succeeded/failed/by_reason/by_content_type)
 * - Failures table with per-row `retry_with_pipeline` preset picker + exclude
 * - "Apply retries" writes user edits back via PATCH /triage, then POSTs
 *   /triage/retry to actually re-run + exclude.
 * - Falls back to legacy manifest-outlier view via the "Show outliers" button.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Job, PipelineParams, Triage } from "../../lib/api-client";
import { api, ApiError } from "../../lib/api-client";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { useToast } from "../ui/toast";
import { formatDuration } from "./estimates";

type PipelinePreset = "keep" | "default" | "vlm_on" | "ocr_rapidocr" | "tables_off" | "ocr_off";

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
  vlm_on: "Retry: VLM on",
  ocr_rapidocr: "Retry: RapidOCR",
  tables_off: "Retry: tables off",
  ocr_off: "Retry: OCR off",
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
  const byReason = (triageQ.data?.by_reason ?? {}) as Record<string, number>;
  const byCt = (triageQ.data?.by_content_type ?? {}) as Record<string, number>;
  const docsSucceeded = triageQ.data?.docs_succeeded ?? 0;
  const docsFailed = triageQ.data?.docs_failed ?? 0;
  const retryAvailable = failures.length;

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
    <div className="p-6 space-y-5 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-fg-muted">
            Post-run · triage
          </div>
          <h1 className="text-lg font-semibold">
            {job.status === "cancelled" ? "Cancelled" : "Completed"}
            {duration && (
              <span className="text-fg-muted font-normal ml-2 text-base">
                in {duration}
              </span>
            )}
          </h1>
          <div className="text-sm text-fg-secondary mt-1">
            <span className="tabular-nums">{docsSucceeded}</span> succeeded
            {docsFailed > 0 && (
              <>
                ,{" "}
                <span className="text-danger-fg tabular-nums">{docsFailed}</span>{" "}
                failed
              </>
            )}
            ,{" "}
            <span className="tabular-nums">{retryAvailable}</span> retry-eligible
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onShowOutliers}>
            Show outliers (legacy)
          </Button>
          <Button variant="primary" onClick={onRequestExport}>
            Export
          </Button>
          <Button variant="secondary" onClick={onStartOver}>
            New batch
          </Button>
        </div>
      </div>

      {triageQ.isLoading && (
        <div className="text-sm text-fg-muted">Loading triage…</div>
      )}
      {triageQ.error && (
        <div className="border border-border-default rounded bg-surface-1 p-3 text-sm text-fg-muted">
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

      {triageQ.data && docsFailed === 0 && (
        <div className="border border-success rounded bg-success-bg/20 p-4">
          <div className="font-medium text-success-fg">
            No failures — every doc converted cleanly.
          </div>
        </div>
      )}

      {triageQ.data && docsFailed > 0 && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="border border-border-default rounded bg-surface-1 p-3">
              <div className="text-xs uppercase tracking-wider text-fg-muted mb-2">
                By reason
              </div>
              {Object.entries(byReason).map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between py-0.5 text-sm"
                >
                  <span className="font-mono text-fg-primary">{k}</span>
                  <span className="tabular-nums text-fg-muted">{v}</span>
                </div>
              ))}
            </div>
            <div className="border border-border-default rounded bg-surface-1 p-3">
              <div className="text-xs uppercase tracking-wider text-fg-muted mb-2">
                By content type
              </div>
              {Object.entries(byCt)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-center justify-between py-0.5 text-sm"
                  >
                    <span className="font-mono text-fg-primary">{k}</span>
                    <span className="tabular-nums text-fg-muted">{v}</span>
                  </div>
                ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="text-xs uppercase tracking-wider text-fg-muted">
                Failures
              </div>
              <div className="flex-1" />
              {pendingCount > 0 && (
                <span className="text-xs text-fg-muted font-mono">
                  {pendingCount} edit{pendingCount === 1 ? "" : "s"} queued
                </span>
              )}
              <Button
                size="sm"
                variant="primary"
                disabled={pendingCount === 0 || apply.isPending}
                onClick={() => apply.mutate()}
              >
                {apply.isPending ? "Applying…" : "Apply retries"}
              </Button>
            </div>

            {failures.map((f) => {
              const sha = f.source_sha256 ?? "";
              const e = edits[sha] ?? { preset: "keep" as const, mark_as_excluded: false };
              const modified = e.preset !== "keep" || e.mark_as_excluded;
              return (
                <div
                  key={sha || f.source_path}
                  className={`p-2 rounded border ${
                    modified
                      ? "border-info bg-info-bg/20"
                      : "border-border-default bg-surface-1"
                  }`}
                >
                  <div
                    className="font-mono text-xs break-all text-fg-primary"
                    title={f.source_path}
                  >
                    {f.source_path}
                  </div>
                  <div className="text-xs text-fg-muted mt-0.5 flex items-center gap-2 flex-wrap">
                    {f.detected_content_type && (
                      <Badge tone="neutral">{f.detected_content_type}</Badge>
                    )}
                    {f.error_category && (
                      <Badge tone="warning">{f.error_category}</Badge>
                    )}
                    <span className="tabular-nums">
                      attempts: {f.attempt_count ?? 1}
                    </span>
                    <details className="flex-1 min-w-0">
                      <summary className="cursor-pointer truncate max-w-md">
                        {f.error ?? "—"}
                      </summary>
                      <pre className="mt-1 text-[10px] text-fg-muted whitespace-pre-wrap break-all">
                        {f.error ?? ""}
                      </pre>
                    </details>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <select
                      className="text-xs bg-surface-0 border border-border-default rounded px-2 py-1"
                      value={e.preset}
                      onChange={(ev) =>
                        setEdits((prev) => ({
                          ...prev,
                          [sha]: {
                            ...e,
                            preset: ev.target.value as PipelinePreset,
                          },
                        }))
                      }
                      disabled={e.mark_as_excluded}
                    >
                      {(Object.keys(PRESET_LABELS) as PipelinePreset[]).map((k) => (
                        <option key={k} value={k}>
                          {PRESET_LABELS[k]}
                        </option>
                      ))}
                    </select>
                    <label className="text-xs text-fg-muted flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={e.mark_as_excluded}
                        onChange={(ev) =>
                          setEdits((prev) => ({
                            ...prev,
                            [sha]: {
                              ...e,
                              mark_as_excluded: ev.target.checked,
                            },
                          }))
                        }
                        className="h-3 w-3"
                      />
                      Exclude
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
