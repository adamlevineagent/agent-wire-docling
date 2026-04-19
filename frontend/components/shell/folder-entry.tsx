"use client";

/**
 * Screen 1 — Folder entry / empty state.
 *
 * The calm opening. Centered hero, single input + primary action,
 * optional recent-corpora list backed by localStorage. PrismGlyph as
 * atmospheric backdrop. The Browse… modal (FolderPicker) is still wired
 * for desktop-y folder selection.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api-client";
import { useAppState } from "./app-state";
import { useToast } from "../ui/toast";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Dot } from "../ui/dot";
import { Card } from "../ui/card";
import { FolderPicker } from "./folder-picker";
import { PrismGlyph } from "./prism-glyph";

const RECENT_KEY = "awd.recent-corpora.v1";

interface Recent {
  path: string;
  scannedAt: number; // ms
  files?: number;
  strata?: number;
  status: "scan" | "ready" | "done";
}

function loadRecents(): Recent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 3);
  } catch {
    return [];
  }
}

function saveRecent(r: Recent) {
  if (typeof window === "undefined") return;
  try {
    const existing = loadRecents().filter((x) => x.path !== r.path);
    const next = [r, ...existing].slice(0, 3);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function formatAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  const wk = Math.floor(d / 7);
  if (wk < 8) return `${wk} week${wk === 1 ? "" : "s"} ago`;
  return new Date(ms).toLocaleDateString();
}

const looksAbsolute = (p: string) =>
  p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p);

export function FolderEntry() {
  const { setFolder, setScan, registerPathInputFocuser } = useAppState();
  const [value, setValue] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    registerPathInputFocuser(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [registerPathInputFocuser]);

  // Hydration guard: loadRecents() reads localStorage which doesn't exist
  // during SSR. Render the recents list only after mount to avoid a
  // server/client mismatch when the user has prior corpora saved.
  const [recents, setRecents] = useState<Recent[]>([]);
  useEffect(() => {
    setRecents(loadRecents());
  }, []);

  const scan = useMutation({
    mutationFn: async (folderPath: string) =>
      api.scan({
        folder: folderPath,
        follow_symlinks: false,
        max_files: 50000,
      }),
    onSuccess: (result) => {
      setScan(result);
      setFolder(result.folder);
      saveRecent({
        path: result.folder,
        scannedAt: Date.now(),
        files: result.total_files,
        strata: result.strata.length,
        status: result.strata.length > 0 ? "ready" : "scan",
      });
      toast.push({
        kind: "success",
        title: "Scan complete",
        detail: `${result.total_files} files across ${result.strata.length} strata`,
      });
    },
    onError: (err) => {
      setScan(null);
      if (err instanceof ApiError) {
        toast.push({
          kind: err.status === 0 ? "warning" : "danger",
          title:
            err.status === 0
              ? "Backend not reachable"
              : `Scan failed (${err.status})`,
          detail: err.message + (err.detail ? ` — ${err.detail}` : ""),
        });
      } else {
        toast.push({
          kind: "danger",
          title: "Scan failed",
          detail: String(err),
        });
      }
    },
  });

  function submit() {
    const v = value.trim();
    if (!v) {
      // Empty path → open the picker instead of erroring.
      setClientError(null);
      setPickerOpen(true);
      return;
    }
    if (!looksAbsolute(v)) {
      setClientError("Use an absolute path (starts with /)");
      return;
    }
    setClientError(null);
    scan.mutate(v);
  }

  return (
    <div className="relative h-full flex flex-col items-center justify-center px-16 py-10 gap-7 overflow-hidden">
      <PrismGlyph />

      {/* Hero copy */}
      <div className="relative z-[2] text-center max-w-[460px]">
        <div className="label-eyebrow mb-2.5">New corpus</div>
        <h1 className="text-[26px] font-semibold tracking-tight leading-tight mb-2">
          Point me at a folder.
        </h1>
        <div className="text-[13.5px] text-fg-muted leading-relaxed">
          I&apos;ll group what&apos;s in it, let you spot-check a few
          conversions, then grind through the rest while you sleep.
        </div>
      </div>

      {/* Input + primary */}
      <div className="relative z-[2] w-[520px]">
        <div className="flex gap-2 items-stretch">
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              className="h-10 w-full pl-3 pr-14 text-sm font-mono bg-surface-2 text-fg-primary placeholder:text-fg-muted border border-border-default rounded-md outline-none focus:border-cyan/40 focus:ring-2 focus:ring-cyan/20"
              placeholder="/absolute/path/to/corpus"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (clientError) setClientError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 mono text-[10px] text-fg-disabled hover:text-fg-secondary"
              title="Browse for folder"
            >
              ⌘O
            </button>
          </div>
          <Button
            variant="primary"
            className="h-10 px-5"
            disabled={scan.isPending}
            onClick={submit}
          >
            {scan.isPending ? "Scanning…" : "Scan"}
            <Kbd>↵</Kbd>
          </Button>
        </div>
        {clientError && (
          <div className="text-xs text-danger mt-2">{clientError}</div>
        )}
        <div className="mt-2.5 text-[11.5px] text-fg-muted text-center">
          Everything happens on your machine. Nothing is uploaded.
        </div>
      </div>

      {/* Recent */}
      {recents.length > 0 && (
        <div className="relative z-[2] w-[520px] mt-3.5">
          <div className="label-eyebrow mb-2">Recent</div>
          <Card className="p-0 overflow-hidden">
            {recents.map((r, i) => (
              <button
                key={r.path}
                type="button"
                onClick={() => {
                  setValue(r.path);
                  scan.mutate(r.path);
                }}
                className={
                  "w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-surface-2 transition-colors " +
                  (i ? "border-t border-border-subtle" : "")
                }
              >
                <Dot
                  tone={
                    r.status === "done"
                      ? "ok"
                      : r.status === "ready"
                        ? "cyan"
                        : "warn"
                  }
                />
                <div className="flex-1 min-w-0">
                  <div className="mono text-[12px] text-fg-primary truncate">
                    {r.path}
                  </div>
                  <div className="text-[11px] text-fg-muted">
                    {r.files != null
                      ? `${r.files} docs · ${r.strata ?? 0} strata`
                      : "scan only"}
                  </div>
                </div>
                <div className="text-[11px] text-fg-disabled">
                  {formatAgo(r.scannedAt)}
                </div>
              </button>
            ))}
          </Card>
        </div>
      )}

      {pickerOpen && (
        <FolderPicker
          initialPath={value && looksAbsolute(value) ? value : null}
          onPick={(path) => {
            setValue(path);
            setClientError(null);
            setPickerOpen(false);
            scan.mutate(path);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
