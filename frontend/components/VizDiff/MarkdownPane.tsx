"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Anchor } from "./types";
import { cn } from "../../lib/cn";

export type OutputTab = "rendered" | "raw" | "json";

export interface MarkdownPaneHandle {
  scrollToAnchor: (a: Anchor) => void;
  /** Returns anchor at a given byte offset (for click→highlight on source side). */
  anchorAtByte: (byte: number) => Anchor | null;
  /** Current topmost anchor in view (for scroll sync). */
  currentAnchor: () => Anchor | null;
  /** Flash an anchor highlight for ~1.2s */
  flashAnchor: (a: Anchor) => void;
}

interface Props {
  markdown: string;
  anchors: Anchor[];
  doclingDoc: unknown;
  tab: OutputTab;
  onAnchorClick: (a: Anchor) => void;
  onScroll?: () => void;
}

/**
 * Split markdown into anchored chunks. Each anchor's byte range defines a slice;
 * slices between anchors are rendered as "unanchored" blocks. This gives us
 * stable DOM nodes per self_ref for scroll + highlight.
 *
 * Note: anchors may not cover the whole markdown; unanchored slices are still
 * rendered (as passthrough) so nothing is lost.
 */
function chunkMarkdown(markdown: string, anchors: Anchor[]) {
  const sorted = [...anchors].sort((a, b) => a.byte_start - b.byte_start);
  const chunks: Array<{
    text: string;
    anchor?: Anchor;
    byteStart: number;
    byteEnd: number;
  }> = [];
  let cursor = 0;
  for (const a of sorted) {
    if (a.byte_start > cursor) {
      chunks.push({
        text: markdown.slice(cursor, a.byte_start),
        byteStart: cursor,
        byteEnd: a.byte_start,
      });
    }
    const end = Math.max(a.byte_end, a.byte_start);
    chunks.push({
      text: markdown.slice(a.byte_start, end),
      anchor: a,
      byteStart: a.byte_start,
      byteEnd: end,
    });
    cursor = end;
  }
  if (cursor < markdown.length) {
    chunks.push({
      text: markdown.slice(cursor),
      byteStart: cursor,
      byteEnd: markdown.length,
    });
  }
  return chunks;
}

export const MarkdownPane = forwardRef<MarkdownPaneHandle, Props>(function MarkdownPane(
  { markdown, anchors, doclingDoc, tab, onAnchorClick, onScroll },
  ref,
) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const anchorElRefs = useRef<Map<string, HTMLElement>>(new Map());
  const flashTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const chunks = useMemo(() => chunkMarkdown(markdown, anchors), [markdown, anchors]);

  useImperativeHandle(ref, () => ({
    scrollToAnchor(a) {
      const el = anchorElRefs.current.get(a.self_ref);
      if (!el || !scrollerRef.current) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    anchorAtByte(byte) {
      for (const a of anchors) {
        if (byte >= a.byte_start && byte < a.byte_end) return a;
      }
      return null;
    },
    currentAnchor() {
      const scroller = scrollerRef.current;
      if (!scroller) return null;
      const scrollTop = scroller.getBoundingClientRect().top;
      let best: { a: Anchor; dist: number } | null = null;
      for (const [ref, el] of anchorElRefs.current.entries()) {
        const rect = el.getBoundingClientRect();
        const dist = rect.top - scrollTop;
        if (dist >= -20) {
          const a = anchors.find((x) => x.self_ref === ref);
          if (!a) continue;
          if (!best || dist < best.dist) best = { a, dist };
        }
      }
      return best?.a ?? null;
    },
    flashAnchor(a) {
      const el = anchorElRefs.current.get(a.self_ref);
      if (!el) return;
      el.classList.add("vizdiff-flash");
      const prev = flashTimers.current.get(a.self_ref);
      if (prev) clearTimeout(prev);
      const t = setTimeout(() => {
        el.classList.remove("vizdiff-flash");
        flashTimers.current.delete(a.self_ref);
      }, 1200);
      flashTimers.current.set(a.self_ref, t);
    },
  }));

  if (tab === "raw") {
    return (
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="h-full overflow-auto p-4 font-mono text-xs whitespace-pre-wrap text-fg-secondary"
      >
        {markdown}
      </div>
    );
  }

  if (tab === "json") {
    return (
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="h-full overflow-auto p-4 font-mono text-xs"
      >
        <JsonTree value={doclingDoc} />
      </div>
    );
  }

  // rendered
  return (
    <div
      ref={scrollerRef}
      onScroll={onScroll}
      className="h-full overflow-auto p-4"
    >
      <div className="prose prose-invert max-w-none text-sm leading-6">
        {chunks.map((c, i) => {
          const isAnchor = !!c.anchor;
          return (
            <div
              key={i}
              ref={(el) => {
                if (!el || !c.anchor) return;
                anchorElRefs.current.set(c.anchor.self_ref, el);
              }}
              data-self-ref={c.anchor?.self_ref}
              data-byte-start={c.byteStart}
              data-byte-end={c.byteEnd}
              onClick={() => c.anchor && onAnchorClick(c.anchor)}
              className={cn(
                "transition-colors",
                isAnchor && "cursor-pointer hover:bg-surface-2 rounded px-1 -mx-1",
              )}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.text}</ReactMarkdown>
            </div>
          );
        })}
      </div>
      <style>{`
        .vizdiff-flash {
          background-color: rgba(250, 204, 21, 0.25);
          box-shadow: 0 0 0 2px rgba(250, 204, 21, 0.45);
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
});

function JsonTree({ value, label }: { value: unknown; label?: string }) {
  if (value === null || value === undefined) {
    return (
      <div>
        {label && <span className="text-fg-muted">{label}: </span>}
        <span className="text-fg-muted">{String(value)}</span>
      </div>
    );
  }
  if (typeof value !== "object") {
    return (
      <div>
        {label && <span className="text-fg-muted">{label}: </span>}
        <span className="text-accent">{JSON.stringify(value)}</span>
      </div>
    );
  }
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  return (
    <details open={!label} className="ml-2">
      <summary className="cursor-pointer text-fg-secondary">
        {label ?? "object"}{" "}
        <span className="text-fg-muted">
          {Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}
        </span>
      </summary>
      <div className="ml-3 border-l border-border-default pl-2">
        {entries.map(([k, v]) => (
          <JsonTree key={k} value={v} label={k} />
        ))}
      </div>
    </details>
  );
}
