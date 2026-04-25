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
