"use client";

/**
 * Assemble a <VizDiff /> VizDiffDoc from backend by hash:
 *   meta (DocMeta) + markdown + json (docling) + anchors.
 *
 * Kept in this file so the reviewer pane stays a thin view.
 */

import { useQuery } from "@tanstack/react-query";
import { api, type ApiError, type DocMeta } from "../../lib/api-client";
import type {
  Anchor,
  QualityBadge,
  VizDiffDoc,
} from "../../../contracts/vizdiff";

export interface AssembledDoc {
  doc: VizDiffDoc;
  meta: DocMeta;
}

export function useDocForVizDiff(
  hash: string | null,
  output_dir: string,
): {
  data: AssembledDoc | null;
  loading: boolean;
  error: ApiError | null;
  refetch: () => void;
} {
  const q = useQuery<AssembledDoc, ApiError>({
    queryKey: ["vizdiff_doc", hash],
    enabled: !!hash,
    queryFn: async () => {
      const h = hash as string;
      const [meta, markdown, doclingDoc, anchorsRaw] = await Promise.all([
        api.docMeta(h),
        api.docMarkdown(h),
        api.docJson(h),
        api.docAnchors(h),
      ]);
      const anchors = (anchorsRaw ?? []) as Anchor[];
      const qualityBadges = (meta.quality_signals?.warnings ?? []) as QualityBadge[];
      const doc: VizDiffDoc = {
        hash: meta.source_sha256,
        source_path: meta.source_path,
        source_format: meta.source_format,
        output_dir,
        doclingDoc,
        markdown,
        anchors,
        qualityBadges: [...qualityBadges].sort((a, b) => a.page - b.page),
      };
      return { doc, meta };
    },
  });

  return {
    data: q.data ?? null,
    loading: q.isLoading,
    error: (q.error as ApiError | null) ?? null,
    refetch: () => q.refetch(),
  };
}
