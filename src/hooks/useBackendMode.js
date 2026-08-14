import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api.js";

/**
 * "full" = real server.js (local dev, Railway, Docker, ...).
 * "lite" = Vercel-only deploy serving api/health.js's { mode: "lite" }.
 * null   = not resolved yet.
 *
 * Module-level cache: every component that calls this hook shares one
 * /api/health request instead of each tab firing its own on mount.
 */
let cachedMode = null;
let inflight = null;
const listeners = new Set();

function resolveMode() {
  if (cachedMode) return Promise.resolve(cachedMode);
  if (!inflight) {
    inflight = apiFetch("/api/health")
      .then((res) => res.json())
      .then((data) => {
        cachedMode = data?.mode === "lite" ? "lite" : "full";
        listeners.forEach((fn) => fn(cachedMode));
        return cachedMode;
      })
      .catch(() => {
        cachedMode = "full"; // assume full backend if health check itself fails to avoid over-restricting
        listeners.forEach((fn) => fn(cachedMode));
        return cachedMode;
      });
  }
  return inflight;
}

export function useBackendMode() {
  const [mode, setMode] = useState(cachedMode);

  useEffect(() => {
    if (cachedMode) return;
    listeners.add(setMode);
    resolveMode();
    return () => listeners.delete(setMode);
  }, []);

  return mode;
}
