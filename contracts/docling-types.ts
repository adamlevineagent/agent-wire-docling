/**
 * DoclingDocument — minimal shape the frontend consumes.
 *
 * Pinned against Docling 2.90.0 (see docs/docling-probes.md for surface proof).
 * Frontend does not consume the full DoclingDocument; only the fields below.
 * Isolating here means a Docling upgrade that changes unrelated fields won't
 * cascade into renderer changes.
 *
 * The BACKEND emits `doc.json` unmodified — whatever Docling emits is what you
 * get. This file tells the FRONTEND what it's allowed to rely on.
 */

export interface DoclingBBox {
  l: number;
  t: number;
  r: number;
  b: number;
  coord_origin: "BOTTOMLEFT" | "TOPLEFT";
}

export interface DoclingProvenance {
  page_no: number;
  bbox: DoclingBBox;
  /** [start, end] char offsets within the item's text */
  charspan: [number, number];
}

/** Union of all label strings observed in probes — expand as needed. */
export type DoclingLabel =
  | "text"
  | "paragraph"
  | "section_header"
  | "title"
  | "caption"
  | "footnote"
  | "list_item"
  | "table"
  | "picture"
  | "formula"
  | "code"
  | "page_header"
  | "page_footer"
  | string; // fallback for labels we haven't catalogued

export interface DoclingItem {
  /** e.g. "#/texts/42" — unique and addressable */
  self_ref: string;
  label: DoclingLabel;
  /** Item text; empty for pure-structure items */
  text?: string;
  prov: DoclingProvenance[];
  /** Reference string to parent item */
  parent?: string;
}

export interface DoclingPage {
  page_no: number;
  size: { width: number; height: number };
}

/** Top-level document body. Additional fields exist in Docling output; ignored here. */
export interface DoclingDocument {
  schema_name: string;
  version: string;
  name: string;
  pages: Record<string, DoclingPage>;
  texts: DoclingItem[];
  tables: DoclingItem[];
  pictures: DoclingItem[];
}

/**
 * Sidecar `doc.anchors.json` — byte-range map for bidirectional highlight.
 * Emitted by backend Agent A alongside `doc.md`.
 */
export interface Anchor {
  self_ref: string;
  byte_start: number;
  byte_end: number;
  page: number;
  label: DoclingLabel;
  bbox: DoclingBBox;
}

/** Small helper for frontend coord-origin flipping. */
export function bboxToTopLeft(
  bbox: DoclingBBox,
  pageHeight: number
): { x: number; y: number; w: number; h: number } {
  if (bbox.coord_origin === "TOPLEFT") {
    return {
      x: bbox.l,
      y: bbox.t,
      w: bbox.r - bbox.l,
      h: bbox.b - bbox.t,
    };
  }
  // BOTTOMLEFT (PDF native)
  return {
    x: bbox.l,
    y: pageHeight - bbox.t,
    w: bbox.r - bbox.l,
    h: bbox.t - bbox.b,
  };
}
