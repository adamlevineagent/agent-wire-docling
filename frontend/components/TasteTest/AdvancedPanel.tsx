"use client";

/**
 * Advanced panel — per-stratum pipeline editor (scope `advanced` masks
 * `tastetest`). Save → PATCH /taste_sessions with pipeline_assignment.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { PipelineParams } from "../../lib/api-client";
import type { StratumState } from "./types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { useShortcutScope } from "../../lib/shortcuts";
import { approvalCount } from "./helpers";

function clonePipeline(p: PipelineParams): PipelineParams {
  return {
    ocr: { enabled: p.ocr?.enabled ?? true, engine: p.ocr?.engine ?? "tesseract" },
    vlm: { enabled: p.vlm?.enabled ?? false, model: p.vlm?.model ?? "granite_docling" },
    tables: { enabled: p.tables?.enabled ?? true },
    enrichments: {
      formulas: p.enrichments?.formulas ?? false,
      code: p.enrichments?.code ?? false,
      charts: p.enrichments?.charts ?? false,
    },
  };
}

export function AdvancedPanel(props: {
  stratum: StratumState;
  onClose: () => void;
  onSave: (pipeline: PipelineParams) => Promise<unknown>;
}) {
  const { stratum, onClose, onSave } = props;
  const [p, setP] = useState<PipelineParams>(() => clonePipeline(stratum.pipeline));
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setP(clonePipeline(stratum.pipeline));
  }, [stratum.name, stratum.pipeline]);

  useShortcutScope({
    scope: "advanced",
    bindings: { Escape: "close" },
    handlers: { close: () => onClose() },
    elementRef: rootRef,
  });

  const { approved } = approvalCount(stratum);
  const willResample = approved > 0;

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(p);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const set = (patch: Partial<PipelineParams>) => setP((prev) => ({ ...prev, ...patch }));

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="absolute inset-0 z-40 bg-surface-0/80 backdrop-blur-sm flex items-center justify-center p-6 outline-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl bg-surface-1 border border-border-default rounded shadow-lg">
        <div className="px-4 py-3 border-b border-border-default flex items-center gap-2">
          <div className="text-sm font-medium">Pipeline</div>
          <Badge tone="neutral" className="font-mono">{stratum.name}</Badge>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="text-xs text-fg-muted hover:text-fg-primary font-mono"
            title="Esc"
          >
            Esc
          </button>
        </div>

        <div className="p-4 space-y-5 text-sm">
          {/* OCR */}
          <section className="space-y-1.5">
            <div className="font-medium">OCR</div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={p.ocr?.enabled ?? true}
                onChange={(e) =>
                  set({
                    ocr: { enabled: e.target.checked, engine: p.ocr?.engine ?? "tesseract" },
                  })
                }
              />
              <span>Enabled</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-fg-muted w-16">Engine</span>
              <select
                className="bg-surface-4 border border-border-default text-sm font-mono px-2 py-1 rounded"
                value={p.ocr?.engine ?? "tesseract"}
                disabled={!p.ocr?.enabled}
                onChange={(e) =>
                  set({
                    ocr: {
                      enabled: p.ocr?.enabled ?? true,
                      engine: e.target.value as "tesseract" | "rapidocr",
                    },
                  })
                }
              >
                <option value="tesseract">tesseract</option>
                <option value="rapidocr">rapidocr</option>
              </select>
            </label>
          </section>

          {/* VLM */}
          <section className="space-y-1.5">
            <div className="font-medium flex items-center gap-2">
              VLM
              <Badge tone="warning">wiring pending</Badge>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={p.vlm?.enabled ?? false}
                onChange={(e) =>
                  set({
                    vlm: { enabled: e.target.checked, model: p.vlm?.model ?? "granite_docling" },
                  })
                }
              />
              <span>Enabled</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-fg-muted w-16">Model</span>
              <input
                className="bg-surface-4 border border-border-default text-sm font-mono px-2 py-1 rounded flex-1"
                disabled={!p.vlm?.enabled}
                value={p.vlm?.model ?? "granite_docling"}
                onChange={(e) =>
                  set({
                    vlm: { enabled: p.vlm?.enabled ?? false, model: e.target.value },
                  })
                }
              />
            </label>
          </section>

          {/* Tables */}
          <section className="space-y-1.5">
            <div className="font-medium">Tables</div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={p.tables?.enabled ?? true}
                onChange={(e) => set({ tables: { enabled: e.target.checked } })}
              />
              <span>Enabled</span>
            </label>
          </section>

          {/* Enrichments */}
          <section className="space-y-1.5">
            <div className="font-medium">Enrichments</div>
            <div className="grid grid-cols-3 gap-2">
              {(["formulas", "code", "charts"] as const).map((k) => (
                <label key={k} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={(p.enrichments?.[k] as boolean) ?? false}
                    onChange={(e) =>
                      set({
                        enrichments: {
                          formulas: p.enrichments?.formulas ?? false,
                          code: p.enrichments?.code ?? false,
                          charts: p.enrichments?.charts ?? false,
                          [k]: e.target.checked,
                        },
                      })
                    }
                  />
                  <span>{k}</span>
                </label>
              ))}
            </div>
          </section>

          {willResample && (
            <div className="px-3 py-2 bg-warning-bg text-warning-fg text-xs rounded border border-warning">
              This stratum already has {approved} approval{approved === 1 ? "" : "s"} under the
              current pipeline. Saving re-assigns the pipeline; prior approvals remain recorded but
              will be shown as &quot;under old pipeline&quot; until re-reviewed under the new one.
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border-default flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
