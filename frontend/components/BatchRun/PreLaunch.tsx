"use client";

/**
 * Pre-launch view: Level B filemap-mode plan.
 *
 * Walks /filetree for the scanned root, pulls /filemap for every folder that
 * has one, aggregates per-content-type counts, and lets the user set a
 * pipeline selector per content type before dispatch. POSTs the new
 * { root, output_dir, pipeline_by_content_type } batch body.
 *
 * Advanced toggle: fall back to the legacy locked-taste-session shape
 * (scan_id + stratum_pipelines) for anyone still driving that flow.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import type {
  Filemap,
  FiletreeNode,
  PipelineParams,
  Stratum,
  TasteSession,
} from "../../lib/api-client";
import { api, ApiError } from "../../lib/api-client";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useToast } from "../ui/toast";
import { useAppState } from "../shell/app-state";
import { estimateStratum, formatDuration } from "./estimates";
import { sessionStore } from "./session-store";

type PipelinePreset =
  | "default"
  | "vlm_on"
  | "ocr_rapidocr"
  | "tables_off"
  | "ocr_off";

const PIPELINE_PRESETS: Record<PipelinePreset, PipelineParams> = {
  default: {},
  vlm_on: { vlm: { enabled: true, model: "granite_docling" } },
  ocr_rapidocr: { ocr: { enabled: true, engine: "rapidocr" } },
  tables_off: { tables: { enabled: false } },
  ocr_off: { ocr: { enabled: false, engine: "tesseract" } },
};

const PRESET_LABELS: Record<PipelinePreset, string> = {
  default: "Default",
  vlm_on: "VLM on",
  ocr_rapidocr: "OCR: RapidOCR",
  tables_off: "Tables off",
  ocr_off: "OCR off",
};

const CONTENT_TYPE_LABELS: Record<string, string> = {
  pdf: "PDF",
  docx: "DOCX",
  pptx: "PPTX",
  xlsx: "XLSX",
  html: "HTML",
  md: "Markdown",
  text: "Text",
  latex: "LaTeX",
};

function pipelineSummary(p: PipelineParams | undefined | null): string {
  if (!p) return "default";
  const bits: string[] = [];
  if (p.ocr?.enabled) bits.push(`ocr:${p.ocr.engine ?? "tesseract"}`);
  else if (p.ocr?.enabled === false) bits.push("ocr:off");
  if (p.vlm?.enabled) bits.push(`vlm:${p.vlm.model ?? "granite_docling"}`);
  if (p.tables?.enabled === false) bits.push("tables:off");
  return bits.length ? bits.join(" · ") : "default";
}

// ── folder discovery ─────────────────────────────────────────────────────────

function collectFolderPaths(tree: FiletreeNode | undefined | null): string[] {
  if (!tree) return [];
  const out: string[] = [];
  const walk = (n: FiletreeNode) => {
    if (n.filemap && n.path) out.push(n.path);
    for (const c of n.children ?? []) walk(c);
  };
  walk(tree);
  return out;
}

type FileIncludeStatus = "included" | "pending" | "excluded";

interface FileRow {
  folder: string;
  path: string; // basename
  content_type: string;
  stratum: string | null;
  status: FileIncludeStatus;
}

function aggregateFiles(filemaps: Array<{ folder: string; fm: Filemap | null }>): {
  rows: FileRow[];
  byContentType: Record<string, { included: number; pending: number; excluded: number }>;
} {
  const rows: FileRow[] = [];
  const byCt: Record<string, { included: number; pending: number; excluded: number }> = {};

  for (const { folder, fm } of filemaps) {
    if (!fm) continue;
    const files = (fm as unknown as { files?: Array<Record<string, unknown>> }).files ?? [];
    for (const f of files) {
      const ui = f.user_included as boolean | null | undefined;
      const sugg = f.scanner_suggestion as string | undefined;
      let status: FileIncludeStatus;
      if (ui === true) status = "included";
      else if (ui === false) status = "excluded";
      else status = sugg === "include" ? "included" : "pending";

      const ct =
        (f.user_content_type as string | undefined) ||
        (f.detected_content_type as string | undefined) ||
        "unknown";
      rows.push({
        folder,
        path: (f.path as string) ?? "",
        content_type: ct,
        stratum: (f.detected_stratum as string | null | undefined) ?? null,
        status,
      });
      if (!byCt[ct]) byCt[ct] = { included: 0, pending: 0, excluded: 0 };
      byCt[ct][status] += 1;
    }
  }
  return { rows, byContentType: byCt };
}

// ── concurrency-bounded filemap fetch via useQueries ─────────────────────────

function useFilemaps(folders: string[]) {
  const queries = useQueries({
    queries: folders.map((folder) => ({
      queryKey: ["filemap", folder],
      queryFn: () => api.filemap(folder),
      staleTime: 30_000,
    })),
  });
  const loading = queries.some((q) => q.isLoading);
  const errors = queries.map((q) => q.error).filter(Boolean) as ApiError[];
  const filemaps = folders.map((folder, i) => ({
    folder,
    fm: (queries[i]?.data as Filemap | undefined) ?? null,
  }));
  return { filemaps, loading, errors };
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  session: TasteSession;
  onJobCreated: (jobId: string) => void;
}

export function PreLaunch({ session, onJobCreated }: Props) {
  const { scan, folder } = useAppState();
  const toast = useToast();

  const root = folder || scan?.folder || session.folder_root || "";

  const [outputDir, setOutputDir] = useState(
    sessionStore.getOutputDir() || session.output_dir || (root ? `${root}/.docling-out` : ""),
  );
  const [includePending, setIncludePending] = useState(true);
  const [ctPreset, setCtPreset] = useState<Record<string, PipelinePreset>>({});
  const [useLegacy, setUseLegacy] = useState(false);
  const [allowUnlocked, setAllowUnlocked] = useState(false);

  // ── Filemap mode: fetch filetree + per-folder filemaps ───────────────────
  const filetreeQ = useQuery<FiletreeNode, ApiError>({
    queryKey: ["filetree", root],
    queryFn: () => api.filetree(root),
    enabled: !!root && !useLegacy,
    staleTime: 15_000,
  });

  const folders = useMemo(() => collectFolderPaths(filetreeQ.data), [filetreeQ.data]);
  const { filemaps, loading: filemapsLoading } = useFilemaps(useLegacy ? [] : folders);

  const { rows, byContentType } = useMemo(
    () => aggregateFiles(filemaps),
    [filemaps],
  );

  const totalIncluded = useMemo(
    () => rows.filter((r) => r.status === "included").length,
    [rows],
  );
  const totalPending = useMemo(
    () => rows.filter((r) => r.status === "pending").length,
    [rows],
  );

  const effectiveTotal = totalIncluded + (includePending ? totalPending : 0);

  // ── Legacy mode: reuse the old taste-session plan ─────────────────────────
  const scanStrata: Record<string, Stratum> = useMemo(() => {
    const map: Record<string, Stratum> = {};
    for (const s of scan?.strata ?? []) map[s.name] = s;
    return map;
  }, [scan]);

  const legacyEstimates = useMemo(() => {
    const rows = session.strata.map((ss) => {
      const scanSx = scanStrata[ss.name];
      const source: Stratum = scanSx ?? {
        name: ss.name,
        size: ss.size,
        sample_size_hint: Math.min(5, ss.size),
        example_paths: [],
      };
      const est = estimateStratum({ stratum: source, pipeline: ss.pipeline });
      return { name: ss.name, est };
    });
    const bestTotal = rows.reduce((n, r) => n + r.est.bestSec, 0);
    const likelyTotal = rows.reduce((n, r) => n + r.est.likelySec, 0);
    return { rows, bestTotal, likelyTotal };
  }, [session.strata, scanStrata]);

  const anyLocked = session.strata.some((s) => s.locked);
  const anyUnlocked = session.strata.some((s) => !s.locked);

  // Drop pipeline_by_content_type entries for presets === "default".
  const pipelineByContentType = useMemo(() => {
    const out: Record<string, PipelineParams> = {};
    for (const [ct, preset] of Object.entries(ctPreset)) {
      if (preset && preset !== "default") out[ct] = PIPELINE_PRESETS[preset];
    }
    return out;
  }, [ctPreset]);

  // ── Launch ─────────────────────────────────────────────────────────────
  const launch = useMutation({
    mutationFn: async () => {
      if (useLegacy) {
        const strata = allowUnlocked
          ? session.strata
          : session.strata.filter((s) => s.locked);
        return api.batch({
          scan_id: session.scan_id,
          output_dir: outputDir,
          concurrency: 2,
          stratum_pipelines: strata.map((s) => ({
            stratum: s.name,
            pipeline: s.pipeline,
          })),
        });
      }
      if (!root) throw new ApiError(0, "no_root", "Scan root unavailable");
      // Before dispatch, optionally bulk-flip user_included=true for pending
      // files in the aggregated set. Keep this client-side to avoid a new
      // backend endpoint; use existing PATCH /filemap per folder.
      if (includePending) {
        const pendingByFolder: Record<string, string[]> = {};
        for (const row of rows) {
          if (row.status !== "pending") continue;
          if (!pendingByFolder[row.folder]) pendingByFolder[row.folder] = [];
          pendingByFolder[row.folder].push(row.path);
        }
        await Promise.all(
          Object.entries(pendingByFolder).map(async ([f, paths]) => {
            try {
              await api.patchFilemap(f, {
                files: paths.map((p) => ({ path: p, user_included: true })),
              });
            } catch {
              /* best-effort */
            }
          }),
        );
      }
      return api.batch({
        output_dir: outputDir,
        concurrency: 2,
        root,
        pipeline_by_content_type: pipelineByContentType,
      });
    },
    onSuccess: (job) => {
      sessionStore.setOutputDir(outputDir);
      sessionStore.setJobId(job.id);
      onJobCreated(job.id);
    },
    onError: (err) => {
      const detail =
        err instanceof ApiError ? `${err.code}: ${err.message}` : String(err);
      toast.push({ kind: "danger", title: "Batch start failed", detail });
    },
  });

  const canLaunch = useLegacy
    ? outputDir.trim() !== "" && anyLocked
    : outputDir.trim() !== "" && effectiveTotal > 0;

  // ── Render ─────────────────────────────────────────────────────────────
  useEffect(() => {
    // noop; placeholder for future effects
  }, []);

  const contentTypeEntries = useMemo(
    () => Object.entries(byContentType).sort((a, b) => b[1].included - a[1].included),
    [byContentType],
  );

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-fg-muted">
            Pre-launch
          </div>
          <h1 className="text-lg font-semibold font-mono break-all">{root}</h1>
          <div className="text-sm text-fg-secondary mt-1">
            {useLegacy ? (
              <>
                Legacy stratum mode ·{" "}
                <span className="tabular-nums">{session.strata.length}</span>{" "}
                {session.strata.length === 1 ? "stratum" : "strata"} ·{" "}
                <span className="tabular-nums">
                  {session.strata.filter((s) => s.locked).length}
                </span>{" "}
                locked
              </>
            ) : (
              <>
                Filemap mode ·{" "}
                <span className="tabular-nums">{effectiveTotal}</span> files to
                build{" "}
                {totalPending > 0 && (
                  <span className="text-fg-muted">
                    ({totalIncluded} included, {totalPending} pending)
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        <label className="text-xs text-fg-muted flex items-center gap-1.5 mt-1">
          <input
            type="checkbox"
            checked={useLegacy}
            onChange={(e) => setUseLegacy(e.target.checked)}
            className="h-3 w-3"
          />
          Use locked-taste-session pipelines (legacy)
        </label>
      </div>

      {!useLegacy && (filetreeQ.isLoading || filemapsLoading) && (
        <div className="text-sm text-fg-muted">Loading filemap plan…</div>
      )}
      {!useLegacy && filetreeQ.error && (
        <div className="text-sm text-danger-fg">
          Couldn&apos;t load filetree: {filetreeQ.error.message}
        </div>
      )}

      {!useLegacy &&
        !filetreeQ.isLoading &&
        !filemapsLoading &&
        filetreeQ.data && (
          <>
            {totalPending > 0 && (
              <div className="border border-warning rounded bg-warning-bg/30 p-3 text-sm">
                <div className="font-medium text-warning-fg">
                  {totalPending} files are not explicitly checked
                </div>
                <div className="text-fg-secondary mt-1">
                  Scanner suggests include, but the user hasn&apos;t confirmed.
                  Include them in the run?
                </div>
                <label className="mt-2 flex items-center gap-2 text-xs text-fg-secondary">
                  <input
                    type="checkbox"
                    checked={includePending}
                    onChange={(e) => setIncludePending(e.target.checked)}
                    className="h-3 w-3"
                  />
                  Include pending files (flips their{" "}
                  <code className="font-mono">user_included</code> to true on
                  launch)
                </label>
              </div>
            )}

            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-fg-muted">
                By content type
              </div>
              {contentTypeEntries.length === 0 && (
                <div className="text-sm text-fg-muted">
                  No filemap entries found under this root.
                </div>
              )}
              {contentTypeEntries.map(([ct, counts]) => {
                const effCount =
                  counts.included + (includePending ? counts.pending : 0);
                const preset = ctPreset[ct] ?? "default";
                return (
                  <div
                    key={ct}
                    className="flex items-center gap-4 p-3 rounded border border-border-default bg-surface-1"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-mono text-sm text-fg-primary">
                          {CONTENT_TYPE_LABELS[ct] ?? ct}
                        </div>
                        <Badge tone="info">{effCount} files</Badge>
                        {counts.pending > 0 && (
                          <Badge tone="warning">{counts.pending} pending</Badge>
                        )}
                        {counts.excluded > 0 && (
                          <Badge tone="neutral">
                            {counts.excluded} excluded
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-fg-muted mt-0.5">
                        pipeline: {pipelineSummary(PIPELINE_PRESETS[preset])}
                      </div>
                    </div>
                    <select
                      className="text-xs bg-surface-0 border border-border-default rounded px-2 py-1"
                      value={preset}
                      onChange={(e) =>
                        setCtPreset((prev) => ({
                          ...prev,
                          [ct]: e.target.value as PipelinePreset,
                        }))
                      }
                    >
                      {(Object.keys(PIPELINE_PRESETS) as PipelinePreset[]).map(
                        (k) => (
                          <option key={k} value={k}>
                            {PRESET_LABELS[k]}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                );
              })}
            </div>
          </>
        )}

      {useLegacy && (
        <>
          {anyUnlocked && (
            <div className="border border-warning rounded bg-warning-bg/30 p-3 text-sm">
              <div className="font-medium text-warning-fg">
                Some strata are unlocked
              </div>
              <div className="text-fg-secondary mt-1">
                Best practice: lock them in Taste first. You can run anyway
                using the current (unlocked) pipeline.
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs text-fg-secondary">
                <input
                  type="checkbox"
                  checked={allowUnlocked}
                  onChange={(e) => setAllowUnlocked(e.target.checked)}
                  className="h-3 w-3"
                />
                Run anyway (include unlocked strata)
              </label>
            </div>
          )}
          <div className="space-y-2">
            {session.strata.map((s) => {
              const row = legacyEstimates.rows.find((r) => r.name === s.name);
              return (
                <div
                  key={s.name}
                  className="flex items-start gap-4 p-3 rounded border border-border-default bg-surface-1"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-mono text-sm text-fg-primary">
                        {s.name}
                      </div>
                      {s.locked ? (
                        <Badge tone="success">locked</Badge>
                      ) : (
                        <Badge tone="warning">unlocked</Badge>
                      )}
                    </div>
                    <div className="text-xs text-fg-muted mt-0.5">
                      {s.size} files · {pipelineSummary(s.pipeline)}
                    </div>
                  </div>
                  <div className="text-xs text-fg-muted text-right tabular-nums whitespace-nowrap">
                    {row
                      ? `${formatDuration(row.est.bestSec)} – ${formatDuration(
                          row.est.likelySec,
                        )}`
                      : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="border border-border-default rounded bg-surface-1 p-3 space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-fg-muted mb-1">
            Output directory
          </div>
          <Input
            value={outputDir}
            onChange={(e) => setOutputDir(e.target.value)}
            placeholder="/absolute/path/to/output"
            spellCheck={false}
          />
        </div>
        <div className="flex items-center justify-between gap-4 pt-2 border-t border-border-default">
          <div className="text-sm text-fg-secondary">
            {useLegacy ? (
              <>
                Estimated runtime:{" "}
                <span className="font-mono text-fg-primary tabular-nums">
                  {formatDuration(legacyEstimates.bestTotal)} –{" "}
                  {formatDuration(legacyEstimates.likelyTotal)}
                </span>
              </>
            ) : (
              <>
                {effectiveTotal} docs ·{" "}
                {Object.keys(pipelineByContentType).length} custom pipeline
                {Object.keys(pipelineByContentType).length === 1 ? "" : "s"}
              </>
            )}
          </div>
          <Button
            variant="primary"
            disabled={!canLaunch || launch.isPending}
            onClick={() => launch.mutate()}
          >
            {launch.isPending ? "Starting…" : "Start batch"}
          </Button>
        </div>
        {!outputDir.trim() && (
          <div className="text-xs text-warning-fg">
            Set an output directory before starting.
          </div>
        )}
        {useLegacy && !anyLocked && (
          <div className="text-xs text-warning-fg">
            No locked strata yet. Lock at least one in Taste.
          </div>
        )}
        {!useLegacy && effectiveTotal === 0 && !filemapsLoading && (
          <div className="text-xs text-warning-fg">
            No files selected. Either include pending files or mark files in
            Taste / Scan.
          </div>
        )}
      </div>
    </div>
  );
}
