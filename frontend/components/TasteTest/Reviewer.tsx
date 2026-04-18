"use client";

/**
 * Reviewer — renders a full <VizDiff /> for one doc, wired to the taste
 * session via onApprove/onReject/onSkip/onFlag/onRerun/onNext/onPrev.
 *
 * For PDFs we drive Agent E's `PdfRenderer` class (has `mount(host)`), which
 * VizDiff's SourceSlot consumes. For non-PDFs we pass a stub SourceRenderer;
 * VizDiff shows its placeholder on the left but Markdown/JSON panes on the
 * right remain fully functional — the review flow (approve/reject/rerun)
 * is the gated primitive this agent's scope owns.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { VizDiff } from "../VizDiff";
import { PdfRenderer } from "../Renderers/pdf";
import { makeNoopRenderer } from "../Renderers/types";
import { pickRenderer } from "../Renderers";
import type {
  Anchor,
  PipelineParams,
  SourceRenderer,
} from "../../../contracts/vizdiff";
import type { TasteSessionPatch } from "../../lib/api-client";
import type { DocApproval } from "./types";
import { useDocForVizDiff } from "./useDocForVizDiff";
import { Button } from "../ui/button";
import { api } from "../../lib/api-client";
import { useToast } from "../ui/toast";

export interface ReviewerProps {
  hash: string;
  stratumName: string;
  pipeline: PipelineParams;
  output_dir: string;
  existingApproval?: DocApproval;
  onDecision: (patch: Omit<TasteSessionPatch, "version">) => Promise<unknown>;
  onAdvance: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export function Reviewer(props: ReviewerProps) {
  const {
    hash,
    stratumName,
    pipeline,
    output_dir,
    onDecision,
    onAdvance,
    onPrev,
    onNext,
    existingApproval,
  } = props;

  const { data, loading, error, refetch } = useDocForVizDiff(hash, output_dir);
  const rendererRef = useRef<SourceRenderer | null>(null);
  const [rendererReady, setRendererReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const anchors = data?.doc.anchors ?? ([] as Anchor[]);
  const doclingDoc = data?.doc.doclingDoc ?? null;

  const fmt = (data?.doc.source_format ?? "").toLowerCase();
  const isPdf = fmt === "pdf";

  // Build renderer for PDF eagerly (class-based). For non-PDF formats we let
  // the React renderer component (below) register the renderer via onRenderer.
  useEffect(() => {
    if (!data) {
      rendererRef.current?.dispose?.();
      rendererRef.current = null;
      setRendererReady(false);
      return;
    }
    // Dispose prior
    rendererRef.current?.dispose?.();
    if (isPdf) {
      rendererRef.current = new PdfRenderer({
        sourceUrl: api.docSourceUrl(data.meta.source_sha256),
        anchorsProvider: () => anchors,
        doclingDocProvider: () => doclingDoc,
      }) as unknown as SourceRenderer;
      setRendererReady(true);
    } else {
      // Provisional noop so VizDiff has a valid renderer while the React
      // source component is mounting. It will be replaced via onRenderer.
      rendererRef.current = makeNoopRenderer(
        `source-preview bootstrapping for ${fmt}`,
      );
      setRendererReady(true);
    }
    return () => {
      rendererRef.current?.dispose?.();
      rendererRef.current = null;
      setRendererReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.meta.source_sha256, data?.doc.source_format]);

  // React source node for non-PDF formats: pickRenderer returns the
  // format-specific component; it registers its SourceRenderer via onRenderer.
  const sourceNode = useMemo(() => {
    if (!data || isPdf) return undefined;
    const Comp = pickRenderer(data.doc.source_format);
    return (
      <Comp
        hash={data.doc.hash}
        source_path={data.doc.source_path}
        sourceUrl={api.docSourceUrl(data.meta.source_sha256)}
        doclingDoc={doclingDoc}
        anchors={anchors}
        onRenderer={(r) => {
          // Dispose the provisional noop; install the real renderer.
          try {
            rendererRef.current?.dispose?.();
          } catch {
            /* noop */
          }
          rendererRef.current = r;
        }}
        className="absolute inset-0 overflow-auto"
      />
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.doc.hash, data?.doc.source_format, isPdf, doclingDoc, anchors]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-fg-muted">
        Loading document…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-2">
          <div className="text-sm text-danger-fg">
            Couldn&apos;t load this document.
          </div>
          <div className="text-xs text-fg-muted font-mono break-all">
            {error?.message ?? "unknown error"}
          </div>
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button size="sm" onClick={() => refetch()}>
              Retry
            </Button>
            <Button size="sm" variant="ghost" onClick={onAdvance}>
              Skip this doc
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const { doc, meta } = data;

  async function submit(status: DocApproval["status"], notes?: string) {
    if (busy) return;
    setBusy(true);
    try {
      const approval: DocApproval = {
        source_sha256: doc.hash,
        status,
        notes,
        reviewed_at: new Date().toISOString(),
        pipeline_hash: meta.pipeline_hash,
      };
      await onDecision({
        approval: { stratum: stratumName, approval },
      });
      // Dual-write to filemap so the new Level B batch path sees the decision.
      // Best-effort: surface errors as a toast only; taste_sessions PATCH above
      // remains the authoritative write for now.
      try {
        const sp = doc.source_path || meta.source_path;
        if (sp) {
          const lastSlash = sp.lastIndexOf("/");
          if (lastSlash > 0) {
            const folder = sp.slice(0, lastSlash);
            const basename = sp.slice(lastSlash + 1);
            let user_included: boolean | null | undefined;
            let user_notes: string | null | undefined;
            if (status === "approved") user_included = true;
            else if (status === "rejected") user_included = false;
            else if (status === "flagged") {
              user_included = true;
              user_notes = notes ? `flagged: ${notes}` : "flagged";
            }
            // skipped → leave user_included untouched
            if (user_included !== undefined || user_notes !== undefined) {
              await api.patchFilemap(folder, {
                files: [
                  {
                    path: basename,
                    ...(user_included !== undefined ? { user_included } : {}),
                    ...(user_notes !== undefined ? { user_notes } : {}),
                  },
                ],
              });
            }
          }
        }
      } catch (e) {
        toast.push({
          kind: "warning",
          title: "Filemap sync failed",
          detail: e instanceof Error ? e.message : String(e),
        });
      }
      onAdvance();
    } catch {
      // toast already surfaced in session hook
    } finally {
      setBusy(false);
    }
  }

  async function doRerun(newPipeline: PipelineParams) {
    try {
      await api.rerun(doc.hash, newPipeline);
      refetch();
      toast.push({ kind: "success", title: "Re-ran with new pipeline" });
    } catch (e) {
      toast.push({
        kind: "danger",
        title: "Rerun failed",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (!rendererReady || !rendererRef.current) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-fg-muted">
        Preparing renderer…
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {existingApproval && (
        <div className="px-3 py-1 bg-info-bg/40 text-info-fg text-xs border-b border-border-default font-mono">
          Previously {existingApproval.status}
          {existingApproval.pipeline_hash &&
            existingApproval.pipeline_hash !== meta.pipeline_hash && (
              <> · under different pipeline</>
            )}
        </div>
      )}
      <div className="flex-1 min-h-0">
        <VizDiff
          doc={doc}
          sourceRenderer={rendererRef.current}
          sourceNode={sourceNode}
          currentPipeline={pipeline}
          shortcutScope="tastetest"
          onApprove={(d) => submit("approved", d.notes)}
          onReject={(d) => submit("rejected", d.notes)}
          onSkip={() => submit("skipped")}
          onFlag={(d) => submit("flagged", d.notes)}
          onRerun={doRerun}
          onNext={onNext}
          onPrev={onPrev}
        />
      </div>
    </div>
  );
}
