import { cn } from "../../lib/cn";

type Tone =
  | "neutral"
  | "cyan"
  | "gold"
  | "ok"
  | "warn"
  | "danger"
  // legacy aliases
  | "accent"
  | "success"
  | "warning"
  | "info";

const toneCls: Record<Tone, string> = {
  neutral: "bg-surface-3 text-fg-secondary",
  cyan: "bg-cyan/10 text-cyan",
  gold: "bg-gold/10 text-gold",
  ok: "bg-success-bg text-success",
  warn: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
  // legacy
  accent: "bg-cyan/10 text-cyan",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  info: "bg-cyan/10 text-cyan",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-px text-xs font-mono rounded-full tracking-tight leading-tight",
        toneCls[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
