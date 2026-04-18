"use client";

import { useMemo, useState } from "react";
import type { QualityBadge } from "./types";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/cn";

const kindTone: Record<QualityBadge["kind"], "warning" | "danger" | "info" | "neutral"> = {
  ocr_low: "warning",
  empty_page: "info",
  table_warn: "warning",
  figure_missing: "warning",
  parse_warning: "danger",
};

const kindLabel: Record<QualityBadge["kind"], string> = {
  ocr_low: "OCR",
  empty_page: "Empty",
  table_warn: "Table",
  figure_missing: "Figure",
  parse_warning: "Parse",
};

/**
 * A compact per-page quality badge rail. Given the full badge list and the
 * currently-visible page, shows the badges for that page. Each badge hovers
 * to reveal page + kind + message + value.
 */
export function QualityBadgeOverlay({
  badges,
  currentPage,
  className,
}: {
  badges: QualityBadge[];
  currentPage: number;
  className?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  const pageBadges = useMemo(
    () => badges.filter((b) => b.page === currentPage),
    [badges, currentPage],
  );

  if (pageBadges.length === 0) return null;

  return (
    <div className={cn("absolute top-2 left-2 z-10 flex flex-col gap-1", className)}>
      {pageBadges.map((b, i) => (
        <div
          key={i}
          className="relative"
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered(null)}
        >
          <Badge tone={kindTone[b.kind]}>
            p{b.page} · {kindLabel[b.kind]}
            {typeof b.value === "number" ? ` ${b.value.toFixed(2)}` : ""}
          </Badge>
          {hovered === i && b.message && (
            <div className="absolute left-full ml-2 top-0 whitespace-nowrap text-xs bg-surface-2 border border-border-default rounded px-2 py-1 shadow z-20">
              <span className="text-fg-muted">page {b.page} · {b.kind}: </span>
              <span className="text-fg-primary">{b.message}</span>
              {typeof b.value === "number" && (
                <span className="text-fg-muted"> ({b.value.toFixed(3)})</span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
