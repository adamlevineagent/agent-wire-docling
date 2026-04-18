"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-8 w-full px-2 text-sm font-mono",
          "bg-surface-4 text-fg-primary placeholder:text-fg-muted",
          "border border-border-default rounded",
          "outline-none focus:border-border-focus focus:ring-2 focus:ring-accent/40",
          "disabled:opacity-60",
          className,
        )}
        {...props}
      />
    );
  },
);
