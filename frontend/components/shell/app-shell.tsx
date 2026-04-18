"use client";

import { useMemo } from "react";
import { Sidebar } from "./sidebar";
import { TopBar } from "./topbar";
import { WindowChrome } from "./window-chrome";
import { useAppState } from "./app-state";
import { ScanView } from "./scan-view";
import { TasteTestSlot, BatchRunSlot } from "./stage-slots";
import { ShortcutHelp } from "./shortcut-help";
import { useShortcutScope, GLOBAL_BINDINGS } from "../../lib/shortcuts";

export function AppShell() {
  const { stage, helpOpen, setHelpOpen, setStage, focusPathInput, folder } =
    useAppState();

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

  const chromeTitle = folder || "agent-wire-docling";
  const subtitle =
    stage === "scan" ? "scan" : stage === "taste" ? "taste" : "batch";

  return (
    <div className="h-screen flex flex-col bg-surface-0 text-fg-primary relative">
      <WindowChrome title={chromeTitle} subtitle={subtitle} />
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar />
          <main className="flex-1 overflow-auto relative">{main}</main>
        </div>
      </div>
      {helpOpen && <ShortcutHelp />}
    </div>
  );
}
