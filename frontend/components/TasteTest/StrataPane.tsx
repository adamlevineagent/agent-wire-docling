"use client";

/**
 * Left pane: list of strata + sample / lock / change-pipeline buttons.
 * Convergence hints shown next to lock as soft nudges (contracts/ux).
 */

import { useMemo } from "react";
import type { TasteSession, Stratum } from "../../lib/api-client";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { cn } from "../../lib/cn";
import {
  approvalCount,
  convergenceHint,
  lookGoodToLock,
} from "./helpers";

type StatusTone = "neutral" | "accent" | "success" | "warning" | "info" | "danger";

function statusChipTone(status: string): StatusTone {
  switch (status) {
    case "converged":
      return "success";
    case "non_convergent":
      return "warning";
    case "exhausted":
      return "info";
    case "under_review":
      return "neutral";
    default:
      return "neutral";
  }
}

export function StrataPane(props: {
  session: TasteSession;
  scanStrata: Stratum[];
  activeStratum: string | null;
  onSelect: (name: string) => void;
  onSample: (name: string) => void;
  onLock: (name: string, locked: boolean) => void;
  onOpenAdvanced: (name: string) => void;
  sampling: string | null;
}) {
  const { session, scanStrata, activeStratum, onSelect, onSample, onLock, onOpenAdvanced, sampling } = props;

  const scanByName = useMemo(() => {
    const m = new Map<string, Stratum>();
    for (const s of scanStrata) m.set(s.name, s);
    return m;
  }, [scanStrata]);

  return (
    <div className="h-full overflow-auto border-r border-border-default bg-surface-1">
      <div className="px-3 py-2 border-b border-border-default text-xs uppercase tracking-wider text-fg-muted">
        Strata ({session.strata.length})
      </div>
      <ul>
        {session.strata.map((s) => {
          const counts = approvalCount(s);
          const scan = scanByName.get(s.name);
          const selected = activeStratum === s.name;
          const canLockNudge = lookGoodToLock(s) && !s.locked;
          return (
            <li
              key={s.name}
              className={cn(
                "border-b border-border-default px-3 py-2 cursor-pointer",
                selected ? "bg-surface-2" : "hover:bg-surface-2/60",
              )}
              onClick={() => onSelect(s.name)}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-fg-primary truncate">{s.name}</span>
                <Badge tone={statusChipTone(s.status)}>{s.status}</Badge>
                {s.locked && <Badge tone="success">locked</Badge>}
                {scan?.exhaustive && <Badge tone="info">exhaustive</Badge>}
              </div>
              <div className="text-xs text-fg-muted mt-1 tabular-nums">
                {counts.approved}/{counts.reviewed} approved of {s.size}
              </div>
              <div
                className={cn(
                  "text-xs mt-0.5",
                  canLockNudge ? "text-success-fg" : "text-fg-muted",
                )}
              >
                {convergenceHint(s)}
              </div>
              <div
                className="flex items-center gap-1 mt-2"
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!!sampling || s.locked}
                  onClick={() => onSample(s.name)}
                >
                  {sampling === s.name ? "Sampling…" : "Sample"}
                </Button>
                <Button
                  size="sm"
                  variant={s.locked ? "secondary" : canLockNudge ? "primary" : "ghost"}
                  onClick={() => onLock(s.name, !s.locked)}
                  title={canLockNudge ? "Looks good to lock (l)" : undefined}
                >
                  {s.locked ? "Unlock" : "Lock"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onOpenAdvanced(s.name)}>
                  Pipeline
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
