"use client";

/**
 * PDF SourceRenderer — pdfjs-dist.
 *
 * Implements contracts/vizdiff.ts SourceRenderer, plus an optional
 * `mount(el)` / `unmount()` duck-typed pair the VizDiff SourceSlot uses
 * to attach this renderer into a host div.
 *
 * Click → bbox hit test against anchors[] for that page, emits {self_ref}
 * if a hit; else {page}.
 */

import type {
  Anchor,
  BBox,
  SourceRenderer,
  SourceViewport,
} from "../../../contracts/vizdiff";
import { bboxToTopLeft } from "../../../contracts/docling-types";

type PdfjsDocumentProxy = {
  numPages: number;
  getPage: (n: number) => Promise<PdfjsPageProxy>;
  destroy: () => Promise<void>;
};

type PdfjsViewport = {
  width: number;
  height: number;
  scale: number;
};

type PdfjsPageProxy = {
  getViewport: (args: { scale: number }) => PdfjsViewport;
  render: (args: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfjsViewport;
  }) => { promise: Promise<void>; cancel?: () => void };
};

export interface PdfRendererOptions {
  sourceUrl: string;
  anchorsProvider?: () => Anchor[];
  doclingDocProvider?: () => unknown;
  scale?: number;
}

export class PdfRenderer implements SourceRenderer {
  private host: HTMLElement | null = null;
  private scroller: HTMLDivElement | null = null;
  private pdfDoc: PdfjsDocumentProxy | null = null;
  private pageCanvases = new Map<number, HTMLCanvasElement>();
  private pageViewports = new Map<number, PdfjsViewport>();
  private pageContainers = new Map<number, HTMLDivElement>();
  private pageHeights = new Map<number, number>();
  private rendering = new Set<number>();
  private renderTasks = new Map<number, { cancel?: () => void }>();
  private clickHandler: ((evt: { self_ref?: string; page: number; bbox?: BBox }) => void) | null = null;
  private highlightEl: HTMLDivElement | null = null;
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;
  private loadPromise: Promise<void>;
  private disposed = false;
  private currentPage = 1;
  private scale: number;

  constructor(private opts: PdfRendererOptions) {
    this.scale = opts.scale ?? 1.3;
    this.loadPromise = this.loadDoc();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────
  private async loadDoc() {
    try {
      const pdfjs = await import("pdfjs-dist");
      // Worker: Next/Turbopack bundles this via webpack alias (canvas=false in next.config)
      // Use the .mjs worker shipped with pdfjs-dist.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const GlobalWorkerOptions = (pdfjs as any).GlobalWorkerOptions;
      if (GlobalWorkerOptions && !GlobalWorkerOptions.workerSrc) {
        // Use a CDN-equivalent local path via unpkg-like URL; fallback to bundled worker.
        GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const getDocument = (pdfjs as any).getDocument;
      const task = getDocument({ url: this.opts.sourceUrl, isEvalSupported: false });
      this.pdfDoc = await task.promise;
    } catch (e) {
      // Renderer load failures are visible as "source renderer — page N" placeholder
      // eslint-disable-next-line no-console
      console.warn("[PdfRenderer] load failed", e);
    }
  }

  mount(host: HTMLElement) {
    if (this.disposed) return;
    this.host = host;
    // Clear host and build scroller
    host.replaceChildren();
    const scroller = document.createElement("div");
    scroller.style.position = "absolute";
    scroller.style.inset = "0";
    scroller.style.overflow = "auto";
    scroller.style.padding = "12px";
    scroller.style.background = "#111";
    scroller.addEventListener("scroll", this.onScroll);
    this.scroller = scroller;
    host.appendChild(scroller);

    // Pre-load pages when doc is ready
    this.loadPromise.then(() => {
      if (this.disposed || !this.pdfDoc) return;
      this.ensurePageContainers();
      // Render first page eagerly, neighbors lazily
      this.renderPage(1);
    });
  }

  unmount() {
    if (this.scroller) {
      this.scroller.removeEventListener("scroll", this.onScroll);
      this.scroller = null;
    }
    if (this.host) {
      this.host.replaceChildren();
      this.host = null;
    }
    this.pageCanvases.clear();
    this.pageContainers.clear();
    this.pageViewports.clear();
    this.pageHeights.clear();
  }

  async dispose() {
    this.disposed = true;
    for (const t of this.renderTasks.values()) {
      try {
        t.cancel?.();
      } catch {
        // ignore
      }
    }
    this.renderTasks.clear();
    this.unmount();
    if (this.pdfDoc) {
      try {
        await this.pdfDoc.destroy();
      } catch {
        // ignore
      }
      this.pdfDoc = null;
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────
  private ensurePageContainers() {
    if (!this.pdfDoc || !this.scroller) return;
    for (let n = 1; n <= this.pdfDoc.numPages; n++) {
      if (this.pageContainers.has(n)) continue;
      const c = document.createElement("div");
      c.dataset.pageNo = String(n);
      c.style.position = "relative";
      c.style.margin = "0 auto 12px";
      c.style.background = "#1a1a1a";
      c.style.border = "1px solid #333";
      c.style.borderRadius = "4px";
      c.style.overflow = "hidden";
      // Placeholder size until rendered
      c.style.width = "612px";
      c.style.height = "792px";

      // label
      const label = document.createElement("div");
      label.textContent = `p ${n}`;
      label.style.position = "absolute";
      label.style.right = "4px";
      label.style.bottom = "4px";
      label.style.font = "10px ui-monospace, SFMono-Regular, monospace";
      label.style.color = "#777";
      label.style.zIndex = "2";
      c.appendChild(label);

      c.addEventListener("click", (e) => this.onPageClick(e, n));
      this.scroller.appendChild(c);
      this.pageContainers.set(n, c);
    }
  }

  renderPage(page: number): void {
    void this.renderPageAsync(page);
  }

  private async renderPageAsync(page: number) {
    await this.loadPromise;
    if (this.disposed || !this.pdfDoc) return;
    if (page < 1 || page > this.pdfDoc.numPages) return;
    this.currentPage = page;
    this.ensurePageContainers();
    const container = this.pageContainers.get(page);
    if (!container) return;

    // Scroll to page if not already near it
    if (this.scroller) {
      const sRect = this.scroller.getBoundingClientRect();
      const cRect = container.getBoundingClientRect();
      const offScreen = cRect.bottom < sRect.top || cRect.top > sRect.bottom;
      if (offScreen) {
        container.scrollIntoView({ block: "start" });
      }
    }

    if (this.pageCanvases.has(page) || this.rendering.has(page)) return;
    this.rendering.add(page);

    try {
      const pageProxy = await this.pdfDoc.getPage(page);
      if (this.disposed) return;
      const viewport = pageProxy.getViewport({ scale: this.scale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.display = "block";
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      container.style.width = `${viewport.width}px`;
      container.style.height = `${viewport.height}px`;
      container.insertBefore(canvas, container.firstChild);

      const task = pageProxy.render({ canvasContext: ctx, viewport });
      this.renderTasks.set(page, task);
      await task.promise;

      this.pageCanvases.set(page, canvas);
      this.pageViewports.set(page, viewport);
      this.pageHeights.set(page, viewport.height);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[PdfRenderer] render failed", page, e);
    } finally {
      this.rendering.delete(page);
      this.renderTasks.delete(page);
    }

    // Lazy render neighbors
    this.renderNeighbors(page);
  }

  private renderNeighbors(page: number) {
    if (!this.pdfDoc) return;
    for (const p of [page - 1, page + 1]) {
      if (p >= 1 && p <= this.pdfDoc.numPages) {
        this.renderPageAsync(p);
      }
    }
  }

  // ── Viewport tracking ────────────────────────────────────────────
  private onScroll = () => {
    if (!this.scroller) return;
    const sRect = this.scroller.getBoundingClientRect();
    let best: { page: number; dist: number } | null = null;
    for (const [n, el] of this.pageContainers.entries()) {
      const r = el.getBoundingClientRect();
      const dist = Math.abs(r.top - sRect.top);
      if (!best || dist < best.dist) best = { page: n, dist };
    }
    if (best) this.currentPage = best.page;
    // Lazy-render the visible page
    if (best && !this.pageCanvases.has(best.page)) {
      this.renderPageAsync(best.page);
    }
  };

  getCurrentViewport(): SourceViewport {
    return { page: this.currentPage };
  }

  scrollToBbox(page: number, bbox: BBox): void {
    void this.scrollToBboxAsync(page, bbox);
  }

  private async scrollToBboxAsync(page: number, bbox: BBox) {
    await this.renderPageAsync(page);
    const container = this.pageContainers.get(page);
    const vp = this.pageViewports.get(page);
    if (!container || !vp || !this.scroller) return;

    const pageHeight = vp.height / this.scale; // approximate PDF pts
    const tl = bboxToTopLeft(bbox, pageHeight);
    const x = tl.x * this.scale;
    const y = tl.y * this.scale;
    const w = Math.max(4, tl.w * this.scale);
    const h = Math.max(4, Math.abs(tl.h) * this.scale);

    // Flash overlay
    if (!this.highlightEl) {
      const el = document.createElement("div");
      el.style.position = "absolute";
      el.style.pointerEvents = "none";
      el.style.border = "2px solid rgba(250, 204, 21, 0.9)";
      el.style.background = "rgba(250, 204, 21, 0.2)";
      el.style.borderRadius = "3px";
      el.style.transition = "opacity 200ms ease";
      el.style.zIndex = "3";
      this.highlightEl = el;
    }
    container.appendChild(this.highlightEl);
    this.highlightEl.style.left = `${x}px`;
    this.highlightEl.style.top = `${y}px`;
    this.highlightEl.style.width = `${w}px`;
    this.highlightEl.style.height = `${h}px`;
    this.highlightEl.style.opacity = "1";

    // Scroll centred-ish
    const containerTop = container.offsetTop;
    const target = containerTop + y - this.scroller.clientHeight / 2 + h / 2;
    this.scroller.scrollTo({ top: Math.max(0, target), behavior: "smooth" });

    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.highlightTimer = setTimeout(() => {
      if (this.highlightEl) this.highlightEl.style.opacity = "0";
    }, 1200);
  }

  // ── Click → bbox hit test ────────────────────────────────────────
  onElementClick(handler: (evt: { self_ref?: string; page: number; bbox?: BBox }) => void): void {
    this.clickHandler = handler;
  }

  private onPageClick(e: MouseEvent, page: number) {
    if (!this.clickHandler) return;
    const container = this.pageContainers.get(page);
    const vp = this.pageViewports.get(page);
    if (!container || !vp) {
      this.clickHandler({ page });
      return;
    }
    const rect = container.getBoundingClientRect();
    const xCss = e.clientX - rect.left;
    const yCss = e.clientY - rect.top;
    // Convert screen-px → PDF pts (undo scale)
    const xPdf = xCss / this.scale;
    const yPdfTopLeft = yCss / this.scale;
    const pageHeightPts = vp.height / this.scale;

    const anchors = this.opts.anchorsProvider?.() ?? [];
    const onPage = anchors.filter((a) => a.page === page);
    // Prefer the smallest-area anchor that contains the click so nested
    // table cells win over their enclosing table/group bbox.
    let hit: Anchor | null = null;
    let hitArea = Number.POSITIVE_INFINITY;
    for (const a of onPage) {
      const tl = bboxToTopLeft(a.bbox, pageHeightPts);
      const w = tl.w;
      const h = Math.abs(tl.h);
      const x0 = tl.x;
      const y0 = tl.y;
      const x1 = tl.x + w;
      const y1 = tl.y + h;
      if (xPdf >= x0 && xPdf <= x1 && yPdfTopLeft >= y0 && yPdfTopLeft <= y1) {
        const area = Math.max(1, w * h);
        if (area < hitArea) {
          hit = a;
          hitArea = area;
        }
      }
    }
    if (hit) {
      this.clickHandler({ page, self_ref: hit.self_ref, bbox: hit.bbox });
    } else {
      this.clickHandler({ page });
    }
  }
}
