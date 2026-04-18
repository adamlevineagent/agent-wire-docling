"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "default" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantCls: Record<Variant, string> = {
  // Primary = cyan filled (Wire-sibling hero). Dark foreground for legibility.
  primary:
    "bg-cyan text-[#001018] hover:brightness-110 border border-cyan font-semibold disabled:opacity-60",
  // Default = neutral surface button
  default:
    "bg-surface-2 text-fg-primary hover:bg-surface-3 border border-border-default hover:border-border-strong disabled:opacity-60",
  // Legacy alias
  secondary:
    "bg-surface-2 text-fg-primary hover:bg-surface-3 border border-border-default hover:border-border-strong disabled:opacity-60",
  // Ghost = transparent, subtle hover
  ghost:
    "bg-transparent text-fg-secondary hover:bg-surface-2 hover:text-fg-primary border border-transparent",
  // Danger = red text, transparent background; hover reveals soft bg
  danger:
    "bg-transparent text-danger hover:bg-danger/10 border border-transparent",
};

const sizeCls: Record<Size, string> = {
  sm: "h-6 px-2 text-xs rounded",
  md: "h-8 px-3 text-sm rounded-md",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "default", size = "md", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 font-medium leading-none",
        "transition-colors outline-none focus-visible:ring-2 focus-visible:ring-cyan/50",
        "disabled:cursor-not-allowed",
        variantCls[variant],
        sizeCls[size],
        className,
      )}
      {...props}
    />
  );
});
