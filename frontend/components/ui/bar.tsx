import { cn } from "../../lib/cn";

type Tone = "cyan" | "gold" | "ok";

export function Bar({
  value,
  tone = "cyan",
  thick,
  className,
}: {
  value: number; // 0–100
  tone?: Tone;
  thick?: boolean;
  className?: string;
}) {
  const fillColor =
    tone === "gold"
      ? "var(--gold)"
      : tone === "ok"
        ? "var(--ok)"
        : "var(--cyan)";
  return (
    <div
      className={cn(
        "bg-surface-2 rounded-sm overflow-hidden relative",
        thick ? "h-1.5" : "h-1",
        className,
      )}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-sm"
        style={{
          width: `${Math.max(0, Math.min(100, value))}%`,
          background: fillColor,
        }}
      />
    </div>
  );
}
