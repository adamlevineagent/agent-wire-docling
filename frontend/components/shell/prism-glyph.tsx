// PrismGlyph — quiet atmospheric SVG: a beam entering a prism, emerging as
// a restrained spectrum. Sits behind page content at ~55% opacity. The
// "bundle of light through a prism" metaphor for the stratification step.

export function PrismGlyph() {
  return (
    <svg
      viewBox="0 0 900 560"
      className="absolute inset-0 w-full h-full pointer-events-none z-[1]"
      style={{ opacity: 0.55 }}
      aria-hidden
    >
      <defs>
        <linearGradient id="pg-beam-in" x1="0" x2="1">
          <stop offset="0" stopColor="#22d3ee" stopOpacity="0" />
          <stop offset="1" stopColor="#22d3ee" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id="pg-beam-pdf" x1="0" x2="1">
          <stop offset="0" stopColor="#f0c040" stopOpacity="0.6" />
          <stop offset="1" stopColor="#f0c040" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="pg-beam-docx" x1="0" x2="1">
          <stop offset="0" stopColor="#22d3ee" stopOpacity="0.5" />
          <stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="pg-beam-xlsx" x1="0" x2="1">
          <stop offset="0" stopColor="#40d080" stopOpacity="0.5" />
          <stop offset="1" stopColor="#40d080" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="pg-beam-scan" x1="0" x2="1">
          <stop offset="0" stopColor="#a78bfa" stopOpacity="0.45" />
          <stop offset="1" stopColor="#a78bfa" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="pg-prism" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#22d3ee" stopOpacity="0.25" />
          <stop offset="1" stopColor="#f0c040" stopOpacity="0.25" />
        </linearGradient>
      </defs>

      <line x1="0" y1="280" x2="380" y2="280" stroke="url(#pg-beam-in)" strokeWidth="1.2" />

      <polygon
        points="380,200 380,360 470,280"
        fill="url(#pg-prism)"
        stroke="rgba(34, 211, 238, 0.5)"
        strokeWidth="1"
      />

      <line x1="470" y1="280" x2="900" y2="200" stroke="url(#pg-beam-pdf)" strokeWidth="1" />
      <line x1="470" y1="280" x2="900" y2="250" stroke="url(#pg-beam-docx)" strokeWidth="1" />
      <line x1="470" y1="280" x2="900" y2="300" stroke="url(#pg-beam-xlsx)" strokeWidth="1" />
      <line x1="470" y1="280" x2="900" y2="360" stroke="url(#pg-beam-scan)" strokeWidth="1" />
    </svg>
  );
}
