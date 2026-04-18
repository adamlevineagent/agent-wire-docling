"use client";

/**
 * Advanced panel — per-stratum pipeline editor.
 *
 * Centered 640px modal, backdrop blur, pill toggles, segmented OCR engine.
 * Esc closes; Save PATCHes /taste_sessions with pipeline_assignment.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { PipelineParams } from "../../lib/api-client";
import type { StratumState } from "./types";
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

const DEFAULT_PIPELINE: PipelineParams = {
  ocr: { enabled: true, engine: "tesseract" },
  vlm: { enabled: false, model: "granite_docling" },
  tables: { enabled: true },
  enrichments: { formulas: false, code: false, charts: false },
};

function isScannedStratum(name: string): boolean {
  return /scan/i.test(name) || /pdf_scanned|pdf-scanned/i.test(name);
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
  const vlmRecommended = isScannedStratum(stratum.name);

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

  const setOcrEnabled = (v: boolean) =>
    setP((prev) => ({
      ...prev,
      ocr: { enabled: v, engine: prev.ocr?.engine ?? "tesseract" },
    }));
  const setOcrEngine = (eng: "tesseract" | "rapidocr") =>
    setP((prev) => ({
      ...prev,
      ocr: { enabled: prev.ocr?.enabled ?? true, engine: eng },
    }));
  const setVlmEnabled = (v: boolean) =>
    setP((prev) => ({
      ...prev,
      vlm: { enabled: v, model: prev.vlm?.model ?? "granite_docling" },
    }));
  const setTables = (v: boolean) =>
    setP((prev) => ({ ...prev, tables: { enabled: v } }));
  const setEnrichment = (k: "formulas" | "code" | "charts", v: boolean) =>
    setP((prev) => ({
      ...prev,
      enrichments: {
        formulas: prev.enrichments?.formulas ?? false,
        code: prev.enrichments?.code ?? false,
        charts: prev.enrichments?.charts ?? false,
        [k]: v,
      },
    }));

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="fixed inset-0 z-40 flex items-center justify-center outline-none"
      style={{
        background: "rgba(8, 10, 15, 0.7)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 640,
          maxWidth: "94vw",
          maxHeight: "90vh",
          background: "var(--s1)",
          border: "1px solid var(--b1)",
          borderRadius: 10,
          boxShadow:
            "0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(34, 211, 238, 0.08)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ padding: "18px 22px 14px", borderBottom: "1px solid var(--b0)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="label-eyebrow">Pipeline settings for</span>
            <span
              className="mono"
              style={{ fontSize: 13, color: "var(--fg0)", fontWeight: 600 }}
            >
              {stratum.name}
            </span>
            <span
              className="mono"
              style={{
                fontSize: 10,
                padding: "2px 6px",
                borderRadius: 10,
                background: "var(--s3)",
                color: "var(--fg1)",
              }}
            >
              {stratum.size} docs
            </span>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={onClose}
              className="kbd"
              style={{ cursor: "pointer" }}
              title="Close"
            >
              esc
            </button>
          </div>
          <div className="text-fg-muted" style={{ fontSize: 12, marginTop: 6 }}>
            Changes here re-run samples in this group. Other groups aren&apos;t affected.
          </div>
        </div>

        {/* Body */}
        <div
          style={{
            padding: "18px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 18,
            overflowY: "auto",
            flex: 1,
          }}
        >
          <Section
            title="Text extraction"
            hint="These are scans, so we read the page as an image."
          >
            <ToggleRow
              label="OCR — extract text from images"
              checked={p.ocr?.enabled ?? true}
              onChange={setOcrEnabled}
            />
            <SelectRow
              label="Engine"
              value={p.ocr?.engine ?? "tesseract"}
              disabled={!p.ocr?.enabled}
              options={["tesseract", "rapidocr"]}
              onChange={(v) => setOcrEngine(v as "tesseract" | "rapidocr")}
            />
            <ToggleRow
              label="Vision model — much better on smudged or handwritten scans"
              sublabel="+2× slower · uses Apple Silicon GPU"
              checked={p.vlm?.enabled ?? false}
              onChange={setVlmEnabled}
              recommended={vlmRecommended ? "Recommended for this group" : undefined}
            />
          </Section>

          <Section title="Structure" hint="What to recognize beyond plain text.">
            <ToggleRow
              label="Tables"
              checked={p.tables?.enabled ?? true}
              onChange={setTables}
            />
            <ToggleRow
              label="Formulas"
              checked={p.enrichments?.formulas ?? false}
              onChange={(v) => setEnrichment("formulas", v)}
            />
            <ToggleRow
              label="Code blocks"
              checked={p.enrichments?.code ?? false}
              onChange={(v) => setEnrichment("code", v)}
            />
            <ToggleRow
              label="Charts"
              checked={p.enrichments?.charts ?? false}
              onChange={(v) => setEnrichment("charts", v)}
            />
          </Section>

          {willResample && (
            <div
              style={{
                padding: "10px 12px",
                background: "var(--warn-soft)",
                border: "1px solid rgba(240, 160, 64, 0.25)",
                borderRadius: 6,
                fontSize: 12,
                color: "var(--fg1)",
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  marginTop: 5,
                  borderRadius: "50%",
                  background: "var(--warn)",
                  flexShrink: 0,
                }}
              />
              <div>
                <span style={{ color: "var(--warn)" }}>
                  {approved} previously approved sample{approved === 1 ? "" : "s"}
                </span>{" "}
                were judged under the old pipeline. They&apos;ll be shown as
                &quot;stale&quot; until re-reviewed.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "14px 22px",
            borderTop: "1px solid var(--b0)",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <button
            type="button"
            onClick={() => setP(clonePipeline(DEFAULT_PIPELINE))}
            className="text-fg-secondary hover:text-fg-primary hover:bg-surface-2 transition-colors"
            style={{
              background: "transparent",
              border: "1px solid transparent",
              padding: "8px 12px",
              fontSize: 12,
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Reset to default
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            className="hover:bg-surface-3 transition-colors"
            style={{
              background: "var(--s2)",
              border: "1px solid var(--b1)",
              color: "var(--fg0)",
              padding: "8px 14px",
              fontSize: 12,
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="hover:brightness-110"
            style={{
              background: "var(--cyan)",
              color: "#001018",
              border: "1px solid var(--cyan)",
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Saving…" : "Save & re-run samples"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <div
          style={{
            fontSize: 13,
            marginBottom: 2,
            color: "var(--fg0)",
            fontWeight: 600,
          }}
        >
          {title}
        </div>
        {hint && (
          <div className="text-fg-muted" style={{ fontSize: 11.5 }}>
            {hint}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{children}</div>
    </div>
  );
}

function ToggleRow({
  label,
  sublabel,
  checked,
  onChange,
  recommended,
}: {
  label: string;
  sublabel?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  recommended?: string;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "9px 10px",
        borderRadius: 6,
        background: "var(--s2)",
        border: "1px solid var(--b0)",
        cursor: "pointer",
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          onChange(!checked);
        }}
        style={{
          width: 28,
          height: 16,
          borderRadius: 9,
          background: checked ? "var(--cyan)" : "var(--s4)",
          position: "relative",
          flexShrink: 0,
          marginTop: 1,
          transition: "background 150ms",
          border: "none",
          cursor: "pointer",
        }}
        aria-pressed={checked}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 14 : 2,
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "white",
            transition: "left 150ms",
            display: "block",
          }}
        />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: "var(--fg0)" }}>{label}</div>
        {sublabel && (
          <div className="text-fg-muted" style={{ fontSize: 11, marginTop: 2 }}>
            {sublabel}
          </div>
        )}
      </div>
      {recommended && (
        <span
          className="mono"
          style={{
            fontSize: 10,
            padding: "2px 6px",
            borderRadius: 10,
            background: "var(--gold-soft)",
            color: "var(--gold)",
            border: "1px solid rgba(240, 192, 64, 0.3)",
            whiteSpace: "nowrap",
          }}
        >
          {recommended}
        </span>
      )}
    </label>
  );
}

function SelectRow({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "9px 10px",
        borderRadius: 6,
        background: "var(--s2)",
        border: "1px solid var(--b0)",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{ fontSize: 12.5, color: "var(--fg1)", flex: 1 }}>{label}</span>
      <div
        style={{
          display: "flex",
          gap: 2,
          background: "var(--s0)",
          padding: 2,
          borderRadius: 5,
        }}
      >
        {options.map((o) => {
          const active = o === value;
          return (
            <button
              key={o}
              type="button"
              disabled={disabled}
              onClick={() => onChange(o)}
              style={{
                padding: "4px 10px",
                fontSize: 11,
                fontFamily: "JetBrains Mono, monospace",
                border: "none",
                borderRadius: 4,
                cursor: disabled ? "not-allowed" : "pointer",
                background: active ? "var(--s3)" : "transparent",
                color: active ? "var(--fg0)" : "var(--fg2)",
              }}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}
