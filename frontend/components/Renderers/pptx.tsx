"use client";

/**
 * PPTX source renderer — slide-image-only degradation mode.
 *
 * `pptx-preview` is not installed (per-ledger deferral accepted). We present
 * a slide list derived from the DoclingDocument — one card per slide with:
 *   - slide index (page_no)
 *   - section header text (if any)
 *   - body text concatenated from text items on that page
 *
 * This is the accepted fallback per plans/deferral-ledger.md Wave 2 entry
 * "PPTX full-fidelity render may degrade to slide-image-only."
 *
 * - `scrollToBbox` → scrolls to the slide card matching page_no
 * - `onElementClick` → emits { page } only (no self_ref bidirectional)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BBox,
  SourceRenderer,
} from "../../../contracts/vizdiff";
import type { DoclingDocument } from "../../../contracts/docling-types";
import { warnAnchorsMissingOnce, type SourceRendererProps } from "./types";

interface SlideSummary {
  page: number;
  header: string;
  bodyLines: string[];
}

export function PptxRenderer(props: SourceRendererProps) {
  const { hash, doclingDoc, anchors, onRenderer } = props;
  const [activePage, setActivePage] = useState(1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const clickHandlerRef = useRef<
    ((e: { self_ref?: string; page: number; bbox?: BBox }) => void) | null
  >(null);

  const slides: SlideSummary[] = useMemo(
    () => buildSlideSummaries(doclingDoc as DoclingDocument | null | undefined),
    [doclingDoc],
  );

  useEffect(() => {
    const renderer: SourceRenderer = {
      renderPage: (p: number) => {
        setActivePage(p);
        scrollToSlide(containerRef.current, p);
      },
      scrollToBbox: (p: number) => {
        setActivePage(p);
        scrollToSlide(containerRef.current, p);
      },
      getCurrentViewport: () => ({ page: activePage }),
      onElementClick: (h) => {
        clickHandlerRef.current = h;
      },
      dispose: () => {
        clickHandlerRef.current = null;
      },
    };
    onRenderer?.(renderer);
    return () => renderer.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);

  useEffect(() => {
    if ((anchors?.length ?? 0) === 0) {
      warnAnchorsMissingOnce(hash, "pptx");
    }
  }, [anchors, hash]);

  const handleSlideClick = (page: number) => {
    setActivePage(page);
    clickHandlerRef.current?.({ page });
  };

  return (
    <div
      ref={containerRef}
      className={
        props.className ?? "w-full h-full overflow-auto bg-neutral-900 text-neutral-100"
      }
    >
      <div className="sticky top-0 z-10 border-b border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-amber-400">
        PPTX degraded mode — slide summary only (see deferral ledger).
      </div>
      <div className="flex flex-col gap-4 p-4">
        {slides.length === 0 && (
          <div className="text-sm text-neutral-500">
            No slide data available from DoclingDocument for this PPTX.
          </div>
        )}
        {slides.map((s) => (
          <button
            type="button"
            key={s.page}
            data-slide-page={s.page}
            onClick={() => handleSlideClick(s.page)}
            className={`rounded border px-4 py-3 text-left transition ${
              s.page === activePage
                ? "border-blue-500 bg-neutral-800"
                : "border-neutral-700 bg-neutral-900 hover:border-neutral-500"
            }`}
          >
            <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
              Slide {s.page}
            </div>
            {s.header && (
              <div className="mb-2 text-lg font-semibold">{s.header}</div>
            )}
            <ul className="list-disc pl-5 text-sm text-neutral-200">
              {s.bodyLines.slice(0, 8).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
              {s.bodyLines.length > 8 && (
                <li className="text-neutral-500">
                  …{s.bodyLines.length - 8} more
                </li>
              )}
            </ul>
          </button>
        ))}
      </div>
    </div>
  );
}

function buildSlideSummaries(
  doc: DoclingDocument | null | undefined,
): SlideSummary[] {
  if (!doc) return [];
  const byPage = new Map<number, SlideSummary>();
  // Ensure every page has a slide, in order
  for (const k of Object.keys(doc.pages ?? {})) {
    const p = doc.pages[k];
    if (!p) continue;
    byPage.set(p.page_no, { page: p.page_no, header: "", bodyLines: [] });
  }
  for (const t of doc.texts ?? []) {
    const page = t.prov?.[0]?.page_no ?? 1;
    if (!byPage.has(page)) {
      byPage.set(page, { page, header: "", bodyLines: [] });
    }
    const slide = byPage.get(page)!;
    const text = (t.text ?? "").trim();
    if (!text) continue;
    if (
      (t.label === "section_header" || t.label === "title") &&
      !slide.header
    ) {
      slide.header = text;
    } else {
      slide.bodyLines.push(text);
    }
  }
  return Array.from(byPage.values()).sort((a, b) => a.page - b.page);
}

function scrollToSlide(root: HTMLElement | null, page: number) {
  if (!root) return;
  const el = root.querySelector<HTMLElement>(`[data-slide-page="${page}"]`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.outline = "2px solid #60a5fa";
    setTimeout(() => (el.style.outline = ""), 1500);
  }
}
