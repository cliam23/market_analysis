#!/usr/bin/env node
/**
 * Out-of-sample style check for adaptive pillar weights (last ~3 months of rebalance log).
 * Requires the API server running (default http://127.0.0.1:3001).
 * Set ADAPTIVE_WEIGHT_LOG=1 in .env and restart the server so backtests include adaptiveWeightLog.
 *
 * Usage: node scripts/oos_adaptive_replay.mjs
 * Optional: BASE_URL=http://127.0.0.1:3001 UNIVERSE=mag7 STRATEGY=full_composite
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';
const universe = process.env.UNIVERSE || 'mag7';
const strategy = process.env.STRATEGY || 'full_composite';

const cutoff = new Date();
cutoff.setMonth(cutoff.getMonth() - 3);
const cutoffStr = cutoff.toISOString().slice(0, 10);

const params = new URLSearchParams({
  period: '1y',
  rebalanceFreq: 'monthly',
  topN: '10',
  strategy,
  initialCapital: '10000',
  optimize: 'false',
  _t: String(Date.now())
});

const url = `${BASE}/api/backtest/${universe}?${params}`;
console.error('GET', url);

const res = await fetch(url);
const text = await res.text();
let data;
try {
  data = JSON.parse(text);
} catch {
  console.error('Non-JSON response:', text.slice(0, 400));
  process.exit(1);
}

if (!data.success) {
  console.error('Backtest failed:', data.error || data);
  process.exit(1);
}

const log = data.adaptiveWeightLog;
if (!log || !Array.isArray(log) || log.length === 0) {
  console.log(JSON.stringify({
    note: 'No adaptiveWeightLog in response. Set ADAPTIVE_WEIGHT_LOG=1, restart server, re-run backtest.',
    universe,
    strategy
  }, null, 2));
  process.exit(0);
}

const recent = log.filter((e) => e.date >= cutoffStr);
const rows = (recent.length ? recent : log).map((e) => ({
  date: e.date,
  fundIc: e.meanIcByFactor?.fundamental != null ? e.meanIcByFactor.fundamental.toFixed(3) : null,
  momRegime: e.momentumRegime?.tag ?? null,
  rsi: e.momentumRegime?.rsi != null ? e.momentumRegime.rsi.toFixed(1) : null,
  wFund: e.weightsAfter?.fundamental != null ? (e.weightsAfter.fundamental * 100).toFixed(1) + '%' : null,
  pivotedAwayFromQuality: Boolean(e.pivotedAwayFromQuality)
}));

console.log(JSON.stringify({ universe, strategy, cutoffStr, rows, count: rows.length }, null, 2));
