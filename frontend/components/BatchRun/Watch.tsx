"use client";

/**
 * <Watch /> — the "my folder is converting" screen.
 *
 * Primary flow:
 *   Scan → Convert (this) → Triage
 *
 * Also the screen a user lands on when an agent drove POST /batch via CLI
 * ("boss mode"). The activity log is the narrative anchor: a passively
 * watching user can see what their agent just did, one line at a time.
 *
 * Data source: SSE on /api/jobs/{id}/stream with a 1Hz poll fallback.
 * Per-doc events are synthesised from the job-progress delta (backend
 * only emits snapshots) — one event per doc increment, tagged with the
 * stratum whose counter moved, latest events at the bottom.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Job } from "../../lib/api-client";
import { api, ApiError } from "../../lib/api-client";
import { Button } from "../ui/button";
import { useToast } from "../ui/toast";
import { useShortcutScope, BATCHRUN_BINDINGS } from "../../lib/shortcuts";
import { formatDuration } from "./estimates";

// Stratum palette (matches Scan spectrum bar + prior LiveProgress).
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

type LogKind = "ok" | "warn" | "fail";

interface LogEntry {
  id: number;
  ts: number;
  kind: LogKind;
  message: string;
  detail?: string;
}

let _logCounter = 0;

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

/**
 * Derive per-doc events from the job delta. Backend emits snapshot-only,
 * so we fan out aggregate deltas into one-line events, attributing to
 * the stratum whose counter moved on this tick.
 */
function deriveEvents(prev: Job | null, next: Job): LogEntry[] {
  const out: LogEntry[] = [];
  const now = Date.now();

  const prevPS = prev?.progress?.per_stratum ?? [];
  const nextPS = next.progress?.per_stratum ?? [];

  // Attribute per-stratum deltas first — they carry the group name.
  let attributedDone = 0;
  let attributedFailed = 0;
  for (const nx of nextPS) {
    const pv = prevPS.find((p) => p.name === nx.name);
    const dDone = (nx.done ?? 0) - (pv?.done ?? 0);
    const dFail = (nx.failed ?? 0) - (pv?.failed ?? 0);
    for (let i = 0; i < dDone; i++) {
      out.push({
        id: ++_logCounter,
        ts: now,
        kind: "ok",
        message: `Converted a document`,
        detail: nx.name ? nx.name : undefined,
      });
      attributedDone++;
    }
    for (let i = 0; i < dFail; i++) {
      out.push({
        id: ++_logCounter,
        ts: now,
        kind: "warn",
        message: `Couldn't convert a document`,
        detail: nx.name
          ? `${nx.name} · will retry / triage pending`
          : "will retry / triage pending",
      });
      attributedFailed++;
    }
  }

  // Fall back to global deltas if the backend didn't populate per_stratum.
  const dDone = (next.progress?.docs_done ?? 0) - (prev?.progress?.docs_done ?? 0);
  const dFail =
    (next.progress?.docs_failed ?? 0) - (prev?.progress?.docs_failed ?? 0);
  for (let i = attributedDone; i < dDone; i++) {
    out.push({
      id: ++_logCounter,
      ts: now,
      kind: "ok",
      message: `Converted a document`,
    });
  }
  for (let i = attributedFailed; i < dFail; i++) {
    out.push({
      id: ++_logCounter,
      ts: now,
      kind: "warn",
      message: `Couldn't convert a document`,
      detail: "will retry / triage pending",
    });
  }

  return out;
}

function kindGlyph(k: LogKind): { glyph: string; color: string } {
  if (k === "ok") return { glyph: "✓", color: "var(--ok)" };
  if (k === "warn") return { glyph: "⚠", color: "var(--warn)" };
  return { glyph: "✕", color: "var(--danger)" };
}

export function Watch({ jobId, onJobFinal, onRequestExport, onPause }: Props) {
  const toast = useToast();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transport, setTransport] = useState<"sse" | "poll" | "initial">(
    "initial",
  );
  const [log, setLog] = useState<LogEntry[]>([]);
  const [cancelling, setCancelling] = useState(false);

  const jobRef = useRef<Job | null>(null);
  const finalisedRef = useRef(false);
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const userScrolledUpRef = useRef(false);

  const applyUpdate = (next: Job) => {
    const events = deriveEvents(jobRef.current, next);
    jobRef.current = next;
    setJob(next);
    if (events.length) {
      // Keep a rolling tail of ~200 events; render only the most recent 20-ish.
      setLog((old) => [...old, ...events].slice(-200));
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

  // Auto-scroll the activity log unless the user scrolled up.
  useEffect(() => {
    const el = logScrollRef.current;
    if (!el) return;
    if (userScrolledUpRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [log]);

  const onLogScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    userScrolledUpRef.current = !atBottom;
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
          console.warn("[Watch] SSE errored; falling back to poll");
          es?.close();
          es = null;
          if (!cancelled) startPolling();
        };
      } catch (e) {
        console.warn("[Watch] SSE unavailable; falling back to poll", e);
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
            Backend offline — can&apos;t monitor conversion
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

  const statusLabel =
    job.status === "running"
      ? "Converting"
      : job.status === "queued"
        ? "Queued"
        : job.status === "completed"
          ? "Done"
          : job.status === "cancelled"
            ? "Cancelled"
            : job.status === "failed"
              ? "Failed"
              : job.status;

  const recent = log.slice(-20);

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Top action bar */}
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
        <span className="label-eyebrow">Convert · step 3 of 3</span>
        <span className="text-fg-disabled" style={{ fontSize: 11 }}>
          ·
        </span>
        <span className="text-fg-muted" style={{ fontSize: 11 }}>
          output:
        </span>
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
          <Button
            size="sm"
            variant="danger"
            disabled={cancelling}
            onClick={() => cancel.mutate()}
            title="Cancel the conversion"
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
        )}
        {(job.status === "completed" || job.status === "cancelled") && (
          <Button size="sm" variant="primary" onClick={onRequestExport}>
            Export
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-auto" style={{ padding: "28px 40px" }}>
        {/* Narrative headline */}
        <div style={{ marginBottom: 18 }}>
          <div className="label-eyebrow" style={{ marginBottom: 8 }}>
            {statusLabel}
          </div>
          <div
            style={{
              fontSize: 26,
              lineHeight: 1.25,
              letterSpacing: -0.4,
              fontWeight: 500,
            }}
          >
            {job.status === "running" ? (
              <>
                Converting{" "}
                <span className="num" style={{ color: "var(--fg0)" }}>
                  {done.toLocaleString()}
                </span>
                <span className="text-fg-muted"> of </span>
                <span className="num" style={{ color: "var(--fg0)" }}>
                  {total.toLocaleString()}
                </span>
                <span className="text-fg-muted"> documents.</span>
                {etaSec != null && (
                  <>
                    <br />
                    <span style={{ color: "var(--fg2)", fontSize: 16 }}>
                      About{" "}
                      <span style={{ color: "var(--fg1)" }}>
                        {formatDuration(etaSec)}
                      </span>{" "}
                      remaining
                      {dps != null && (
                        <>
                          {" "}
                          ·{" "}
                          <span className="mono">
                            {dps.toFixed(2)} docs/s
                          </span>
                        </>
                      )}
                    </span>
                  </>
                )}
              </>
            ) : job.status === "completed" ? (
              <>
                Converted{" "}
                <span className="num" style={{ color: "var(--fg0)" }}>
                  {done.toLocaleString()}
                </span>
                <span className="text-fg-muted"> of </span>
                <span className="num" style={{ color: "var(--fg0)" }}>
                  {total.toLocaleString()}
                </span>
                <span className="text-fg-muted"> documents.</span>
              </>
            ) : (
              <>
                <span className="num" style={{ color: "var(--fg0)" }}>
                  {done.toLocaleString()}
                </span>
                <span className="text-fg-muted"> of </span>
                <span className="num" style={{ color: "var(--fg0)" }}>
                  {total.toLocaleString()}
                </span>
                <span className="text-fg-muted"> documents.</span>
              </>
            )}
          </div>
        </div>

        {/* Big progress bar */}
        <div
          style={{
            marginBottom: 24,
            height: 10,
            background: "var(--s2)",
            borderRadius: 5,
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
              borderRadius: 5,
              transition: "width 200ms",
              boxShadow: "0 0 12px rgba(64, 200, 240, 0.35)",
            }}
          />
        </div>

        {/* Prominent stats row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 10,
            marginBottom: 26,
          }}
        >
          <StatCard
            label="Converted"
            value={done.toLocaleString()}
            accent="var(--ok)"
          />
          <StatCard
            label="Failed"
            value={failed.toLocaleString()}
            accent={failed > 0 ? "var(--warn)" : "var(--fg3)"}
            sub={failed > 0 ? "triage pending" : undefined}
          />
          <StatCard
            label="Throughput"
            value={dps != null ? `${dps.toFixed(2)}` : "—"}
            sub="docs / sec"
          />
          <StatCard
            label="ETA"
            value={etaSec != null ? formatDuration(etaSec) : "—"}
          />
        </div>

        {/* Activity log — the narrative anchor */}
        <div
          style={{
            padding: "12px 14px 6px",
            background: "var(--s1)",
            border: "1px solid var(--b0)",
            borderRadius: 8,
            marginBottom: 22,
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
            <span className="label-eyebrow">Activity</span>
            <div style={{ flex: 1 }} />
            <span
              className="mono"
              style={{ fontSize: 10.5, color: "var(--fg3)" }}
            >
              live · {transport}
            </span>
          </div>
          <div
            ref={logScrollRef}
            onScroll={onLogScroll}
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 11.5,
              lineHeight: 1.9,
              color: "var(--fg2)",
              maxHeight: 280,
              overflowY: "auto",
              paddingRight: 8,
            }}
          >
            {recent.length === 0 ? (
              <div
                className="text-fg-muted"
                style={{ fontStyle: "italic" }}
              >
                Waiting for the first document…
              </div>
            ) : (
              recent.map((e) => {
                const { glyph, color } = kindGlyph(e.kind);
                return (
                  <div
                    key={e.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "72px 18px 1fr auto",
                      gap: 10,
                      alignItems: "baseline",
                    }}
                  >
                    <span className="text-fg-disabled">{fmtTime(e.ts)}</span>
                    <span style={{ color }}>{glyph}</span>
                    <span
                      className="truncate"
                      style={{
                        color:
                          e.kind === "ok" ? "var(--fg1)" : "var(--fg1)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {e.message}
                    </span>
                    <span
                      className="text-fg-disabled"
                      style={{ fontSize: 10.5 }}
                    >
                      {e.detail ?? ""}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Per-stratum mini bars */}
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
                marginBottom: 20,
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
                      padding: "10px 12px",
                      background: "var(--s1)",
                      border: "1px solid var(--b0)",
                      borderRadius: 8,
                      opacity: doneFull ? 0.55 : 1,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 6,
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: color,
                          boxShadow: `0 0 6px ${color}`,
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

        {job.error && (
          <div className="mt-5 border border-danger rounded bg-danger-bg/30 p-3">
            <div className="font-medium text-danger-fg">
              Conversion stopped
            </div>
            <div className="text-sm text-fg-secondary font-mono">
              {job.error}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        background: "var(--s1)",
        border: "1px solid var(--b0)",
        borderRadius: 8,
      }}
    >
      <div className="label-eyebrow" style={{ marginBottom: 6 }}>
        {label}
      </div>
      <div
        className="num"
        style={{
          fontSize: 22,
          fontWeight: 500,
          color: accent ?? "var(--fg0)",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          className="text-fg-muted"
          style={{ fontSize: 10.5, marginTop: 4 }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
