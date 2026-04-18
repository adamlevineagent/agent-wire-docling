import type { Config } from "tailwindcss";
import { tokens } from "./lib/design-tokens";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: tokens.colors.surface,
        fg: tokens.colors.fg,
        border: tokens.colors.border,
        accent: tokens.colors.accent,
        success: tokens.colors.success,
        warning: tokens.colors.warning,
        danger: tokens.colors.danger,
        info: tokens.colors.info,
      },
      fontFamily: {
        sans: [...tokens.fontFamily.sans],
        mono: [...tokens.fontFamily.mono],
      },
      fontSize: Object.fromEntries(
        Object.entries(tokens.fontSize).map(([k, v]) => [k, [v[0], { lineHeight: v[1].lineHeight }]])
      ),
      spacing: { ...tokens.spacing },
      borderRadius: { ...tokens.borderRadius },
      boxShadow: { ...tokens.boxShadow },
    },
  },
  plugins: [],
};

export default config;
