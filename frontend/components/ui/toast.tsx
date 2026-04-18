"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { cn } from "../../lib/cn";

export type ToastKind = "info" | "success" | "warning" | "danger";

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
}

interface ToastCtx {
  push: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, ...t }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 6000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-96 max-w-[calc(100vw-2rem)]">
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={cn(
              "px-3 py-2 rounded border shadow cursor-pointer",
              "bg-surface-2 border-border-default",
              t.kind === "success" && "border-l-4 border-l-success",
              t.kind === "warning" && "border-l-4 border-l-warning",
              t.kind === "danger" && "border-l-4 border-l-danger",
              t.kind === "info" && "border-l-4 border-l-info",
            )}
          >
            <div className="text-sm text-fg-primary font-medium">{t.title}</div>
            {t.detail && (
              <div className="text-xs text-fg-muted mt-1 font-mono break-words">
                {t.detail}
              </div>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast requires <ToastProvider>");
  return ctx;
}
