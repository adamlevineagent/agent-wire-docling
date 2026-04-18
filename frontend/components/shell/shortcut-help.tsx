"use client";

import { useAppState } from "./app-state";
import { useShortcutRegistry } from "../../lib/shortcuts";
import { Kbd } from "../ui/kbd";
import { cn } from "../../lib/cn";

/**
 * Overlay listing every currently-active scope's bindings. Triggered by `?`.
 */
export function ShortcutHelp() {
  const { helpOpen, setHelpOpen } = useAppState();
  const regs = useShortcutRegistry();

  if (!helpOpen) return null;

  const active = regs.filter((r) => r.active);
  // Bring global to the end; vizdiff first
  active.sort((a, b) => {
    const order = (s: string) =>
      s === "global" ? 99 : s.startsWith("vizdiff") ? 0 : s === "advanced" ? 1 : s === "tastetest" ? 2 : s === "batchrun" ? 3 : 50;
    return order(a.scope) - order(b.scope);
  });

  return (
    <div
      className="fixed inset-0 z-40 bg-surface-0/80 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={() => setHelpOpen(false)}
    >
      <div
        className="w-[640px] max-w-full max-h-[80vh] overflow-auto bg-surface-1 border border-border-default rounded-md shadow"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border-default flex items-center justify-between">
          <div className="text-sm font-semibold">Keyboard shortcuts</div>
          <div className="text-xs text-fg-muted">
            press <Kbd>Esc</Kbd> or <Kbd>?</Kbd> to close
          </div>
        </div>
        <div className="p-4 space-y-4">
          {active.length === 0 && (
            <div className="text-sm text-fg-muted italic">
              No scopes registered yet.
            </div>
          )}
          {active.map((r) => (
            <div key={r.id}>
              <div
                className={cn(
                  "text-xs uppercase tracking-wider mb-1.5",
                  r.scope === "global" ? "text-fg-muted" : "text-accent",
                )}
              >
                {r.scope}
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                {Object.entries(r.bindings).map(([key, action]) => (
                  <div key={key} className="contents">
                    <div className="flex gap-1 items-center">
                      {key.split(" ").map((k, i) => (
                        <Kbd key={i}>{k}</Kbd>
                      ))}
                    </div>
                    <div className="text-fg-secondary">{action}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
