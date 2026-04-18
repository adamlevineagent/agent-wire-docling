/**
 * Design tokens — Wire-sibling palette (2026-04-18 redesign pass).
 *
 * Source of truth: Claude Design handoff `agent-wire-com-corpus-ingest-prototype`
 * (project/styles.css). Dark-first, restrained cyan + gold accents, warmer-than-
 * Wire-but-cooler-than-GitHub surfaces. 13px base, Inter + JetBrains Mono.
 *
 * Agent D imports this into tailwind.config.ts. Consumers should use the
 * semantic names (`bg-surface-1`, `text-fg-secondary`, `text-accent-cyan`) not
 * raw hex values.
 */

export const tokens = {
  colors: {
    // Surfaces — warmer-than-Wire, cooler-than-GitHub
    surface: {
      0: "#0b0d12", // deepest — window chrome / body
      1: "#12151c", // panels, sidebar
      2: "#181c25", // raised card
      3: "#20252f", // hover
      4: "#2a303c", // input, code block
    },

    // Foreground
    fg: {
      primary: "#e8eaf0",
      secondary: "#b3b8c4",
      muted: "#7a8090",
      disabled: "#4a5060",
      inverse: "#001018",
    },

    // Borders
    border: {
      subtle: "#1c1f27",
      default: "#262b35",
      strong: "#353b47",
      focus: "#22d3ee", // cyan focus
    },

    // Accents — Wire cyan (signature) + Wire gold (tertiary)
    accent: {
      // Default accent = cyan (primary buttons, focus, "active" cues)
      DEFAULT: "#22d3ee",
      hover: "#4ddcf1",
      muted: "rgba(34, 211, 238, 0.12)",
      dim: "rgba(34, 211, 238, 0.35)",
      fg: "#001018",
      // Named aliases (accent.cyan / accent.gold)
      cyan: "#22d3ee",
      "cyan-soft": "rgba(34, 211, 238, 0.12)",
      "cyan-dim": "rgba(34, 211, 238, 0.35)",
      gold: "#f0c040",
      "gold-soft": "rgba(240, 192, 64, 0.12)",
      "gold-dim": "rgba(240, 192, 64, 0.4)",
    },

    // Functional
    success: {
      DEFAULT: "#40d080",
      bg: "rgba(64, 208, 128, 0.12)",
      fg: "#40d080",
    },
    warning: {
      DEFAULT: "#f0a040",
      bg: "rgba(240, 160, 64, 0.12)",
      fg: "#f0a040",
    },
    danger: {
      DEFAULT: "#f06060",
      bg: "rgba(240, 96, 96, 0.12)",
      fg: "#f06060",
    },
    info: {
      DEFAULT: "#22d3ee", // map info → cyan for legacy callers
      bg: "rgba(34, 211, 238, 0.12)",
      fg: "#22d3ee",
    },
    ok: {
      DEFAULT: "#40d080",
      soft: "rgba(64, 208, 128, 0.12)",
    },
  },

  fontFamily: {
    sans: [
      "Inter",
      "InterVariable",
      "system-ui",
      "-apple-system",
      "Segoe UI",
      "Helvetica Neue",
      "sans-serif",
    ],
    mono: [
      "JetBrains Mono",
      "SF Mono",
      "Menlo",
      "Monaco",
      "Consolas",
      "monospace",
    ],
  },

  fontSize: {
    xs: ["10px", { lineHeight: "14px" }],
    sm: ["11px", { lineHeight: "16px" }],
    base: ["13px", { lineHeight: "20px" }],
    md: ["14px", { lineHeight: "22px" }],
    lg: ["16px", { lineHeight: "24px" }],
    xl: ["18px", { lineHeight: "26px" }],
    "2xl": ["22px", { lineHeight: "30px" }],
    "3xl": ["26px", { lineHeight: "32px" }],
  },

  spacing: {
    px: "1px",
    "0.5": "2px",
    1: "4px",
    1.5: "6px",
    2: "8px",
    3: "12px",
    4: "16px",
    5: "20px",
    6: "24px",
    8: "32px",
    10: "40px",
    12: "48px",
    16: "64px",
  },

  borderRadius: {
    none: "0",
    sm: "3px",
    DEFAULT: "5px",
    md: "6px",
    lg: "8px",
    xl: "12px",
    full: "9999px",
  },

  boxShadow: {
    sm: "0 1px 2px rgba(0,0,0,0.35)",
    DEFAULT: "0 4px 16px rgba(0,0,0,0.35)",
    md: "0 4px 16px rgba(0,0,0,0.35)",
    lg: "0 12px 40px rgba(0,0,0,0.5)",
    focus: "0 0 0 2px rgba(34, 211, 238, 0.35)",
    "glow-cyan": "0 0 6px rgba(34, 211, 238, 0.35)",
    "glow-gold": "0 0 6px rgba(240, 192, 64, 0.4)",
  },

  components: {
    kbd: { padX: "5px", padY: "2px", radius: "4px" },
    pane: { minWidthPx: 360, resizerWidthPx: 4, headerHeightPx: 32 },
    qualityBadge: { radius: "3px", padX: "7px", padY: "3px" },
  },
} as const;

export type DesignTokens = typeof tokens;
