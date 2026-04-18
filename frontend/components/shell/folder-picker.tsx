"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../ui/button";

type FsEntry = { name: string; path: string; kind: string };
type FsList = {
  path: string;
  parent: string | null;
  entries: FsEntry[];
  file_count: number;
};

async function fsList(path: string | null): Promise<FsList> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : "";
  const r = await fetch(`/api/fs/list${qs}`);
  if (!r.ok) {
    const body = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(body.detail ?? r.statusText);
  }
  return r.json();
}

export function FolderPicker({
  initialPath,
  onPick,
  onClose,
}: {
  initialPath?: string | null;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [cwd, setCwd] = useState<string | null>(initialPath ?? null);

  const { data, error, isLoading } = useQuery({
    queryKey: ["fs-list", cwd ?? "HOME"],
    queryFn: () => fsList(cwd),
    retry: false,
  });

  // Close on Esc
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Navigate with arrow keys / enter
  // Simple version: click-only. Polished nav can come later.

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/70"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[min(640px,92vw)] max-h-[min(640px,90vh)] bg-surface-1 border border-border-default rounded-lg shadow-md flex flex-col">
        {/* header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <div className="text-xs uppercase tracking-wider text-fg-muted">Folder</div>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="text-fg-muted hover:text-fg-primary text-sm"
            aria-label="Close"
          >
            Esc
          </button>
        </div>

        {/* breadcrumb / parent */}
        <div className="px-4 py-2 border-b border-border-subtle flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={!data?.parent}
            onClick={() => data?.parent && setCwd(data.parent)}
          >
            ← Parent
          </Button>
          <div className="flex-1 font-mono text-xs text-fg-secondary truncate">
            {data?.path ?? (isLoading ? "…" : "")}
          </div>
          {data && data.file_count > 0 && (
            <div className="text-xs text-fg-muted">{data.file_count} files</div>
          )}
        </div>

        {/* body */}
        <div className="flex-1 overflow-auto min-h-[280px]">
          {error && (
            <div className="px-4 py-3 text-xs text-danger-fg">
              {(error as Error).message}
            </div>
          )}
          {isLoading && (
            <div className="px-4 py-3 text-xs text-fg-muted">Loading…</div>
          )}
          {data && data.entries.length === 0 && !isLoading && (
            <div className="px-4 py-6 text-center text-xs text-fg-muted">
              No sub-folders.{" "}
              {data.file_count > 0 && `This folder has ${data.file_count} files — pick it?`}
            </div>
          )}
          {data?.entries.map((e) => (
            <button
              key={e.path}
              onClick={() => setCwd(e.path)}
              onDoubleClick={() => {
                setCwd(e.path);
              }}
              className="w-full text-left px-4 py-1.5 hover:bg-surface-3 flex items-center gap-2 text-sm font-mono"
            >
              <span className="text-fg-muted">▸</span>
              <span className="text-fg-primary">{e.name}</span>
            </button>
          ))}
        </div>

        {/* footer */}
        <div className="border-t border-border-subtle px-4 py-3 flex items-center gap-2">
          <div className="flex-1 text-xs text-fg-muted">
            Navigate with clicks. Pick this folder when ready.
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!data}
            onClick={() => data && onPick(data.path)}
          >
            Use this folder
          </Button>
        </div>
      </div>
    </div>
  );
}
