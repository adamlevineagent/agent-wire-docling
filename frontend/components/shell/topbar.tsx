"use client";

import { useAppState, type Stage } from "./app-state";
import { cn } from "../../lib/cn";
import { HealthIndicator } from "./health-panel";
import { Kbd } from "../ui/kbd";

const STAGES: { id: Stage; label: string; chord: string }[] = [
  { id: "scan", label: "Scan", chord: "g s" },
  { id: "taste", label: "Taste", chord: "g t" },
  { id: "batch", label: "Batch", chord: "g b" },
];

export function TopBar() {
  const { stage, setStage, folder, setHelpOpen } = useAppState();

  return (
    <header className="h-10 shrink-0 flex items-center gap-3 px-3 border-b border-border-default bg-surface-1">
      <div className="flex items-center gap-0.5 bg-surface-0 p-0.5 rounded border border-border-default">
        {STAGES.map((s) => {
          const active = s.id === stage;
          return (
            <button
              key={s.id}
              onClick={() => setStage(s.id)}
              className={cn(
                "h-6 px-2.5 rounded-sm text-xs font-medium transition-colors",
                active
                  ? "bg-accent text-accent-fg"
                  : "text-fg-secondary hover:text-fg-primary hover:bg-surface-3",
              )}
              title={`${s.label} (${s.chord})`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-w-0 flex items-center gap-2 text-xs text-fg-muted">
        {folder ? (
          <span className="font-mono truncate" title={folder}>
            {folder}
          </span>
        ) : (
          <span className="italic">no folder selected</span>
        )}
      </div>

      <button
        onClick={() => setHelpOpen(true)}
        className="text-xs text-fg-muted hover:text-fg-primary flex items-center gap-1.5"
        title="Shortcut help"
      >
        <Kbd>?</Kbd>
        help
      </button>

      <HealthIndicator />
    </header>
  );
}
