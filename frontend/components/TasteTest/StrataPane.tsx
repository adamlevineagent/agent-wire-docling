"use client";

/**
 * Taste sidebar — "tuning progress" rail.
 *
 * Header: locked count / total strata + thin cyan progress bar.
 * List: per-stratum card with 5 dots, active highlighted, locked badge.
 * Footer: "Sample more from this stratum ⇧S" ghost button.
 */

import type { TasteSession, Stratum } from "../../lib/api-client";
import { approvalCount } from "./helpers";

interface Props {
  session: TasteSession;
  scanStrata: Stratum[];
  activeStratum: string | null;
  onSelect: (name: string) => void;
  onSample: (name: string) => void;
  // kept in contract for compatibility; unused in new visual
  onLock: (name: string, locked: boolean) => void;
  onOpenAdvanced: (name: string) => void;
  sampling: string | null;
}

// Translate approvals → 5 dots filled (approved/5 up to 5, rate-of-progress).
function dotsForStratum(
  approved: number,
  samplesHint: number,
): boolean[] {
  const target = Math.max(1, Math.min(5, samplesHint || 5));
  const filled = Math.max(0, Math.min(5, Math.round((approved / target) * 5)));
  return Array.from({ length: 5 }, (_, i) => i < filled);
}

export function StrataPane({
  session,
  scanStrata,
  activeStratum,
  onSelect,
  onSample,
  sampling,
}: Props) {
  const scanByName = new Map<string, Stratum>();
  for (const s of scanStrata) scanByName.set(s.name, s);

  const strata = session.strata;
  const total = strata.length;
  const lockedCount = strata.filter((s) => s.locked).length;
  const pct = total > 0 ? (lockedCount / total) * 100 : 0;

  const activeName = activeStratum ?? strata[0]?.name ?? null;

  return (
    <aside
      className="h-full flex flex-col border-r border-border-subtle bg-surface-1"
      style={{ width: 240 }}
    >
      {/* Header — Tuning progress */}
      <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid var(--b0)" }}>
        <div className="label-eyebrow" style={{ marginBottom: 6 }}>
          Tuning progress
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span
            className="num"
            style={{ fontSize: 22, fontWeight: 600, color: "var(--fg0)" }}
          >
            {lockedCount}
          </span>
          <span className="text-fg-muted" style={{ fontSize: 12 }}>
            of {total} strata tuned
          </span>
        </div>
        <div
          style={{
            marginTop: 8,
            height: 4,
            background: "var(--s2)",
            borderRadius: 2,
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              width: `${pct}%`,
              background: "var(--cyan)",
              borderRadius: 2,
              transition: "width 200ms",
            }}
          />
        </div>
      </div>

      {/* Scroll list of per-stratum cards */}
      <div className="flex-1 overflow-auto" style={{ padding: "6px 0" }}>
        {strata.map((s) => {
          const counts = approvalCount(s);
          const scanS = scanByName.get(s.name);
          const hint = scanS?.sample_size_hint ?? 5;
          const isActive = activeName === s.name;
          const dots = dotsForStratum(counts.approved, hint);
          return (
            <button
              key={s.name}
              type="button"
              onClick={() => onSelect(s.name)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "10px 14px",
                borderTop: "none",
                borderRight: "none",
                borderBottom: "none",
                borderLeft: "2px solid " + (isActive ? "var(--cyan)" : "transparent"),
                background: isActive
                  ? "linear-gradient(90deg, var(--cyan-soft), transparent 70%)"
                  : "transparent",
                cursor: "pointer",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}
              >
                <span
                  className="mono truncate"
                  style={{
                    fontSize: 12,
                    color: isActive ? "var(--fg0)" : "var(--fg1)",
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  {s.name}
                </span>
                <div style={{ flex: 1 }} />
                {s.locked && (
                  <span
                    className="mono"
                    style={{
                      fontSize: 9.5,
                      padding: "1px 5px",
                      borderRadius: 3,
                      background: "var(--ok-soft)",
                      color: "var(--ok)",
                    }}
                  >
                    locked
                  </span>
                )}
                <span
                  className="num"
                  style={{ fontSize: 10.5, color: "var(--fg3)" }}
                >
                  {s.size}
                </span>
              </div>
              <div style={{ display: "flex", gap: 3 }}>
                {dots.map((filled, i) => (
                  <span
                    key={i}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: filled
                        ? s.locked
                          ? "var(--ok)"
                          : "var(--cyan)"
                        : "var(--s3)",
                    }}
                  />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ padding: "10px 14px", borderTop: "1px solid var(--b0)" }}>
        <button
          type="button"
          disabled={!activeName || !!sampling}
          onClick={() => activeName && onSample(activeName)}
          className="w-full text-fg-secondary hover:text-fg-primary hover:bg-surface-2 transition-colors"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            padding: "8px 10px",
            borderRadius: 4,
            background: "transparent",
            border: "none",
            cursor: activeName && !sampling ? "pointer" : "not-allowed",
            opacity: activeName && !sampling ? 1 : 0.55,
          }}
        >
          <span style={{ color: "var(--fg2)" }}>+</span>
          <span style={{ flex: 1, textAlign: "left" }}>
            {sampling === activeName ? "Sampling…" : "Sample more from this stratum"}
          </span>
          <span className="kbd">⇧S</span>
        </button>
      </div>
    </aside>
  );
}
