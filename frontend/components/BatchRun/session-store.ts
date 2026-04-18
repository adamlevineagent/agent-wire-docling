"use client";

/**
 * Tiny bridge between Agent G's TasteTest and Agent H's BatchRun.
 *
 * Parallel-agent coordination constraint: Agent G writes a taste_session_id
 * and its associated output_dir to localStorage when a session is created or
 * rehydrated; Agent H reads it to know which session to launch a batch against.
 *
 * Keys intentionally scoped "docling:" so they don't collide with other apps
 * sharing localhost during dev.
 *
 * URL query params `?taste_session=...` and `?job=...` override localStorage
 * — useful for reload-survival of an in-flight batch and for scripted testing.
 */

const TASTE_KEY = "docling:taste_session_id";
const OUTPUT_KEY = "docling:output_dir";
const JOB_KEY = "docling:batch_job_id";

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (value == null || value === "") window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* ignore quota or privacy-mode errors */
  }
}

export const sessionStore = {
  getTasteSessionId(): string | null {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      // Agent G writes the session id as `?session=...` — prefer that, then
      // `?taste_session=...` as an alias, then localStorage mirror.
      const q = params.get("session") ?? params.get("taste_session");
      if (q) return q;
    }
    return safeGet(TASTE_KEY);
  },
  setTasteSessionId(id: string | null) {
    safeSet(TASTE_KEY, id);
  },
  getOutputDir(): string | null {
    return safeGet(OUTPUT_KEY);
  },
  setOutputDir(dir: string | null) {
    safeSet(OUTPUT_KEY, dir);
  },
  getJobId(): string | null {
    if (typeof window !== "undefined") {
      const q = new URLSearchParams(window.location.search).get("job");
      if (q) return q;
    }
    return safeGet(JOB_KEY);
  },
  setJobId(id: string | null) {
    safeSet(JOB_KEY, id);
    // Also mirror to URL for reload-survival without forcing a navigation
    if (typeof window !== "undefined") {
      try {
        const url = new URL(window.location.href);
        if (id) url.searchParams.set("job", id);
        else url.searchParams.delete("job");
        window.history.replaceState({}, "", url.toString());
      } catch {
        /* ignore */
      }
    }
  },
};
