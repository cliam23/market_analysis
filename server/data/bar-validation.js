/**
 * Daily OHLC chart rows (backtest) — validation for trust + optional strict mode.
 * Rows: { date: 'YYYY-MM-DD', open, high, low, close, ... }
 */

function parseNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * @param {Array<{date?:string,open?:number,high?:number,low?:number,close?:number}>} rows
 * @param {{ ticker?: string, strict?: boolean }} [opts]
 * @returns {{ warnings: string[], errors: string[], rowCount: number, lastBarDate: string|null, firstBarDate: string|null }}
 */
export function validateDailyChartRows(rows, opts = {}) {
  const ticker = opts.ticker ? String(opts.ticker) : 'series';
  const warnings = [];
  const errors = [];
  if (!Array.isArray(rows)) {
    errors.push(`${ticker}: not an array`);
    return { warnings, errors, rowCount: 0, lastBarDate: null, firstBarDate: null };
  }
  if (rows.length === 0) {
    warnings.push(`${ticker}: empty series`);
    return { warnings, errors, rowCount: 0, lastBarDate: null, firstBarDate: null };
  }

  const sorted = [...rows].sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')));

  let prevDate = null;
  const datesSeen = new Set();
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const d = r?.date != null ? String(r.date).substring(0, 10) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      errors.push(`${ticker}: invalid date at index ${i}`);
      continue;
    }
    if (datesSeen.has(d)) {
      errors.push(`${ticker}: duplicate date ${d}`);
    }
    datesSeen.add(d);
    if (prevDate && d.localeCompare(prevDate) <= 0) {
      errors.push(`${ticker}: dates not strictly increasing (${prevDate} then ${d})`);
    }
    prevDate = d;

    const c = parseNum(r.close);
    if (!(c > 0)) {
      errors.push(`${ticker}: non-positive close on ${d}`);
    }
    const hi = parseNum(r.high);
    const lo = parseNum(r.low);
    const op = parseNum(r.open);
    if (Number.isFinite(hi) && Number.isFinite(lo) && hi < lo) {
      warnings.push(`${ticker}: high < low on ${d}`);
    }
    if (Number.isFinite(c) && Number.isFinite(hi) && c > hi * 1.05) {
      warnings.push(`${ticker}: close far above high on ${d} (possible bad tick)`);
    }
    if (Number.isFinite(c) && Number.isFinite(lo) && c < lo * 0.95) {
      warnings.push(`${ticker}: close far below low on ${d} (possible bad tick)`);
    }
  }

  const first = sorted[0]?.date != null ? String(sorted[0].date).substring(0, 10) : null;
  const last = sorted[sorted.length - 1]?.date != null ? String(sorted[sorted.length - 1].date).substring(0, 10) : null;

  if (sorted.length >= 3) {
    for (let i = 1; i < sorted.length; i++) {
      const prev = parseNum(sorted[i - 1].close);
      const cur = parseNum(sorted[i].close);
      if (prev > 0 && Math.abs(cur / prev - 1) > 0.35) {
        warnings.push(`${ticker}: large day-over-day move (~${((cur / prev - 1) * 100).toFixed(0)}%) — check splits`);
        break;
      }
    }
  }

  return {
    warnings,
    errors,
    rowCount: sorted.length,
    lastBarDate: last,
    firstBarDate: first
  };
}

export function validationStrictEnabled() {
  return process.env.DATA_VALIDATION_STRICT === '1' || process.env.DATA_VALIDATION_STRICT === 'true';
}

/**
 * Heuristic split-adjust pass for chart rows already returned by upstream caches.
 *
 * Many series come back from cache layers without a forward split adjustment, which
 * leaves a single-day move of ~33%/50%/66% (clean split ratios) sitting in the
 * series. That spike inflates momentum and (especially) volatility for weeks,
 * biasing risk-adjusted momentum and the composite ranker.
 *
 * Strategy:
 *  - Walk rows in time order. If the absolute day-over-day return is > 25% AND
 *    the close/prevClose ratio is within ±3% of a common split factor
 *    (2:1, 3:1, 3:2, 4:1, 5:1, 10:1 and their reverses), treat it as a missed split.
 *  - When found, multiply every prior bar's OHLC by `factor = newClose/prevClose`
 *    so the series becomes flat across the suspected split day. This is exactly
 *    what Yahoo's adjusted close would have applied if the split were known.
 *  - A persistence check (next 3 closes within ±8% of newClose) avoids false
 *    positives on real crashes or merger-driven jumps.
 *
 * Returns the (possibly mutated) row array and a small diagnostic.
 */
/**
 * factor = newClose / prevClose. We exclude 3:2 (0.667) and its reverse on purpose —
 * real crashes (NFLX 2022-04 -35%, META 2022-02 -26%) sit close to those ratios
 * and we'd rather miss the rare 3:2 split than corrupt a backtest.
 */
const COMMON_SPLIT_FACTORS = [
  0.5,    // 2-for-1
  0.3333, // 3-for-1
  0.25,   // 4-for-1
  0.2,    // 5-for-1
  0.1,    // 10-for-1
  2.0,    // 1-for-2 (reverse)
  3.0,    // 1-for-3 (reverse)
  4.0,    // 1-for-4 (reverse)
  10.0    // 1-for-10 (reverse)
];

/**
 * Three combined filters keep this from firing on real one-day crashes:
 *   1. Day-i factor must be within 0.8% of an exact common split ratio.
 *   2. The very next day's |return| must be < 2% (real splits are mechanical;
 *      crashes almost always have continued selling/volatility next day).
 *   3. Next 5 closes must each be within ±3% of the new close (post-split level
 *      stability vs crash-driven drift).
 *
 * Set DATA_VALIDATION_SPLIT_FIX=0 to disable entirely; defaults to enabled.
 */
export function splitAdjustChartRows(rows, opts = {}) {
  const ticker = opts.ticker ? String(opts.ticker).toUpperCase() : 'series';
  const diag = { adjustments: 0, applied: [] };
  if (process.env.DATA_VALIDATION_SPLIT_FIX === '0') return { rows, diag };
  if (!Array.isArray(rows) || rows.length < 7) return { rows, diag };

  const out = rows.map((r) => ({ ...r }));
  const tolerance = 0.008;
  const nextDayMaxReturn = 0.02;
  const persistenceDays = 5;
  const persistenceTolerance = 0.03;

  for (let i = 1; i < out.length - persistenceDays - 1; i++) {
    const prev = parseNum(out[i - 1].close);
    const cur = parseNum(out[i].close);
    if (!(prev > 0) || !(cur > 0)) continue;
    const factor = cur / prev;
    if (Math.abs(factor - 1) < 0.05) continue;

    const matched = COMMON_SPLIT_FACTORS.find((f) => Math.abs(factor - f) / f <= tolerance);
    if (matched == null) continue;

    const next1 = parseNum(out[i + 1].close);
    if (!(next1 > 0)) continue;
    if (Math.abs(next1 / cur - 1) >= nextDayMaxReturn) continue;

    let persists = true;
    for (let k = 1; k <= persistenceDays; k++) {
      const px = parseNum(out[i + k].close);
      if (!(px > 0) || Math.abs(px / cur - 1) > persistenceTolerance) {
        persists = false;
        break;
      }
    }
    if (!persists) continue;

    for (let j = 0; j < i; j++) {
      if (Number.isFinite(out[j].open)) out[j].open *= factor;
      if (Number.isFinite(out[j].high)) out[j].high *= factor;
      if (Number.isFinite(out[j].low)) out[j].low *= factor;
      if (Number.isFinite(out[j].close)) out[j].close *= factor;
    }
    diag.adjustments += 1;
    diag.applied.push({ date: out[i].date, factor: parseFloat(factor.toFixed(4)) });
    console.log(
      `[BAR-FIX] ${ticker}: applied split adjustment factor=${factor.toFixed(3)} on ${out[i].date} (retroactive on ${i} prior bars)`
    );
  }
  return { rows: out, diag };
}
