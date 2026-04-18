/**
 * Small pure helpers shared across TasteTest panes.
 */

import type { PipelineParams, Stratum } from "../../lib/api-client";
import type { StratumState, DocApproval } from "./types";

export const DEFAULT_PIPELINE: PipelineParams = {
  ocr: { enabled: true, engine: "tesseract" },
  vlm: { enabled: false, model: "granite_docling" },
  tables: { enabled: true },
  enrichments: { formulas: false, code: false, charts: false },
};

export function approvalCount(s: StratumState): {
  approved: number;
  rejected: number;
  skipped: number;
  flagged: number;
  reviewed: number;
} {
  const a = s.approvals ?? [];
  const approved = a.filter((x) => x.status === "approved").length;
  const rejected = a.filter((x) => x.status === "rejected").length;
  const skipped = a.filter((x) => x.status === "skipped").length;
  const flagged = a.filter((x) => x.status === "flagged").length;
  return { approved, rejected, skipped, flagged, reviewed: a.length };
}

export function approvalRate(s: StratumState): number | null {
  const { approved, reviewed } = approvalCount(s);
  if (reviewed === 0) return null;
  return approved / reviewed;
}

export function lookGoodToLock(s: StratumState): boolean {
  const { approved, reviewed } = approvalCount(s);
  return approved >= 5 && reviewed > 0 && approved / reviewed >= 0.8;
}

export function adjustPipelineSuggested(s: StratumState): boolean {
  const { reviewed } = approvalCount(s);
  const rate = approvalRate(s);
  return reviewed >= 5 && rate !== null && rate < 0.5;
}

export function convergenceHint(s: StratumState): string {
  const { approved, reviewed } = approvalCount(s);
  if (reviewed === 0) return "Pull a sample to begin";
  const rate = approvalRate(s) ?? 0;
  const pct = Math.round(rate * 100);
  if (lookGoodToLock(s)) return `${approved}/${reviewed} approved (${pct}%) — looks good to lock`;
  if (adjustPipelineSuggested(s)) return `${approved}/${reviewed} approved (${pct}%) — consider adjusting pipeline`;
  return `${approved}/${reviewed} approved (${pct}%)`;
}

export function pipelineHashKey(p: PipelineParams): string {
  // Stable but cheap client-side key for display grouping.
  // Backend uses its own hash; this is *only* for UI "under old pipeline" marks.
  return JSON.stringify([
    p.ocr?.enabled ?? true,
    p.ocr?.engine ?? "tesseract",
    p.vlm?.enabled ?? false,
    p.vlm?.model ?? "granite_docling",
    p.tables?.enabled ?? true,
    p.enrichments?.formulas ?? false,
    p.enrichments?.code ?? false,
    p.enrichments?.charts ?? false,
  ]);
}

export function reviewedHashes(s: StratumState): string[] {
  return (s.approvals ?? []).map((a) => a.source_sha256);
}

export function findApproval(
  s: StratumState,
  sha: string,
): DocApproval | undefined {
  return (s.approvals ?? []).find((a) => a.source_sha256 === sha);
}

export function scanStratumSize(scanStrata: Stratum[] | undefined, name: string): number | null {
  const hit = scanStrata?.find((x) => x.name === name);
  return hit ? hit.size : null;
}

export function inferOutputDir(folder: string | null): string {
  if (!folder) return "";
  // `/a/b/c` → `/a/b/c/.docling-out`. Strip trailing slash.
  const trimmed = folder.replace(/\/+$/, "");
  return trimmed ? `${trimmed}/.docling-out` : "";
}
