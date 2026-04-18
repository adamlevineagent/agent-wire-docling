"use client";

/**
 * <BatchRun /> — the stage="batch" slot. Dispatches between four sub-views
 * based on session + job state:
 *
 *   1. No locked taste session → empty state
 *   2. Locked session, no job yet → <PreLaunch />
 *   3. Job queued/running → <LiveProgress />
 *   4. Job completed/cancelled/failed → <PostRun />
 *
 * Error handling:
 *   - Backend unreachable → retry UI
 *   - Job fails entirely → "Start new batch" escape hatch
 */

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Job, TasteSession } from "../../lib/api-client";
import { api, ApiError } from "../../lib/api-client";
import { Button } from "../ui/button";
import { useAppState } from "../shell/app-state";
import { PreLaunch } from "./PreLaunch";
import { Watch } from "./Watch";
import { PostRun } from "./PostRun";
import { PostRunTriage } from "./PostRunTriage";
import { ExportDropdown } from "./ExportDropdown";
import { sessionStore } from "./session-store";
import { useToast } from "../ui/toast";

export function BatchRun() {
  const { scan } = useAppState();
  const toast = useToast();

  // Session + job identifiers, sourced from localStorage (+ URL for job).
  const [tasteSessionId, setTasteSessionId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [finalJob, setFinalJob] = useState<Job | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [showLegacyOutliers, setShowLegacyOutliers] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setTasteSessionId(sessionStore.getTasteSessionId());
    setJobId(sessionStore.getJobId());
    setHydrated(true);
  }, []);

  // Re-read on focus (Agent G may have written a new taste_session in
  // another tab or we jumped back from Taste stage).
  useEffect(() => {
    function refresh() {
      const t = sessionStore.getTasteSessionId();
      if (t !== tasteSessionId) setTasteSessionId(t);
      const j = sessionStore.getJobId();
      if (j !== jobId) setJobId(j);
    }
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [tasteSessionId, jobId]);

  const sessionQ = useQuery<TasteSession, ApiError>({
    queryKey: ["taste-session", tasteSessionId],
    queryFn: () => api.getTasteSession(tasteSessionId!),
    enabled: !!tasteSessionId,
    staleTime: 2_000,
  });

  const handleJobCreated = useCallback((id: string) => {
    setJobId(id);
    setFinalJob(null);
  }, []);

  const handleJobFinal = useCallback((job: Job) => {
    setFinalJob(job);
    if (job.status === "completed" || job.status === "cancelled") {
      toast.push({
        kind: job.status === "completed" ? "success" : "warning",
        title: `Batch ${job.status}`,
        detail: `${job.progress?.docs_done ?? 0} docs`,
      });
    }
  }, [toast]);

  const startOver = useCallback(() => {
    sessionStore.setJobId(null);
    setJobId(null);
    setFinalJob(null);
  }, []);

  // Pause: prototype-level hint — cancel-then-restart pattern.
  const handlePause = useCallback(() => {
    toast.push({
      kind: "info",
      title: "Pause not implemented",
      detail:
        "Cancel and re-start preserves completed docs (resume is by re-POSTing /batch).",
    });
  }, [toast]);

  // Current effective output_dir for export: prefer session, fallback to store.
  const outputDir =
    sessionQ.data?.output_dir || sessionStore.getOutputDir() || "";

  // ── Render branches ────────────────────────────────────────────────

  if (!hydrated) {
    return (
      <div className="p-6 text-sm text-fg-muted">Loading batch stage…</div>
    );
  }

  // No taste session in local store → empty state
  if (!tasteSessionId) {
    return (
      <EmptyState
        title="Point at a folder on the Scan stage to start."
        detail={
          scan
            ? "Back on Scan, click Start converting to kick off the job. Preview first is optional."
            : "No folder scanned yet — head to Scan."
        }
      />
    );
  }

  // Loading / error loading session
  if (sessionQ.isLoading && !sessionQ.data) {
    return <div className="p-6 text-sm text-fg-muted">Loading session…</div>;
  }
  if (sessionQ.error) {
    return (
      <div className="p-6 max-w-2xl">
        <div className="border border-danger rounded bg-danger-bg/30 p-4 space-y-2">
          <div className="font-medium text-danger-fg">
            Couldn&apos;t load taste session
          </div>
          <div className="text-sm text-fg-secondary">
            {sessionQ.error.message}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => sessionQ.refetch()}>
              Retry
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                sessionStore.setTasteSessionId(null);
                setTasteSessionId(null);
              }}
            >
              Clear session
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const session = sessionQ.data!;

  // Job active → live progress
  if (jobId && !finalJob) {
    return (
      <>
        <Watch
          jobId={jobId}
          onJobFinal={handleJobFinal}
          onRequestExport={() => setExportOpen(true)}
          onPause={handlePause}
        />
        {outputDir && (
          <ExportDropdown
            outputDir={outputDir}
            open={exportOpen}
            onClose={() => setExportOpen(false)}
          />
        )}
      </>
    );
  }

  // Job finalised → post-run review (triage-first, legacy outliers as fallback)
  if (finalJob) {
    return (
      <>
        {showLegacyOutliers ? (
          <PostRun
            job={finalJob}
            outputDir={outputDir}
            onRequestExport={() => setExportOpen(true)}
            onStartOver={startOver}
          />
        ) : (
          <PostRunTriage
            job={finalJob}
            outputDir={outputDir}
            onRequestExport={() => setExportOpen(true)}
            onStartOver={startOver}
            onShowOutliers={() => setShowLegacyOutliers(true)}
          />
        )}
        {outputDir && (
          <ExportDropdown
            outputDir={outputDir}
            open={exportOpen}
            onClose={() => setExportOpen(false)}
          />
        )}
      </>
    );
  }

  // Session exists, no job → pre-launch (filemap-mode or legacy)
  return (
    <PreLaunch
      session={session}
      onJobCreated={handleJobCreated}
    />
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-2">
        <div className="text-lg text-fg-primary font-medium">{title}</div>
        <div className="text-sm text-fg-muted">{detail}</div>
      </div>
    </div>
  );
}
