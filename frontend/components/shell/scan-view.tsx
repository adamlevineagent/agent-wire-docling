"use client";

import { useAppState } from "./app-state";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

export function ScanView() {
  const { scan, folder, setStage } = useAppState();

  if (!folder && !scan) {
    return (
      <EmptyState
        title="Enter a folder path to begin"
        detail="Paste an absolute path into the sidebar and press Validate. The scanner walks the folder, detects formats, and clusters files into strata."
      />
    );
  }

  if (!scan) {
    return (
      <EmptyState
        title="Scan pending"
        detail={`Press Validate for "${folder}" to see stratum breakdown.`}
      />
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div>
        <div className="text-xs uppercase tracking-wider text-fg-muted">
          Scanned
        </div>
        <h1 className="text-lg font-semibold font-mono break-all">{scan.folder}</h1>
        <div className="text-sm text-fg-secondary mt-1">
          <span className="tabular-nums">{scan.total_files}</span> files ·{" "}
          <span className="tabular-nums">{scan.strata.length}</span> strata ·{" "}
          <span className="tabular-nums">{scan.skipped?.length ?? 0}</span> skipped
        </div>
      </div>

      <div className="space-y-2">
        {scan.strata.map((s) => (
          <div
            key={s.name}
            className="flex items-start gap-4 p-3 rounded border border-border-default bg-surface-1 hover:bg-surface-2"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="font-mono text-sm text-fg-primary">{s.name}</div>
                {s.exhaustive && <Badge tone="info">exhaustive · size ≤ 6</Badge>}
              </div>
              <div className="text-xs text-fg-muted mt-0.5">
                {s.size} files · sample hint {s.sample_size_hint}
              </div>
              {s.example_paths.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {s.example_paths.slice(0, 3).map((p) => (
                    <li
                      key={p}
                      className="text-xs font-mono text-fg-muted truncate"
                      title={p}
                    >
                      {p}
                    </li>
                  ))}
                  {s.example_paths.length > 3 && (
                    <li className="text-xs text-fg-muted italic">
                      + {s.example_paths.length - 3} more
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>
        ))}
      </div>

      {scan.strata.length > 0 && (
        <div className="pt-3 border-t border-border-default">
          <Button variant="primary" onClick={() => setStage("taste")}>
            Start taste test →
          </Button>
          <div className="text-xs text-fg-muted mt-2">
            Wave 2 Agent G wires this to <code className="font-mono">POST /taste_sessions</code>.
          </div>
        </div>
      )}

      {scan.skipped && scan.skipped.length > 0 && (
        <details className="pt-3 border-t border-border-default">
          <summary className="text-xs text-fg-muted cursor-pointer">
            {scan.skipped.length} skipped files
          </summary>
          <ul className="mt-2 space-y-0.5 max-h-48 overflow-auto">
            {scan.skipped.map((sk, i) => (
              <li key={i} className="text-xs font-mono text-fg-muted">
                <span className="text-warning-fg">{sk.reason}</span> {sk.path}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-2">
        <div className="text-lg text-fg-primary font-medium">{title}</div>
        <div className="text-sm text-fg-muted">{detail}</div>
      </div>
    </div>
  );
}
