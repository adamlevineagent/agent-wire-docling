/**
 * Shared types for SourceRenderer React components.
 *
 * Each format renderer exposes two things:
 *   1) A React component that mounts the source into a container div
 *   2) A `SourceRenderer` instance (via `onRenderer` callback) so VizDiff
 *      can drive navigation, bbox scroll, and element-click events.
 *
 * This keeps VizDiff's surface to the contract interface in
 * contracts/vizdiff.ts while letting each renderer own its own DOM.
 */

import type { Anchor, SourceRenderer } from "../../../contracts/vizdiff";

export interface SourceRendererProps {
  /** Canonical doc hash — used to build source URLs and as React key. */
  hash: string;
  /** Filename, for display in loading/error states. */
  source_path: string;
  /** DoclingDocument JSON (or null while loading). */
  doclingDoc?: unknown | null;
  /** Anchor sidecar — element ↔ byte ranges. May be empty. */
  anchors?: Anchor[];
  /**
   * Absolute URL to fetch raw source bytes from.
   * For the fixture/dev route, callers can pass a data: URL or a local path.
   */
  sourceUrl: string;
  /**
   * Optional prefetched source bytes. Some renderers (docx, xlsx, pptx) want
   * ArrayBuffer directly; supplying it lets fixture pages skip fetch.
   */
  sourceBytes?: ArrayBuffer | null;
  /** Called once the per-format renderer instance is ready. */
  onRenderer?: (renderer: SourceRenderer) => void;
  /** Optional className for the container. */
  className?: string;
}

/**
 * Default noop renderer. Used when a format has no meaningful bbox support
 * (html, plain text) — still satisfies the SourceRenderer contract.
 */
export function makeNoopRenderer(
  reason: string,
  opts: {
    renderPage?: (p: number) => void;
    getCurrentViewport?: () => { page: number };
    dispose?: () => void;
  } = {},
): SourceRenderer {
  let clickHandler:
    | ((evt: { self_ref?: string; page: number }) => void)
    | null = null;
  return {
    renderPage: (p: number) => opts.renderPage?.(p),
    scrollToBbox: (page: number) => {
      // Best-effort: treat as page scroll only
      opts.renderPage?.(page);
    },
    getCurrentViewport: () =>
      opts.getCurrentViewport?.() ?? { page: 1 },
    onElementClick: (h) => {
      clickHandler = h;
    },
    dispose: () => {
      clickHandler = null;
      opts.dispose?.();
    },
    // Expose for internal testing
    __reason: reason,
    __emitClick: (evt: { self_ref?: string; page: number }) =>
      clickHandler?.(evt),
  } as SourceRenderer & {
    __reason: string;
    __emitClick: (evt: { self_ref?: string; page: number }) => void;
  };
}

/**
 * Log once per (hash, reason) that anchors are missing, so a format that
 * can't do bidirectional highlight fails loud-but-once.
 */
const loggedAnchorWarnings = new Set<string>();
export function warnAnchorsMissingOnce(hash: string, format: string) {
  const key = `${format}:${hash}`;
  if (loggedAnchorWarnings.has(key)) return;
  loggedAnchorWarnings.add(key);
  // eslint-disable-next-line no-console
  console.warn(
    `[Renderers/${format}] No anchors for ${hash}; bidirectional highlight disabled.`,
  );
}
