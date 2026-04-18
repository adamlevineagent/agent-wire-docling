"use client";

/**
 * Shortcut manager — implements contracts/shortcuts.ts.
 *
 * Rules (from the contract):
 *  - At most one scope active per scope-class. vizdiff:*, tastetest, batchrun, advanced.
 *  - "global" is always active, runs LAST as fallthrough.
 *  - Scope activation follows focus: a scope registered inside a DOM subtree
 *    is active when that subtree (or a descendant) owns document.activeElement
 *    OR when the user's recent interaction was within it.
 *  - "advanced" masks "tastetest" when open.
 *
 * Implementation:
 *  - A global provider owns the registry (a ref). Each `useShortcutScope` call
 *    registers/unregisters a scope with a DOM element and its bindings.
 *  - A single window keydown listener dispatches to the active scope, then
 *    to global. Chord sequences (e.g. "g s") are supported with a 1s window.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ShortcutBindings,
  ShortcutScope,
  UseShortcutScopeArgs,
} from "../../contracts/shortcuts";

export type { ShortcutBindings, ShortcutScope } from "../../contracts/shortcuts";
export {
  GLOBAL_BINDINGS,
  TASTETEST_BINDINGS,
  BATCHRUN_BINDINGS,
} from "../../contracts/shortcuts";

// ──────────────────────────────────────────────────────────────────────────

interface Registration {
  id: number;
  scope: ShortcutScope;
  bindings: ShortcutBindings;
  handlers: Record<string, (e: KeyboardEvent) => void>;
  active: boolean;
  element: HTMLElement | null;
}

interface RegistryState {
  regs: Registration[];
}

interface RegistryCtxValue {
  register: (r: Omit<Registration, "id">) => number;
  unregister: (id: number) => void;
  update: (id: number, patch: Partial<Omit<Registration, "id">>) => void;
  // Returns the current snapshot. Used by help overlay.
  getSnapshot: () => Registration[];
  subscribe: (listener: () => void) => () => void;
}

const RegistryCtx = createContext<RegistryCtxValue | null>(null);

let nextId = 1;

function scopeClass(s: ShortcutScope): string {
  if (s.startsWith("vizdiff:")) return "vizdiff";
  return s;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

function keyFromEvent(e: KeyboardEvent): string {
  // Escape is special
  if (e.key === "Escape") return "Escape";
  // Printable: use the literal key (shift yields capital S)
  if (e.key.length === 1) return e.key;
  return e.key;
}

// ──────────────────────────────────────────────────────────────────────────

export function ShortcutProvider({ children }: { children: React.ReactNode }) {
  const state = useRef<RegistryState>({ regs: [] });
  const listeners = useRef<Set<() => void>>(new Set());
  const chordBuffer = useRef<string>("");
  const chordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback(() => {
    listeners.current.forEach((l) => l());
  }, []);

  const register = useCallback(
    (r: Omit<Registration, "id">) => {
      const id = nextId++;
      state.current.regs.push({ ...r, id });
      notify();
      return id;
    },
    [notify],
  );

  const unregister = useCallback(
    (id: number) => {
      state.current.regs = state.current.regs.filter((r) => r.id !== id);
      notify();
    },
    [notify],
  );

  const update = useCallback(
    (id: number, patch: Partial<Omit<Registration, "id">>) => {
      const i = state.current.regs.findIndex((r) => r.id === id);
      if (i === -1) return;
      state.current.regs[i] = { ...state.current.regs[i], ...patch };
      notify();
    },
    [notify],
  );

  const getSnapshot = useCallback(() => state.current.regs, []);
  const subscribe = useCallback((l: () => void) => {
    listeners.current.add(l);
    return () => listeners.current.delete(l);
  }, []);

  // ── Active-scope computation ────────────────────────────────────────────
  //
  // For each scope-class (except "global"), pick the active registration:
  //   1. registrations with active=false are skipped
  //   2. if one registration's element contains document.activeElement → that one
  //   3. otherwise the most recently registered
  // "advanced" masks "tastetest".

  const pickActivePerClass = (): Map<string, Registration> => {
    const active = document.activeElement as HTMLElement | null;
    const byClass = new Map<string, Registration[]>();
    for (const r of state.current.regs) {
      if (!r.active) continue;
      const cls = scopeClass(r.scope);
      if (cls === "global") continue;
      if (!byClass.has(cls)) byClass.set(cls, []);
      byClass.get(cls)!.push(r);
    }
    const chosen = new Map<string, Registration>();
    byClass.forEach((regs, cls) => {
      let focusHit: Registration | undefined;
      for (const r of regs) {
        if (r.element && active && r.element.contains(active)) {
          focusHit = r;
          break;
        }
      }
      chosen.set(cls, focusHit ?? regs[regs.length - 1]);
    });
    return chosen;
  };

  // ── Key dispatch ────────────────────────────────────────────────────────

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Ignore typing contexts for most keys; allow Escape always
      const typing = isTypingTarget(e.target);

      const key = keyFromEvent(e);

      // Chord buffer: if last key started a chord (e.g. "g"), wait for second
      let resolvedKey = key;
      if (chordBuffer.current) {
        resolvedKey = `${chordBuffer.current} ${key}`;
        chordBuffer.current = "";
        if (chordTimer.current) clearTimeout(chordTimer.current);
      }

      const activePerClass = pickActivePerClass();

      // advanced masks tastetest
      if (activePerClass.has("advanced")) {
        activePerClass.delete("tastetest");
      }

      // scope-class dispatch order: advanced → vizdiff → tastetest → batchrun → global
      const order = ["advanced", "vizdiff", "tastetest", "batchrun"];
      for (const cls of order) {
        const reg = activePerClass.get(cls);
        if (!reg) continue;
        if (typing && resolvedKey !== "Escape") continue;
        const action = reg.bindings[resolvedKey];
        if (action && reg.handlers[action]) {
          e.preventDefault();
          reg.handlers[action](e);
          return;
        }
      }

      // Global fallthrough — but see if the plain key is a chord prefix first
      const globalReg = state.current.regs.find(
        (r) => r.scope === "global" && r.active,
      );
      if (!globalReg) return;

      // Ignore most global keys while typing, except Escape and the help/search sequence handled below
      if (typing && resolvedKey !== "Escape") return;

      // Check chord prefixes at global scope
      if (!chordBuffer.current) {
        const prefixes = Object.keys(globalReg.bindings)
          .filter((k) => k.includes(" "))
          .map((k) => k.split(" ")[0]);
        if (prefixes.includes(key)) {
          chordBuffer.current = key;
          if (chordTimer.current) clearTimeout(chordTimer.current);
          chordTimer.current = setTimeout(() => {
            chordBuffer.current = "";
          }, 1000);
          // Don't preventDefault — user might intend this key for something
          return;
        }
      }

      const action = globalReg.bindings[resolvedKey];
      if (action && globalReg.handlers[action]) {
        e.preventDefault();
        globalReg.handlers[action](e);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo<RegistryCtxValue>(
    () => ({ register, unregister, update, getSnapshot, subscribe }),
    [register, unregister, update, getSnapshot, subscribe],
  );

  return <RegistryCtx.Provider value={value}>{children}</RegistryCtx.Provider>;
}

// ──────────────────────────────────────────────────────────────────────────

export function useShortcutScope(args: UseShortcutScopeArgs & { elementRef?: React.RefObject<HTMLElement | null> }) {
  const ctx = useContext(RegistryCtx);
  if (!ctx) throw new Error("useShortcutScope requires <ShortcutProvider>");

  const idRef = useRef<number | null>(null);
  // Keep latest handlers/bindings in a ref so we don't re-register every render
  const handlersRef = useRef(args.handlers);
  const bindingsRef = useRef(args.bindings);
  handlersRef.current = args.handlers;
  bindingsRef.current = args.bindings;

  useEffect(() => {
    const id = ctx.register({
      scope: args.scope,
      bindings: bindingsRef.current,
      handlers: new Proxy(
        {},
        {
          get: (_t, prop: string) => handlersRef.current[prop],
          has: (_t, prop: string) => prop in handlersRef.current,
          ownKeys: () => Object.keys(handlersRef.current),
          getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
        },
      ) as Record<string, (e: KeyboardEvent) => void>,
      active: args.active !== false,
      element: args.elementRef?.current ?? null,
    });
    idRef.current = id;
    return () => ctx.unregister(id);
    // intentionally only scope identity re-registers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.scope]);

  useEffect(() => {
    if (idRef.current == null) return;
    ctx.update(idRef.current, {
      bindings: args.bindings,
      active: args.active !== false,
      element: args.elementRef?.current ?? null,
    });
  }, [args.bindings, args.active, args.elementRef, ctx]);
}

// ──────────────────────────────────────────────────────────────────────────

export function useShortcutRegistry() {
  const ctx = useContext(RegistryCtx);
  if (!ctx) throw new Error("useShortcutRegistry requires <ShortcutProvider>");
  const [, force] = useState(0);
  useEffect(() => ctx.subscribe(() => force((n) => n + 1)), [ctx]);
  return ctx.getSnapshot();
}
