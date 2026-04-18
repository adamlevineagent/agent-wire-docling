/**
 * Re-export the public contract so VizDiff consumers can import from one place:
 *
 *   import type { VizDiffProps } from "@/components/VizDiff/types";
 */
export type {
  VizDiffProps,
  VizDiffDoc,
  SourceRenderer,
  SourceViewport,
  Anchor,
  BBox,
  QualityBadge,
  PipelineParams,
  ReviewAction,
  ReviewDecision,
} from "../../../contracts/vizdiff";

export { VIZDIFF_BINDINGS } from "../../../contracts/vizdiff";
