/**
 * Renderer registry + dispatcher.
 *
 * Given a source_format string, returns a React component that mounts the
 * format-specific SourceRenderer (per contracts/vizdiff.ts). Unknown formats
 * fall through to the text renderer with a banner noting no native renderer
 * was found.
 *
 * Two shapes of renderer coexist in this codebase:
 *   - Agent F's renderers (docx, xlsx, pptx, html, text) are React components
 *     that render their own DOM and expose a `SourceRenderer` via `onRenderer`.
 *   - Agent E's PDF renderer is a class with `mount(host)` / `unmount()`. We
 *     wrap it in a small React component so the registry presents a uniform
 *     React-component surface to VizDiff / the dev route.
 */

import { useEffect, useRef, type ComponentType } from "react";
import type { SourceRenderer } from "../../../contracts/vizdiff";
import type { SourceRendererProps } from "./types";
import { DocxRenderer } from "./docx";
import { XlsxRenderer } from "./xlsx";
import { PptxRenderer } from "./pptx";
import { HtmlRenderer } from "./html";
import { TextRenderer } from "./text";
import { PdfRenderer } from "./pdf";

// Re-export the shared props type so callers can import from one place.
export type { SourceRendererProps } from "./types";
export {
  DocxRenderer,
  XlsxRenderer,
  PptxRenderer,
  HtmlRenderer,
  TextRenderer,
};

type RendererComponent = ComponentType<SourceRendererProps>;

/** Thin wrappers so TextRenderer's extra props are honored by the registry. */
const MdRenderer: RendererComponent = (props) => (
  <TextRenderer {...props} flavor="md" />
);
const LatexRenderer: RendererComponent = (props) => (
  <TextRenderer
    {...props}
    flavor="latex"
    banner="LaTeX source view (KaTeX render deferred per ledger)."
  />
);
const PlainTextRenderer: RendererComponent = (props) => (
  <TextRenderer {...props} flavor="text" />
);
const FallbackRenderer: RendererComponent = (props) => (
  <TextRenderer
    {...props}
    flavor="text"
    banner={`No native renderer for "${props.source_path}" — showing raw source.`}
  />
);

/**
 * React wrapper around Agent E's class-based PdfRenderer. Mounts on a div,
 * instantiates the class, and surfaces the resulting SourceRenderer via
 * `onRenderer` — same surface as Agent F's renderers.
 */
const PdfRendererComponent: RendererComponent = (props) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<PdfRenderer | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const anchors = props.anchors ?? [];
    const doc = props.doclingDoc;
    const r = new PdfRenderer({
      sourceUrl: props.sourceUrl,
      anchorsProvider: () => anchors,
      doclingDocProvider: () => doc,
    });
    instanceRef.current = r;
    // Class has mount/unmount duck-typed methods
    (r as unknown as { mount: (el: HTMLElement) => void }).mount(hostRef.current);
    props.onRenderer?.(r as unknown as SourceRenderer);
    return () => {
      try {
        (r as unknown as { unmount?: () => void }).unmount?.();
      } catch {
        /* noop */
      }
      (r as unknown as { dispose?: () => void }).dispose?.();
      instanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.hash, props.sourceUrl]);

  return (
    <div
      ref={hostRef}
      className={
        props.className ?? "relative h-full w-full overflow-hidden bg-neutral-950"
      }
    />
  );
};

// The registry is a map so it's trivially inspectable and extensible.
export const RENDERERS: Record<string, RendererComponent> = {
  pdf: PdfRendererComponent,
  docx: DocxRenderer,
  xlsx: XlsxRenderer,
  pptx: PptxRenderer,
  html: HtmlRenderer,
  md: MdRenderer,
  markdown: MdRenderer,
  latex: LatexRenderer,
  tex: LatexRenderer,
  text: PlainTextRenderer,
  txt: PlainTextRenderer,
};

/**
 * Returns the renderer component for a given source_format. Unknown formats
 * return the fallback text renderer with a banner explaining the situation.
 */
export function pickRenderer(source_format: string): RendererComponent {
  const fmt = (source_format ?? "").toLowerCase().trim();
  return RENDERERS[fmt] ?? FallbackRenderer;
}
