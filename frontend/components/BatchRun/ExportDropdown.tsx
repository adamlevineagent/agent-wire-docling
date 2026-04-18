"use client";

/**
 * Export dropdown + polling: manifest-only, manifest+md, full archive.
 *
 * Creates an /export job, then polls /exports/{id} until completion. On
 * success, shows the resulting path with a "Copy path" helper (full Finder
 * integration requires a native bridge and is intentionally out of scope).
 */

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Job, ExportRequest } from "../../lib/api-client";
import { api, ApiError } from "../../lib/api-client";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useToast } from "../ui/toast";

type Kind = ExportRequest["kind"];

interface KindOption {
  value: Kind;
  label: string;
  extHint: string;
  desc: string;
}

const KINDS: KindOption[] = [
  {
    value: "manifest_only",
    label: "Manifest only",
    extHint: ".json",
    desc: "Small, fast. Just manifest.json.",
  },
  {
    value: "manifest_plus_md",
    label: "Manifest + Markdown",
    extHint: "",
    desc: "Adds per-doc doc.md files. Same directory.",
  },
  {
    value: "full_archive",
    label: "Full archive",
    extHint: ".zip",
    desc: "Everything zipped: source, md, json, meta.",
  },
];

function deriveDestination(outputDir: string, kind: Kind): string {
  if (!outputDir) return "";
  if (kind === "full_archive") return `${outputDir}-export.zip`;
  if (kind === "manifest_only") return `${outputDir}-manifest.json`;
  return `${outputDir}-export`;
}

interface Props {
  outputDir: string;
  open: boolean;
  onClose: () => void;
}

export function ExportDropdown({ outputDir, open, onClose }: Props) {
  const toast = useToast();
  const [kind, setKind] = useState<Kind>("manifest_only");
  const [destination, setDestination] = useState<string>(
    deriveDestination(outputDir, "manifest_only"),
  );
  const [jobId, setJobId] = useState<string | null>(null);
  const [finalJob, setFinalJob] = useState<Job | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Update default destination when kind or outputDir changes (unless user edited it)
  const userEditedRef = useRef(false);
  useEffect(() => {
    if (!userEditedRef.current) {
      setDestination(deriveDestination(outputDir, kind));
    }
  }, [outputDir, kind]);

  const start = useMutation({
    mutationFn: (req: ExportRequest) => api.export(req),
    onSuccess: (job) => {
      setJobId(job.id);
      setFinalJob(null);
    },
    onError: (err) => {
      const detail =
        err instanceof ApiError ? `${err.code}: ${err.message}` : String(err);
      toast.push({ kind: "danger", title: "Export failed", detail });
    },
  });

  // Poll /exports/{id}
  useEffect(() => {
    if (!jobId) return;
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(async () => {
      try {
        const j = await api.exportStatus(jobId);
        if (
          j.status === "completed" ||
          j.status === "cancelled" ||
          j.status === "failed"
        ) {
          setFinalJob(j);
          if (pollTimer.current) {
            clearInterval(pollTimer.current);
            pollTimer.current = null;
          }
        }
      } catch {
        /* keep polling */
      }
    }, 500);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = null;
    };
  }, [jobId]);

  if (!open) return null;

  const inFlight = jobId && !finalJob;

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-start justify-end p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-surface-0 border border-border-default rounded shadow-lg p-4 space-y-3 mt-14 mr-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Export</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-fg-muted">
            Kind
          </div>
          <div className="space-y-1">
            {KINDS.map((k) => (
              <label
                key={k.value}
                className={`flex items-start gap-2 p-2 rounded border cursor-pointer ${
                  kind === k.value
                    ? "border-accent bg-accent-muted/20"
                    : "border-border-default hover:bg-surface-1"
                }`}
              >
                <input
                  type="radio"
                  name="exp-kind"
                  className="mt-1"
                  checked={kind === k.value}
                  onChange={() => setKind(k.value)}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-fg-primary">{k.label}</div>
                  <div className="text-xs text-fg-muted">{k.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wider text-fg-muted">
            Destination
          </div>
          <Input
            value={destination}
            onChange={(e) => {
              userEditedRef.current = true;
              setDestination(e.target.value);
            }}
            placeholder="/absolute/path"
            spellCheck={false}
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-default">
          <Button
            variant="primary"
            disabled={!destination.trim() || !!inFlight}
            onClick={() =>
              start.mutate({ output_dir: outputDir, kind, destination })
            }
          >
            {inFlight ? "Exporting…" : "Start export"}
          </Button>
        </div>

        {jobId && (
          <div className="border border-border-default rounded bg-surface-1 p-2 text-sm space-y-1">
            <div className="flex items-center gap-2">
              <Badge
                tone={
                  finalJob?.status === "completed"
                    ? "success"
                    : finalJob?.status === "failed"
                      ? "danger"
                      : "info"
                }
              >
                {finalJob?.status ?? "running"}
              </Badge>
              <span className="text-xs font-mono text-fg-muted">{jobId}</span>
            </div>
            {finalJob?.status === "completed" && finalJob.result_path && (
              <div className="space-y-1">
                <div className="text-xs text-fg-secondary">Exported to:</div>
                <div className="font-mono text-xs break-all bg-surface-3 p-2 rounded">
                  {finalJob.result_path}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      if (finalJob.result_path) {
                        navigator.clipboard
                          ?.writeText(finalJob.result_path)
                          .then(() =>
                            toast.push({
                              kind: "success",
                              title: "Path copied to clipboard",
                            }),
                          )
                          .catch(() => {
                            toast.push({
                              kind: "warning",
                              title: "Clipboard unavailable",
                            });
                          });
                      }
                    }}
                  >
                    Copy path
                  </Button>
                  <span className="text-xs text-fg-muted self-center italic">
                    (Finder integration needs a native bridge — skipped)
                  </span>
                </div>
              </div>
            )}
            {finalJob?.status === "failed" && (
              <div className="text-xs text-danger-fg">
                {finalJob.error ?? "Export failed"}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
