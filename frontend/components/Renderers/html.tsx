"use client";

/**
 * HTML source renderer.
 *
 * Sandboxed <iframe> with no-scripts CSP. We fetch the raw HTML, then render
 * it inside `sandbox="allow-same-origin"` (no `allow-scripts`) — this means
 * inline <script> tags cannot execute. A CSP <meta> is also injected as
 * defense-in-depth.
 *
 * Bidirectional highlight is not implemented for HTML:
 *   - `scrollToBbox` is a no-op (DoclingDocument HTML coords are unreliable)
 *   - `onElementClick` is disabled (iframe origin isolation)
 *
 * This is a graceful renderer for a format that wasn't a first-class
 * VizDiff target.
 */

import { useEffect, useRef, useState } from "react";
import type { SourceRenderer } from "../../../contracts/vizdiff";
import { makeNoopRenderer, type SourceRendererProps } from "./types";

export function HtmlRenderer(props: SourceRendererProps) {
  const { hash, sourceUrl, sourceBytes, onRenderer } = props;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        let html: string;
        if (sourceBytes) {
          html = new TextDecoder().decode(sourceBytes);
        } else {
          const res = await fetch(sourceUrl);
          if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
          html = await res.text();
        }
        if (cancelled) return;
        setSrcDoc(wrapWithCSP(html));
      } catch (e) {
        if (!cancelled) {
          setError(
            `Failed to load HTML: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }
    load();

    const renderer = makeNoopRenderer("html-iframe-no-bbox", {
      renderPage: () => {
        iframeRef.current?.contentWindow?.scrollTo(0, 0);
      },
    });
    onRenderer?.(renderer);

    return () => {
      cancelled = true;
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, sourceUrl]);

  return (
    <div
      className={
        props.className ?? "w-full h-full overflow-hidden bg-white"
      }
    >
      {error && <div className="p-6 text-sm text-red-400">{error}</div>}
      {!error && srcDoc !== null && (
        <iframe
          ref={iframeRef}
          sandbox="allow-same-origin"
          srcDoc={srcDoc}
          className="h-full w-full border-0"
          title="HTML source preview"
        />
      )}
    </div>
  );
}

function wrapWithCSP(html: string): string {
  const csp =
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self' data:; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-ancestors 'self';\">";
  // If the document already has <head>, inject after it; else prepend.
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => m + csp);
  }
  return `<!doctype html><html><head>${csp}</head><body>${html}</body></html>`;
}

export type { SourceRenderer };
