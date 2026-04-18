"use client";

/**
 * Live progress view: shown while a batch is running.
 *
 * Prefer SSE via /jobs/{id}/stream; fall back to 1Hz polling of /jobs/{id}
 * if SSE fails to connect or errors at runtime.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Job } from "../../lib/api-client";
import { api, ApiError } from "../../lib/api-client";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { useToast } from "../ui/toast";
import { useShortcutScope, BATCHRUN_BINDINGS } from "../../lib/shortcuts";
import { formatDuration } from "./estimates";

interface Props {
  jobId: string;
  onJobFinal: (job: Job) => void;
  onRequestExport: () => void;
  onPause: () => void;
}

// Local derived-event log for a lightweight "what's happening" tail.
interface LogEntry {
  ts: number;
  text: string;
}

function deriveEvents(prev: Job | null, next: Job): LogEntry[] {
  const out: LogEntry[] = [];
  const now = Date.now();
  const prevDone = prev?.progress?.docs_done ?? 0;
  const nextDone = next.progress?.docs_done ?? 0;
  const prevFailed = prev?.progress?.docs_failed ?? 0;
  const nextFailed = next.progress?.docs_failed ?? 0;
  if (nextDone > prevDone) {
    out.push({ ts: now, text: `+${nextDone - prevDone} doc(s) completed` });
  }
  if (nextFailed > prevFailed) {
    out.push({ ts: now, text: `+${nextFailed - prevFailed} doc(s) failed` });
  }
  if (prev?.status !== next.status) {
    out.push({ ts: now, text: `status → ${next.status}` });
  }
  return out;
}

export function LiveProgress({ jobId, onJobFinal, onRequestExport, onPause }: Props) {
  const toast = useToast();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transport, setTransport] = useState<"sse" | "poll" | "initial">("initial");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [cancelling, setCancelling] = useState(false);
  const jobRef = useRef<Job | null>(null);
  const finalisedRef = useRef(false);

  const applyUpdate = (next: Job) => {
    const events = deriveEvents(jobRef.current, next);
    jobRef.current = next;
    setJob(next);
    if (events.length) {
      setLog((old) => [...old, ...events].slice(-20));
    }
    if (
      !finalisedRef.current &&
      (next.status === "completed" ||
        next.status === "cancelled" ||
        next.status === "failed")
    ) {
      finalisedRef.current = true;
      onJobFinal(next);
    }
  };

  // SSE with poll fallback
  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    async function initialFetch() {
      try {
        const initial = await api.job(jobId);
        if (cancelled) return;
        applyUpdate(initial);
      } catch (e) {
        if (cancelled) return;
        setError(
          e instanceof ApiError
            ? `${e.code}: ${e.message}`
            : "Backend unreachable",
        );
      }
    }

    function startPolling() {
      setTransport("poll");
      if (pollTimer) return;
      pollTimer = setInterval(async () => {
        if (cancelled) return;
        try {
          const j = await api.job(jobId);
          applyUpdate(j);
          if (
            j.status === "completed" ||
            j.status === "cancelled" ||
            j.status === "failed"
          ) {
            if (pollTimer) {
              clearInterval(pollTimer);
              pollTimer = null;
            }
          }
        } catch {
          /* keep polling */
        }
      }, 1000);
    }

    function startSSE() {
      try {
        es = new EventSource(`/api/jobs/${jobId}/stream`);
        es.onopen = () => {
          setTransport("sse");
        };
        es.onmessage = (ev) => {
          try {
            const data = JSON.parse(ev.data) as Job;
            applyUpdate(data);
            if (
              data.status === "completed" ||
              data.status === "cancelled" ||
              data.status === "failed"
            ) {
              es?.close();
              es = null;
            }
          } catch {
            /* ignore malformed frames */
          }
        };
        es.onerror = () => {
          // Fall back to polling
          console.warn("[BatchRun] SSE errored; falling back to poll");
          es?.close();
          es = null;
          if (!cancelled) startPolling();
        };
      } catch (e) {
        console.warn("[BatchRun] SSE unavailable; falling back to poll", e);
        startPolling();
      }
    }

    initialFetch().then(() => {
      if (cancelled) return;
      startSSE();
    });

    return () => {
      cancelled = true;
      if (es) es.close();
      if (pollTimer) clearInterval(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const cancel = useMutation({
    mutationFn: () => api.cancelBatch(jobId),
    onMutate: () => {
      setCancelling(true);
    },
    onSuccess: (j) => {
      applyUpdate(j);
    },
    onError: (err) => {
      setCancelling(false);
      const detail =
        err instanceof ApiError ? `${err.code}: ${err.message}` : String(err);
      toast.push({ kind: "danger", title: "Cancel failed", detail });
    },
  });

  // Shortcuts
  useShortcutScope({
    scope: "batchrun",
    bindings: BATCHRUN_BINDINGS,
    handlers: {
      "cancel-batch": () => {
        if (!cancelling && job?.status === "running") cancel.mutate();
      },
      "pause-batch": () => onPause(),
      export: () => onRequestExport(),
    },
  });

  const progress = job?.progress;
  const total = progress?.docs_total ?? 0;
  const done = progress?.docs_done ?? 0;
  const failed = progress?.docs_failed ?? 0;
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  const etaSec = progress?.eta_seconds ?? null;

  const statusTone = useMemo(() => {
    switch (job?.status) {
      case "running":
        return "accent";
      case "queued":
        return "info";
      case "cancelled":
        return "warning";
      case "failed":
        return "danger";
      case "completed":
        return "success";
      default:
        return "neutral";
    }
  }, [job?.status]);

  if (error) {
    return (
      <div className="p-6 max-w-2xl">
        <div className="border border-danger rounded bg-danger-bg/30 p-4 space-y-2">
          <div className="font-medium text-danger-fg">
            Backend offline — can&apos;t monitor batch
          </div>
          <div className="text-sm text-fg-secondary">{error}</div>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="p-6 text-sm text-fg-muted">Loading job {jobId}…</div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-fg-muted">
            Batch · {job.id}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Badge tone={statusTone}>{job.status}</Badge>
            <span className="text-xs text-fg-muted">
              transport: {transport}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {job.status === "running" && (
            <>
              <Button
                variant="secondary"
                onClick={() => onPause()}
                title="Pause (see note in deferral ledger)"
              >
                Pause
              </Button>
              <Button
                variant="danger"
                disabled={cancelling}
                onClick={() => cancel.mutate()}
              >
                {cancelling ? "Cancelling…" : "Cancel"}
              </Button>
            </>
          )}
          {(job.status === "completed" ||
            job.status === "cancelled") && (
            <Button variant="primary" onClick={onRequestExport}>
              Export
            </Button>
          )}
        </div>
      </div>

      <div className="border border-border-default rounded bg-surface-1 p-4 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <div className="tabular-nums">
            <span className="text-fg-primary font-semibold">{done}</span>
            <span className="text-fg-muted"> / {total} docs</span>
            {failed > 0 && (
              <span className="text-danger-fg ml-3">({failed} failed)</span>
            )}
          </div>
          <div className="text-xs text-fg-muted tabular-nums">
            {progress?.docs_per_sec
              ? `${progress.docs_per_sec.toFixed(2)} docs/s`
              : "—"}
            {etaSec != null && ` · ETA ${formatDuration(etaSec)}`}
          </div>
        </div>
        <div className="h-2 bg-surface-3 rounded overflow-hidden">
          <div
            className={
              failed > 0
                ? "h-full bg-warning transition-all"
                : "h-full bg-accent transition-all"
            }
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {progress?.per_stratum && progress.per_stratum.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-fg-muted">
            Per-stratum
          </div>
          {progress.per_stratum.map((ps) => {
            const sTotal = ps.total ?? 0;
            const sDone = ps.done ?? 0;
            const sFailed = ps.failed ?? 0;
            const sPct = sTotal > 0 ? (sDone / sTotal) * 100 : 0;
            return (
              <div
                key={ps.name}
                className="flex items-center gap-3 p-2 rounded border border-border-default bg-surface-1"
              >
                <div className="w-48 min-w-0">
                  <div className="font-mono text-xs truncate" title={ps.name}>
                    {ps.name}
                  </div>
                </div>
                <div className="flex-1 h-1.5 bg-surface-3 rounded overflow-hidden">
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${sPct}%` }}
                  />
                </div>
                <div className="text-xs text-fg-muted tabular-nums whitespace-nowrap w-24 text-right">
                  {sDone}/{sTotal}
                  {sFailed > 0 && (
                    <span className="text-danger-fg"> ·{sFailed}f</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-1">
        <div className="text-xs uppercase tracking-wider text-fg-muted">
          Recent events
        </div>
        <div className="font-mono text-xs bg-surface-1 border border-border-default rounded p-2 max-h-48 overflow-auto">
          {log.length === 0 ? (
            <div className="text-fg-muted italic">
              No events yet — waiting on first tick…
            </div>
          ) : (
            log
              .slice()
              .reverse()
              .map((e, i) => (
                <div key={i} className="text-fg-secondary">
                  <span className="text-fg-muted">
                    {new Date(e.ts).toLocaleTimeString()}
                  </span>{" "}
                  {e.text}
                </div>
              ))
          )}
        </div>
      </div>

      {job.error && (
        <div className="border border-danger rounded bg-danger-bg/30 p-3">
          <div className="font-medium text-danger-fg">Job error</div>
          <div className="text-sm text-fg-secondary font-mono">{job.error}</div>
        </div>
      )}
    </div>
  );
}
