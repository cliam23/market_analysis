#!/usr/bin/env node
/**
 * Golden parity check for GET /api/backtest (see server/README.md).
 * Usage:
 *   node scripts/verify-golden.mjs              # compare live to scripts/golden-baseline.json
 *   node scripts/verify-golden.mjs --capture   # write baseline from live (requires server)
 * Env: BACKTEST_GOLDEN_BASE (default http://127.0.0.1:3001)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = path.join(__dirname, 'golden-baseline.json');

const DEFAULT_URL =
  '/api/backtest/sp500_top150?period=1y&rebalanceFreq=bimonthly&topN=15&strategy=full_composite&rlAgent=false&fresh=true';

const RETURN_TOL = 0.15; // percent points on performance.totalReturn string
const SHARPE_TOL = 0.15;

function num(s) {
  const x = parseFloat(String(s ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(x) ? x : NaN;
}

async function main() {
  const base = (process.env.BACKTEST_GOLDEN_BASE || 'http://127.0.0.1:3001').replace(/\/$/, '');
  const capture = process.argv.includes('--capture');

  const url = `${base}${DEFAULT_URL}`;
  const res = await fetch(url);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error('Invalid JSON from', url);
    console.error(text.slice(0, 500));
    process.exit(1);
  }

  if (!res.ok || data.success === false) {
    console.error('Request failed:', res.status, data.error || data);
    process.exit(1);
  }

  const snap = {
    capturedAt: new Date().toISOString(),
    url: DEFAULT_URL,
    totalReturn: num(data.performance?.totalReturn),
    sharpe: num(data.performance?.sharpe),
    equityCurveRows: Array.isArray(data.equityCurve) ? data.equityCurve.length : null,
    computedAt: data.computedAt || null
  };

  if (capture) {
    writeFileSync(BASELINE_PATH, JSON.stringify(snap, null, 2), 'utf-8');
    console.log('Wrote', BASELINE_PATH);
    console.log(JSON.stringify(snap, null, 2));
    process.exit(0);
  }

  if (!existsSync(BASELINE_PATH)) {
    console.error('Missing', BASELINE_PATH, '— run: node scripts/verify-golden.mjs --capture');
    process.exit(1);
  }

  const expected = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
  if (expected.totalReturn == null || expected.sharpe == null || !Number.isFinite(expected.totalReturn)) {
    console.error('Baseline not initialized — run with server up: node scripts/verify-golden.mjs --capture');
    process.exit(1);
  }
  const dr = Math.abs(snap.totalReturn - expected.totalReturn);
  const ds = Math.abs(snap.sharpe - expected.sharpe);

  const okR = dr <= RETURN_TOL;
  const okS = ds <= SHARPE_TOL;

  console.log('Live:', { totalReturn: snap.totalReturn, sharpe: snap.sharpe, equityCurveRows: snap.equityCurveRows });
  console.log('Baseline:', { totalReturn: expected.totalReturn, sharpe: expected.sharpe });
  console.log('Delta:', { dReturn: dr, dSharpe: ds, tol: { return: RETURN_TOL, sharpe: SHARPE_TOL } });

  if (!okR || !okS) {
    console.error('GOLDEN CHECK FAILED');
    process.exit(1);
  }
  console.log('GOLDEN OK');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
