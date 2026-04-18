/**
 * Tiny in-memory fixtures for the dev route. These avoid committing any
 * third-party binary blobs; each fixture is generated at runtime (html/md/tex/txt)
 * or built from a hand-written DoclingDocument summary (pptx, docx stand-in).
 *
 * For DOCX and XLSX, rendering requires real bytes. We generate them on the fly:
 *   - XLSX: SheetJS can build a workbook from JSON.
 *   - DOCX: we ship a tiny hand-crafted DOCX (zip of XML parts) as a data URL.
 *     To avoid bundling a DOCX library for build, we read the minimal file.
 *
 * The fixtures live only in dev and are not part of production bundles.
 */

import type { Anchor } from "../../../../../contracts/vizdiff";
import type { DoclingDocument } from "../../../../../contracts/docling-types";

export interface Fixture {
  format:
    | "docx"
    | "xlsx"
    | "pptx"
    | "html"
    | "md"
    | "latex"
    | "text";
  hash: string;
  source_path: string;
  /** Either a data URL or a getter returning ArrayBuffer. */
  getSource: () => Promise<{ url?: string; bytes?: ArrayBuffer }>;
  doclingDoc: DoclingDocument;
  anchors: Anchor[];
}

// ─── Hand-built DoclingDocument helpers ─────────────────────────────────

function makeDoc(
  name: string,
  texts: { self_ref: string; label: string; text: string; page: number }[],
  pageCount = 1,
): DoclingDocument {
  const pages: Record<string, { page_no: number; size: { width: number; height: number } }> = {};
  for (let i = 1; i <= pageCount; i++) {
    pages[String(i)] = {
      page_no: i,
      size: { width: 612, height: 792 },
    };
  }
  return {
    schema_name: "DoclingDocument",
    version: "2.0.0",
    name,
    pages,
    texts: texts.map((t) => ({
      self_ref: t.self_ref,
      label: t.label,
      text: t.text,
      prov: [
        {
          page_no: t.page,
          bbox: { l: 0, t: 0, r: 100, b: 20, coord_origin: "TOPLEFT" },
          charspan: [0, t.text.length],
        },
      ],
    })),
    tables: [],
    pictures: [],
  };
}

function makeAnchors(
  items: { self_ref: string; label: string; page: number }[],
): Anchor[] {
  let off = 0;
  return items.map((it) => {
    const a: Anchor = {
      self_ref: it.self_ref,
      byte_start: off,
      byte_end: off + 40,
      page: it.page,
      label: it.label,
      bbox: { l: 0, t: 0, r: 100, b: 20, coord_origin: "TOPLEFT" },
    };
    off += 40;
    return a;
  });
}

// ─── HTML / MD / LaTeX / text ───────────────────────────────────────────

const HTML_SRC = `<!doctype html><html><head><title>Hello</title></head>
<body>
<h1>Fixture HTML</h1>
<p>This document is rendered in a sandboxed iframe with no-scripts CSP.</p>
<p>Try clicking — clicks are ignored for HTML format (bidirectional highlight off).</p>
<script>alert('should never fire');</script>
</body></html>`;

const MD_SRC = `# Fixture Markdown

Some **bold** text and a list:

- one
- two
- three

\`\`\`js
console.log("code fence");
\`\`\`

A [link](https://example.com) and inline \`code\`.
`;

const LATEX_SRC = `\\documentclass{article}
\\begin{document}
\\section{Fixture LaTeX}
This is a formula: $E = mc^2$.
% a comment
\\end{document}
`;

const TEXT_SRC = `Line one of a plain-text fixture.
Line two with some numbers 42 and 1337.
Line three.`;

function bytesFromString(s: string): ArrayBuffer {
  const enc = new TextEncoder().encode(s);
  // Return a standalone ArrayBuffer (not a SharedArrayBuffer view)
  const ab = new ArrayBuffer(enc.byteLength);
  new Uint8Array(ab).set(enc);
  return ab;
}

// ─── XLSX fixture built at runtime via SheetJS ─────────────────────────

async function buildXlsxFixture(): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const sheet1 = XLSX.utils.aoa_to_sheet([
    ["Name", "Amount", "Notes"],
    ["alpha", 12, "first"],
    ["beta", 34, "second"],
    ["gamma", 56, "third"],
  ]);
  const sheet2 = XLSX.utils.aoa_to_sheet([
    ["Item", "Count"],
    ...Array.from({ length: 1200 }, (_, i) => [`row-${i}`, i]),
  ]);
  XLSX.utils.book_append_sheet(wb, sheet1, "Summary");
  XLSX.utils.book_append_sheet(wb, sheet2, "BigSheet");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return out;
}

// ─── DOCX fixture: minimal valid docx built at runtime via a tiny zip ───
// We use the browser's Compression Streams API + a hand-rolled minimal zip
// writer to avoid adding a dep. DOCX = a ZIP containing Content_Types +
// _rels + word/document.xml. docx-preview tolerates missing styles.

async function buildDocxFixture(): Promise<ArrayBuffer> {
  const files: { path: string; content: string }[] = [
    {
      path: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    },
    {
      path: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    {
      path: "word/document.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Fixture DOCX</w:t></w:r></w:p>
<w:p><w:r><w:t>This is the first paragraph of the fixture document.</w:t></w:r></w:p>
<w:p><w:r><w:t>Second paragraph has more text for scroll testing and click-through.</w:t></w:r></w:p>
</w:body>
</w:document>`,
    },
  ];
  return buildZip(files);
}

// Minimal STORE (no compression) zip writer. Sufficient for docx-preview.
function buildZip(
  files: { path: string; content: string }[],
): ArrayBuffer {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.path);
    const data = enc.encode(f.content);
    const crc = crc32(data);

    // Local file header
    const lfh = new ArrayBuffer(30 + nameBytes.length);
    const lv = new DataView(lfh);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // method = STORE
    lv.setUint16(10, 0, true); // time
    lv.setUint16(12, 0, true); // date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // compressed
    lv.setUint32(22, data.length, true); // uncompressed
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    const lfhBytes = new Uint8Array(lfh);
    lfhBytes.set(nameBytes, 30);
    chunks.push(lfhBytes);
    chunks.push(data);

    // Central directory entry
    const cd = new ArrayBuffer(46 + nameBytes.length);
    const cv = new DataView(cd);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    const cdBytes = new Uint8Array(cd);
    cdBytes.set(nameBytes, 46);
    central.push(cdBytes);

    offset += lfhBytes.length + data.length;
  }

  const centralStart = offset;
  for (const c of central) {
    chunks.push(c);
    offset += c.length;
  }
  const centralSize = offset - centralStart;

  // End of central directory
  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);
  ev.setUint16(20, 0, true);
  chunks.push(new Uint8Array(eocd));

  // Concatenate
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out.buffer;
}

// Standard CRC-32 (IEEE 802.3)
let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ─── Fixture registry ───────────────────────────────────────────────────

export const FIXTURES: Fixture[] = [
  {
    format: "docx",
    hash: "fixture-docx",
    source_path: "fixture.docx",
    getSource: async () => ({ bytes: await buildDocxFixture() }),
    doclingDoc: makeDoc("fixture.docx", [
      { self_ref: "#/texts/0", label: "section_header", text: "Fixture DOCX", page: 1 },
      { self_ref: "#/texts/1", label: "text", text: "This is the first paragraph of the fixture document.", page: 1 },
      { self_ref: "#/texts/2", label: "text", text: "Second paragraph has more text for scroll testing and click-through.", page: 1 },
    ]),
    anchors: makeAnchors([
      { self_ref: "#/texts/0", label: "section_header", page: 1 },
      { self_ref: "#/texts/1", label: "text", page: 1 },
      { self_ref: "#/texts/2", label: "text", page: 1 },
    ]),
  },
  {
    format: "xlsx",
    hash: "fixture-xlsx",
    source_path: "fixture.xlsx",
    getSource: async () => ({ bytes: await buildXlsxFixture() }),
    doclingDoc: makeDoc("fixture.xlsx", [], 2),
    anchors: [
      {
        self_ref: "#/tables/0/cells/1_1",
        byte_start: 0,
        byte_end: 10,
        page: 1,
        label: "table",
        bbox: { l: 1, t: 1, r: 2, b: 2, coord_origin: "TOPLEFT" },
      },
    ],
  },
  {
    format: "pptx",
    hash: "fixture-pptx",
    source_path: "fixture.pptx",
    getSource: async () => ({ url: "" }),
    doclingDoc: makeDoc(
      "fixture.pptx",
      [
        { self_ref: "#/texts/0", label: "title", text: "Deck Title", page: 1 },
        { self_ref: "#/texts/1", label: "text", text: "Bullet one on slide 1", page: 1 },
        { self_ref: "#/texts/2", label: "text", text: "Bullet two on slide 1", page: 1 },
        { self_ref: "#/texts/3", label: "section_header", text: "Section Two", page: 2 },
        { self_ref: "#/texts/4", label: "text", text: "Slide 2 content", page: 2 },
      ],
      2,
    ),
    anchors: makeAnchors([
      { self_ref: "#/texts/0", label: "title", page: 1 },
      { self_ref: "#/texts/1", label: "text", page: 1 },
    ]),
  },
  {
    format: "html",
    hash: "fixture-html",
    source_path: "fixture.html",
    getSource: async () => ({ bytes: bytesFromString(HTML_SRC) }),
    doclingDoc: makeDoc("fixture.html", [
      { self_ref: "#/texts/0", label: "section_header", text: "Fixture HTML", page: 1 },
    ]),
    anchors: [],
  },
  {
    format: "md",
    hash: "fixture-md",
    source_path: "fixture.md",
    getSource: async () => ({ bytes: bytesFromString(MD_SRC) }),
    doclingDoc: makeDoc("fixture.md", [
      { self_ref: "#/texts/0", label: "section_header", text: "Fixture Markdown", page: 1 },
    ]),
    anchors: [
      {
        self_ref: "#/texts/0",
        byte_start: 0,
        byte_end: 22,
        page: 1,
        label: "section_header",
        bbox: { l: 0, t: 0, r: 100, b: 20, coord_origin: "TOPLEFT" },
      },
    ],
  },
  {
    format: "latex",
    hash: "fixture-latex",
    source_path: "fixture.tex",
    getSource: async () => ({ bytes: bytesFromString(LATEX_SRC) }),
    doclingDoc: makeDoc("fixture.tex", [
      { self_ref: "#/texts/0", label: "section_header", text: "Fixture LaTeX", page: 1 },
    ]),
    anchors: [],
  },
  {
    format: "text",
    hash: "fixture-text",
    source_path: "fixture.txt",
    getSource: async () => ({ bytes: bytesFromString(TEXT_SRC) }),
    doclingDoc: makeDoc("fixture.txt", [
      { self_ref: "#/texts/0", label: "text", text: TEXT_SRC, page: 1 },
    ]),
    anchors: [
      {
        self_ref: "#/texts/0",
        byte_start: 0,
        byte_end: TEXT_SRC.length,
        page: 1,
        label: "text",
        bbox: { l: 0, t: 0, r: 100, b: 20, coord_origin: "TOPLEFT" },
      },
    ],
  },
];
