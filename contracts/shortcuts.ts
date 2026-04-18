/**
 * Keyboard shortcut scope API — frozen in pre-flight P2.
 *
 * Scoped so Agent D's global manager, Agent E's VizDiff bindings, and Agent G's
 * TasteTest bindings don't trample each other. Active scope wins; fallthrough
 * to "global" only if the active scope doesn't handle the key.
 *
 * Implementation (Agent D, frontend/lib/shortcuts.ts) exposes the hook.
 */

export type ShortcutScope =
  | "global" // app-wide: `?` help, `/` search, Esc close
  | "tastetest" // sampling grid, pipeline panel
  | `vizdiff:${string}` // per-instance VizDiff (tastetest vs batch review)
  | "batchrun" // batch progress + cancel
  | "advanced"; // advanced pipeline panel when open

/** A single binding: key → action id (string) */
export type ShortcutBindings = Record<string, string>;

/** What the hook accepts */
export interface UseShortcutScopeArgs {
  scope: ShortcutScope;
  /** Map of key → action id. Action ids are callbacks resolved via `handlers`. */
  bindings: ShortcutBindings;
  /** Action handlers keyed by action id */
  handlers: Record<string, (e: KeyboardEvent) => void>;
  /** When false, this scope is inactive (but still registered); default true */
  active?: boolean;
}

/**
 * Hook signature. Implementation lives in Agent D's shell.
 *
 *   useShortcutScope({
 *     scope: "vizdiff:tastetest",
 *     bindings: VIZDIFF_BINDINGS,
 *     handlers: { approve: () => onApprove(), reject: () => onReject(), ... },
 *   });
 *
 * Rules:
 *  - At most ONE scope active at a time per scope-class (vizdiff:*, tastetest, etc.).
 *  - "global" is always active and runs LAST (fallthrough).
 *  - Scope activation follows focus: entering the VizDiff root element activates its scope.
 *  - "advanced" when open masks "tastetest" until closed.
 */
export type UseShortcutScope = (args: UseShortcutScopeArgs) => void;

// Default global bindings — owned by Agent D
export const GLOBAL_BINDINGS: ShortcutBindings = {
  "?": "help",
  "/": "search",
  "Escape": "close-dialog",
  "g s": "goto-scan",
  "g t": "goto-tastetest",
  "g b": "goto-batchrun",
};

// Default tastetest bindings — owned by Agent G
export const TASTETEST_BINDINGS: ShortcutBindings = {
  "a": "approved-drawer",
  "l": "lock-stratum",
  "S": "resample", // capital S (shift)
  "c": "open-advanced-panel",
};

// Default batchrun bindings — owned by Agent H
export const BATCHRUN_BINDINGS: ShortcutBindings = {
  "c": "cancel-batch",
  "P": "pause-batch",
  "e": "export",
};
