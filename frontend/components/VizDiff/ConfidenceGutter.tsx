"use client";

/**
 * ConfidenceGutter — vertical strip between source + markdown panes.
 * Each segment is a page; colored by OCR confidence. Clicking jumps both
 * panes to that page.
 *
 * Design source: `project/src/screen-taste.jsx · ConfidenceGutter`.
 *
 * Confidence is derived from QualityBadge entries (ocr_low.value is expected
 * to be a 0–1 or 0–100 score; we normalize to 0–100 below). Pages with no
 * badges are treated as 95 (clean).
 */

import { cn } from "../../lib/cn";
import type { QualityBadge } from "./types";

function colorFor(conf: number) {
  if (conf >= 85) return "var(--ok)";
  if (conf >= 65) return "var(--cyan)";
  if (conf >= 50) return "var(--warn)";
  return "var(--danger)";
}

function deriveConfidence(badges: QualityBadge[], page: number): number {
  const pageBadges = badges.filter((b) => b.page === page);
  if (pageBadges.length === 0) return 95;
  // Find ocr_low if present, otherwise best-available value
  const ocr = pageBadges.find((b) => b.kind === "ocr_low");
  if (ocr && typeof ocr.value === "number") {
    const raw = ocr.value;
    return raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
  }
  // Parse warning / empty page → low confidence
  if (pageBadges.some((b) => b.kind === "parse_warning" || b.kind === "empty_page")) {
    return 40;
  }
  return 70;
}

export function ConfidenceGutter({
  badges,
  totalPages,
  currentPage,
  gotoPage,
  pageLabels,
}: {
  badges: QualityBadge[];
  totalPages: number;
  currentPage: number;
  gotoPage: (p: number) => void;
  pageLabels?: Record<number, string>;
}) {
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
  return (
    <div className="w-12 bg-surface-1 border-l border-r border-border-subtle flex flex-col">
      <div className="h-8 flex items-center justify-center border-b border-border-subtle">
        <span className="label-eyebrow" style={{ fontSize: 9 }}>
          conf
        </span>
      </div>
      <div className="flex-1 flex flex-col px-1.5 py-2 gap-0.5">
        {pages.map((p) => {
          const conf = deriveConfidence(badges, p);
          const color = colorFor(conf);
          const isCurrent = p === currentPage;
          return (
            <button
              key={p}
              onClick={() => gotoPage(p)}
              title={pageLabels?.[p] ? `p${p} · ${pageLabels[p]}` : `p${p}`}
              className={cn(
                "flex-1 relative flex items-center justify-center rounded-sm",
                "cursor-pointer outline-none",
              )}
              style={{
                outline: isCurrent ? "1px solid var(--cyan)" : "none",
                outlineOffset: 1,
              }}
            >
              <div
                className="absolute left-0.5 top-0.5 bottom-0.5 w-[3px] rounded-sm"
                style={{ background: color }}
              />
              <div
                className="absolute left-2 top-0.5 bottom-0.5 right-0.5 rounded-sm"
                style={{ background: color, opacity: 0.12 }}
              />
              <span
                className={cn(
                  "num mono text-[10px] relative z-[1]",
                  isCurrent ? "text-fg-primary font-semibold" : "text-fg-secondary",
                )}
              >
                {conf}
              </span>
            </button>
          );
        })}
      </div>
      <div className="py-1.5 border-t border-border-subtle text-center">
        <span className="mono text-[9px] text-fg-disabled">p{totalPages}</span>
      </div>
    </div>
  );
}
