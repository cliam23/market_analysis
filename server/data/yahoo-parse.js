// Helper: safely extract number from Yahoo Finance (handles {raw, fmt} objects)
export function yfNum(val, def = null) {
  if (val == null || val === '' || (typeof val === 'number' && isNaN(val))) return def;
  if (typeof val === 'number') return val;
  if (typeof val === 'object') {
    if (val.raw != null) return typeof val.raw === 'number' ? val.raw : parseFloat(val.raw) || def;
    if (val.toString) return parseFloat(val.toString().replace(/[^0-9.-]/g, '')) || def;
  }
  if (typeof val === 'string') return parseFloat(val.replace(/[^0-9.-]/g, '')) || def;
  return def;
}

/**
 * Yahoo Finance v2 chart/quoteSummary often fail on dotted class tickers (e.g. BRK.B).
 * Use hyphen form for API calls; keep caller's symbol as the map key elsewhere.
 */
export function yahooApiSymbol(ticker) {
  const u = String(ticker || '').toUpperCase().trim();
  if (u === 'BRK.B') return 'BRK-B';
  return String(ticker || '').trim() || ticker;
}
