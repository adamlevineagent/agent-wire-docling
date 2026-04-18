"use client";

/**
 * Taste session lifecycle: create-or-get + URL-rehydrated session_id.
 *
 * Contracts:
 *  - POST /taste_sessions {scan_id, output_dir} → TasteSession
 *  - GET  /taste_sessions/{id} → TasteSession
 *  - PATCH /taste_sessions/{id} {version, ...sub-patch} → TasteSession
 *
 * We keep the current session_id in the URL (`?session=...`) so a refresh
 * rehydrates where we were. URL writes are best-effort — we don't navigate.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  ApiError,
  type TasteSession,
  type TasteSessionPatch,
} from "../../lib/api-client";
import { useToast } from "../ui/toast";

const SESSION_PARAM = "session";

function readSessionIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const u = new URL(window.location.href);
    return u.searchParams.get(SESSION_PARAM);
  } catch {
    return null;
  }
}

function writeSessionIdToUrl(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    const u = new URL(window.location.href);
    if (id) u.searchParams.set(SESSION_PARAM, id);
    else u.searchParams.delete(SESSION_PARAM);
    window.history.replaceState({}, "", u.toString());
  } catch {
    // ignore
  }
}

export function useTasteSession(opts: { scan_id: string | null; output_dir: string }) {
  const { scan_id, output_dir } = opts;
  const qc = useQueryClient();
  const toast = useToast();
  const [sessionId, setSessionId] = useState<string | null>(() => readSessionIdFromUrl());

  // If URL session_id exists, GET it; else null until we create one.
  const sessionQuery = useQuery<TasteSession, ApiError>({
    queryKey: ["taste_session", sessionId],
    queryFn: () => api.getTasteSession(sessionId as string),
    enabled: !!sessionId,
  });

  // Mirror id to URL whenever it changes.
  useEffect(() => {
    writeSessionIdToUrl(sessionId);
  }, [sessionId]);

  // Create a new session.
  const createMut = useMutation<TasteSession, ApiError, void>({
    mutationFn: async () => {
      if (!scan_id) throw new ApiError(0, "no_scan", "No scan to bind");
      return api.createTasteSession({ scan_id, output_dir });
    },
    onSuccess: (s) => {
      setSessionId(s.id);
      qc.setQueryData(["taste_session", s.id], s);
    },
    onError: (e) => {
      toast.push({ kind: "danger", title: "Create session failed", detail: e.message });
    },
  });

  // If we have a scan and a non-matching session, or no session at all, we don't auto-create —
  // the caller decides (with a button). We DO auto-create when the user enters taste stage
  // for the first time with a clean URL.
  const autoCreateTriggered = useRef(false);
  useEffect(() => {
    if (autoCreateTriggered.current) return;
    if (!scan_id) return;
    if (sessionId) return;
    autoCreateTriggered.current = true;
    createMut.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan_id, sessionId]);

  // If the hydrated session belongs to a DIFFERENT scan than the current one,
  // surface a toast and allow the user to recreate.
  const session = sessionQuery.data ?? null;
  const mismatchedScan =
    !!session && !!scan_id && session.scan_id !== scan_id;

  // PATCH with optimistic CAS retry.
  const patchMut = useMutation<
    TasteSession,
    ApiError,
    Omit<TasteSessionPatch, "version">
  >({
    mutationFn: async (sub) => {
      if (!session) throw new ApiError(0, "no_session", "No session loaded");
      try {
        return await api.patchTasteSession(session.id, {
          version: session.version ?? 0,
          ...sub,
        });
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          // Refetch and retry once.
          const fresh = await api.getTasteSession(session.id);
          qc.setQueryData(["taste_session", session.id], fresh);
          return api.patchTasteSession(session.id, {
            version: fresh.version ?? 0,
            ...sub,
          });
        }
        throw e;
      }
    },
    onSuccess: (s) => {
      qc.setQueryData(["taste_session", s.id], s);
    },
    onError: (e) => {
      toast.push({ kind: "danger", title: "Save failed", detail: e.message });
    },
  });

  const refresh = useCallback(() => {
    if (sessionId) qc.invalidateQueries({ queryKey: ["taste_session", sessionId] });
  }, [qc, sessionId]);

  return useMemo(
    () => ({
      session,
      sessionId,
      loading: sessionQuery.isLoading || createMut.isPending,
      error: (sessionQuery.error as ApiError | null) ?? null,
      mismatchedScan,
      recreate: () => {
        setSessionId(null);
        autoCreateTriggered.current = false;
        createMut.mutate();
      },
      patch: (sub: Omit<TasteSessionPatch, "version">) => patchMut.mutateAsync(sub),
      patchPending: patchMut.isPending,
      refresh,
    }),
    [session, sessionId, sessionQuery, createMut, patchMut, mismatchedScan, refresh],
  );
}
