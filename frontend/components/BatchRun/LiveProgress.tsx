"use client";

/**
 * Live progress view — the "walk away and come back" screen.
 *
 * Design: one sentence of truth at the top, per-stratum cards below,
 * recent event tail card. Calm, not busy. SSE primary, poll fallback.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Job } from "../../lib/api-client";
import { api, ApiError } from "../../lib/api-client";
import { Button } from "../ui/button";
import { useToast } from "../ui/toast";
import { useShortcutScope, BATCHRUN_BINDINGS } from "../../lib/shortcuts";
import { formatDuration } from "./estimates";

// Stratum colour palette mirrors the spectrum bar in Scan.
const STRATUM_COLORS = [
  "var(--gold)",
  "var(--cyan)",
  "#40d080",
  "#a78bfa",
  "#f08060",
  "#b3b8c4",
  "#ec4899",
  "#6366f1",
];
function colorFor(i: number) {
  return STRATUM_COLORS[i % STRATUM_COLORS.length];
}

interface Props {
  jobId: string;
  onJobFinal: (job: Job) => void;
  onRequestExport: () => void;
  onPause: () => void;
}

interface LogEntry {
  ts: number;
  icon: "ok" | "warn";
  file: string;
  meta: string;
}

function deriveEvents(prev: Job | null, next: Job): LogEntry[] {
  const out: LogEntry[] = [];
  const now = Date.now();
  const prevDone = prev?.progress?.docs_done ?? 0;
  const nextDone = next.progress?.docs_done ?? 0;
  const prevFailed = prev?.progress?.docs_failed ?? 0;
  const nextFailed = next.progress?.docs_failed ?? 0;
  if (nextDone > prevDone) {
    out.push({
      ts: now,
      icon: "ok",
      file: `+${nextDone - prevDone} doc(s) completed`,
      meta: "",
    });
  }
  if (nextFailed > prevFailed) {
    out.push({
      ts: now,
      icon: "warn",
      file: `+${nextFailed - prevFailed} doc(s) failed`,
      meta: "",
    });
  }
  return out;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString("en-GB", { hour12: false });
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
        es.onopen = () => setTransport("sse");
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
    onMutate: () => setCancelling(true),
    onSuccess: (j) => applyUpdate(j),
    onError: (err) => {
      setCancelling(false);
      const detail =
        err instanceof ApiError ? `${err.code}: ${err.message}` : String(err);
      toast.push({ kind: "danger", title: "Cancel failed", detail });
    },
  });

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
  const dps = progress?.docs_per_sec ?? null;
  const outputDir = useMemo(() => {
    const j = job as unknown as { output_dir?: string } | null;
    return j?.output_dir ?? "";
  }, [job]);

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
    return <div className="p-6 text-sm text-fg-muted">Loading job {jobId}…</div>;
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Action bar (top) */}
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
        <span className="label-eyebrow">Batch · step 3 of 3</span>
        <span className="text-fg-disabled" style={{ fontSize: 11 }}>·</span>
        <span className="text-fg-muted" style={{ fontSize: 11 }}>output:</span>
        <span
          className="mono truncate"
          style={{ fontSize: 11, color: "var(--fg1)", maxWidth: 420 }}
          title={outputDir}
        >
          {outputDir || "—"}
        </span>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10.5, color: "var(--fg3)" }}>
          {transport}
        </span>
        {job.status === "running" && (
          <>
            <Button size="sm" variant="ghost" onClick={onPause} title="Pause">
              Pause
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={cancelling}
              onClick={() => cancel.mutate()}
            >
              {cancelling ? "Cancelling…" : "Cancel"}
            </Button>
          </>
        )}
        {(job.status === "completed" || job.status === "cancelled") && (
          <Button size="sm" variant="primary" onClick={onRequestExport}>
            Export
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-auto" style={{ padding: "32px 40px" }}>
        {/* Sentence of truth */}
        <div style={{ marginBottom: 28 }}>
          <div className="label-eyebrow" style={{ marginBottom: 8 }}>
            {job.status === "running"
              ? "Converting"
              : job.status === "queued"
                ? "Queued"
                : job.status === "completed"
                  ? "Done"
                  : job.status}
          </div>
          <div
            style={{
              fontSize: 26,
              lineHeight: 1.2,
              letterSpacing: -0.4,
              fontWeight: 500,
            }}
          >
            <span className="num" style={{ color: "var(--fg0)" }}>
              {done.toLocaleString()}
            </span>
            <span className="text-fg-muted"> of </span>
            <span className="num" style={{ color: "var(--fg0)" }}>
              {total.toLocaleString()}
            </span>
            <span className="text-fg-muted"> documents.</span>
          </div>
          <div style={{ fontSize: 14, color: "var(--fg2)", marginTop: 6 }}>
            {etaSec != null && (
              <>
                About{" "}
                <span style={{ color: "var(--fg1)" }}>
                  {formatDuration(etaSec)}
                </span>{" "}
                remaining
              </>
            )}
            {dps != null && (
              <>
                {etaSec != null ? " at " : "Running at "}
                <span className="mono">{dps.toFixed(2)} docs/s</span>
              </>
            )}
            {failed > 0 && (
              <>
                <span className="text-fg-disabled"> · </span>
                <span style={{ color: "var(--warn)" }}>{failed} failed</span>
                <span className="text-fg-muted">
                  {" "}— you&apos;ll be able to retry after
                </span>
              </>
            )}
          </div>
          <div
            style={{
              marginTop: 16,
              height: 6,
              background: "var(--s2)",
              borderRadius: 3,
              overflow: "hidden",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                width: `${pct}%`,
                background: "var(--cyan)",
                borderRadius: 3,
                transition: "width 200ms",
              }}
            />
          </div>
        </div>

        {/* Per-stratum cards */}
        {progress?.per_stratum && progress.per_stratum.length > 0 && (
          <>
            <div className="label-eyebrow" style={{ marginBottom: 12 }}>
              Per group
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginBottom: 28,
              }}
            >
              {progress.per_stratum.map((ps, i) => {
                const sTotal = ps.total ?? 0;
                const sDone = ps.done ?? 0;
                const sFail = ps.failed ?? 0;
                const p = sTotal > 0 ? (sDone / sTotal) * 100 : 0;
                const doneFull = sTotal > 0 && sDone >= sTotal;
                const color = colorFor(i);
                return (
                  <div
                    key={ps.name}
                    style={{
                      padding: "12px 14px",
                      background: "var(--s1)",
                      border: "1px solid var(--b0)",
                      borderRadius: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 8,
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: color,
                          boxShadow: `0 0 6px ${color}`,
                          opacity: doneFull ? 0.5 : 1,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        className="mono truncate"
                        style={{
                          fontSize: 12,
                          color: "var(--fg0)",
                          fontWeight: 500,
                        }}
                      >
                        {ps.name}
                      </span>
                      {doneFull && (
                        <span
                          className="mono"
                          style={{
                            fontSize: 9.5,
                            padding: "1px 5px",
                            borderRadius: 3,
                            background: "var(--ok-soft)",
                            color: "var(--ok)",
                          }}
                        >
                          done
                        </span>
                      )}
                      {sFail > 0 && (
                        <span
                          className="mono"
                          style={{
                            fontSize: 9.5,
                            padding: "1px 5px",
                            borderRadius: 3,
                            background: "var(--warn-soft)",
                            color: "var(--warn)",
                          }}
                        >
                          {sFail} fail
                        </span>
                      )}
                      <div style={{ flex: 1 }} />
                      <span
                        className="num"
                        style={{ fontSize: 11.5, color: "var(--fg1)" }}
                      >
                        {sDone}
                        <span className="text-fg-disabled">/{sTotal}</span>
                      </span>
                    </div>
                    <div
                      style={{
                        height: 4,
                        background: "var(--s2)",
                        borderRadius: 2,
                        overflow: "hidden",
                        position: "relative",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: `${p}%`,
                          background: doneFull ? "var(--ok)" : color,
                          borderRadius: 2,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Recent event tail */}
        <div
          style={{
            padding: "12px 14px",
            background: "var(--s1)",
            border: "1px solid var(--b0)",
            borderRadius: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <span className="label-eyebrow">Recent</span>
            <div style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 10.5, color: "var(--fg3)" }}>
              live · {transport}
            </span>
          </div>
          <div
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 11,
              lineHeight: 1.9,
              color: "var(--fg2)",
            }}
          >
            {log.length === 0 ? (
              <div className="text-fg-muted italic" style={{ fontStyle: "italic" }}>
                No events yet — waiting on first tick…
              </div>
            ) : (
              log
                .slice()
                .reverse()
                .slice(0, 7)
                .map((e, i) => (
                  <div
                    key={i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "64px 16px 1fr 120px",
                      gap: 10,
                    }}
                  >
                    <span className="text-fg-disabled">{fmtTime(e.ts)}</span>
                    <span
                      style={{
                        color: e.icon === "ok" ? "var(--ok)" : "var(--warn)",
                      }}
                    >
                      {e.icon === "ok" ? "✓" : "⚠"}
                    </span>
                    <span
                      className="truncate"
                      style={{ color: "var(--fg1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {e.file}
                    </span>
                    <span className="text-fg-disabled">{e.meta}</span>
                  </div>
                ))
            )}
          </div>
        </div>

        {job.error && (
          <div className="mt-5 border border-danger rounded bg-danger-bg/30 p-3">
            <div className="font-medium text-danger-fg">Job error</div>
            <div className="text-sm text-fg-secondary font-mono">{job.error}</div>
          </div>
        )}
      </div>
    </div>
  );
}
