"use client";

import type { ReactNode } from "react";

export function WindowChrome({
  title = "agent-wire-docling",
  subtitle,
  rightSlot,
}: {
  title?: string;
  subtitle?: string;
  rightSlot?: ReactNode;
}) {
  return (
    <div className="h-[34px] flex items-center gap-3 px-3.5 bg-surface-1 border-b border-border-subtle flex-shrink-0">
      <div className="flex gap-[7px]">
        <i className="w-[11px] h-[11px] rounded-full block bg-[#ff5f57]" />
        <i className="w-[11px] h-[11px] rounded-full block bg-[#febc2e]" />
        <i className="w-[11px] h-[11px] rounded-full block bg-[#28c840]" />
      </div>
      <div className="mono text-xs text-fg-muted tracking-[0.2px]">
        agent-wire-docling
        {title && title !== "agent-wire-docling" ? (
          <>
            {" "}
            · <span className="text-fg-secondary">{title}</span>
          </>
        ) : null}
        {subtitle && <span className="text-fg-muted"> — {subtitle}</span>}
      </div>
      <div className="ml-auto flex items-center gap-2">{rightSlot}</div>
    </div>
  );
}
