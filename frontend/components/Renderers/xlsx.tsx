"use client";

/**
 * XLSX source renderer.
 *
 * Uses SheetJS (`xlsx`) to parse the workbook, renders each sheet as an HTML
 * table under a tab strip. Large sheets (>1000 rows) are sliced into pages of
 * 500 rows with prev/next controls — virtualization-lite, no react-virtuoso.
 *
 * - `scrollToBbox` → interprets bbox.l as column index and bbox.t as row index
 *   (Docling XLSX coords are grid positions, not pixels). Falls back to self_ref
 *   lookup via anchors if bbox is zero/empty.
 * - `onElementClick` emits self_ref derived from (sheet, row, col) matched
 *   against anchor list.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Anchor,
  BBox,
  SourceRenderer,
} from "../../../contracts/vizdiff";
import {
  warnAnchorsMissingOnce,
  type SourceRendererProps,
} from "./types";

const PAGE_SIZE = 500;
const VIRTUALIZE_THRESHOLD = 1000;

interface ClickEvt {
  self_ref?: string;
  page: number;
  bbox?: BBox;
}

interface SheetData {
  name: string;
  rows: (string | number | null)[][];
  totalRows: number;
}

export function XlsxRenderer(props: SourceRendererProps) {
  const { hash, sourceUrl, sourceBytes, anchors, onRenderer } = props;
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const clickHandlerRef = useRef<((e: ClickEvt) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const bytes =
          sourceBytes ??
          (await fetch(sourceUrl).then((r) => {
            if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
            return r.arrayBuffer();
          }));
        if (cancelled) return;
        const XLSX = await import("xlsx");
        const wb = XLSX.read(bytes, { type: "array" });
        const parsed: SheetData[] = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
            header: 1,
            defval: null,
            raw: false,
          });
          return { name, rows, totalRows: rows.length };
        });
        if (!cancelled) {
          setSheets(parsed);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            `Failed to parse XLSX: ${e instanceof Error ? e.message : String(e)}`,
          );
          setLoading(false);
        }
      }
    }
    load();

    const renderer: SourceRenderer = {
      renderPage: (p: number) => {
        // Treat page as 1-indexed sheet tab
        const idx = Math.max(0, Math.min(sheets.length - 1, p - 1));
        setActiveIdx(idx);
        setPage(0);
      },
      scrollToBbox: (p: number, bbox: BBox) => {
        const idx = Math.max(0, Math.min(sheets.length - 1, p - 1));
        setActiveIdx(idx);
        const row = Math.max(0, Math.floor(bbox.t ?? 0));
        const col = Math.max(0, Math.floor(bbox.l ?? 0));
        setPage(Math.floor(row / PAGE_SIZE));
        requestAnimationFrame(() => {
          const cell = containerRef.current?.querySelector<HTMLElement>(
            `td[data-row="${row}"][data-col="${col}"]`,
          );
          if (cell) {
            cell.scrollIntoView({ behavior: "smooth", block: "center" });
            cell.style.outline = "2px solid #60a5fa";
            setTimeout(() => (cell.style.outline = ""), 1500);
          }
        });
      },
      getCurrentViewport: () => ({ page: activeIdx + 1 }),
      onElementClick: (h) => {
        clickHandlerRef.current = h;
      },
      dispose: () => {
        clickHandlerRef.current = null;
      },
    };
    onRenderer?.(renderer);

    return () => {
      cancelled = true;
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, sourceUrl]);

  const active = sheets[activeIdx];
  const virtualized = !!active && active.totalRows > VIRTUALIZE_THRESHOLD;
  const pageCount = useMemo(
    () => (active ? Math.ceil(active.totalRows / PAGE_SIZE) : 0),
    [active],
  );
  const visibleRows = useMemo(() => {
    if (!active) return [];
    if (!virtualized) return active.rows;
    const start = page * PAGE_SIZE;
    return active.rows.slice(start, start + PAGE_SIZE);
  }, [active, page, virtualized]);

  const handleCellClick = (row: number, col: number) => {
    if (!clickHandlerRef.current) return;
    const evt: ClickEvt = { page: activeIdx + 1 };
    if ((anchors?.length ?? 0) === 0) {
      warnAnchorsMissingOnce(hash, "xlsx");
    } else {
      // self_ref resolution: find anchor where bbox.t ~ row, bbox.l ~ col, page matches
      const match = anchors!.find(
        (a) =>
          a.page === activeIdx + 1 &&
          Math.floor(a.bbox.t) === row &&
          Math.floor(a.bbox.l) === col,
      );
      if (match) evt.self_ref = match.self_ref;
    }
    clickHandlerRef.current(evt);
  };

  return (
    <div
      ref={containerRef}
      className={
        props.className ?? "w-full h-full overflow-auto bg-white text-black"
      }
    >
      {loading && !error && (
        <div className="p-6 text-sm text-neutral-500">Parsing workbook…</div>
      )}
      {error && <div className="p-6 text-sm text-red-400">{error}</div>}
      {!loading && !error && sheets.length > 0 && (
        <>
          <div className="sticky top-0 z-10 flex flex-wrap gap-1 border-b border-neutral-300 bg-neutral-50 px-2 py-1">
            {sheets.map((s, i) => (
              <button
                key={s.name + i}
                onClick={() => {
                  setActiveIdx(i);
                  setPage(0);
                }}
                className={`rounded px-2 py-1 text-xs ${
                  i === activeIdx
                    ? "bg-blue-600 text-white"
                    : "bg-white text-neutral-700 hover:bg-neutral-200"
                }`}
              >
                {s.name}
                <span className="ml-1 text-[10px] opacity-70">
                  {s.totalRows}
                </span>
              </button>
            ))}
          </div>
          {virtualized && (
            <div className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-2 py-1 text-xs">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="rounded bg-white px-2 py-0.5 disabled:opacity-40"
              >
                ◀
              </button>
              <span>
                Rows {page * PAGE_SIZE + 1}–
                {Math.min((page + 1) * PAGE_SIZE, active!.totalRows)} of{" "}
                {active!.totalRows}
              </span>
              <button
                disabled={page >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                className="rounded bg-white px-2 py-0.5 disabled:opacity-40"
              >
                ▶
              </button>
            </div>
          )}
          <div className="overflow-auto p-2">
            <table className="min-w-full border-collapse text-xs">
              <tbody>
                {visibleRows.map((row, rIdx) => {
                  const realRow = virtualized ? page * PAGE_SIZE + rIdx : rIdx;
                  return (
                    <tr key={realRow}>
                      <td className="border border-neutral-200 bg-neutral-100 px-1 py-0.5 text-neutral-500">
                        {realRow + 1}
                      </td>
                      {row.map((cell, cIdx) => (
                        <td
                          key={cIdx}
                          data-row={realRow}
                          data-col={cIdx}
                          onClick={() => handleCellClick(realRow, cIdx)}
                          className="cursor-pointer border border-neutral-200 px-1 py-0.5 hover:bg-blue-50"
                        >
                          {cell == null ? "" : String(cell)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
