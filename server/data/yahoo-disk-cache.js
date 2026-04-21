import path from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { YAHOO_DISK_CACHE_DIR } from '../config/paths.js';
import { QUOTE_CACHE_TTL } from '../config/constants.js';

export function readQuoteDiskCache(ticker) {
  const upper = String(ticker).toUpperCase();
  const fp = path.join(YAHOO_DISK_CACHE_DIR, `${upper}.json`);
  if (!existsSync(fp)) return null;
  try {
    const raw = JSON.parse(readFileSync(fp, 'utf-8'));
    if (!raw.fetchedAt || !raw.data) return null;
    if (Date.now() - raw.fetchedAt > QUOTE_CACHE_TTL) return null;
    return raw.data;
  } catch {
    return null;
  }
}

export function writeQuoteDiskCache(ticker, data) {
  try {
    mkdirSync(YAHOO_DISK_CACHE_DIR, { recursive: true });
    const upper = String(ticker).toUpperCase();
    writeFileSync(
      path.join(YAHOO_DISK_CACHE_DIR, `${upper}.json`),
      JSON.stringify({ fetchedAt: Date.now(), data })
    );
  } catch (e) {
    console.warn('Yahoo disk cache write failed:', e.message);
  }
}

/** Persist successful Yahoo chart series (OHLC daily rows) for stale fallback. */
export function writeChartDiskCache(ticker, chartRows) {
  try {
    if (!chartRows?.length) return;
    mkdirSync(YAHOO_DISK_CACHE_DIR, { recursive: true });
    const upper = String(ticker).toUpperCase();
    writeFileSync(
      path.join(YAHOO_DISK_CACHE_DIR, `${upper}-chart.json`),
      JSON.stringify({ fetchedAt: Date.now(), data: chartRows })
    );
  } catch (e) {
    console.warn('[Yahoo] chart disk cache write failed:', e.message);
  }
}

/** Read last successful chart series even if TTL expired (used when live fetch fails). */
export function readChartDiskCacheStale(ticker) {
  const upper = String(ticker).toUpperCase();
  const fp = path.join(YAHOO_DISK_CACHE_DIR, `${upper}-chart.json`);
  if (!existsSync(fp)) return null;
  try {
    const raw = JSON.parse(readFileSync(fp, 'utf-8'));
    if (!raw || !Array.isArray(raw.data) || raw.data.length === 0) return null;
    return raw.data;
  } catch {
    return null;
  }
}

export function filterChartRowsToRange(rows, startDate, endDate) {
  if (!rows?.length) return [];
  return rows.filter((r) => r.date && r.date >= startDate && r.date <= endDate);
}
