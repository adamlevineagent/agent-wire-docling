"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppState } from "./app-state";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { api, type Filemap, type FiletreeNode } from "../../lib/api-client";

export function ScanView() {
  const { scan, folder, setStage } = useAppState();

  if (!folder && !scan) {
    return (
      <EmptyState
        title="Enter a folder path to begin"
        detail="Paste an absolute path into the sidebar and press Validate. The scanner walks the folder, detects formats, and clusters files into strata."
      />
    );
  }

  if (!scan) {
    return (
      <EmptyState
        title="Scan pending"
        detail={`Press Validate for "${folder}" to see stratum breakdown.`}
      />
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div>
        <div className="text-xs uppercase tracking-wider text-fg-muted">
          Scanned
        </div>
        <h1 className="text-lg font-semibold font-mono break-all">{scan.folder}</h1>
        <div className="text-sm text-fg-secondary mt-1">
          <span className="tabular-nums">{scan.total_files}</span> files ·{" "}
          <span className="tabular-nums">{scan.strata.length}</span> strata ·{" "}
          <span className="tabular-nums">{scan.skipped?.length ?? 0}</span> skipped
        </div>
      </div>

      <div className="space-y-2">
        {scan.strata.map((s) => (
          <div
            key={s.name}
            className="flex items-start gap-4 p-3 rounded border border-border-default bg-surface-1 hover:bg-surface-2"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="font-mono text-sm text-fg-primary">{s.name}</div>
                {s.exhaustive && <Badge tone="info">exhaustive · size ≤ 6</Badge>}
              </div>
              <div className="text-xs text-fg-muted mt-0.5">
                {s.size} files · sample hint {s.sample_size_hint}
              </div>
              {s.example_paths.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {s.example_paths.slice(0, 3).map((p) => (
                    <li
                      key={p}
                      className="text-xs font-mono text-fg-muted truncate"
                      title={p}
                    >
                      {p}
                    </li>
                  ))}
                  {s.example_paths.length > 3 && (
                    <li className="text-xs text-fg-muted italic">
                      + {s.example_paths.length - 3} more
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>
        ))}
      </div>

      {scan.strata.length > 0 && (
        <div className="pt-3 border-t border-border-default">
          <Button variant="primary" onClick={() => setStage("taste")}>
            Start taste test →
          </Button>
          <div className="text-xs text-fg-muted mt-2">
            Or curate inclusion directly in the folder tree below.
          </div>
        </div>
      )}

      <FilemapTreePanel root={scan.folder} />

      {scan.skipped && scan.skipped.length > 0 && (
        <details className="pt-3 border-t border-border-default">
          <summary className="text-xs text-fg-muted cursor-pointer">
            {scan.skipped.length} skipped files
          </summary>
          <ul className="mt-2 space-y-0.5 max-h-48 overflow-auto">
            {scan.skipped.map((sk, i) => (
              <li key={i} className="text-xs font-mono text-fg-muted">
                <span className="text-warning-fg">{sk.reason}</span> {sk.path}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function FilemapTreePanel({ root }: { root: string }) {
  const q = useQuery<FiletreeNode>({
    queryKey: ["filetree", root],
    queryFn: () => api.filetree(root),
    enabled: !!root,
  });
  if (q.isLoading) {
    return <div className="text-xs text-fg-muted">Loading folder tree…</div>;
  }
  if (q.error || !q.data) return null;
  return (
    <details className="pt-3 border-t border-border-default" open>
      <summary className="text-xs text-fg-muted cursor-pointer">
        Folder tree · {q.data.counts?.included ?? 0}/{q.data.counts?.total ?? 0} included
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
          title={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? "▾" : "▸"}
        </button>
        <span className="text-fg-primary truncate">{name}/</span>
        <Badge tone="info">
          {c.included}/{c.total}
        </Badge>
        {c.pending > 0 && <Badge tone="warning">{c.pending} pending</Badge>}
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
      // Refresh the parent filetree counts.
      qc.invalidateQueries({ queryKey: ["filetree"] });
    },
  });

  if (q.isLoading)
    return (
      <div className="text-fg-muted pl-4" style={{ paddingLeft: depth * 12 }}>
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
        // tri-state: true=check, false=empty-explicit, null=indeterminate
        const effective =
          ui === true
            ? "included"
            : ui === false
              ? "excluded"
              : f.scanner_suggestion === "include"
                ? "pending-include"
                : "pending-exclude";
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
                patchMut.mutate([
                  { path: f.path, user_included: nextState },
                ])
              }
              title={`click to cycle: ${effective} → ${
                nextState === true ? "included" : nextState === false ? "excluded" : "pending"
              }`}
            />
            <span className="truncate text-fg-primary" title={f.path}>
              {f.path}
            </span>
            {f.detected_content_type && (
              <Badge tone="neutral">{f.detected_content_type}</Badge>
            )}
            {f.detected_stratum && (
              <Badge tone="info">{f.detected_stratum}</Badge>
            )}
            {ui === false && <Badge tone="warning">excluded</Badge>}
          </div>
        );
      })}
    </div>
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
