/**
 * Local "gold" daily bars (JSON files) for faster repeat backtests — $0, gitignored.
 */
import path from 'path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { DATA_GOLD_BARS_DIR } from '../config/paths.js';
import { filterChartRowsToRange } from './yahoo-disk-cache.js';

function tickerPath(upper) {
  return path.join(DATA_GOLD_BARS_DIR, `${upper}.json`);
}

export function goldLayerReadEnabled() {
  return process.env.DATA_GOLD_LAYER === '1' || process.env.DATA_GOLD_LAYER === 'true';
}

export function goldLayerWriteEnabled() {
  return process.env.DATA_GOLD_WRITE === '1' || process.env.DATA_GOLD_WRITE === 'true';
}

/** Max age before gold is ignored for reads (default 7 days). */
export function goldMaxAgeMs() {
  const d = parseInt(String(process.env.DATA_GOLD_MAX_AGE_DAYS || '7'), 10);
  return (Number.isFinite(d) && d > 0 ? d : 7) * 86400000;
}

export function ensureGoldBarsDir() {
  mkdirSync(DATA_GOLD_BARS_DIR, { recursive: true });
}

/**
 * @returns {{ updatedAt: number, rows: object[] } | null}
 */
export function readGoldBarsFile(ticker) {
  const upper = String(ticker).toUpperCase();
  const fp = tickerPath(upper);
  if (!existsSync(fp)) return null;
  try {
    const raw = JSON.parse(readFileSync(fp, 'utf-8'));
    if (!raw || !Array.isArray(raw.rows) || raw.rows.length === 0) return null;
    return { updatedAt: Number(raw.updatedAt) || 0, rows: raw.rows };
  } catch {
    return null;
  }
}

/**
 * Clip to [startDate, endDate]; return null if too few rows or stale.
 */
export function readGoldBarsForRange(ticker, startDate, endDate) {
  if (!goldLayerReadEnabled()) return null;
  const pack = readGoldBarsFile(ticker);
  if (!pack) return null;
  if (Date.now() - pack.updatedAt > goldMaxAgeMs()) return null;
  const clipped = filterChartRowsToRange(pack.rows, startDate, endDate);
  if (clipped.length < 5) return null;
  return { rows: clipped, updatedAt: pack.updatedAt };
}

export function writeGoldBars(ticker, rows) {
  if (!rows?.length) return;
  ensureGoldBarsDir();
  const upper = String(ticker).toUpperCase();
  const payload = {
    updatedAt: Date.now(),
    ticker: upper,
    rows: rows.map((r) => ({
      date: r.date,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close
    }))
  };
  writeFileSync(tickerPath(upper), JSON.stringify(payload), 'utf-8');
}

export function goldDateRangeForYears(years) {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - years * 365.25 * 86400000);
  const lookbackStart = new Date(startDate.getTime() - 400 * 86400000);
  return {
    startDateStr: lookbackStart.toISOString().split('T')[0],
    endDateStr: endDate.toISOString().split('T')[0],
    simStartStr: startDate.toISOString().split('T')[0]
  };
}
