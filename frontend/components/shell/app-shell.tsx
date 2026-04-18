"use client";

import { useMemo } from "react";
import { Sidebar } from "./sidebar";
import { TopBar } from "./topbar";
import { useAppState } from "./app-state";
import { ScanView } from "./scan-view";
import { TasteTestSlot, BatchRunSlot } from "./stage-slots";
import { ShortcutHelp } from "./shortcut-help";
import { useShortcutScope, GLOBAL_BINDINGS } from "../../lib/shortcuts";

export function AppShell() {
  const { stage, helpOpen, setHelpOpen, setStage, focusPathInput } = useAppState();

  const handlers = useMemo(
    () => ({
      help: () => setHelpOpen(true),
      search: () => focusPathInput(),
      "close-dialog": () => setHelpOpen(false),
      "goto-scan": () => setStage("scan"),
      "goto-tastetest": () => setStage("taste"),
      "goto-batchrun": () => setStage("batch"),
    }),
    [setHelpOpen, setStage, focusPathInput],
  );

  useShortcutScope({
    scope: "global",
    bindings: GLOBAL_BINDINGS,
    handlers,
  });

  let main: React.ReactNode;
  if (stage === "scan") main = <ScanView />;
  else if (stage === "taste") main = <TasteTestSlot />;
  else main = <BatchRunSlot />;

  return (
    <div className="h-screen flex flex-col bg-surface-0 text-fg-primary">
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar />
          <main className="flex-1 overflow-auto">{main}</main>
        </div>
      </div>
      {helpOpen && <ShortcutHelp />}
    </div>
  );
}
