"use client";

/**
 * Thumbnail/row grid of picked sample docs for the active stratum.
 * Each entry shows filename + current review state + convert status.
 */

import { Badge } from "../ui/badge";
import { cn } from "../../lib/cn";
import type { DocApproval } from "./types";

export interface SampleEntry {
  hash: string;
  source_path: string;
  source_format: string;
  approval?: DocApproval;
  convertStatus: "pending" | "converting" | "ready" | "error";
  convertError?: string | null;
}

function basename(p: string): string {
  return p.split("/").pop() ?? p;
}

function toneForApproval(a?: DocApproval) {
  if (!a) return "neutral" as const;
  switch (a.status) {
    case "approved":
      return "success" as const;
    case "rejected":
      return "danger" as const;
    case "skipped":
      return "info" as const;
    case "flagged":
      return "warning" as const;
  }
}

export function SampleGrid(props: {
  samples: SampleEntry[];
  activeHash: string | null;
  onSelect: (hash: string) => void;
  stratumName: string;
}) {
  const { samples, activeHash, onSelect, stratumName } = props;
  if (samples.length === 0) {
    return (
      <div className="px-3 py-4 text-sm text-fg-muted italic">
        No samples pulled yet. Press <span className="font-mono">Sample</span> on the stratum.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2 p-2">
      {samples.map((e) => (
        <button
          key={e.hash}
          onClick={() => onSelect(e.hash)}
          className={cn(
            "text-left p-2 rounded border bg-surface-1 hover:bg-surface-2 border-border-default",
            activeHash === e.hash && "ring-2 ring-accent border-accent",
          )}
          title={e.source_path}
        >
          <div className="flex items-center gap-1 mb-1">
            <Badge tone="neutral">{e.source_format}</Badge>
            {e.approval && (
              <Badge tone={toneForApproval(e.approval)}>{e.approval.status}</Badge>
            )}
            {e.convertStatus === "converting" && <Badge tone="info">converting…</Badge>}
            {e.convertStatus === "error" && <Badge tone="danger">convert failed</Badge>}
          </div>
          <div className="text-xs font-mono text-fg-primary truncate">
            {basename(e.source_path)}
          </div>
          <div className="text-[10px] font-mono text-fg-muted truncate">{stratumName}</div>
          {e.convertError && (
            <div className="text-[10px] text-danger-fg truncate mt-0.5">{e.convertError}</div>
          )}
        </button>
      ))}
    </div>
  );
}
