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
  useMemo,
  useState,
} from "react";
import type { ScanResult } from "../../lib/api-client";

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
  const [folder, setFolder] = useState("");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

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
