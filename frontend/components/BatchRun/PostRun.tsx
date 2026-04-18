"use client";

/**
 * Post-run review: shown once a batch is completed/cancelled/failed.
 *
 * Fetches manifest, surfaces outliers per thresholds defined in the build plan
 * (OCR avg < 0.7, warnings > 0, empty_page_count > 0, or status=error), and
 * opens a read-only <VizDiff /> for inspection when the user clicks "Review".
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Job, Manifest, DocMeta } from "../../lib/api-client";
import { api, ApiError } from "../../lib/api-client";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { VizDiff } from "../VizDiff";
import { PdfRenderer } from "../Renderers/pdf";
import { pickRenderer } from "../Renderers";
import { makeStubRenderer } from "../VizDiff/fixture";
import type { SourceRenderer, Anchor } from "../../../contracts/vizdiff";
import { formatDuration } from "./estimates";

type ManifestEntry = Manifest["docs"][number];

interface OutlierReason {
  kind: "error" | "ocr_low" | "warnings" | "empty_pages";
  label: string;
}

function computeOutlierReasons(entry: ManifestEntry): OutlierReason[] {
  const reasons: OutlierReason[] = [];
  if (entry.status === "error") {
    reasons.push({ kind: "error", label: "error" });
  }
  const qs = entry.quality_summary;
  if (qs) {
    if (qs.ocr_avg != null && qs.ocr_avg < 0.7) {
      reasons.push({
        kind: "ocr_low",
        label: `ocr ${qs.ocr_avg.toFixed(2)}`,
      });
    }
    if ((qs.warning_count ?? 0) > 0) {
      reasons.push({
        kind: "warnings",
        label: `${qs.warning_count} warn`,
      });
    }
    if ((qs.empty_page_count ?? 0) > 0) {
      reasons.push({
        kind: "empty_pages",
        label: `${qs.empty_page_count} empty`,
      });
    }
  }
  return reasons;
}

interface Props {
  job: Job;
  outputDir: string;
  onRequestExport: () => void;
  onStartOver: () => void;
}

const PAGE_SIZE = 50;

export function PostRun({ job, outputDir, onRequestExport, onStartOver }: Props) {
  const [page, setPage] = useState(0);
  const [reviewHash, setReviewHash] = useState<string | null>(null);

  const manifestQ = useQuery<Manifest, ApiError>({
    queryKey: ["manifest", outputDir],
    queryFn: () => api.manifest(outputDir),
    refetchInterval: false,
  });

  const outliers = useMemo(() => {
    const manifest = manifestQ.data;
    if (!manifest) return [];
    return manifest.docs
      .map((d) => ({ entry: d, reasons: computeOutlierReasons(d) }))
      .filter((r) => r.reasons.length > 0);
  }, [manifestQ.data]);

  const pages = Math.max(1, Math.ceil(outliers.length / PAGE_SIZE));
  const pageItems = outliers.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Duration
  const duration = useMemo(() => {
    if (!job.started_at || !job.completed_at) return null;
    const a = new Date(job.started_at).getTime();
    const b = new Date(job.completed_at).getTime();
    if (!isFinite(a) || !isFinite(b)) return null;
    return formatDuration((b - a) / 1000);
  }, [job.started_at, job.completed_at]);

  const docsDone = job.progress?.docs_done ?? 0;
  const docsFailed = job.progress?.docs_failed ?? 0;

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
            Post-run review
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
            <span className="tabular-nums">{docsDone}</span> converted
            {docsFailed > 0 && (
              <>
                ,{" "}
                <span className="text-danger-fg tabular-nums">
                  {docsFailed}
                </span>{" "}
                failures
              </>
            )}
            {manifestQ.data && (
              <>
                {" · "}
                <span className="tabular-nums">{outliers.length}</span> outlier
                {outliers.length === 1 ? "" : "s"}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={onRequestExport}>
            Export
          </Button>
          <Button variant="secondary" onClick={onStartOver}>
            New batch
          </Button>
        </div>
      </div>

      {manifestQ.isLoading && (
        <div className="text-sm text-fg-muted">Loading manifest…</div>
      )}
      {manifestQ.error && (
        <div className="text-sm text-danger-fg">
          Couldn&apos;t load manifest: {manifestQ.error.message}
        </div>
      )}

      {manifestQ.data && outliers.length === 0 && (
        <div className="border border-success rounded bg-success-bg/20 p-4">
          <div className="font-medium text-success-fg">
            No outliers flagged
          </div>
          <div className="text-sm text-fg-secondary mt-1">
            Every doc passed the quality thresholds (OCR ≥ 0.7, no warnings, no
            empty pages, no errors).
          </div>
        </div>
      )}

      {outliers.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-fg-muted">
            Outliers
          </div>
          {pageItems.map(({ entry, reasons }) => (
            <div
              key={entry.source_sha256}
              className="flex items-center gap-3 p-2 rounded border border-border-default bg-surface-1"
            >
              <div className="flex-1 min-w-0">
                <div
                  className="font-mono text-xs truncate text-fg-primary"
                  title={entry.source_path}
                >
                  {entry.source_path}
                </div>
                <div className="text-xs text-fg-muted mt-0.5 flex items-center gap-2 flex-wrap">
                  <span className="font-mono">{entry.stratum}</span>
                  {reasons.map((r) => (
                    <Badge
                      key={r.kind}
                      tone={r.kind === "error" ? "danger" : "warning"}
                    >
                      {r.label}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={entry.status === "error"}
                onClick={() => setReviewHash(entry.source_sha256)}
              >
                Review
              </Button>
            </div>
          ))}

          {pages > 1 && (
            <div className="flex items-center gap-2 pt-2 text-xs">
              <Button
                variant="ghost"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Prev
              </Button>
              <span className="text-fg-muted tabular-nums">
                {page + 1} / {pages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={page >= pages - 1}
                onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}

      {reviewHash && (
        <OutlierReviewDrawer
          hash={reviewHash}
          outputDir={outputDir}
          onClose={() => setReviewHash(null)}
        />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Read-only VizDiff drawer for outlier inspection.

function OutlierReviewDrawer({
  hash,
  outputDir,
  onClose,
}: {
  hash: string;
  outputDir: string;
  onClose: () => void;
}) {
  const metaQ = useQuery<DocMeta, ApiError>({
    queryKey: ["doc-meta", hash],
    queryFn: () => api.docMeta(hash),
  });
  const mdQ = useQuery<string, ApiError>({
    queryKey: ["doc-md", hash],
    queryFn: () => api.docMarkdown(hash),
  });
  const jsonQ = useQuery<unknown, ApiError>({
    queryKey: ["doc-json", hash],
    queryFn: () => api.docJson(hash),
  });
  const anchorsQ = useQuery<unknown[], ApiError>({
    queryKey: ["doc-anchors", hash],
    queryFn: () => api.docAnchors(hash),
  });

  const loading =
    metaQ.isLoading || mdQ.isLoading || jsonQ.isLoading || anchorsQ.isLoading;
  const error = metaQ.error || mdQ.error || jsonQ.error || anchorsQ.error;

  const meta = metaQ.data;
  const anchors = (anchorsQ.data ?? []) as Anchor[];
  const doclingDoc = jsonQ.data;

  // Construct the source renderer. PDF uses the class-based PdfRenderer
  // (same pattern as /dev/vizdiff); other formats fall back to a stub so
  // the right-pane markdown + JSON review still works.
  const rendererRef = useRef<SourceRenderer | null>(null);
  const isPdf = meta?.source_format === "pdf";
  useEffect(() => {
    if (rendererRef.current) {
      try {
        rendererRef.current.dispose();
      } catch {
        /* noop */
      }
      rendererRef.current = null;
    }
    if (!meta) return;
    if (isPdf) {
      rendererRef.current = new PdfRenderer({
        sourceUrl: api.docSourceUrl(hash),
        anchorsProvider: () => anchors,
        doclingDocProvider: () => doclingDoc,
      });
    } else {
      // Provisional; real renderer is registered by the React renderer below
      // via onRenderer once mounted.
      rendererRef.current = makeStubRenderer();
    }
    return () => {
      try {
        rendererRef.current?.dispose();
      } catch {
        /* noop */
      }
      rendererRef.current = null;
    };
  }, [hash, meta, isPdf, anchors, doclingDoc]);

  const sourceNode = useMemo(() => {
    if (!meta || isPdf) return undefined;
    const Comp = pickRenderer(meta.source_format);
    return (
      <Comp
        hash={hash}
        source_path={meta.source_path}
        sourceUrl={api.docSourceUrl(hash)}
        doclingDoc={doclingDoc}
        anchors={anchors}
        onRenderer={(r) => {
          try {
            rendererRef.current?.dispose?.();
          } catch {
            /* noop */
          }
          rendererRef.current = r;
        }}
        className="absolute inset-0 overflow-auto"
      />
    );
  }, [hash, meta, isPdf, doclingDoc, anchors]);

  // Esc-to-close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-0 border border-border-default rounded w-full h-full max-w-[1400px] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 p-3 border-b border-border-default">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-fg-muted">
              Review (read-only)
            </div>
            <div className="font-mono text-sm truncate">
              {meta?.source_path ?? hash}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close (Esc)
          </Button>
        </div>

        <div className="flex-1 min-h-0 relative">
          {loading && (
            <div className="p-6 text-sm text-fg-muted">Loading doc…</div>
          )}
          {error && (
            <div className="p-6 text-sm text-danger-fg">
              Couldn&apos;t load doc: {error.message}
            </div>
          )}
          {meta && mdQ.data != null && doclingDoc !== undefined && rendererRef.current && (
            <div className="h-full flex flex-col">
              <div className="flex-1 min-h-0">
                <VizDiff
                  doc={{
                    hash,
                    source_path: meta.source_path,
                    source_format: meta.source_format,
                    output_dir: outputDir,
                    doclingDoc,
                    markdown: mdQ.data,
                    anchors,
                    qualityBadges: meta.quality_signals?.warnings ?? [],
                  }}
                  sourceRenderer={rendererRef.current}
                  sourceNode={sourceNode}
                  currentPipeline={meta.pipeline_params}
                  shortcutScope="batchreview"
                  // Read-only: no approve/reject/rerun callbacks.
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
