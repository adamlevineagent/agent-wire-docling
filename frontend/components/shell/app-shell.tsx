"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "./sidebar";
import { TopBar } from "./topbar";
import { WindowChrome } from "./window-chrome";
import { useAppState } from "./app-state";
import { ScanView } from "./scan-view";
import { TasteTestSlot, BatchRunSlot } from "./stage-slots";
import { ShortcutHelp } from "./shortcut-help";
import { useShortcutScope, GLOBAL_BINDINGS } from "../../lib/shortcuts";
import { api, type ApiError, type Job } from "../../lib/api-client";
import { sessionStore } from "../BatchRun/session-store";
import { useToast } from "../ui/toast";

export function AppShell() {
  const { stage, helpOpen, setHelpOpen, setStage, focusPathInput, folder } =
    useAppState();
  const toast = useToast();
  const lastDiscoveredJob = useRef<string | null>(null);

  // Boss mode: discover any active batch from anywhere, regardless of stage.
  // When a NEW job appears (one we haven't seen before), auto-switch to the
  // Convert stage so the user sees what their agent kicked off.
  const latestQ = useQuery<Job | null, ApiError>({
    queryKey: ["jobs-latest"],
    queryFn: () => api.latestJob(),
    refetchInterval: 3_000,
    staleTime: 0,
    retry: false,
  });

  useEffect(() => {
    const j = latestQ.data;
    if (!j || !j.id) return;
    const known = sessionStore.getJobId();
    if (lastDiscoveredJob.current === j.id) return;
    lastDiscoveredJob.current = j.id;
    if (j.id === known) return; // already adopted
    sessionStore.setJobId(j.id);
    if (j.status === "running" || j.status === "queued") {
      toast.push({
        kind: "info",
        title: "Batch detected",
        detail: `Picked up ${j.id.slice(0, 8)}…  Switching to Convert.`,
      });
      if (stage !== "batch") setStage("batch");
    }
  }, [latestQ.data, setStage, stage, toast]);

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
