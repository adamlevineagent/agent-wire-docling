"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-8 w-full px-2.5 text-sm font-mono",
          "bg-surface-2 text-fg-primary placeholder:text-fg-muted",
          "border border-border-default rounded-md",
          "outline-none focus:border-cyan/40 focus:ring-2 focus:ring-cyan/20",
          "disabled:opacity-60",
          className,
        )}
        {...props}
      />
    );
  },
);
