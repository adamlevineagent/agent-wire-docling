"use client";

/**
 * <VizDiff /> — shared two-pane reviewer. See contracts/vizdiff.ts.
 *
 * Layout:
 *   ┌─ header ────────────────────────────────────────────────────┐
 *   │  format · filename · pipeline · quality badges · actions   │
 *   ├───────────────────────────┬─────────────────────────────────┤
 *   │                           │  [Rendered MD | Raw MD | JSON]  │
 *   │      SourceRenderer       │                                 │
 *   │                           │      MarkdownPane               │
 *   └───────────────────────────┴─────────────────────────────────┘
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { VizDiffProps as BaseVizDiffProps } from "./types";

/**
 * Extended props: allow callers to mount an arbitrary React subtree as the
 * source preview (Agent F's per-format renderers are React components). The
 * class-based `sourceRenderer` (Agent E's PDF style) still works as before via
 * duck-typed mount(). See CRITICAL FIX in Wave 2b audit.
 */
export interface VizDiffProps extends BaseVizDiffProps {
  /** Optional React tree to render inside the source pane host div. */
  sourceNode?: ReactNode;
}
import type { MarkdownPaneHandle, OutputTab } from "./MarkdownPane";
import { VIZDIFF_BINDINGS } from "./types";
import { MarkdownPane } from "./MarkdownPane";
import { QualityBadgeOverlay } from "./QualityBadgeOverlay";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { cn } from "../../lib/cn";
import { useShortcutScope } from "../../lib/shortcuts";

const TABS: { id: OutputTab; label: string; shortcut: string }[] = [
  { id: "rendered", label: "Rendered MD", shortcut: "1" },
  { id: "raw", label: "Raw MD", shortcut: "2" },
  { id: "json", label: "JSON", shortcut: "3" },
];

export function VizDiff(props: VizDiffProps) {
  const {
    doc,
    sourceRenderer,
    currentPipeline,
    onApprove,
    onReject,
    onSkip,
    onFlag,
    onRerun,
    onNext,
    onPrev,
    shortcutScope,
    sourceNode,
  } = props;

  const [tab, setTab] = useState<OutputTab>("rendered");
  const [currentPage, setCurrentPage] = useState(1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mdPaneRef = useRef<MarkdownPaneHandle | null>(null);

  // ── Bidirectional highlight ────────────────────────────────────────────
  // 1. MD element click → scrollToBbox on source
  const onAnchorClick = useCallback(
    (a: typeof doc.anchors[number]) => {
      sourceRenderer.scrollToBbox(a.page, a.bbox);
      mdPaneRef.current?.flashAnchor(a);
    },
    [sourceRenderer],
  );

  // 2. Source click → scroll MD + flash
  useEffect(() => {
    sourceRenderer.onElementClick((evt) => {
      // Resolve anchor: prefer self_ref, else first anchor on that page.
      let a = evt.self_ref
        ? doc.anchors.find((x) => x.self_ref === evt.self_ref)
        : undefined;
      if (!a) a = doc.anchors.find((x) => x.page === evt.page);
      if (!a) return;
      mdPaneRef.current?.scrollToAnchor(a);
      mdPaneRef.current?.flashAnchor(a);
    });
  }, [sourceRenderer, doc.anchors]);

  // ── Synced scroll: source viewport → MD scroll ────────────────────────
  // Poll source viewport every 250ms; debounce MD-side scroll to 80ms.
  const lastSyncedPage = useRef<number>(1);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      try {
        const vp = sourceRenderer.getCurrentViewport();
        if (!vp) return;
        if (vp.page !== currentPage) setCurrentPage(vp.page);
        if (vp.page !== lastSyncedPage.current) {
          lastSyncedPage.current = vp.page;
          if (debounceTimer.current) clearTimeout(debounceTimer.current);
          debounceTimer.current = setTimeout(() => {
            const first = doc.anchors.find((a) => a.page === vp.page);
            if (first) mdPaneRef.current?.scrollToAnchor(first);
          }, 80);
        }
      } catch {
        // no-op — renderer may be disposed
      }
    }, 250);
    return () => clearInterval(interval);
  }, [sourceRenderer, currentPage, doc.anchors]);

  // ── Page navigation ────────────────────────────────────────────────────
  const totalPages = useMemo(() => {
    const pages = (doc.doclingDoc as { pages?: Record<string, unknown> })?.pages;
    if (pages && typeof pages === "object") {
      return Math.max(1, Object.keys(pages).length);
    }
    const maxAnchorPage = doc.anchors.reduce((m, a) => Math.max(m, a.page), 1);
    return maxAnchorPage;
  }, [doc]);

  const gotoPage = useCallback(
    (p: number) => {
      const clamped = Math.min(Math.max(1, p), totalPages);
      setCurrentPage(clamped);
      sourceRenderer.renderPage(clamped);
      const first = doc.anchors.find((a) => a.page === clamped);
      if (first) mdPaneRef.current?.scrollToAnchor(first);
    },
    [sourceRenderer, doc.anchors, totalPages],
  );

  // ── Keyboard bindings ─────────────────────────────────────────────────
  const handlers = useMemo(() => {
    const h: Record<string, () => void> = {};
    if (onApprove) h["approve"] = () => onApprove({ action: "approve" });
    if (onReject) h["reject"] = () => onReject({ action: "reject" });
    if (onSkip) h["skip"] = () => onSkip();
    if (onFlag) h["flag"] = () => onFlag({ action: "flag" });
    if (onNext) h["next-doc"] = () => onNext();
    if (onPrev) h["prev-doc"] = () => onPrev();
    if (onRerun) h["rerun"] = () => onRerun(currentPipeline);
    h["next-page"] = () => gotoPage(currentPage + 1);
    h["prev-page"] = () => gotoPage(currentPage - 1);
    h["tab-rendered-md"] = () => setTab("rendered");
    h["tab-raw-md"] = () => setTab("raw");
    h["tab-json"] = () => setTab("json");
    // `?` and `help` are handled at global scope (shell); we don't override.
    return h;
  }, [onApprove, onReject, onSkip, onFlag, onNext, onPrev, onRerun, currentPipeline, gotoPage, currentPage]);

  // Only bind keys for callbacks that are actually provided — "undefined
  // callbacks → that action is hidden" (contracts/vizdiff.ts). Also hide
  // page/tab keys if unneeded? No — page nav and tab switching are always
  // available while VizDiff is mounted.
  const bindings = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, action] of Object.entries(VIZDIFF_BINDINGS)) {
      if (action in handlers || action === "help") {
        out[k] = action;
      }
    }
    return out;
  }, [handlers]);

  useShortcutScope({
    scope: `vizdiff:${shortcutScope}` as const,
    bindings,
    handlers,
    elementRef: rootRef,
  });

  // ── Pipeline indicator ────────────────────────────────────────────────
  const pipelineLabel = (() => {
    const parts: string[] = [];
    if (currentPipeline.ocr?.enabled) parts.push(`OCR:${currentPipeline.ocr.engine ?? "tesseract"}`);
    if (currentPipeline.vlm?.enabled) parts.push(`VLM:${currentPipeline.vlm.model ?? "granite_docling"}`);
    if (currentPipeline.tables?.enabled) parts.push("tables");
    if (currentPipeline.enrichments?.formulas) parts.push("formulas");
    if (currentPipeline.enrichments?.code) parts.push("code");
    if (currentPipeline.enrichments?.charts) parts.push("charts");
    return parts.length ? parts.join(" · ") : "default";
  })();

  const vlmRequested = !!currentPipeline.vlm?.enabled;

  const filename = doc.source_path.split("/").pop() ?? doc.source_path;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="h-full flex flex-col outline-none bg-surface-0"
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border-default bg-surface-1 text-sm">
        <Badge tone="accent">{doc.source_format}</Badge>
        <span className="font-mono text-xs text-fg-secondary truncate max-w-[28ch]">
          {filename}
        </span>
        <Badge tone="neutral" className="font-mono">
          {pipelineLabel}
        </Badge>
        {vlmRequested && (
          <Badge tone="warning" className="font-mono">
            VLM requested · pipeline wiring pending
          </Badge>
        )}
        <div className="flex items-center gap-1 ml-2">
          <span className="text-xs text-fg-muted">p</span>
          <span className="font-mono text-xs">
            {currentPage}/{totalPages}
          </span>
        </div>
        <div className="flex-1" />
        {/* Review actions — only for callbacks provided */}
        <div className="flex items-center gap-1">
          {onApprove && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => onApprove({ action: "approve" })}
              title="Approve (y)"
            >
              Approve
            </Button>
          )}
          {onReject && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => onReject({ action: "reject" })}
              title="Reject (x)"
            >
              Reject
            </Button>
          )}
          {onSkip && (
            <Button size="sm" variant="ghost" onClick={() => onSkip()} title="Skip (s)">
              Skip
            </Button>
          )}
          {onFlag && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onFlag({ action: "flag" })}
              title="Flag (f)"
            >
              Flag
            </Button>
          )}
          {onRerun && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onRerun(currentPipeline)}
              title="Rerun (r)"
            >
              Rerun
            </Button>
          )}
        </div>
      </div>

      {/* ── Panes ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">
        {/* Source (left) */}
        <div className="relative flex-1 border-r border-border-default bg-surface-1 min-w-0">
          <QualityBadgeOverlay badges={doc.qualityBadges} currentPage={currentPage} />
          <SourceSlot
            sourceRenderer={sourceRenderer}
            page={currentPage}
            onPageChange={(p) => setCurrentPage(p)}
            sourceNode={sourceNode}
          />
        </div>

        {/* Output (right) */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center gap-px border-b border-border-default bg-surface-1 px-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "px-3 py-1.5 text-xs font-mono rounded-t",
                  tab === t.id
                    ? "bg-surface-0 text-fg-primary border-t border-x border-border-default -mb-px"
                    : "text-fg-muted hover:text-fg-secondary",
                )}
              >
                <span className="mr-1 text-fg-muted">{t.shortcut}</span>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0">
            <MarkdownPane
              ref={mdPaneRef}
              markdown={doc.markdown}
              anchors={doc.anchors}
              doclingDoc={doc.doclingDoc}
              tab={tab}
              onAnchorClick={onAnchorClick}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// SourceSlot — drives the SourceRenderer into a host DOM element.
// Renderers may be DOM-attaching (pdf.js) or self-contained React; we
// expose a simple slot div via ref on the renderer if it supports it.

function SourceSlot({
  sourceRenderer,
  page,
  onPageChange,
  sourceNode,
}: {
  sourceRenderer: import("./types").SourceRenderer;
  page: number;
  onPageChange: (p: number) => void;
  sourceNode?: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  // If the renderer implements a `mount(el)` hook, call it. The contract
  // doesn't require it — but pdf.tsx exposes one. Duck-type it.
  useEffect(() => {
    const r = sourceRenderer as typeof sourceRenderer & {
      mount?: (el: HTMLElement) => void;
      unmount?: () => void;
    };
    if (hostRef.current && typeof r.mount === "function") {
      r.mount(hostRef.current);
    }
    return () => {
      if (typeof r.unmount === "function") r.unmount();
    };
  }, [sourceRenderer]);

  // When page changes from outside, ask renderer to render it.
  useEffect(() => {
    try {
      sourceRenderer.renderPage(page);
    } catch {
      // ignore renderer errors on dispose / race
    }
  }, [sourceRenderer, page]);

  // Fallback hint when renderer has no DOM mount (e.g. stub)
  return (
    <div
      ref={hostRef}
      data-vizdiff-source-host
      data-current-page={page}
      className="absolute inset-0 overflow-auto"
      onScroll={() => {
        try {
          const vp = sourceRenderer.getCurrentViewport();
          if (vp && vp.page !== page) onPageChange(vp.page);
        } catch {
          // ignore
        }
      }}
    >
      {/* Renderer mounts into this div; if it doesn't (stub), show a hint */}
      {sourceNode ? (
        sourceNode
      ) : (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-fg-muted text-xs font-mono vizdiff-source-placeholder">
          [source renderer — page {page}]
        </div>
      )}
    </div>
  );
}
