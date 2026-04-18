"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantCls: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg hover:bg-accent-hover border border-accent disabled:opacity-60",
  secondary:
    "bg-surface-3 text-fg-primary hover:bg-surface-4 border border-border-default disabled:opacity-60",
  ghost:
    "bg-transparent text-fg-secondary hover:bg-surface-3 hover:text-fg-primary border border-transparent",
  danger:
    "bg-danger-bg text-danger-fg hover:bg-danger border border-danger disabled:opacity-60",
};

const sizeCls: Record<Size, string> = {
  sm: "h-6 px-2 text-xs rounded-sm",
  md: "h-8 px-3 text-sm rounded",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 font-medium",
        "transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent",
        "disabled:cursor-not-allowed",
        variantCls[variant],
        sizeCls[size],
        className,
      )}
      {...props}
    />
  );
});
