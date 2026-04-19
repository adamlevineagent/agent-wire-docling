"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppState } from "./app-state";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Dot } from "../ui/dot";
import { PrismGlyph } from "./prism-glyph";
import { FolderEntry } from "./folder-entry";
import { FolderPicker } from "./folder-picker";
import { useToast } from "../ui/toast";
import { api, ApiError, type Filemap, type FiletreeNode } from "../../lib/api-client";
import { sessionStore } from "../BatchRun/session-store";

// Stratum color palette — matches the spectrum bar design.
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

function colorFor(i: number): string {
  return STRATUM_COLORS[i % STRATUM_COLORS.length];
}

// Regex test helper — matches absolute-ish paths so empty-state flips correctly
const looksAbsolute = (p: string) => p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p);

export function ScanView() {
  const { scan, folder, setStage, setScan, setFolder } = useAppState();
  const toast = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);

  // "Skip to batch" — auto-create a taste session, lock every stratum at
  // defaults, then jump to the Batch stage. The Level B batch reads filemaps
  // directly so pipelines default to {} (tesseract OCR, tables on, formulas
  // off). Users who want to tune per-stratum should use Taste instead.
  const skipToBatch = useMutation({
    mutationFn: async () => {
      if (!scan) throw new ApiError(0, "no_scan", "Scan first");
      const defaultOutputDir = `${scan.folder.replace(/\/$/, "")}/.docling-out`;
      let session = await api.createTasteSession({
        scan_id: scan.scan_id,
        output_dir: defaultOutputDir,
      });
      for (const s of session.strata ?? []) {
        // Serial lock — each PATCH returns a new version we must use next.
        session = await api.patchTasteSession(session.id, {
          version: session.version ?? 0,
          lock_stratum: { stratum: s.name, locked: true },
        });
      }
      // Fire the batch immediately — defaults across the board, no per-doc tuning.
      // User wanted "skip to batch", they get straight to Watch with progress.
      const job = await api.batch({
        scan_id: scan.scan_id,
        root: scan.folder,
        output_dir: defaultOutputDir,
      } as never);
      return { session, job };
    },
    onSuccess: ({ session, job }) => {
      sessionStore.setTasteSessionId(session.id);
      sessionStore.setOutputDir(session.output_dir);
      sessionStore.setJobId(job.id);
      toast.push({
        kind: "success",
        title: "Conversion started",
        detail: `${job.progress?.docs_total ?? "?"} documents queued. Walk away if you want.`,
      });
      setStage("batch");
    },
    onError: (err) => {
      toast.push({
        kind: "danger",
        title: "Couldn't start conversion",
        detail: err instanceof Error ? err.message : String(err),
      });
    },
  });

  const rescan = useMutation({
    mutationFn: async (folderPath: string) =>
      api.scan({ folder: folderPath, follow_symlinks: false, max_files: 50000 }),
    onSuccess: (result) => {
      setScan(result);
      setFolder(result.folder);
      toast.push({
        kind: "success",
        title: "Scan complete",
        detail: `${result.total_files} files across ${result.strata.length} strata`,
      });
    },
    onError: (err) => {
      setScan(null);
      if (err instanceof ApiError) {
        toast.push({
          kind: err.status === 0 ? "warning" : "danger",
          title:
            err.status === 0 ? "Backend not reachable" : `Scan failed (${err.status})`,
          detail: err.message + (err.detail ? ` — ${err.detail}` : ""),
        });
      } else {
        toast.push({ kind: "danger", title: "Scan failed", detail: String(err) });
      }
    },
  });

  // Screen 1 — folder entry (prism glyph hero)
  if (!folder && !scan) {
    return <FolderEntry />;
  }

  if (!scan) {
    return (
      <div className="h-full flex items-center justify-center p-8 relative">
        <PrismGlyph />
        <div className="relative z-[2] max-w-md text-center space-y-2">
          <div className="label-eyebrow">Waiting on scan</div>
          <div className="text-lg text-fg-primary font-medium">Scan pending</div>
          <div className="text-sm text-fg-muted">
            Validate{" "}
            <span className="mono text-fg-secondary">{folder}</span> to see the
            stratum breakdown.
          </div>
        </div>
      </div>
    );
  }

  // Screen 2 — scan results (spectrum bar + detail cards)
  const strata = scan.strata ?? [];
  const total = strata.reduce((n, s) => n + (s.size ?? 0), 0);

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Action bar at top */}
      <div className="h-11 flex items-center gap-3 px-5 border-b border-border-subtle bg-surface-0">
        <span className="label-eyebrow">Scan · step 1 of 3</span>
        <span className="text-fg-disabled text-[11px]">·</span>
        <span className="text-fg-muted text-[11.5px]">
          Groups of docs that share a conversion pipeline
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPickerOpen(true)}
          disabled={rescan.isPending}
          title="Pick a different folder and re-scan"
        >
          {rescan.isPending ? "Scanning…" : "Change folder…"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setStage("taste")}
          title="Sample a few docs and verify quality before converting"
        >
          Preview a few first
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => skipToBatch.mutate()}
          disabled={skipToBatch.isPending}
          title="Lock all groups at defaults and start converting"
        >
          {skipToBatch.isPending ? "Preparing…" : "Start converting →"}
        </Button>
      </div>

      {pickerOpen && (
        <FolderPicker
          initialPath={folder || null}
          onPick={(path) => {
            setPickerOpen(false);
            rescan.mutate(path);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <div className="flex-1 overflow-auto p-7">
        {/* Headline */}
        <div className="mb-6">
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight">
            <span className="num">{total.toLocaleString()}</span> documents,{" "}
            <span className="num">{strata.length}</span> natural group
            {strata.length === 1 ? "" : "s"}.
          </h1>
          <div className="text-sm text-fg-muted mt-1">
            Each group gets its own conversion settings. Start converting with
            sensible defaults, or preview a few first to tune.
          </div>
        </div>

        {/* Spectrum bar — the novel moment */}
        {strata.length > 0 && (
          <div className="mb-9">
            <div
              className="h-11 flex gap-0.5 rounded overflow-hidden border border-border-subtle"
            >
              {strata.map((s, i) => (
                <div
                  key={s.name}
                  className="relative"
                  style={{
                    flex: s.size || 1,
                    background: colorFor(i),
                    opacity: 0.85,
                    minWidth: 14,
                  }}
                  title={`${s.name} · ${s.size}`}
                >
                  <div
                    className="absolute inset-0"
                    style={{
                      background:
                        "linear-gradient(180deg, rgba(255,255,255,0.15), rgba(0,0,0,0.1))",
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-0.5 mt-1.5">
              {strata.map((s) => (
                <div
                  key={s.name}
                  className="flex flex-col gap-px overflow-hidden"
                  style={{ flex: s.size || 1, minWidth: 14 }}
                >
                  <span className="mono text-[10px] text-fg-muted leading-tight truncate">
                    {s.name}
                  </span>
                  <span className="num text-[10.5px] text-fg-disabled">
                    {s.size}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Detail cards */}
        <div className="label-eyebrow mb-2.5">Detail</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {strata.map((s, i) => (
            <Card key={s.name} className="p-4 flex gap-3.5">
              <div
                className="w-[3px] rounded-sm flex-shrink-0"
                style={{ background: colorFor(i) }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="mono text-[12.5px] text-fg-primary font-medium">
                    {s.name}
                  </span>
                  {s.exhaustive && <Badge tone="cyan">exhaust</Badge>}
                  <div className="flex-1" />
                  <span className="num text-fg-muted text-[12px]">
                    {s.size} docs
                  </span>
                </div>
                {s.example_paths.length > 0 && (
                  <div className="text-[12px] text-fg-muted truncate">
                    {s.example_paths[0].split("/").pop()}
                    {s.example_paths.length > 1 && (
                      <span className="text-fg-disabled">
                        {" "}
                        · +{s.example_paths.length - 1} more
                      </span>
                    )}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>

        {/* Folder tree / filemap — collapsed below */}
        <FilemapTreePanel root={scan.folder} />

        {/* Skipped */}
        {scan.skipped && scan.skipped.length > 0 && (
          <div className="mt-5 flex items-center gap-2.5 px-3.5 py-2.5 bg-surface-1 border border-border-subtle rounded-md">
            <Dot />
            <span className="text-fg-muted text-[12px]">
              <span className="num text-fg-secondary">{scan.skipped.length}</span>{" "}
              files skipped
              <span className="text-fg-disabled mx-1.5">·</span>
              <span className="mono">images, .DS_Store, .git/, &gt;100MB</span>
            </span>
            <div className="flex-1" />
            <details>
              <summary className="text-[11px] text-fg-muted hover:text-fg-primary cursor-pointer">
                Review
              </summary>
              <div className="mt-2 max-h-48 overflow-auto space-y-0.5">
                {scan.skipped.map((sk, i) => (
                  <div key={i} className="text-[11px] mono text-fg-muted">
                    <span className="text-warning">{sk.reason}</span> {sk.path}
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

/* Filemap tree retained from prior impl — wiring is load-bearing */

function FilemapTreePanel({ root }: { root: string }) {
  const q = useQuery<FiletreeNode>({
    queryKey: ["filetree", root],
    queryFn: () => api.filetree(root),
    enabled: !!root,
  });
  if (q.isLoading) {
    return (
      <div className="text-xs text-fg-muted mt-5">Loading folder tree…</div>
    );
  }
  if (q.error || !q.data) return null;
  return (
    <details className="mt-6 pt-4 border-t border-border-subtle">
      <summary className="text-[11px] text-fg-muted cursor-pointer hover:text-fg-secondary">
        Folder tree · {q.data.counts?.included ?? 0}/{q.data.counts?.total ?? 0}{" "}
        included
      </summary>
      <div className="mt-2 font-mono text-xs space-y-0.5">
        <FilemapTreeNode node={q.data} depth={0} />
      </div>
    </details>
  );
}

function FilemapTreeNode({ node, depth }: { node: FiletreeNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth === 0);
  const name =
    node.folder_relative && node.folder_relative !== ""
      ? node.folder_relative.split("/").pop()
      : node.path?.split("/").pop() || "/";
  const counts = node.counts || {};
  const c = {
    included: counts.included ?? 0,
    pending: counts.pending ?? 0,
    excluded: counts.excluded ?? 0,
    total: counts.total ?? 0,
  };
  const hasFilemap = !!node.filemap;
  return (
    <div>
      <div
        className="flex items-center gap-2 py-0.5"
        style={{ paddingLeft: depth * 12 }}
      >
        <button
          type="button"
          className="text-fg-muted hover:text-fg-primary w-4 text-center"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "▾" : "▸"}
        </button>
        <span className="text-fg-primary truncate">{name}/</span>
        <Badge tone="cyan">
          {c.included}/{c.total}
        </Badge>
        {c.pending > 0 && <Badge tone="warn">{c.pending} pending</Badge>}
        {c.excluded > 0 && <Badge tone="neutral">{c.excluded} excluded</Badge>}
      </div>
      {expanded && hasFilemap && node.path && (
        <FolderFiles folder={node.path} depth={depth + 1} />
      )}
      {expanded &&
        (node.children || []).map((child) => (
          <FilemapTreeNode key={child.path} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}

interface FilemapFileEntry {
  path: string;
  detected_content_type?: string;
  detected_stratum?: string | null;
  scanner_suggestion?: string;
  user_included?: boolean | null;
}

function FolderFiles({ folder, depth }: { folder: string; depth: number }) {
  const qc = useQueryClient();
  const q = useQuery<Filemap>({
    queryKey: ["filemap", folder],
    queryFn: () => api.filemap(folder),
    enabled: !!folder,
  });

  const patchMut = useMutation({
    mutationFn: async (
      files: Array<{ path: string; user_included: boolean | null }>,
    ) => api.patchFilemap(folder, { files }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["filemap", folder] });
      qc.invalidateQueries({ queryKey: ["filetree"] });
    },
  });

  if (q.isLoading)
    return (
      <div className="text-fg-muted" style={{ paddingLeft: depth * 12 }}>
        loading files…
      </div>
    );
  if (q.error || !q.data) return null;

  const files = ((q.data as unknown as { files?: FilemapFileEntry[] }).files ??
    []) as FilemapFileEntry[];
  if (files.length === 0) return null;

  const pendingPaths = files
    .filter((f) => f.user_included == null)
    .map((f) => f.path);

  return (
    <div>
      {pendingPaths.length > 0 && (
        <div
          className="flex items-center gap-2 py-0.5 text-fg-muted"
          style={{ paddingLeft: depth * 12 }}
        >
          <button
            type="button"
            className="underline hover:text-fg-primary"
            onClick={() =>
              patchMut.mutate(
                pendingPaths.map((p) => ({ path: p, user_included: true })),
              )
            }
          >
            include all pending
          </button>
          <span>·</span>
          <button
            type="button"
            className="underline hover:text-fg-primary"
            onClick={() =>
              patchMut.mutate(
                pendingPaths.map((p) => ({ path: p, user_included: false })),
              )
            }
          >
            exclude all pending
          </button>
        </div>
      )}
      {files.map((f) => {
        const ui = f.user_included;
        const nextState: boolean | null =
          ui === true ? false : ui === false ? null : true;
        return (
          <div
            key={f.path}
            className="flex items-center gap-2 py-0.5"
            style={{ paddingLeft: depth * 12 }}
          >
            <input
              type="checkbox"
              className="h-3 w-3"
              checked={ui === true}
              ref={(el) => {
                if (el) el.indeterminate = ui == null;
              }}
              onChange={() =>
                patchMut.mutate([{ path: f.path, user_included: nextState }])
              }
            />
            <span className="truncate text-fg-primary" title={f.path}>
              {f.path}
            </span>
            {f.detected_content_type && (
              <Badge tone="neutral">{f.detected_content_type}</Badge>
            )}
            {f.detected_stratum && <Badge tone="cyan">{f.detected_stratum}</Badge>}
            {ui === false && <Badge tone="warn">excluded</Badge>}
          </div>
        );
      })}
    </div>
  );
}

// Keep the symbol used elsewhere
export { looksAbsolute };
