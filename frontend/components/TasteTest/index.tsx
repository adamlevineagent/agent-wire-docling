"use client";

/**
 * TasteTest — top-level pane for the `taste` stage.
 *
 * Wiring:
 *   - Reads scan + folder from useAppState()
 *   - Creates-or-resumes a taste session (session.ts)
 *   - Left pane: StrataPane
 *   - Center pane: SampleGrid + Reviewer
 *   - Drawer: ApprovedDrawer (toggled by `a`)
 *   - Overlay: AdvancedPanel (toggled by `c` or per-stratum button)
 *
 * Keyboard scope `tastetest`: a/l/S/c per TASTETEST_BINDINGS.
 * `advanced` masks `tastetest` while open (shortcuts.tsx handles mask).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAppState } from "../shell/app-state";
import { api, ApiError, type PipelineParams, type ConvertRequest, type DocMeta } from "../../lib/api-client";
import type { StratumState } from "./types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { useToast } from "../ui/toast";
import { useShortcutScope, TASTETEST_BINDINGS } from "../../lib/shortcuts";
import { useTasteSession } from "./session";
import { StrataPane } from "./StrataPane";
import { SampleGrid, type SampleEntry } from "./SampleGrid";
import { ApprovedDrawer } from "./ApprovedDrawer";
import { AdvancedPanel } from "./AdvancedPanel";
import { Reviewer } from "./Reviewer";
import { DEFAULT_PIPELINE, inferOutputDir, reviewedHashes, findApproval } from "./helpers";

interface SamplePool {
  [stratumName: string]: SampleEntry[];
}

export function TasteTest() {
  const { scan, folder, setStage } = useAppState();
  const toast = useToast();

  const [outputDir, setOutputDir] = useState<string>(() => inferOutputDir(folder));
  const [outputDirDraft, setOutputDirDraft] = useState<string>(outputDir);
  const [outputDirConfirmed, setOutputDirConfirmed] = useState<boolean>(!!outputDir);

  // Sync default when folder changes.
  useEffect(() => {
    if (!outputDirConfirmed) {
      const inferred = inferOutputDir(folder);
      setOutputDir(inferred);
      setOutputDirDraft(inferred);
    }
  }, [folder, outputDirConfirmed]);

  const {
    session,
    sessionId,
    loading,
    error,
    mismatchedScan,
    recreate,
    patch,
    patchPending,
    refresh,
  } = useTasteSession({
    scan_id: outputDirConfirmed ? scan?.scan_id ?? null : null,
    output_dir: outputDir,
  });

  // Sample pool per stratum — UI-local; not persisted server-side in this wave.
  const [samples, setSamples] = useState<SamplePool>({});
  const [activeStratum, setActiveStratum] = useState<string | null>(null);
  const [activeHash, setActiveHash] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState<string | null>(null);
  const [sampling, setSampling] = useState<string | null>(null);

  // When session appears, default activeStratum to first under-review stratum.
  useEffect(() => {
    if (!session) return;
    if (activeStratum && session.strata.find((s) => s.name === activeStratum)) return;
    const first = session.strata[0];
    if (first) setActiveStratum(first.name);
  }, [session, activeStratum]);

  const activeStratumState: StratumState | null = useMemo(() => {
    if (!session || !activeStratum) return null;
    return session.strata.find((s) => s.name === activeStratum) ?? null;
  }, [session, activeStratum]);

  const activePipeline: PipelineParams =
    activeStratumState?.pipeline ?? DEFAULT_PIPELINE;

  const activeStratumSamples = activeStratum ? samples[activeStratum] ?? [] : [];

  // ── Sampling ────────────────────────────────────────────────────────────
  const sampleMut = useMutation<
    SampleEntry[],
    ApiError,
    { stratumName: string }
  >({
    mutationFn: async ({ stratumName }) => {
      if (!scan) throw new ApiError(0, "no_scan", "No scan loaded");
      if (!session) throw new ApiError(0, "no_session", "No session");
      const existing = samples[stratumName] ?? [];
      const existingHashes = new Set(existing.map((e) => e.hash));
      const stratumState = session.strata.find((s) => s.name === stratumName);
      const reviewed = stratumState ? reviewedHashes(stratumState) : [];
      reviewed.forEach((h) => existingHashes.add(h));
      const result = await api.sample({
        scan_id: scan.scan_id,
        n: 5,
        exclude_hashes: Array.from(existingHashes),
      });
      const stratumResult = result.strata.find((s) => s.name === stratumName);
      const picked = stratumResult?.docs ?? [];
      return picked.map((d) => ({
        hash: d.source_sha256,
        source_path: d.source_path,
        source_format: d.source_format,
        convertStatus: "pending" as const,
      }));
    },
    onError: (e, vars) => {
      toast.push({
        kind: "danger",
        title: `Sample failed for ${vars.stratumName}`,
        detail: e.message,
      });
    },
  });

  const runSample = useCallback(
    async (stratumName: string) => {
      if (sampling) return;
      setSampling(stratumName);
      try {
        const picks = await sampleMut.mutateAsync({ stratumName });
        setSamples((prev) => ({
          ...prev,
          [stratumName]: [...(prev[stratumName] ?? []), ...picks],
        }));
        // Kick conversions for newly picked docs against the stratum's pipeline.
        if (!session) return;
        const stratumState = session.strata.find((s) => s.name === stratumName);
        const pipeline = stratumState?.pipeline ?? DEFAULT_PIPELINE;
        for (const p of picks) {
          convertDoc(p, stratumName, pipeline);
        }
        // Auto-select the first fresh pick if none active.
        if (!activeHash && picks.length) {
          setActiveHash(picks[0].hash);
          setActiveStratum(stratumName);
        }
      } finally {
        setSampling(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sampling, sampleMut, session, activeHash],
  );

  const convertDoc = useCallback(
    async (entry: SampleEntry, stratumName: string, pipeline: PipelineParams) => {
      setSamples((prev) => {
        const list = (prev[stratumName] ?? []).map((e) =>
          e.hash === entry.hash ? { ...e, convertStatus: "converting" as const } : e,
        );
        return { ...prev, [stratumName]: list };
      });
      try {
        const req: ConvertRequest = {
          source_path: entry.source_path,
          output_dir: outputDir,
          pipeline,
        };
        const meta: DocMeta = await api.convert(req);
        setSamples((prev) => {
          const list = (prev[stratumName] ?? []).map((e) =>
            e.hash === entry.hash
              ? { ...e, convertStatus: "ready" as const, hash: meta.source_sha256 }
              : e,
          );
          return { ...prev, [stratumName]: list };
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setSamples((prev) => {
          const list = (prev[stratumName] ?? []).map((x) =>
            x.hash === entry.hash
              ? { ...x, convertStatus: "error" as const, convertError: msg }
              : x,
          );
          return { ...prev, [stratumName]: list };
        });
      }
    },
    [outputDir],
  );

  // Merge approvals from session into sample entries so the grid reflects state after refresh.
  const samplesWithApproval: SampleEntry[] = useMemo(() => {
    if (!activeStratumState) return activeStratumSamples;
    return activeStratumSamples.map((e) => ({
      ...e,
      approval: findApproval(activeStratumState, e.hash),
    }));
  }, [activeStratumSamples, activeStratumState]);

  // ── Navigation (auto-advance) ───────────────────────────────────────────
  const advance = useCallback(() => {
    if (!activeStratumState) return;
    const list = samplesWithApproval;
    const idx = list.findIndex((s) => s.hash === activeHash);
    // Find next un-reviewed
    for (let i = idx + 1; i < list.length; i++) {
      if (!list[i].approval) {
        setActiveHash(list[i].hash);
        return;
      }
    }
    // Wrap from start
    for (let i = 0; i < list.length; i++) {
      if (!list[i].approval && list[i].hash !== activeHash) {
        setActiveHash(list[i].hash);
        return;
      }
    }
    // No un-reviewed remaining → open drawer summary
    setActiveHash(null);
    setDrawerOpen(true);
  }, [activeStratumState, samplesWithApproval, activeHash]);

  const goNextDoc = useCallback(() => {
    const list = samplesWithApproval;
    const idx = list.findIndex((s) => s.hash === activeHash);
    if (idx >= 0 && idx + 1 < list.length) setActiveHash(list[idx + 1].hash);
  }, [samplesWithApproval, activeHash]);
  const goPrevDoc = useCallback(() => {
    const list = samplesWithApproval;
    const idx = list.findIndex((s) => s.hash === activeHash);
    if (idx > 0) setActiveHash(list[idx - 1].hash);
  }, [samplesWithApproval, activeHash]);

  // ── Lock / pipeline ─────────────────────────────────────────────────────
  const toggleLock = useCallback(
    async (stratum: string, locked: boolean) => {
      await patch({ lock_stratum: { stratum, locked } });
    },
    [patch],
  );

  const savePipeline = useCallback(
    async (stratum: string, pipeline: PipelineParams) => {
      await patch({ pipeline_assignment: { stratum, pipeline } });
      // Clear cached samples for this stratum so next sample uses new pipeline.
      setSamples((prev) => ({ ...prev, [stratum]: [] }));
      if (activeStratum === stratum) setActiveHash(null);
      toast.push({ kind: "info", title: `Pipeline updated for ${stratum}` });
    },
    [patch, activeStratum, toast],
  );

  // ── Keyboard scope ─────────────────────────────────────────────────────
  const rootRef = useRef<HTMLDivElement | null>(null);
  useShortcutScope({
    scope: "tastetest",
    bindings: TASTETEST_BINDINGS,
    handlers: {
      "approved-drawer": () => setDrawerOpen((v) => !v),
      "lock-stratum": () => {
        if (activeStratumState) toggleLock(activeStratumState.name, !activeStratumState.locked);
      },
      "resample": () => {
        if (activeStratum) runSample(activeStratum);
      },
      "open-advanced-panel": () => {
        if (activeStratum) setAdvancedOpen(activeStratum);
      },
    },
    elementRef: rootRef,
    active: !advancedOpen,
  });

  // ── Early-out states ────────────────────────────────────────────────────
  if (!scan) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-2">
          <div className="text-lg text-fg-primary font-medium">Complete a scan first</div>
          <div className="text-sm text-fg-muted">
            Point the scanner at a folder before reviewing samples.
          </div>
          <Button onClick={() => setStage("scan")}>← Go to Scan</Button>
        </div>
      </div>
    );
  }

  if (!outputDirConfirmed) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="w-full max-w-lg space-y-4">
          <div>
            <div className="text-lg text-fg-primary font-medium">Choose output directory</div>
            <div className="text-sm text-fg-muted mt-1">
              Converted docs, sidecars, and manifest will live here. Defaults to{" "}
              <span className="font-mono">&lt;folder&gt;/.docling-out</span>.
            </div>
          </div>
          <Input
            value={outputDirDraft}
            onChange={(e) => setOutputDirDraft(e.target.value)}
            placeholder="/absolute/path/to/output"
          />
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              disabled={!outputDirDraft.trim().startsWith("/")}
              onClick={() => {
                setOutputDir(outputDirDraft.trim());
                setOutputDirConfirmed(true);
              }}
            >
              Start taste session
            </Button>
            <Button variant="ghost" onClick={() => setStage("scan")}>Cancel</Button>
          </div>
        </div>
      </div>
    );
  }

  if (loading || (!session && !error)) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-fg-muted">
        {sessionId ? "Loading session…" : "Creating session…"}
      </div>
    );
  }

  if (error && !session) {
    const is404 = error.status === 404;
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-2">
          <div className="text-sm text-danger-fg">
            {is404 ? "Session not found" : "Couldn't load taste session"}
          </div>
          <div className="text-xs text-fg-muted font-mono break-all">{error.message}</div>
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button onClick={recreate}>Start a fresh session</Button>
            <Button variant="ghost" onClick={() => refresh()}>Retry</Button>
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div ref={rootRef} tabIndex={-1} className="relative h-full flex outline-none">
      {/* Left pane */}
      <div className="w-72 shrink-0">
        <StrataPane
          session={session}
          scanStrata={scan.strata}
          activeStratum={activeStratum}
          onSelect={(name) => {
            setActiveStratum(name);
            // Default active hash to the first un-reviewed sample in this stratum
            const st = session.strata.find((s) => s.name === name);
            const list = samples[name] ?? [];
            const firstOpen = list.find((e) => !st?.approvals?.find((a) => a.source_sha256 === e.hash));
            setActiveHash(firstOpen?.hash ?? list[0]?.hash ?? null);
          }}
          onSample={runSample}
          onLock={toggleLock}
          onOpenAdvanced={(name) => setAdvancedOpen(name)}
          sampling={sampling}
        />
      </div>

      {/* Center pane */}
      <div className="flex-1 min-w-0 flex flex-col">
        {mismatchedScan && (
          <div className="px-3 py-2 bg-warning-bg text-warning-fg text-xs font-mono border-b border-border-default flex items-center gap-2">
            This session belongs to a different scan.
            <Button size="sm" variant="secondary" onClick={recreate}>
              Start fresh session
            </Button>
          </div>
        )}
        {/* Header */}
        <div className="px-3 py-2 border-b border-border-default bg-surface-1 flex items-center gap-2">
          {activeStratumState ? (
            <>
              <span className="font-mono text-sm">{activeStratumState.name}</span>
              <Badge tone="neutral">{activeStratumState.status}</Badge>
              {activeStratumState.locked && <Badge tone="success">locked</Badge>}
            </>
          ) : (
            <span className="text-sm text-fg-muted">Select a stratum</span>
          )}
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDrawerOpen((v) => !v)}
            title="Approved drawer (a)"
          >
            Approved {drawerOpen ? "▾" : "▸"}
          </Button>
          {activeStratum && (
            <Button size="sm" variant="ghost" onClick={() => setAdvancedOpen(activeStratum)}>
              Advanced (c)
            </Button>
          )}
          {patchPending && (
            <span className="text-xs text-fg-muted font-mono">saving…</span>
          )}
        </div>

        {/* Reviewer or empty state */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0">
            {activeHash && activeStratumState ? (
              <Reviewer
                hash={activeHash}
                stratumName={activeStratumState.name}
                pipeline={activePipeline}
                output_dir={outputDir}
                existingApproval={findApproval(activeStratumState, activeHash)}
                onDecision={patch}
                onAdvance={advance}
                onNext={goNextDoc}
                onPrev={goPrevDoc}
              />
            ) : (
              <div className="h-full flex flex-col">
                <SampleGrid
                  samples={samplesWithApproval}
                  activeHash={activeHash}
                  onSelect={(h) => setActiveHash(h)}
                  stratumName={activeStratum ?? ""}
                />
                {activeStratumState && samplesWithApproval.length === 0 && (
                  <div className="px-3 py-2 text-xs text-fg-muted">
                    Press <span className="font-mono">Sample</span> on this stratum (or{" "}
                    <span className="font-mono">Shift+S</span>) to pull {Math.min(5, activeStratumState.size)} docs.
                  </div>
                )}
                {activeStratumState && samplesWithApproval.length > 0 &&
                  samplesWithApproval.every((s) => s.approval) && (
                    <div className="px-3 py-3 bg-surface-1 border-t border-border-default text-sm flex items-center gap-3">
                      <span className="text-fg-muted">
                        Reviewed all current samples.
                      </span>
                      <Button size="sm" onClick={() => runSample(activeStratumState.name)}>
                        Sample more
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => toggleLock(activeStratumState.name, !activeStratumState.locked)}
                      >
                        {activeStratumState.locked ? "Unlock stratum" : "Lock stratum"}
                      </Button>
                    </div>
                  )}
              </div>
            )}
          </div>

          {activeStratumState && (
            <ApprovedDrawer
              stratum={activeStratumState}
              open={drawerOpen}
              onOpenHash={(h) => {
                setActiveHash(h);
                setDrawerOpen(false);
              }}
              // Use most recent approval's pipeline_hash as "current" anchor
              currentPipelineHash={(activeStratumState.approvals ?? [])
                .slice()
                .sort((a, b) => (a.reviewed_at < b.reviewed_at ? 1 : -1))[0]
                ?.pipeline_hash}
            />
          )}
        </div>
      </div>

      {/* Advanced overlay */}
      {advancedOpen &&
        (() => {
          const st = session.strata.find((s) => s.name === advancedOpen);
          if (!st) return null;
          return (
            <AdvancedPanel
              stratum={st}
              onClose={() => setAdvancedOpen(null)}
              onSave={(p) => savePipeline(st.name, p)}
            />
          );
        })()}
    </div>
  );
}
