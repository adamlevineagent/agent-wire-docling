"use client";

import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { makeQueryClient } from "../../lib/query-client";
import { ShortcutProvider } from "../../lib/shortcuts";
import { ToastProvider } from "../ui/toast";
import { AppStateProvider } from "./app-state";
import { ErrorBoundary } from "./error-boundary";

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => makeQueryClient());
  return (
    <ErrorBoundary>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <ShortcutProvider>
            <AppStateProvider>{children}</AppStateProvider>
          </ShortcutProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
