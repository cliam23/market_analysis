/** Mitigate Yahoo 429s: parse int env with clamp (used at module load for concurrency defaults). */
export function parseYahooEnvInt(name, def, min, max) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return def;
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}
