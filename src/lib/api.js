/**
 * All browser calls to the Express API should go through here so tabs stay
 * aligned with one backend origin:
 * - Dev: Vite proxies `/api` → `VITE_API_TARGET` (default localhost:3001).
 * - Preview: same proxy in vite.config `preview`.
 * - Split deploy: set `VITE_API_BASE=https://your-api-host` (no trailing slash).
 *
 * If `VITE_API_BASE` is set in `.env`, requests go **directly** to that host (Vite’s `/api`
 * proxy is bypassed). Point it at the same API you run locally (e.g. `http://localhost:3001`)
 * or KPIs will look “disconnected” / stale compared to the server you restarted.
 */
const RAW = import.meta.env.VITE_API_BASE ?? "";
export const API_BASE = String(RAW).replace(/\/$/, "");

export function apiUrl(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!API_BASE) return p;
  return `${API_BASE}${p}`;
}

export function apiFetch(path, init) {
  return fetch(apiUrl(path), init);
}

export async function safeJson(res) {
  const text = await res.text();
  if (!res.ok) {
    let serverMsg = null;
    try {
      const j = JSON.parse(text);
      if (j && typeof j.error === "string" && j.error.trim()) serverMsg = j.error.trim();
    } catch { /* ignore */ }
    if (serverMsg) throw new Error(serverMsg);
    const downHint = res.status === 0 || res.status >= 500 ? " — is the backend running?" : "";
    throw new Error(`Request failed (${res.status})${downHint}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Server returned non-JSON — backend may be down");
  }
}
