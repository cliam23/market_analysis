const KEY = "ma-recent-tickers-v1";
const MAX = 10;

export function readRecentTickers() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((t) => typeof t === "string" && t.trim()) : [];
  } catch {
    return [];
  }
}

export function pushRecentTicker(ticker) {
  const u = String(ticker || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(u)) return;
  try {
    const prev = readRecentTickers().filter((x) => x !== u);
    const next = [u, ...prev].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
}
