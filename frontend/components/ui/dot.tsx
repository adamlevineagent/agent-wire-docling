import { cn } from "../../lib/cn";

type Tone = "neutral" | "ok" | "cyan" | "gold" | "warn" | "danger";

const toneCls: Record<Tone, string> = {
  neutral: "bg-fg-muted",
  ok: "bg-success shadow-[0_0_6px_var(--ok-soft)]",
  cyan: "bg-cyan shadow-[0_0_6px_var(--cyan-soft)]",
  gold: "bg-gold shadow-[0_0_6px_var(--gold-soft)]",
  warn: "bg-warning shadow-[0_0_6px_var(--warn-soft)]",
  danger: "bg-danger shadow-[0_0_6px_var(--danger-soft)]",
};

export function Dot({
  tone = "neutral",
  className,
}: {
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block w-1.5 h-1.5 rounded-full flex-shrink-0",
        toneCls[tone],
        className,
      )}
    />
  );
}
