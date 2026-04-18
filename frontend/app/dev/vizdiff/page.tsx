"use client";

/**
 * Dev-only route: /dev/vizdiff
 *
 * Drives <VizDiff /> against a real converted doc fetched from the backend.
 *
 *   /dev/vizdiff?hash=<sha256>&output_dir=<abs>
 *
 * Defaults: converts data/fixtures/attention.pdf into /tmp/awd-dev-output
 * on the fly if the hash isn't already converted.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type DocMeta } from "../../../lib/api-client";
import type { Anchor, PipelineParams } from "../../../../contracts/vizdiff";
import { VizDiff } from "../../../components/VizDiff";
import {
  FIXTURE_DOC,
  FIXTURE_PIPELINE,
  makeStubRenderer,
} from "../../../components/VizDiff/fixture";
import { PdfRenderer } from "../../../components/Renderers/pdf";
import type { SourceRenderer } from "../../../../contracts/vizdiff";

const DEFAULT_SOURCE = "/Users/adamlevine/AI Project Files/agent-wire-docling/data/fixtures/attention.pdf";
const DEFAULT_OUTPUT = "/tmp/awd-dev-output";

export default function DevVizDiffPage() {
  const [status, setStatus] = useState<
    "loading" | "converting" | "ready" | "error" | "fixture"
  >("loading");
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<DocMeta | null>(null);
  const [markdown, setMarkdown] = useState<string>("");
  const [doclingDoc, setDoclingDoc] = useState<unknown>(null);
  const [anchors, setAnchors] = useState<Anchor[]>([]);

  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const paramHash = params?.get("hash") ?? undefined;
  const outputDir = params?.get("output_dir") ?? DEFAULT_OUTPUT;
  const sourcePath = params?.get("source") ?? DEFAULT_SOURCE;

  const pipeline: PipelineParams = useMemo(() => FIXTURE_PIPELINE, []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        let hash = paramHash;
        if (!hash) {
          setStatus("converting");
          const conv = await api.convert({
            source_path: sourcePath,
            output_dir: outputDir,
            pipeline,
          });
          hash = conv.source_sha256;
          if (cancelled) return;
          setMeta(conv);
        } else {
          const m = await api.docMeta(hash);
          if (cancelled) return;
          setMeta(m);
        }
        const [md, json, anchorsRaw] = await Promise.all([
          api.docMarkdown(hash),
          api.docJson(hash),
          api.docAnchors(hash),
        ]);
        if (cancelled) return;
        setMarkdown(md);
        setDoclingDoc(json);
        setAnchors((anchorsRaw as Anchor[]) ?? []);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("fixture");
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [paramHash, outputDir, sourcePath, pipeline]);

  // ── Renderer handling ──────────────────────────────────────────────
  const rendererRef = useRef<SourceRenderer | null>(null);
  if (!rendererRef.current) {
    rendererRef.current =
      status === "ready" && meta
        ? new PdfRenderer({
            sourceUrl: api.docSourceUrl(meta.source_sha256),
            anchorsProvider: () => anchors,
            doclingDocProvider: () => doclingDoc,
          })
        : makeStubRenderer();
  }

  // Rebuild renderer when the hash changes (new doc) or status flips
  useEffect(() => {
    if (status === "ready" && meta) {
      if (rendererRef.current) rendererRef.current.dispose();
      rendererRef.current = new PdfRenderer({
        sourceUrl: api.docSourceUrl(meta.source_sha256),
        anchorsProvider: () => anchors,
        doclingDocProvider: () => doclingDoc,
      });
    }
  }, [status, meta, anchors, doclingDoc]);

  const onApprove = useCallback(() => console.log("[dev/vizdiff] approve"), []);
  const onReject = useCallback(() => console.log("[dev/vizdiff] reject"), []);
  const onSkip = useCallback(() => console.log("[dev/vizdiff] skip"), []);
  const onFlag = useCallback(() => console.log("[dev/vizdiff] flag"), []);
  const onRerun = useCallback(() => console.log("[dev/vizdiff] rerun"), []);

  if (status === "loading" || status === "converting") {
    return (
      <div className="h-screen flex items-center justify-center text-sm text-fg-muted font-mono">
        {status === "converting"
          ? `Converting ${sourcePath.split("/").pop()} → ${outputDir} …`
          : "Loading…"}
      </div>
    );
  }

  if (status === "fixture") {
    return (
      <div className="h-screen flex flex-col">
        <div className="px-3 py-2 border-b border-border-default bg-warning-bg text-warning-fg text-xs font-mono">
          Backend unreachable ({error ?? "unknown"}). Rendering fixture.
        </div>
        <div className="flex-1 min-h-0">
          <VizDiff
            doc={FIXTURE_DOC}
            sourceRenderer={makeStubRenderer()}
            currentPipeline={FIXTURE_PIPELINE}
            onApprove={onApprove}
            onReject={onReject}
            onSkip={onSkip}
            onFlag={onFlag}
            onRerun={onRerun}
            shortcutScope="dev"
          />
        </div>
      </div>
    );
  }

  if (status === "error" || !meta) {
    return (
      <div className="h-screen flex items-center justify-center text-sm text-danger-fg font-mono">
        Error: {error}
      </div>
    );
  }

  return (
    <VizDiff
      doc={{
        hash: meta.source_sha256,
        source_path: meta.source_path,
        source_format: meta.source_format,
        output_dir: outputDir,
        doclingDoc,
        markdown,
        anchors,
        qualityBadges: meta.quality_signals?.warnings ?? [],
      }}
      sourceRenderer={rendererRef.current!}
      currentPipeline={meta.pipeline_params ?? pipeline}
      onApprove={onApprove}
      onReject={onReject}
      onSkip={onSkip}
      onFlag={onFlag}
      onRerun={onRerun}
      shortcutScope="dev"
    />
  );
}
