/**
 * Design tokens — frozen in pre-flight P2.
 *
 * Dark-first. Tastefully dense. Reference points: GitHub PR review UI,
 * Linear, Raycast. Not Slack, not Notion.
 *
 * Agent D imports this into frontend/tailwind.config.ts. All frontend agents
 * use the semantic names (e.g. `bg-surface-1`, `text-fg-muted`), not raw colors.
 */

export const tokens = {
  // ── Colors (dark-first)
  //
  // Palette: warm near-black surfaces, cool-tinted foregrounds, one signature
  // accent (amber), functional colors for state. No pure black, no pure white.

  colors: {
    // Surfaces: darker → lighter as you go up the stack
    surface: {
      0: "#0b0c0f", // app background (body)
      1: "#121419", // panel (sidebar, main pane)
      2: "#191c23", // elevated card
      3: "#232832", // hover / active
      4: "#2c3340", // input / code block
    },

    // Foreground / text
    fg: {
      primary: "#e6e8ee", // main text
      secondary: "#b5bac5", // secondary text, sub-labels
      muted: "#7d838f", // captions, placeholders
      disabled: "#4c525c",
      inverse: "#0b0c0f", // text on accent
    },

    // Borders / dividers
    border: {
      subtle: "#1e2128",
      default: "#2a2e37",
      strong: "#3a4050",
      focus: "#d69f32", // matches accent
    },

    // Accent (signature): amber — matches keyboard-first diff-viewer aesthetic
    accent: {
      DEFAULT: "#d69f32",
      hover: "#e3ae41",
      muted: "#6a4e18",
      fg: "#0b0c0f",
    },

    // Functional
    success: {
      DEFAULT: "#46a86f",
      bg: "#18301f",
      fg: "#8ddea9",
    },
    warning: {
      DEFAULT: "#d1973b",
      bg: "#3a2a0f",
      fg: "#ead7a2",
    },
    danger: {
      DEFAULT: "#d24a4a",
      bg: "#3a1414",
      fg: "#f1a0a0",
    },
    info: {
      DEFAULT: "#5792d4",
      bg: "#16253a",
      fg: "#a8caec",
    },
  },

  // ── Typography

  fontFamily: {
    sans: [
      "InterVariable",
      "Inter",
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
    // 13px base (denser than web-default 16px)
    xs: ["11px", { lineHeight: "16px" }],
    sm: ["12px", { lineHeight: "18px" }],
    base: ["13px", { lineHeight: "20px" }],
    md: ["14px", { lineHeight: "22px" }],
    lg: ["16px", { lineHeight: "24px" }],
    xl: ["18px", { lineHeight: "26px" }],
    "2xl": ["22px", { lineHeight: "30px" }],
  },

  // ── Spacing / radii / shadows

  spacing: {
    // 4px grid
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
  },

  boxShadow: {
    sm: "0 1px 2px 0 rgb(0 0 0 / 0.3)",
    DEFAULT: "0 2px 6px -1px rgb(0 0 0 / 0.35), 0 1px 2px -1px rgb(0 0 0 / 0.35)",
    md: "0 4px 10px -2px rgb(0 0 0 / 0.4), 0 2px 4px -1px rgb(0 0 0 / 0.3)",
    focus: "0 0 0 2px rgb(214 159 50 / 0.5)",
  },

  // ── Component-level conventions (consumed directly by component code)

  components: {
    // Keyboard shortcut badge: monospace, muted, small
    kbd: {
      padX: "6px",
      padY: "2px",
      radius: "4px",
      bg: "surface.3",
      fg: "fg.secondary",
      border: "border.default",
    },
    // Source/output panes
    pane: {
      minWidthPx: 360,
      resizerWidthPx: 4,
      headerHeightPx: 40,
    },
    // Quality badge pill on source render
    qualityBadge: {
      radius: "4px",
      padX: "6px",
      padY: "1px",
    },
  },
} as const;

export type DesignTokens = typeof tokens;
