"use client";

import { useAppState } from "./app-state";
import { FolderInput } from "./folder-input";
import { Badge } from "../ui/badge";

export function Sidebar() {
  const { scan } = useAppState();

  return (
    <aside className="w-72 shrink-0 h-full border-r border-border-default bg-surface-1 flex flex-col">
      <div className="p-3 border-b border-border-default">
        <FolderInput />
      </div>

      <div className="flex-1 overflow-auto">
        <div className="p-3">
          <div className="text-xs uppercase tracking-wider text-fg-muted mb-2">
            Strata
          </div>
          {!scan && (
            <div className="text-xs text-fg-muted italic">
              Validate a folder to see strata.
            </div>
          )}
          {scan && scan.strata.length === 0 && (
            <div className="text-xs text-fg-muted italic">
              No recognized documents.
            </div>
          )}
          {scan && scan.strata.length > 0 && (
            <ul className="space-y-1">
              {scan.strata.map((s) => (
                <li
                  key={s.name}
                  className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-surface-2"
                >
                  <span className="font-mono text-xs truncate" title={s.name}>
                    {s.name}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {s.exhaustive && <Badge tone="info">exhaust</Badge>}
                    <span className="text-xs text-fg-muted tabular-nums">
                      {s.size}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="p-3 border-t border-border-default text-xs text-fg-muted">
        <span className="font-mono">agent-wire-docling</span>
        <span className="mx-1.5">·</span>
        <span>prototype</span>
      </div>
    </aside>
  );
}
