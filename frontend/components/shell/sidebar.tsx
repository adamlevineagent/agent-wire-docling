"use client";

import { useAppState, type Stage } from "./app-state";
import { cn } from "../../lib/cn";
import { Dot } from "../ui/dot";
import { Kbd } from "../ui/kbd";

type StageDef = { id: Stage; label: string; sub: string };

const STAGES: StageDef[] = [
  { id: "scan", label: "Scan", sub: "find & group" },
  { id: "taste", label: "Taste test", sub: "verify quality" },
  { id: "batch", label: "Batch run", sub: "convert all" },
];

export function Sidebar() {
  const { stage, setStage, folder, scan, setHelpOpen } = useAppState();
  const idx = STAGES.findIndex((s) => s.id === stage);

  // Status snapshot values (best-effort; undefined becomes dim)
  const filesCount = scan ? (scan.strata ?? []).reduce((n, s) => n + (s.size ?? 0), 0) : null;
  const strataCount = scan ? (scan.strata ?? []).length : null;

  return (
    <aside className="w-[220px] shrink-0 h-full border-r border-border-subtle bg-surface-1 flex flex-col">
      {/* Brand + folder */}
      <div className="px-3.5 pt-3.5 pb-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 mb-2.5">
          <div
            className="w-[22px] h-[22px] rounded flex items-center justify-center text-[11px] font-bold"
            style={{
              background: "linear-gradient(135deg, var(--cyan), var(--gold))",
              color: "#001018",
              letterSpacing: -0.5,
            }}
          >
            D
          </div>
          <div className="text-sm font-semibold text-fg-primary">Docling</div>
          <div className="flex-1" />
          <span className="mono text-[9.5px] text-fg-disabled">v0.1</span>
        </div>
        <div className="label-eyebrow mb-1">Corpus</div>
        <div
          className="mono text-[11px] text-fg-secondary leading-snug break-all"
          title={folder || undefined}
        >
          {folder || <span className="text-fg-disabled">no folder selected</span>}
        </div>
      </div>

      {/* Stages */}
      <div className="py-2.5">
        <div className="label-eyebrow px-3.5 pb-1.5">Pipeline</div>
        {STAGES.map((s, i) => {
          const isActive = s.id === stage;
          const isDone = i < idx;
          return (
            <button
              key={s.id}
              onClick={() => setStage(s.id)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3.5 py-1.5 text-xs text-left",
                "border-l-2 cursor-pointer transition-colors",
                isActive
                  ? "border-l-cyan bg-[linear-gradient(90deg,var(--cyan-soft),transparent_60%)] text-fg-primary"
                  : "border-l-transparent text-fg-secondary hover:bg-surface-2",
              )}
              title={`${s.label}`}
            >
              <span className="mono text-[10px] w-3 text-fg-disabled">
                {isDone ? (
                  <span className="text-success">✓</span>
                ) : (
                  <span>{i + 1}</span>
                )}
              </span>
              <div className="flex-1 min-w-0">
                <div className={cn("leading-tight", isActive && "font-semibold text-fg-primary")}>
                  {s.label}
                </div>
                <div className="text-fg-muted text-[10.5px] leading-tight">{s.sub}</div>
              </div>
              {isActive && <Dot tone="cyan" />}
              {isDone && <Dot tone="ok" />}
            </button>
          );
        })}
      </div>

      {/* Status snapshot */}
      <div className="px-3.5 pt-2 pb-3 border-t border-border-subtle">
        {filesCount != null && (
          <div className="text-[11px] text-fg-muted mb-1.5">
            <span className="num text-fg-secondary">{filesCount}</span> files ·{" "}
            <span className="num text-fg-secondary">{strataCount}</span> strata
          </div>
        )}
        {filesCount == null && (
          <div className="text-[11px] text-fg-disabled italic">
            scan a folder to see counts
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* Help footer */}
      <button
        onClick={() => setHelpOpen(true)}
        className="px-3.5 py-2.5 border-t border-border-subtle flex items-center gap-2 text-[11px] text-fg-muted hover:text-fg-primary hover:bg-surface-2 transition-colors"
      >
        <Kbd>?</Kbd>
        <span>keyboard help</span>
      </button>
    </aside>
  );
}
