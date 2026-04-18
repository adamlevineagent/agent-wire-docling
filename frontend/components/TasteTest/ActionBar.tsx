"use client";

/**
 * Taste verdict action bar — external bottom bar replacing the in-VizDiff
 * action buttons. Wires flag/skip/rerun (chips) + reject (danger) + approve
 * (big cyan primary). Keyboard shortcuts still flow through
 * tastetest / vizdiff:tastetest scopes above.
 */

interface ActionChipProps {
  kbd: string;
  label: string;
  tone?: "muted" | "danger";
  onClick?: () => void;
  disabled?: boolean;
}

function ActionChip({ kbd, label, tone = "muted", onClick, disabled }: ActionChipProps) {
  const color = tone === "danger" ? "var(--danger)" : "var(--fg1)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="hover:bg-surface-2 transition-colors"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "6px 10px",
        borderRadius: 6,
        border: "1px solid var(--b0)",
        background: "transparent",
        fontSize: 12,
        color,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <span>{label}</span>
      <span className="kbd">{kbd}</span>
    </button>
  );
}

export interface TasteActionBarProps {
  docIndex?: number | null;
  docTotal?: number | null;
  stratumName?: string | null;
  busy?: boolean;
  onApprove: () => void;
  onReject: () => void;
  onSkip: () => void;
  onFlag: () => void;
  onRerun: () => void;
}

export function TasteActionBar({
  docIndex,
  docTotal,
  stratumName,
  busy,
  onApprove,
  onReject,
  onSkip,
  onFlag,
  onRerun,
}: TasteActionBarProps) {
  const counter =
    docIndex != null && docTotal != null ? `doc ${docIndex} of ${docTotal}` : null;

  return (
    <div
      style={{
        height: 58,
        borderTop: "1px solid var(--b0)",
        background: "var(--s1)",
        display: "flex",
        alignItems: "center",
        padding: "0 18px",
        gap: 12,
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="label-eyebrow">Verdict</span>
        {(counter || stratumName) && (
          <span className="text-fg-muted" style={{ fontSize: 11 }}>
            {[counter, stratumName].filter(Boolean).join(" · ")}
          </span>
        )}
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <ActionChip kbd="f" label="Flag" onClick={onFlag} disabled={busy} />
        <ActionChip kbd="s" label="Skip" onClick={onSkip} disabled={busy} />
        <ActionChip kbd="r" label="Re-run" onClick={onRerun} disabled={busy} />
        <div
          style={{
            width: 1,
            height: 22,
            background: "var(--b0)",
            margin: "0 4px",
          }}
        />
        <ActionChip
          kbd="x"
          label="Reject"
          tone="danger"
          onClick={onReject}
          disabled={busy}
        />
      </div>

      <button
        type="button"
        onClick={onApprove}
        disabled={busy}
        className="hover:brightness-110"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 22px",
          fontSize: 13,
          fontWeight: 600,
          background: "var(--cyan)",
          color: "#001018",
          border: "1px solid var(--cyan)",
          borderRadius: 6,
          cursor: busy ? "not-allowed" : "pointer",
          opacity: busy ? 0.6 : 1,
          transition: "filter 120ms",
        }}
      >
        Approve
        <span className="kbd" style={{ background: "rgba(0,16,24,0.15)", color: "#001018", borderColor: "rgba(0,16,24,0.25)" }}>
          y
        </span>
      </button>
    </div>
  );
}
