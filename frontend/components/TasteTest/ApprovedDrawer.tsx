"use client";

/**
 * Collapsible drawer listing every approval in the active stratum, with a
 * visual mark for approvals made under an older pipeline_hash.
 */

import type { StratumState } from "./types";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/cn";

export function ApprovedDrawer(props: {
  stratum: StratumState;
  onOpenHash: (hash: string) => void;
  open: boolean;
  currentPipelineHash?: string;
}) {
  const { stratum, onOpenHash, open, currentPipelineHash } = props;
  if (!open) return null;
  const approvals = (stratum.approvals ?? []).filter((a) => a.status === "approved");
  return (
    <div className="border-t border-border-default bg-surface-1 max-h-56 overflow-auto">
      <div className="px-3 py-2 text-xs uppercase tracking-wider text-fg-muted flex items-center gap-2">
        Approved · {stratum.name}
        <Badge tone="success">{approvals.length}</Badge>
      </div>
      {approvals.length === 0 ? (
        <div className="px-3 py-4 text-sm text-fg-muted italic">
          No approvals yet in this stratum.
        </div>
      ) : (
        <ul className="divide-y divide-border-default">
          {approvals.map((a) => {
            const stale =
              currentPipelineHash &&
              a.pipeline_hash &&
              a.pipeline_hash !== currentPipelineHash;
            return (
              <li
                key={a.source_sha256}
                className={cn(
                  "px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-surface-2 cursor-pointer",
                )}
                onClick={() => onOpenHash(a.source_sha256)}
                title={a.source_sha256}
              >
                <span className="font-mono truncate max-w-[28ch]">
                  {a.source_sha256.slice(0, 12)}
                </span>
                {stale && <Badge tone="warning">under old pipeline</Badge>}
                {a.notes && <span className="text-fg-muted truncate">{a.notes}</span>}
                <span className="ml-auto text-fg-muted font-mono">
                  {new Date(a.reviewed_at).toLocaleTimeString()}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
