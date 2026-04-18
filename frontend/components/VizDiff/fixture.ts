/**
 * VizDiff fixture — used by the stub commit and tests to render <VizDiff />
 * without a live backend. Shape matches contracts/vizdiff.ts VizDiffProps.
 */

import type {
  Anchor,
  QualityBadge,
  PipelineParams,
  SourceRenderer,
  VizDiffDoc,
} from "../../../contracts/vizdiff";

export const FIXTURE_MARKDOWN = `# Attention Is All You Need

Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, Llion Jones,
Aidan N. Gomez, Lukasz Kaiser, Illia Polosukhin.

## Abstract

The dominant sequence transduction models are based on complex recurrent or
convolutional neural networks that include an encoder and a decoder. The best
performing models also connect the encoder and decoder through an attention
mechanism.

<!--- page-break --->

## 1. Introduction

Recurrent neural networks, long short-term memory and gated recurrent neural
networks in particular, have been firmly established as state of the art
approaches in sequence modeling.

<!-- image -->

*Figure 1 placeholder — original figure not extracted in this fixture.*
`;

function byteRange(needle: string): { start: number; end: number } {
  const idx = FIXTURE_MARKDOWN.indexOf(needle);
  return { start: idx, end: idx + needle.length };
}

const h1 = byteRange("# Attention Is All You Need");
const abs = byteRange("## Abstract");
const intro = byteRange("## 1. Introduction");

export const FIXTURE_ANCHORS: Anchor[] = [
  {
    self_ref: "#/texts/0",
    byte_start: h1.start,
    byte_end: h1.end,
    page: 1,
    label: "section_header",
    bbox: { l: 50, t: 750, r: 540, b: 720, coord_origin: "BOTTOMLEFT" },
  },
  {
    self_ref: "#/texts/1",
    byte_start: abs.start,
    byte_end: abs.end,
    page: 1,
    label: "section_header",
    bbox: { l: 50, t: 680, r: 180, b: 660, coord_origin: "BOTTOMLEFT" },
  },
  {
    self_ref: "#/texts/2",
    byte_start: intro.start,
    byte_end: intro.end,
    page: 2,
    label: "section_header",
    bbox: { l: 50, t: 750, r: 260, b: 730, coord_origin: "BOTTOMLEFT" },
  },
];

export const FIXTURE_BADGES: QualityBadge[] = [
  { page: 1, kind: "parse_warning", message: "First page parsed OK (fixture)" },
  { page: 2, kind: "empty_page", message: "Sparse content on page 2 (fixture)" },
  { page: 2, kind: "figure_missing", message: "Figure 1 extraction skipped (fixture)" },
];

export const FIXTURE_PIPELINE: PipelineParams = {
  ocr: { enabled: false, engine: "tesseract" },
  vlm: { enabled: false, model: "granite_docling" },
  tables: { enabled: true },
  enrichments: { formulas: false, code: false, charts: false },
};

export const FIXTURE_DOCLING_DOC = {
  schema_name: "DoclingDocument",
  version: "2.90.0",
  name: "attention.pdf",
  pages: {
    "1": { page_no: 1, size: { width: 612, height: 792 } },
    "2": { page_no: 2, size: { width: 612, height: 792 } },
  },
  texts: [
    { self_ref: "#/texts/0", label: "section_header", text: "Attention Is All You Need", prov: [] },
    { self_ref: "#/texts/1", label: "section_header", text: "Abstract", prov: [] },
    { self_ref: "#/texts/2", label: "section_header", text: "1. Introduction", prov: [] },
  ],
  tables: [],
  pictures: [],
};

export const FIXTURE_DOC: VizDiffDoc = {
  hash: "fixture0000000000000000000000000000000000000000000000000000000000",
  source_path: "/fixtures/attention.pdf",
  source_format: "pdf",
  output_dir: "/tmp/awd-dev-output",
  doclingDoc: FIXTURE_DOCLING_DOC,
  markdown: FIXTURE_MARKDOWN,
  anchors: FIXTURE_ANCHORS,
  qualityBadges: FIXTURE_BADGES,
};

/**
 * A no-op SourceRenderer that satisfies the interface for stubs/tests.
 * Wave 2b can compose against this without pdf.js in the harness.
 */
export function makeStubRenderer(): SourceRenderer {
  let clickHandler: ((evt: { self_ref?: string; page: number }) => void) | null =
    null;
  return {
    renderPage: () => {},
    scrollToBbox: () => {},
    getCurrentViewport: () => ({ page: 1 }),
    onElementClick: (h) => {
      clickHandler = h;
    },
    dispose: () => {
      clickHandler = null;
    },
    // @ts-expect-error — test helper
    _emitClick: (page: number, self_ref?: string) => {
      clickHandler?.({ page, self_ref });
    },
  };
}
