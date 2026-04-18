"use client";

import { QueryClient } from "@tanstack/react-query";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, err: unknown) => {
          // Don't retry 4xx; retry network/5xx once
          const status = (err as { status?: number })?.status ?? 0;
          if (status >= 400 && status < 500) return false;
          return failureCount < 1;
        },
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
