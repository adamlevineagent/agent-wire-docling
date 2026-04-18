/**
 * Thin typed fetch wrapper over the OpenAPI-generated types.
 *
 * Conventions:
 *  - All calls go through the Next.js /api/* rewrite (→ http://localhost:8000).
 *  - Non-2xx responses throw ApiError with the backend's {code, message, detail}
 *    when possible, else a generic message.
 *  - GET responses parsed as JSON (or text for markdown endpoints).
 */

import type { components } from "./api-types";

type Schemas = components["schemas"];

export type Health = Schemas["Health"];
export type ScanRequest = Schemas["ScanRequest"];
export type ScanResult = Schemas["ScanResult"];
export type Stratum = Schemas["Stratum"];
export type SampleRequest = Schemas["SampleRequest"];
export type SampleResult = Schemas["SampleResult"];
export type ConvertRequest = Schemas["ConvertRequest"];
export type DocMeta = Schemas["DocMeta"];
export type PipelineParams = Schemas["PipelineParams"];
export type BatchRequest = Schemas["BatchRequest"];
export type Job = Schemas["Job"];
export type Manifest = Schemas["Manifest"];
export type TasteSessionCreate = Schemas["TasteSessionCreate"];
export type TasteSession = Schemas["TasteSession"];
export type TasteSessionPatch = Schemas["TasteSessionPatch"];
export type ExportRequest = Schemas["ExportRequest"];
export type Filemap = Schemas["Filemap"];
export type FilemapPatchRequest = Schemas["FilemapPatchRequest"];
export type FiletreeNode = Schemas["FiletreeNode"];
export type Triage = Schemas["Triage"];
export type ApiError_ = Schemas["Error"];

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public detail?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = "/api";

async function request<T>(
  path: string,
  init?: RequestInit & { parse?: "json" | "text" },
): Promise<T> {
  const parse = init?.parse ?? "json";
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Accept: parse === "text" ? "text/markdown, text/plain, */*" : "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    throw new ApiError(0, "network_error", "Backend not reachable", String(e));
  }

  if (!res.ok) {
    let code = "http_error";
    let message = `${res.status} ${res.statusText}`;
    let detail: string | undefined;
    try {
      const body = (await res.json()) as ApiError_;
      code = body.code ?? code;
      message = body.message ?? message;
      detail = body.detail;
    } catch {
      // not json; ignore
    }
    throw new ApiError(res.status, code, message, detail);
  }

  if (parse === "text") return (await res.text()) as unknown as T;
  // Some endpoints (stream, octet) are not json; callers use request directly.
  return (await res.json()) as T;
}

export const api = {
  health: () => request<Health>("/health"),

  scan: (req: ScanRequest) =>
    request<ScanResult>("/scan", { method: "POST", body: JSON.stringify(req) }),

  sample: (req: SampleRequest) =>
    request<SampleResult>("/strata/sample", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  convert: (req: ConvertRequest) =>
    request<DocMeta>("/convert", { method: "POST", body: JSON.stringify(req) }),

  docMeta: (hash: string) => request<DocMeta>(`/docs/${hash}`),
  docMarkdown: (hash: string) =>
    request<string>(`/docs/${hash}/md`, { parse: "text" }),
  docJson: (hash: string) => request<unknown>(`/docs/${hash}/json`),
  docAnchors: (hash: string) => request<unknown[]>(`/docs/${hash}/anchors`),
  docSourceUrl: (hash: string) => `${BASE}/docs/${hash}/source`,
  rerun: (hash: string, pipeline: PipelineParams) =>
    request<DocMeta>(`/docs/${hash}/rerun`, {
      method: "POST",
      body: JSON.stringify(pipeline),
    }),

  batch: (req: BatchRequest) =>
    request<Job>("/batch", { method: "POST", body: JSON.stringify(req) }),
  job: (id: string) => request<Job>(`/jobs/${id}`),
  cancelBatch: (id: string) =>
    request<Job>(`/batch/${id}/cancel`, { method: "POST" }),
  manifest: (outputDir: string) =>
    request<Manifest>(`/manifest?output_dir=${encodeURIComponent(outputDir)}`),

  createTasteSession: (req: TasteSessionCreate) =>
    request<TasteSession>("/taste_sessions", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  getTasteSession: (id: string) => request<TasteSession>(`/taste_sessions/${id}`),
  patchTasteSession: (id: string, patch: TasteSessionPatch) =>
    request<TasteSession>(`/taste_sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  export: (req: ExportRequest) =>
    request<Job>("/export", { method: "POST", body: JSON.stringify(req) }),
  exportStatus: (id: string) => request<Job>(`/exports/${id}`),

  // ── Level B: filemap / filetree / triage ─────────────────────────────────
  filemap: (folder: string) =>
    request<Filemap>(`/filemap?folder=${encodeURIComponent(folder)}`),
  patchFilemap: (folder: string, req: FilemapPatchRequest) =>
    request<Filemap>(`/filemap?folder=${encodeURIComponent(folder)}`, {
      method: "PATCH",
      body: JSON.stringify(req),
    }),
  filetree: (root: string) =>
    request<FiletreeNode>(`/filetree?root=${encodeURIComponent(root)}`),
  triage: (outputDir: string) =>
    request<Triage>(`/triage?output_dir=${encodeURIComponent(outputDir)}`),
  retryTriage: (outputDir: string) =>
    request<{ retried: number; succeeded: number; still_failed: number; excluded: number }>(
      "/triage/retry",
      { method: "POST", body: JSON.stringify({ output_dir: outputDir }) },
    ),
};

export type Api = typeof api;
