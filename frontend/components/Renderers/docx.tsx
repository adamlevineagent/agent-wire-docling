"use client";

/**
 * DOCX source renderer.
 *
 * Uses `docx-preview` to render the original document into a container div.
 * Docling DOCX output does not carry reliable page bboxes, so:
 *   - `scrollToBbox` falls back to text-prefix match against the anchor's
 *     expected content (first 40 chars of the matching element text).
 *   - `onElementClick` resolves the nearest anchor via the same text match.
 * If anchors are empty, bidirectional highlight is disabled (warned once).
 */

import { useEffect, useRef, useState } from "react";
import type {
  Anchor,
  BBox,
  SourceRenderer,
} from "../../../contracts/vizdiff";
import type { DoclingDocument } from "../../../contracts/docling-types";
import {
  makeNoopRenderer,
  warnAnchorsMissingOnce,
  type SourceRendererProps,
} from "./types";

interface ClickEvt {
  self_ref?: string;
  page: number;
  bbox?: BBox;
}

export function DocxRenderer(props: SourceRendererProps) {
  const { hash, sourceUrl, sourceBytes, doclingDoc, anchors, onRenderer } =
    props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const disposedRef = useRef(false);
  const clickHandlerRef = useRef<((e: ClickEvt) => void) | null>(null);

  useEffect(() => {
    disposedRef.current = false;
    let cancelled = false;

    async function run() {
      if (!containerRef.current) return;
      try {
        const bytes =
          sourceBytes ??
          (await fetch(sourceUrl).then((r) => {
            if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
            return r.arrayBuffer();
          }));
        if (cancelled || disposedRef.current) return;

        const docxPreview = await import("docx-preview");
        containerRef.current.innerHTML = "";
        await docxPreview.renderAsync(bytes, containerRef.current, undefined, {
          className: "docx-preview-root",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          experimental: false,
          useBase64URL: true,
        });
        if (cancelled || disposedRef.current) return;
        setLoading(false);

        // Wire click-to-element
        const root = containerRef.current;
        const onClick = (e: MouseEvent) => {
          if (!clickHandlerRef.current) return;
          const target = e.target as HTMLElement | null;
          if (!target) return;
          const text = (target.textContent ?? "").trim().slice(0, 60);
          const evt: ClickEvt = { page: 1 };
          if ((anchors?.length ?? 0) > 0 && text && doclingDoc) {
            const self_ref = resolveSelfRefByText(
              doclingDoc as DoclingDocument,
              anchors!,
              text,
            );
            if (self_ref) evt.self_ref = self_ref;
          } else if ((anchors?.length ?? 0) === 0) {
            warnAnchorsMissingOnce(hash, "docx");
          }
          clickHandlerRef.current(evt);
        };
        root.addEventListener("click", onClick);
        (root as HTMLElement & { __clickHandler?: EventListener }).__clickHandler =
          onClick as EventListener;
      } catch (e) {
        if (!cancelled) {
          setError(
            `Failed to render DOCX: ${e instanceof Error ? e.message : String(e)}`,
          );
          setLoading(false);
        }
      }
    }
    run();

    // Build renderer instance
    const renderer: SourceRenderer = {
      renderPage: (_page: number) => {
        // docx-preview renders inline; renderPage is effectively scrollTop reset.
        containerRef.current?.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
      },
      scrollToBbox: (_page: number, _bbox: BBox) => {
        // DOCX has no reliable page bboxes; fallback to self_ref-by-text
        // if caller eventually calls scrollToBbox we can't act; no-op here.
      },
      getCurrentViewport: () => ({ page: 1 }),
      onElementClick: (h) => {
        clickHandlerRef.current = h;
      },
      dispose: () => {
        disposedRef.current = true;
        clickHandlerRef.current = null;
        const root = containerRef.current as
          | (HTMLElement & { __clickHandler?: EventListener })
          | null;
        if (root?.__clickHandler) {
          root.removeEventListener("click", root.__clickHandler);
          root.__clickHandler = undefined;
        }
      },
    };

    // Extra scroll-to-text helper wired onto the renderer instance
    (renderer as SourceRenderer & {
      scrollToSelfRef?: (self_ref: string) => void;
    }).scrollToSelfRef = (self_ref: string) => {
      if (!containerRef.current || !doclingDoc) return;
      const text = findTextForSelfRef(doclingDoc as DoclingDocument, self_ref);
      if (!text) return;
      scrollToTextPrefix(containerRef.current, text);
    };

    onRenderer?.(renderer);

    return () => {
      cancelled = true;
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, sourceUrl]);

  return (
    <div
      className={
        props.className ?? "w-full h-full overflow-auto bg-white text-black"
      }
    >
      {loading && !error && (
        <div className="p-6 text-sm text-neutral-500">Rendering DOCX…</div>
      )}
      {error && (
        <div className="p-6 text-sm text-red-400">{error}</div>
      )}
      <div ref={containerRef} className="docx-render-container" />
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

function findTextForSelfRef(
  doc: DoclingDocument,
  self_ref: string,
): string | null {
  const all = [...(doc.texts ?? []), ...(doc.tables ?? [])];
  for (const item of all) {
    if (item.self_ref === self_ref && item.text) return item.text;
  }
  return null;
}

function resolveSelfRefByText(
  doc: DoclingDocument,
  anchors: Anchor[],
  needle: string,
): string | undefined {
  if (!needle) return undefined;
  const n = needle.slice(0, 40).toLowerCase();
  for (const item of doc.texts ?? []) {
    if (!item.text) continue;
    if (item.text.toLowerCase().startsWith(n)) {
      const anchor = anchors.find((a) => a.self_ref === item.self_ref);
      if (anchor) return anchor.self_ref;
    }
  }
  return undefined;
}

function scrollToTextPrefix(root: HTMLElement, text: string) {
  const prefix = text.slice(0, 40).toLowerCase();
  if (!prefix) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = (node.nodeValue ?? "").trim().toLowerCase();
    if (t.startsWith(prefix)) {
      const el = node.parentElement;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (el) {
        el.style.outline = "2px solid #60a5fa";
        setTimeout(() => {
          el.style.outline = "";
        }, 1500);
      }
      return;
    }
  }
}

/**
 * Exposed for the dev route / tests: build a no-op renderer when the fixture
 * doesn't load. VizDiff will still compose, just without highlight.
 */
export function makeDocxStubRenderer(): SourceRenderer {
  return makeNoopRenderer("docx-stub");
}
