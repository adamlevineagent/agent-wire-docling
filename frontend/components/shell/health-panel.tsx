"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/cn";

export function HealthIndicator() {
  const { data, error, isPending } = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 10_000,
    retry: 0,
  });

  if (isPending) {
    return <Badge tone="neutral">health…</Badge>;
  }

  if (error || !data) {
    return (
      <div className="relative group">
        <Badge tone="danger">backend offline</Badge>
        <div className="hidden group-hover:block absolute right-0 top-full mt-1 w-72 p-2 bg-surface-2 border border-border-default rounded text-xs text-fg-secondary shadow z-40">
          The FastAPI backend at <code className="font-mono">localhost:8000</code>{" "}
          is not reachable. Start it with{" "}
          <code className="font-mono">scripts/start.sh</code>.
        </div>
      </div>
    );
  }

  const { status, model_ready, tesseract_present, poppler_present, docling_version } = data;

  const tone =
    status === "ok" ? "success" : status === "degraded" ? "warning" : "danger";

  const missing: string[] = [];
  if (!tesseract_present) missing.push("tesseract");
  if (!poppler_present) missing.push("poppler");

  return (
    <div className="relative group">
      <Badge tone={tone as never}>
        <span className={cn("mr-1 w-1.5 h-1.5 rounded-full inline-block",
          status === "ok" ? "bg-success" : status === "degraded" ? "bg-warning" : "bg-danger")}
        />
        {status}
        {!model_ready && <span className="ml-1 text-fg-muted">· warming</span>}
      </Badge>
      <div className="hidden group-hover:block absolute right-0 top-full mt-1 w-80 p-2.5 bg-surface-2 border border-border-default rounded text-xs text-fg-secondary shadow z-40 space-y-1">
        <div>
          <span className="text-fg-muted">docling:</span>{" "}
          <span className="font-mono">{docling_version}</span>
        </div>
        <div>
          <span className="text-fg-muted">models:</span>{" "}
          {model_ready ? "ready" : "downloading…"}
        </div>
        <div>
          <span className="text-fg-muted">poppler:</span>{" "}
          {poppler_present ? "ok" : <span className="text-danger-fg">missing</span>}
        </div>
        <div>
          <span className="text-fg-muted">tesseract:</span>{" "}
          {tesseract_present ? "ok" : <span className="text-danger-fg">missing</span>}
        </div>
        {missing.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border-default">
            <span className="text-fg-muted">Install with:</span>{" "}
            <code className="font-mono text-accent">brew install {missing.join(" ")}</code>
          </div>
        )}
      </div>
    </div>
  );
}
