#!/usr/bin/env node
/**
 * Populate data/gold/bars/*.json from Yahoo (same shape as backtest chart rows).
 * Requires: server not needed; uses yahoo-finance2 directly.
 *
 *   node scripts/warm-gold.mjs --universe sp500_top150 --years 5
 * Env: YAHOO delay: sleep 40ms between tickers (edit below if 429s)
 */
import yf from 'yahoo-finance2';
import { UNIVERSE_TICKERS } from '../server/config/universes.js';
import { yahooApiSymbol } from '../server/data/yahoo-parse.js';
import { writeGoldBars, ensureGoldBarsDir, goldDateRangeForYears } from '../server/data/gold-bars-store.js';

const yahooFinance = new yf({ suppressNotices: ['yahooSurvey'] });

const DELAY_MS = 50;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mapQuotes(result) {
  if (!result || !result.quotes || result.quotes.length === 0) return null;
  return result.quotes
    .filter((q) => q.date && q.close)
    .map((q) => {
      const c = q.close;
      const hi = q.high != null && Number.isFinite(q.high) ? q.high : c;
      const lo = q.low != null && Number.isFinite(q.low) ? q.low : c;
      const op = q.open != null && Number.isFinite(q.open) ? q.open : c;
      return {
        date: typeof q.date === 'string' ? q.date.substring(0, 10) : q.date.toISOString().substring(0, 10),
        close: c,
        high: hi,
        low: lo,
        open: op
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchChart(ticker, startDate, endDate) {
  const result = await yahooFinance.chart(yahooApiSymbol(ticker), {
    period1: startDate,
    period2: endDate,
    interval: '1d'
  });
  return mapQuotes(result);
}

function parseArgs() {
  const a = process.argv.slice(2);
  let universe = 'sp500_top150';
  let years = 5;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--universe' && a[i + 1]) {
      universe = a[i + 1];
      i++;
    } else if (a[i] === '--years' && a[i + 1]) {
      years = parseFloat(a[i + 1]) || 5;
      i++;
    }
  }
  return { universe, years };
}

async function main() {
  const { universe, years } = parseArgs();
  const tickers = UNIVERSE_TICKERS[universe];
  if (!tickers?.length) {
    console.error('Unknown universe:', universe);
    process.exit(1);
  }
  const { startDateStr, endDateStr } = goldDateRangeForYears(years);
  ensureGoldBarsDir();
  let ok = 0;
  let fail = 0;
  for (const t of tickers) {
    try {
      const rows = await fetchChart(t, startDateStr, endDateStr);
      if (rows?.length) {
        writeGoldBars(t, rows);
        console.log('OK', t, rows.length, 'rows');
        ok++;
      } else {
        console.warn('EMPTY', t);
        fail++;
      }
    } catch (e) {
      console.warn('FAIL', t, e.message);
      fail++;
    }
    await sleep(DELAY_MS);
  }
  console.log('Done. ok=', ok, 'fail=', fail);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
