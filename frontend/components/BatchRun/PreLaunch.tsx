"use client";

/**
 * Pre-launch view: shown when a locked taste_session exists but no job is
 * running yet. Summarizes strata + their pipelines, estimates total runtime,
 * and lets the user fire off the batch.
 */

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { TasteSession, Stratum } from "../../lib/api-client";
import { api, ApiError } from "../../lib/api-client";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useToast } from "../ui/toast";
import { useAppState } from "../shell/app-state";
import { estimateStratum, formatDuration } from "./estimates";
import { sessionStore } from "./session-store";

function pipelineSummary(p: TasteSession["strata"][number]["pipeline"]): string {
  const bits: string[] = [];
  if (p.ocr?.enabled) bits.push(`ocr:${p.ocr.engine}`);
  else bits.push("ocr:off");
  if (p.vlm?.enabled) bits.push(`vlm:${p.vlm.model}`);
  if (p.tables?.enabled) bits.push("tables");
  const enrich = [
    p.enrichments?.formulas && "formulas",
    p.enrichments?.code && "code",
    p.enrichments?.charts && "charts",
  ].filter(Boolean);
  if (enrich.length) bits.push(`enrich:${enrich.join(",")}`);
  return bits.join(" · ");
}

interface Props {
  session: TasteSession;
  onJobCreated: (jobId: string) => void;
}

export function PreLaunch({ session, onJobCreated }: Props) {
  const { scan } = useAppState();
  const toast = useToast();

  const [outputDir, setOutputDir] = useState(
    sessionStore.getOutputDir() || session.output_dir || "",
  );
  const [allowUnlocked, setAllowUnlocked] = useState(false);

  // Stratum-size lookup from the scan (taste_session.strata carries name + size
  // but we cross-reference the scan's stratum for page-bin hints).
  const scanStrata: Record<string, Stratum> = useMemo(() => {
    const map: Record<string, Stratum> = {};
    for (const s of scan?.strata ?? []) map[s.name] = s;
    return map;
  }, [scan]);

  const estimates = useMemo(() => {
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

  const anyUnlocked = session.strata.some((s) => !s.locked);
  const anyLocked = session.strata.some((s) => s.locked);
  const canLaunch = outputDir.trim() !== "" && anyLocked;

  const launch = useMutation({
    mutationFn: async () => {
      // Include only locked strata unless the user ticked "Run anyway".
      const strata = allowUnlocked
        ? session.strata
        : session.strata.filter((s) => s.locked);
      const job = await api.batch({
        scan_id: session.scan_id,
        output_dir: outputDir,
        concurrency: 2,
        stratum_pipelines: strata.map((s) => ({
          stratum: s.name,
          pipeline: s.pipeline,
        })),
      });
      return job;
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

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div>
        <div className="text-xs uppercase tracking-wider text-fg-muted">
          Pre-launch
        </div>
        <h1 className="text-lg font-semibold font-mono break-all">
          {session.folder_root}
        </h1>
        <div className="text-sm text-fg-secondary mt-1">
          <span className="tabular-nums">{session.strata.length}</span>{" "}
          {session.strata.length === 1 ? "stratum" : "strata"} ·{" "}
          <span className="tabular-nums">
            {session.strata.filter((s) => s.locked).length}
          </span>{" "}
          locked
        </div>
      </div>

      {anyUnlocked && (
        <div className="border border-warning rounded bg-warning-bg/30 p-3 text-sm">
          <div className="font-medium text-warning-fg">
            Some strata are unlocked
          </div>
          <div className="text-fg-secondary mt-1">
            Unlocked strata don&apos;t have a committed pipeline yet. Best
            practice: lock them in Taste first. You can run anyway using the
            current (unlocked) pipeline.
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
          const row = estimates.rows.find((r) => r.name === s.name);
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
                  {s.status === "converged" && (
                    <Badge tone="info">converged</Badge>
                  )}
                </div>
                <div className="text-xs text-fg-muted mt-0.5">
                  {s.size} files · {pipelineSummary(s.pipeline) || "defaults"}
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
            Estimated runtime:{" "}
            <span className="font-mono text-fg-primary tabular-nums">
              {formatDuration(estimates.bestTotal)} –{" "}
              {formatDuration(estimates.likelyTotal)}
            </span>
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
        {!anyLocked && (
          <div className="text-xs text-warning-fg">
            No locked strata yet. Lock at least one in Taste.
          </div>
        )}
      </div>
    </div>
  );
}
