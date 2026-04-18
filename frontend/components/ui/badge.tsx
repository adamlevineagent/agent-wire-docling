import { cn } from "../../lib/cn";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const toneCls: Record<Tone, string> = {
  neutral: "bg-surface-3 text-fg-secondary border-border-default",
  accent: "bg-accent-muted text-accent border-accent",
  success: "bg-success-bg text-success-fg border-success",
  warning: "bg-warning-bg text-warning-fg border-warning",
  danger: "bg-danger-bg text-danger-fg border-danger",
  info: "bg-info-bg text-info-fg border-info",
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
        "inline-flex items-center px-1.5 py-px text-xs font-mono rounded-sm border",
        toneCls[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
