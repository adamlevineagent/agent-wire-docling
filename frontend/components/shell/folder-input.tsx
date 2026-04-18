"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api-client";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useAppState } from "./app-state";
import { useToast } from "../ui/toast";

function looksAbsolute(p: string) {
  return p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p);
}

export function FolderInput() {
  const { folder, setFolder, setScan, registerPathInputFocuser } = useAppState();
  const [value, setValue] = useState(folder);
  const [clientError, setClientError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    registerPathInputFocuser(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [registerPathInputFocuser]);

  const scan = useMutation({
    mutationFn: async (folderPath: string) =>
      api.scan({ folder: folderPath, follow_symlinks: false, max_files: 50000 }),
    onSuccess: (result) => {
      setScan(result);
      setFolder(result.folder);
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
            err.status === 0 ? "Backend not reachable" : `Scan failed (${err.status})`,
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

  function validate(v: string): string | null {
    if (!v.trim()) return "Path is required";
    if (!looksAbsolute(v.trim())) return "Use an absolute path (starts with /)";
    return null;
  }

  function submit() {
    const v = value.trim();
    const err = validate(v);
    setClientError(err);
    if (err) return;
    scan.mutate(v);
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs uppercase tracking-wider text-fg-muted">
        Folder
      </label>
      <Input
        ref={inputRef}
        value={value}
        placeholder="/absolute/path/to/corpus"
        onChange={(e) => {
          setValue(e.target.value);
          if (clientError) setClientError(null);
        }}
        onBlur={() => {
          if (value) setClientError(validate(value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      {clientError && (
        <div className="text-xs text-danger-fg">{clientError}</div>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={scan.isPending}
          onClick={submit}
        >
          {scan.isPending ? "Scanning…" : "Validate"}
        </Button>
      </div>
    </div>
  );
}
