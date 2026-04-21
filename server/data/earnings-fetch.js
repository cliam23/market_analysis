import path from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { EARNINGS_DISK_CACHE_DIR } from '../config/paths.js';
import { EARNINGS_DISK_CACHE_TTL_MS, YAHOO_QUOTE_SUMMARY_MODULE_OPTS } from '../config/constants.js';
import { yfNum, yahooApiSymbol } from './yahoo-parse.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function earningsCacheFilePath(ticker) {
  return path.join(EARNINGS_DISK_CACHE_DIR, `${String(ticker).toUpperCase()}.json`);
}

function readEarningsDiskCache(ticker) {
  const fp = earningsCacheFilePath(ticker);
  if (!existsSync(fp)) return null;
  try {
    const raw = JSON.parse(readFileSync(fp, 'utf8'));
    if (!raw || !raw.fetchedAt) return null;
    const t = new Date(raw.fetchedAt).getTime();
    if (Number.isNaN(t) || Date.now() - t > EARNINGS_DISK_CACHE_TTL_MS) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeEarningsDiskCache(ticker, payload) {
  try {
    mkdirSync(EARNINGS_DISK_CACHE_DIR, { recursive: true });
    writeFileSync(earningsCacheFilePath(ticker), JSON.stringify(payload, null, 2), 'utf8');
  } catch (e) {
    console.warn('[earnings] disk cache write failed:', e.message);
  }
}

/** Quarter end / label from Yahoo earningsHistory row. */
function normalizeEarningsHistoryRowDate(row) {
  if (!row || typeof row !== 'object') return null;
  const q = row.quarter;
  if (q instanceof Date && !Number.isNaN(q.getTime())) return q.toISOString().slice(0, 10);
  if (typeof q === 'string') {
    const m = q.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const d = row.date;
  if (d && typeof d === 'object' && d.fmt) return String(d.fmt).slice(0, 10);
  if (typeof d === 'string') return d.slice(0, 10);
  if (typeof row.period === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.period)) return row.period;
  if (typeof row.period === 'string' && /^\d{8}$/.test(row.period)) {
    const s = row.period;
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return row.period != null ? String(row.period) : null;
}

/**
 * Parse quoteSummary modules earningsHistory + earningsTrend (yahoo-finance2 bundle or v10 result[0]).
 * Returns null if earningsTrend is unusable (per product rule).
 */
function parseYahooEarningsQuoteSummary(ticker, json) {
  const err = json?.quoteSummary?.error;
  if (err) return null;
  let r0 = json?.quoteSummary?.result?.[0];
  if (!r0 && json?.earningsHistory) r0 = json;
  if (!r0) return null;
  const trendArr = r0.earningsTrend?.trend;
  if (!Array.isArray(trendArr) || trendArr.length === 0) return null;
  const hist = r0.earningsHistory?.history;
  if (!Array.isArray(hist) || hist.length === 0) return null;

  const sortedHist = [...hist]
    .map((h) => ({ h, d: normalizeEarningsHistoryRowDate(h) || '' }))
    .filter((x) => x.d)
    .sort((a, b) => b.d.localeCompare(a.d));
  const last4 = sortedHist.slice(0, 4);

  const quarters = last4.map(({ h, d }) => {
    const epsActual = yfNum(h.epsActual);
    const epsEstimate = yfNum(h.epsEstimate);
    const revenue = yfNum(h.revenueActual ?? h.revenue);
    let surprise = null;
    if (epsEstimate != null && epsEstimate !== 0 && epsActual != null) {
      surprise = (epsActual - epsEstimate) / epsEstimate;
    } else {
      const sp = yfNum(h.surprisePercent);
      if (sp != null && Number.isFinite(sp)) {
        surprise = Math.abs(sp) > 1.5 ? sp / 100 : sp;
      }
    }
    return {
      date: d,
      epsActual: epsActual != null && Number.isFinite(epsActual) ? epsActual : null,
      epsEstimate: epsEstimate != null && Number.isFinite(epsEstimate) ? epsEstimate : null,
      surprise: surprise != null && Number.isFinite(surprise) ? parseFloat(surprise.toFixed(6)) : null,
      revenue: revenue != null && revenue > 0 ? revenue : null
    };
  });

  const pickTrend = (period) => trendArr.find((t) => String(t?.period) === period) || null;
  const t0 = pickTrend('0q');
  const t1 = pickTrend('+1q');
  const trendRowEpsEstimate = (t) => yfNum(t?.earningsEstimate?.avg) ?? yfNum(t?.epsTrend?.current);
  const trendRowEps90dAgo = (t) => yfNum(t?.epsTrend?.['90daysAgo']);

  const epsTrend = {
    currentQtrEstimate: trendRowEpsEstimate(t0),
    currentQtr90dAgoEstimate: trendRowEps90dAgo(t0),
    nextQtrEstimate: trendRowEpsEstimate(t1),
    nextQtr90dAgoEstimate: trendRowEps90dAgo(t1)
  };

  return {
    ticker: String(ticker).toUpperCase(),
    fetchedAt: new Date().toISOString().split('T')[0],
    quarters,
    epsTrend
  };
}

/**
 * @param {{ yahooFinance: import('yahoo-finance2').default, fetchWithTimeout: (fn: () => Promise<unknown>, ms?: number) => Promise<unknown> }} deps
 */
export function createEarningsFetchers(deps) {
  const { yahooFinance, fetchWithTimeout } = deps;

  async function fetchYahooEarningsQuoteSummaryModules(ticker) {
    const apiSym = yahooApiSymbol(ticker);
    return fetchWithTimeout(
      () =>
        yahooFinance.quoteSummary(apiSym, { modules: ['earningsHistory', 'earningsTrend'] }, YAHOO_QUOTE_SUMMARY_MODULE_OPTS),
      15000
    );
  }

  async function fetchEarningsHistory(ticker) {
    const upper = String(ticker || '')
      .trim()
      .toUpperCase();
    if (!upper) return null;
    if (upper === 'SPY') return null;

    const cached = readEarningsDiskCache(upper);
    if (cached && cached.failed === true) {
      return null;
    }
    if (cached && Array.isArray(cached.quarters) && cached.epsTrend) {
      return { ticker: upper, fetchedAt: cached.fetchedAt, quarters: cached.quarters, epsTrend: cached.epsTrend };
    }

    let modules;
    try {
      modules = await fetchYahooEarningsQuoteSummaryModules(upper);
    } catch (e) {
      const reason = String(e?.message || e || 'error');
      console.warn(`[earnings] fetch failed ${upper}:`, reason);
      writeEarningsDiskCache(upper, { ticker: upper, failed: true, reason, fetchedAt: new Date().toISOString() });
      return null;
    }

    const parsed = parseYahooEarningsQuoteSummary(upper, modules);
    if (!parsed) {
      writeEarningsDiskCache(upper, {
        ticker: upper,
        failed: true,
        reason: 'parseYahooEarningsQuoteSummary returned null (no trend/history)',
        fetchedAt: new Date().toISOString()
      });
      return null;
    }
    writeEarningsDiskCache(upper, parsed);
    return parsed;
  }

  async function fetchAllEarnings(tickers) {
    const uniq = [
      ...new Set((tickers || []).map((t) => String(t).trim().toUpperCase()).filter(Boolean))
    ].filter((t) => t !== 'SPY');
    const out = new Map();
    const batchSize = 5;
    const earningsProgressLog =
      process.env.EARNINGS_FETCH_PROGRESS === '1' ||
      String(process.env.EARNINGS_FETCH_PROGRESS || '').toLowerCase() === 'true';
    for (let i = 0; i < uniq.length; i += batchSize) {
      const batch = uniq.slice(i, i + batchSize);
      const done = Math.min(i + batch.length, uniq.length);
      if (earningsProgressLog) {
        console.log(`Fetching earnings: ${done}/${uniq.length}...`);
      }
      const rows = await Promise.all(batch.map((t) => fetchEarningsHistory(t)));
      for (let j = 0; j < batch.length; j++) out.set(batch[j], rows[j]);
      if (i + batchSize < uniq.length) await sleep(50);
    }
    return out;
  }

  return { fetchYahooEarningsQuoteSummaryModules, fetchEarningsHistory, fetchAllEarnings };
}
