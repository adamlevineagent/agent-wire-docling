"use client";

import { useAppState } from "./app-state";
import { HealthIndicator } from "./health-panel";

const STAGE_META: Record<string, { label: string; step: string }> = {
  scan: { label: "Scan", step: "step 1 of 3" },
  taste: { label: "Taste", step: "step 2 of 3" },
  batch: { label: "Batch", step: "step 3 of 3" },
};

export function TopBar() {
  const { stage } = useAppState();
  const meta = STAGE_META[stage];

  return (
    <header className="h-[42px] shrink-0 flex items-center gap-3 px-4 border-b border-border-subtle bg-surface-0">
      <span className="label-eyebrow">{meta.label}</span>
      <span className="text-fg-disabled text-[11px]">·</span>
      <span className="text-fg-muted text-[11.5px]">{meta.step}</span>

      <div className="flex-1 min-w-0" />

      <HealthIndicator />
    </header>
  );
}
