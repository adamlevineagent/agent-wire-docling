"use client";

/**
 * /dev/renderers — standalone dev route for Wave 2a Agent F.
 *
 * Click a format chip to load its fixture in the renderer registry.
 * Used by the agent to verify each renderer loads without crashing, and
 * by Agent E / the Wave 2a verifier to compose VizDiff against real
 * per-format renderers.
 */

import { useEffect, useState } from "react";
import { pickRenderer } from "../../../components/Renderers";
import type { SourceRenderer } from "../../../../contracts/vizdiff";
import {
  FIXTURES,
  type Fixture,
} from "../../../components/Renderers/__dev__/fixtures";

export default function DevRenderersPage() {
  const [active, setActive] = useState<Fixture>(FIXTURES[0]);
  const [sourceBytes, setSourceBytes] = useState<ArrayBuffer | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string>("");
  const [rendererRef, setRendererRef] = useState<SourceRenderer | null>(null);
  const [events, setEvents] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setSourceBytes(null);
    setSourceUrl("");
    setRendererRef(null);
    setEvents([]);
    active.getSource().then((s) => {
      if (cancelled) return;
      setSourceBytes(s.bytes ?? null);
      setSourceUrl(s.url ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    if (!rendererRef) return;
    rendererRef.onElementClick((evt) => {
      setEvents((prev) => [
        `click → page=${evt.page} self_ref=${evt.self_ref ?? "(none)"}`,
        ...prev,
      ].slice(0, 10));
    });
  }, [rendererRef]);

  const Renderer = pickRenderer(active.format);

  return (
    <div className="flex h-screen w-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3">
        <h1 className="text-sm font-semibold">Wave 2a · Renderer dev harness</h1>
        <div className="ml-4 flex flex-wrap gap-1">
          {FIXTURES.map((f) => (
            <button
              key={f.hash}
              onClick={() => setActive(f)}
              className={`rounded px-2 py-1 text-xs ${
                f.hash === active.hash
                  ? "bg-blue-600 text-white"
                  : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
              }`}
            >
              {f.format} · {f.source_path}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2 text-xs">
          <button
            onClick={() => rendererRef?.renderPage(1)}
            className="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700"
          >
            renderPage(1)
          </button>
          <button
            onClick={() =>
              rendererRef?.scrollToBbox(1, {
                l: 1,
                t: 1,
                r: 10,
                b: 10,
                coord_origin: "TOPLEFT",
              })
            }
            className="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700"
          >
            scrollToBbox
          </button>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-hidden">
          {(sourceBytes || sourceUrl || active.format === "pptx") && (
            <Renderer
              key={active.hash}
              hash={active.hash}
              source_path={active.source_path}
              sourceUrl={sourceUrl}
              sourceBytes={sourceBytes}
              doclingDoc={active.doclingDoc}
              anchors={active.anchors}
              onRenderer={setRendererRef}
            />
          )}
        </main>
        <aside className="w-72 shrink-0 border-l border-neutral-800 p-3 text-xs">
          <div className="mb-2 font-semibold text-neutral-400">Click events</div>
          <div className="flex flex-col gap-1 font-mono text-[11px]">
            {events.length === 0 && (
              <span className="text-neutral-600">
                (click inside the renderer)
              </span>
            )}
            {events.map((e, i) => (
              <span key={i} className="text-neutral-300">
                {e}
              </span>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
