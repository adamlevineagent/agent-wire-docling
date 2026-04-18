/**
 * VizDiff contract — frozen in pre-flight P2.
 *
 * The shared two-pane reviewer component that every format renderer plugs into,
 * and that TasteTest + BatchRun both embed. Four Wave 2 agents (E, F, G, H)
 * consume this file; if it changes mid-wave, everyone drifts.
 *
 * Types in this file MUST match:
 *  - contracts/openapi.yaml (QualityBadge, PipelineParams, Anchor, BBox, DoclingDocument)
 *  - contracts/shortcuts.ts (scope routing)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Core geometry + provenance (mirrors openapi.yaml)

export interface BBox {
  l: number;
  t: number;
  r: number;
  b: number;
  coord_origin: "BOTTOMLEFT" | "TOPLEFT";
}

export interface Anchor {
  self_ref: string; // e.g. "#/texts/42"
  byte_start: number;
  byte_end: number;
  page: number;
  label: string; // text | section_header | table | picture | list_item | ...
  bbox: BBox;
}

export interface QualityBadge {
  page: number;
  kind:
    | "ocr_low"
    | "empty_page"
    | "table_warn"
    | "figure_missing"
    | "parse_warning";
  value?: number | null;
  message?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source renderer interface — every per-format renderer implements this

export interface SourceViewport {
  page: number;
  /** Optional bbox when we can report a specific element in view */
  bbox?: BBox;
}

export interface SourceRenderer {
  /** Called by VizDiff when the user navigates to page N (1-indexed). */
  renderPage(page: number): void;

  /** Flash/scroll to a specific region. No-op if bbox unsupported for this format. */
  scrollToBbox(page: number, bbox: BBox): void;

  /** Snapshot of the currently-visible viewport. VizDiff polls this for MD-side sync. */
  getCurrentViewport(): SourceViewport;

  /**
   * Register a click handler. Renderer emits the element the user clicked on
   * (by self_ref) if it can be resolved from the click location.
   * Fallback: emit { page } only.
   */
  onElementClick(
    handler: (evt: { self_ref?: string; page: number; bbox?: BBox }) => void
  ): void;

  /** Cleanup — called when VizDiff unmounts or swaps source. */
  dispose(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline params (mirrors openapi.yaml PipelineParams)

/**
 * Sub-object fields are `required` in the codegen'd PipelineParams because
 * the OpenAPI schema supplies defaults. We mirror that here so the hand-
 * written contract stays byte-identical to the codegen'd components.schemas
 * shape — callers can pass this directly to api.convert without casts.
 */
export interface PipelineParams {
  ocr?: {
    enabled: boolean;
    engine: "tesseract" | "rapidocr";
  };
  vlm?: {
    enabled: boolean;
    model: string;
  };
  tables?: {
    enabled: boolean;
  };
  enrichments?: {
    formulas: boolean;
    code: boolean;
    charts: boolean;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Review actions

export type ReviewAction = "approve" | "reject" | "skip" | "flag";

export interface ReviewDecision {
  action: ReviewAction;
  notes?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// VizDiff props — what every caller (TasteTest, BatchRun review) passes in

export interface VizDiffDoc {
  /** Canonical source_sha256 */
  hash: string;
  /** Human-facing filename */
  source_path: string;
  /** pdf | docx | xlsx | pptx | html | txt | md | latex */
  source_format: string;
  /** Output-dir absolute path; frontend fetches /docs/{hash}/source etc. */
  output_dir: string;

  /** DoclingDocument JSON (full body) — already fetched */
  doclingDoc: unknown; // see contracts/docling-types.ts for narrower shape

  /** Markdown body with page-break placeholders */
  markdown: string;

  /** Anchor sidecar — byte ranges in `markdown` ↔ self_ref */
  anchors: Anchor[];

  /** Per-page quality badges, already sorted by page */
  qualityBadges: QualityBadge[];
}

export interface VizDiffProps {
  doc: VizDiffDoc;

  /** Renderer instance matched to doc.source_format. Owner decides which. */
  sourceRenderer: SourceRenderer;

  /** Current pipeline used to produce this conversion — shown in header */
  currentPipeline: PipelineParams;

  /** Callbacks. Undefined callbacks → that action is hidden in the UI. */
  onApprove?: (decision: ReviewDecision) => void;
  onReject?: (decision: ReviewDecision) => void;
  onSkip?: () => void;
  onFlag?: (decision: ReviewDecision) => void;

  /** Rerun with different pipeline. Undefined → rerun button hidden. */
  onRerun?: (params: PipelineParams) => void;

  /** Navigation between docs in a list. Undefined → n/p keys inert. */
  onNext?: () => void;
  onPrev?: () => void;

  /**
   * Keyboard scope identity. VizDiff registers its bindings under this scope
   * via useShortcutScope. Must be unique per VizDiff instance on screen.
   * Typical values: "vizdiff:tastetest" | "vizdiff:batchreview"
   */
  shortcutScope: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default shortcut bindings for VizDiff scope
// (actual binding registration happens via contracts/shortcuts.ts)

export const VIZDIFF_BINDINGS = {
  "y": "approve",
  "x": "reject",
  "s": "skip",
  "f": "flag",
  "n": "next-doc",
  "p": "prev-doc",
  "j": "next-page",
  "k": "prev-page",
  "r": "rerun",
  "?": "help",
  "1": "tab-rendered-md",
  "2": "tab-raw-md",
  "3": "tab-json",
} as const;
