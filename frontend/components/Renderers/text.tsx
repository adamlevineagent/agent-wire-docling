"use client";

/**
 * Shared renderer for text / markdown / LaTeX sources.
 *
 * Lightweight inline highlighter (regex-based) — MD/LaTeX don't have accurate
 * prism grammars and we're viewing *source*, not rendering it. LaTeX render
 * is deferred per plans/deferral-ledger.md.
 *
 * - `scrollToBbox` — no-op (text formats have no page bboxes)
 * - `renderPage(n)` — page ≈ 1; n>1 uses anchors to seek char offset if provided
 * - `onElementClick` — resolves clicked character offset to nearest anchor
 *   (by byte_start ≤ offset < byte_end).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Anchor,
  BBox,
  SourceRenderer,
} from "../../../contracts/vizdiff";
import { warnAnchorsMissingOnce, type SourceRendererProps } from "./types";

type Flavor = "text" | "md" | "latex";

interface TextRendererExtraProps {
  flavor?: Flavor;
  /** Banner shown at the top of the pane. */
  banner?: string | null;
}

export function TextRenderer(
  props: SourceRendererProps & TextRendererExtraProps,
) {
  const {
    hash,
    sourceUrl,
    sourceBytes,
    anchors,
    onRenderer,
    flavor = "text",
    banner,
  } = props;
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const clickHandlerRef = useRef<
    ((e: { self_ref?: string; page: number; bbox?: BBox }) => void) | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        let text: string;
        if (sourceBytes) {
          text = new TextDecoder().decode(sourceBytes);
        } else {
          const res = await fetch(sourceUrl);
          if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
          text = await res.text();
        }
        if (!cancelled) setSource(text);
      } catch (e) {
        if (!cancelled)
          setError(
            `Failed to load source: ${e instanceof Error ? e.message : String(e)}`,
          );
      }
    }
    load();

    const renderer: SourceRenderer = {
      renderPage: (_p: number) => {
        containerRef.current?.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
      },
      scrollToBbox: (_page: number, _bbox: BBox) => {
        // No-op for text formats — no page bboxes.
      },
      getCurrentViewport: () => ({ page: 1 }),
      onElementClick: (h) => {
        clickHandlerRef.current = h;
      },
      dispose: () => {
        clickHandlerRef.current = null;
      },
    };

    // Extension: jump to a character offset (byte_start from anchors)
    (renderer as SourceRenderer & {
      scrollToOffset?: (off: number) => void;
    }).scrollToOffset = (off: number) => {
      scrollToCharOffset(preRef.current, off);
    };

    onRenderer?.(renderer);
    return () => {
      cancelled = true;
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, sourceUrl]);

  useEffect(() => {
    if ((anchors?.length ?? 0) === 0) {
      warnAnchorsMissingOnce(hash, flavor);
    }
  }, [anchors, hash, flavor]);

  const highlighted = useMemo(
    () => (source == null ? null : highlight(source, flavor)),
    [source, flavor],
  );

  const onPreClick = (e: React.MouseEvent<HTMLPreElement>) => {
    if (!clickHandlerRef.current) return;
    const off = offsetFromMouseEvent(e, source ?? "");
    const evt: { self_ref?: string; page: number; bbox?: BBox } = { page: 1 };
    if ((anchors?.length ?? 0) > 0 && off != null) {
      const hit = (anchors ?? []).find(
        (a: Anchor) => off >= a.byte_start && off < a.byte_end,
      );
      if (hit) evt.self_ref = hit.self_ref;
    }
    clickHandlerRef.current(evt);
  };

  return (
    <div
      ref={containerRef}
      className={
        props.className ??
        "w-full h-full overflow-auto bg-neutral-900 text-neutral-100 font-mono"
      }
    >
      {banner && (
        <div className="sticky top-0 z-10 border-b border-amber-700 bg-amber-900/40 px-3 py-1 text-xs text-amber-300">
          {banner}
        </div>
      )}
      {error && <div className="p-6 text-sm text-red-400">{error}</div>}
      {source == null && !error && (
        <div className="p-6 text-sm text-neutral-500">Loading source…</div>
      )}
      {highlighted != null && (
        <pre
          ref={preRef}
          onClick={onPreClick}
          className="m-0 whitespace-pre-wrap break-words p-4 text-xs leading-relaxed"
          // Safe: `highlight` escapes inputs and only emits known <span> tags.
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      )}
    </div>
  );
}

// ── Minimal highlighter ─────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function highlight(source: string, flavor: Flavor): string {
  const escaped = escapeHtml(source);
  if (flavor === "md") return highlightMd(escaped);
  if (flavor === "latex") return highlightLatex(escaped);
  return escaped;
}

function highlightMd(src: string): string {
  // Order matters: code fences first, then line-prefixed constructs.
  return src
    .replace(
      /^(```[^\n]*\n[\s\S]*?^```)$/gm,
      (m) => `<span class="text-emerald-300">${m}</span>`,
    )
    .replace(
      /^(#{1,6}\s.*)$/gm,
      (m) => `<span class="text-blue-400 font-bold">${m}</span>`,
    )
    .replace(
      /(\*\*[^*\n]+\*\*)/g,
      (m) => `<span class="text-amber-300">${m}</span>`,
    )
    .replace(
      /(`[^`\n]+`)/g,
      (m) => `<span class="text-emerald-300">${m}</span>`,
    )
    .replace(
      /^(\s*[-*+]\s|\s*\d+\.\s)/gm,
      (m) => `<span class="text-violet-400">${m}</span>`,
    )
    .replace(
      /(\[[^\]]+\]\([^)]+\))/g,
      (m) => `<span class="text-cyan-400">${m}</span>`,
    );
}

function highlightLatex(src: string): string {
  return src
    .replace(
      /(%[^\n]*)/g,
      (m) => `<span class="text-neutral-500 italic">${m}</span>`,
    )
    .replace(
      /(\\[A-Za-z@]+)/g,
      (m) => `<span class="text-blue-400">${m}</span>`,
    )
    .replace(
      /(\{[^{}\n]*\})/g,
      (m) => `<span class="text-amber-300">${m}</span>`,
    )
    .replace(
      /(\$[^$\n]+\$)/g,
      (m) => `<span class="text-emerald-300">${m}</span>`,
    );
}

// ── Click → char offset ─────────────────────────────────────────────────

function offsetFromMouseEvent(
  e: React.MouseEvent<HTMLPreElement>,
  source: string,
): number | null {
  // Use Selection API to get a caret position at the click point.
  const sel = window.getSelection();
  if (!sel) return null;
  const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
  if (!range) return null;
  // Walk through the <pre> and accumulate textContent length up to range.
  const pre = e.currentTarget;
  let offset = 0;
  const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node === range.startContainer) {
      return Math.min(source.length, offset + range.startOffset);
    }
    offset += (node.nodeValue ?? "").length;
  }
  return null;
}

function scrollToCharOffset(pre: HTMLPreElement | null, off: number) {
  if (!pre) return;
  let accum = 0;
  const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const len = (node.nodeValue ?? "").length;
    if (accum + len >= off) {
      const el = node.parentElement;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (el) {
        el.style.outline = "2px solid #60a5fa";
        setTimeout(() => (el.style.outline = ""), 1500);
      }
      return;
    }
    accum += len;
  }
}
