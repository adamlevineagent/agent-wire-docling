"use client";

/**
 * UI-local app state: current stage, current folder, latest scan result.
 * Server state (mutations, queries) lives in TanStack Query; this context is
 * the tiny slice that multiple shell panels need without prop-drilling.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ScanResult } from "../../lib/api-client";
import { sessionStore } from "../BatchRun/session-store";

export type Stage = "scan" | "taste" | "batch";

interface AppStateValue {
  stage: Stage;
  setStage: (s: Stage) => void;

  folder: string;
  setFolder: (f: string) => void;

  scan: ScanResult | null;
  setScan: (s: ScanResult | null) => void;

  helpOpen: boolean;
  setHelpOpen: (b: boolean) => void;

  focusPathInput: () => void;
  registerPathInputFocuser: (fn: () => void) => void;
}

const Ctx = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [stage, setStage] = useState<Stage>("scan");
  const [folder, setFolderState] = useState("");
  const [scan, setScanState] = useState<ScanResult | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  // Hydrate from localStorage on mount so reload survives.
  useEffect(() => {
    const f = sessionStore.getFolder();
    if (f) setFolderState(f);
    const s = sessionStore.getScanResult<ScanResult>();
    if (s) setScanState(s);
  }, []);

  // Persist on change (so failed-batch resume + boss-mode discovery work
  // even after a hard reload — the user's scan context isn't ephemeral).
  const setFolder = useCallback((f: string) => {
    setFolderState(f);
    sessionStore.setFolder(f || null);
  }, []);
  const setScan = useCallback((s: ScanResult | null) => {
    setScanState(s);
    sessionStore.setScanResult(s);
  }, []);

  const focuserRef = { current: null as (() => void) | null };
  const focusPathInput = useCallback(() => focuserRef.current?.(), []);
  const registerPathInputFocuser = useCallback((fn: () => void) => {
    focuserRef.current = fn;
  }, []);

  const value = useMemo<AppStateValue>(
    () => ({
      stage,
      setStage,
      folder,
      setFolder,
      scan,
      setScan,
      helpOpen,
      setHelpOpen,
      focusPathInput,
      registerPathInputFocuser,
    }),
    [stage, folder, scan, helpOpen, focusPathInput, registerPathInputFocuser],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppState requires <AppStateProvider>");
  return ctx;
}
