/**
 * Runtime estimation for batch launch preview.
 *
 * Rough heuristics calibrated from docs/docling-probes.md:
 *  - PDFs (native, no OCR): ~0.6s/page
 *  - PDFs (scanned, OCR on): ~2.5s/page likely, ~5s/page worst-case
 *  - PDFs (VLM): ~4s/page likely, ~10s/page worst-case
 *  - DOCX / HTML / MD / text / LaTeX: ~2s/doc flat
 *  - XLSX: ~3s/doc flat (workbooks vary wildly; conservative)
 *  - PPTX: ~4s/doc flat (slide decks)
 *
 * Page-count signal comes from `scan_docs` only for PDFs; other formats don't
 * expose page counts from /scan. We fall back to per-doc flat rates.
 *
 * Stratum names follow Agent B's convention:
 *   pdf-native-1-10, pdf-native-11-50, pdf-native-51-200, pdf-native-201+
 *   pdf-scanned-1-10, ...
 *   docx, xlsx, pptx, html, text, md, latex
 *   pdf-unknown-* (when poppler missing)
 */

import type { PipelineParams, Stratum } from "../../lib/api-client";

interface EstimateInput {
  stratum: Stratum;
  pipeline?: PipelineParams;
}

interface EstimateOutput {
  /** Best-case seconds (things go right) */
  bestSec: number;
  /** Likely seconds */
  likelySec: number;
}

function avgPagesFromBin(name: string): number {
  // Bin midpoints; conservative upper edge when ambiguous.
  if (name.includes("1-10")) return 5;
  if (name.includes("11-50")) return 25;
  if (name.includes("51-200")) return 100;
  if (name.includes("201+") || name.includes("201-")) return 300;
  return 30; // fallback
}

export function estimateStratum({ stratum, pipeline }: EstimateInput): EstimateOutput {
  const name = stratum.name;
  const size = stratum.size;

  // ── PDF branches ──
  if (name.startsWith("pdf-")) {
    const pages = avgPagesFromBin(name);
    const scanned = name.includes("scanned") || name.includes("unknown");
    const ocr = pipeline?.ocr?.enabled ?? true;
    const vlm = pipeline?.vlm?.enabled ?? false;

    let bestPerPage: number;
    let likelyPerPage: number;

    if (vlm) {
      bestPerPage = 2.0;
      likelyPerPage = 4.0;
    } else if (scanned && ocr) {
      bestPerPage = 1.5;
      likelyPerPage = 2.5;
    } else {
      bestPerPage = 0.4;
      likelyPerPage = 0.6;
    }

    return {
      bestSec: size * pages * bestPerPage,
      likelySec: size * pages * likelyPerPage,
    };
  }

  // ── Non-PDF branches (flat per-doc) ──
  let bestPerDoc = 2;
  let likelyPerDoc = 3;
  if (name === "xlsx") {
    bestPerDoc = 2;
    likelyPerDoc = 4;
  } else if (name === "pptx") {
    bestPerDoc = 3;
    likelyPerDoc = 6;
  }

  return {
    bestSec: size * bestPerDoc,
    likelySec: size * likelyPerDoc,
  };
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  const mr = m % 60;
  return mr === 0 ? `${h}h` : `${h}h ${mr}m`;
}
