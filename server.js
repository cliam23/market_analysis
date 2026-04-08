import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import yf from 'yahoo-finance2';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import readline from 'readline';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import {
  safeNum, billions, calcMoatAnalysis, calcAIDisruption,
  calcROICSensitivity, calcProfitabilityPath, calcGrowthConstraints,
  getPeers, calculateComps, calcEarningsQuality, calcTotalShareholderYield, calcComposite,
  calcCompositeRules,
  buildMlFeatureVector, packMlFundRankRow,
  spyAbove200dma, regimeAdjustedCompositeWeights
} from './analysis-engine.js';
import {
  RollingAdaptiveState,
  composeAdaptiveWeightsForRebalance,
  rebuildRollingStateFromRebalanceHistory
} from './adaptiveWeights.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ML_PREDICT_SCRIPT = path.join(__dirname, 'ml', 'predict.py');
const ML_WORKER_SCRIPT = path.join(__dirname, 'ml', 'predict_worker.py');

const app = express();
const PORT = Number(process.env.PORT) || 3001;
app.use(cors());
app.use(express.json());

const yahooFinance = new yf({ 
  suppressNotices: ['yahooSurvey'] 
});

/** Yahoo often returns fields that fail strict schemas (e.g. null currency); skip result validation and coerce in our parsers. */
const YAHOO_QUOTE_SUMMARY_MODULE_OPTS = { validateResult: false };

// Suppress all console output from yahoo-finance2 about deprecated APIs
try {
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalLog = console.log;
  
  const suppressPattern = /fundamentalsTimeSeries|financial statements submodules|QuoteSummary financial statements/i;
  
  console.error = (...args) => {
    if (suppressPattern.test(args[0]?.toString?.() || '')) return;
    originalError.apply(console, args);
  };
  
  console.warn = (...args) => {
    if (suppressPattern.test(args[0]?.toString?.() || '')) return;
    originalWarn.apply(console, args);
  };
  
  console.log = (...args) => {
    if (suppressPattern.test(args[0]?.toString?.() || '')) return;
    originalLog.apply(console, args);
  };
} catch(e) {
  // Ignore if console patching fails
}

// Helper: safely extract number from Yahoo Finance (handles {raw, fmt} objects)
function yfNum(val, def = null) {
  if (val == null || val === '' || (typeof val === 'number' && isNaN(val))) return def;
  if (typeof val === 'number') return val;
  if (typeof val === 'object') {
    if (val.raw != null) return typeof val.raw === 'number' ? val.raw : parseFloat(val.raw) || def;
    if (val.toString) return parseFloat(val.toString().replace(/[^0-9.-]/g, '')) || def;
  }
  if (typeof val === 'string') return parseFloat(val.replace(/[^0-9.-]/g, '')) || def;
  return def;
}

const UNIVERSES = {
  sp500_top50: ["AAPL","MSFT","AMZN","NVDA","GOOGL","META","BRK-B","LLY","AVGO","JPM","TSLA","UNH","XOM","V","MA","PG","COST","JNJ","HD","ABBV","WMT","NFLX","BAC","KO","MRK","CRM","CVX","AMD","PEP","LIN","TMO","ADBE","ACN","MCD","CSCO","ABT","WFC","DHR","TXN","QCOM","ISRG","PM","INTU","GE","AMAT","AMGN","NEE","RTX","PFE","LOW"],
  sp500_full: ["AAPL","MSFT","AMZN","NVDA","GOOGL","META","BRK-B","LLY","AVGO","JPM","TSLA","UNH","XOM","V","MA","PG","COST","JNJ","HD","ABBV","WMT","NFLX","BAC","KO","MRK","CRM","CVX","AMD","PEP","LIN","TMO","ADBE","ACN","MCD","CSCO","ABT","WFC","DHR","TXN","QCOM","ISRG","PM","INTU","GE","AMAT","AMGN","NEE","RTX","PFE","LOW"],
  vgt: ["AAPL","MSFT","NVDA","AVGO","AMD","ADBE","CRM","ACN","CSCO","TXN","QCOM","INTU","AMAT","ADI","LRCX","KLAC","SNPS","CDNS","MRVL","FTNT","PANW","NOW","WDAY","TEAM","DDOG","ZS","CRWD","HUBS","TTD","NET"],
  russell_growth: ["DECK","AXON","FIX","TOST","DUOL","CAVA","CELH","ELF","BIRK","ONON","LULU","MNDY","PCVX","IOT","RELY","FRPT","KRYS","ACLX","DOC","CFLT"],
  dividend_aristocrats: ["JNJ","PG","KO","PEP","ABBV","MCD","WMT","LOW","CL","SHW","EMR","GD","ADP","AFL","ECL","CTAS","SWK","GWW","APD","BDX"],
  mag7: ["AAPL","MSFT","AMZN","NVDA","GOOGL","META","TSLA"]
};

const MOMENTUM_CACHE = new Map();
const NETWORK_INPUT_CACHE = new Map();
const COMPS_CACHE = new Map();
const QUOTE_CACHE = new Map();
const BACKTEST_CACHE = new Map();
const CACHE_TTL = 15 * 60 * 1000;
const COMPS_CACHE_TTL = 30 * 60 * 1000;
/** Yahoo quote/full-summary bundle — memory + disk (see .cache/yahoo/) */
const QUOTE_CACHE_TTL = 4 * 60 * 60 * 1000;
const BACKTEST_CACHE_TTL = 60 * 60 * 1000; // 1 hour
/** Bump when backtest sim inputs/outputs change (cache invalidation). */
const BACKTEST_CACHE_VERSION = 'v34';

/** Only treat financials as knowable this many days after quarter-end (SEC filing lag heuristic). */
const FILING_LAG_DAYS = 45;
/** PIT fallback: if snapshot older than this vs rebalance date, halve fundamental pillar weights. */
const STALENESS_PENALTY_DAYS = 120;
/** Weakest name in new top-N must score >= held * (1 + this) to displace a holding (when challengers exist). */
const TURNOVER_SCORE_IMPROVEMENT_THRESHOLD = 0.25;
/** Min calendar days in position before a rebalance SELL (not STOP) may exit. */
const MIN_HOLD_DAYS_BEFORE_SELL = 45;
/** Extra names above adjustedTopN allowed before forced trim bypasses min-hold. */
const HOLDINGS_OVERFLOW_SLOTS = 3;
/** After a voluntary SELL, block re-opening the same ticker for this many days. */
const REBUY_COOLDOWN_DAYS = 60;
/** Min days after STOP before re-entry is considered. */
const RE_ENTRY_MIN_WAIT_DAYS = 45;
/** Skip STOP re-entry if next scheduled rebalance is sooner than this (days). */
const RE_ENTRY_MIN_DAYS_TO_NEXT_REBALANCE = 10;

function turnoverDebugEnabled() {
  const v = process.env.TURNOVER_DEBUG;
  return v === '1' || String(v || '').toLowerCase() === 'true';
}
/** Max portfolio weight per name after sizing (composite backtest / paper). */
const MAX_POSITION_WEIGHT_BACKTEST = 0.10;
/** Trailing stop: peak must be this much above entry before giveback rule can fire. */
const TRAILING_STOP_MIN_PEAK_GAIN = 0.25;
/** Trailing stop: giveback floor vs entry = entry * (1 + this) once min peak gain is met. */
const TRAILING_STOP_FLOOR = 0.1;
/** Skip trailing giveback until position is at least this many calendar days old. */
const TRAILING_STOP_MIN_HOLD_DAYS = 60;

function trailingStopEnabled() {
  const v = process.env.TRAILING_STOP_ENABLED;
  if (v === undefined || v === null || String(v).trim() === '') return false;
  return v === '1' || String(v).toLowerCase() === 'true';
}

/** Bust backtest cache when env-driven ranking (adaptive IC, ML) changes — otherwise UI can show stale returns vs current server config. */
function backtestSimConfigCacheTag(extra = {}) {
  const icp = process.env.ROLLING_IC_PERIODS || '12';
  const ridge = process.env.ADAPTIVE_RIDGE === '1' || String(process.env.ADAPTIVE_RIDGE || '').toLowerCase() === 'true' ? '1' : '0';
  const rl = process.env.ADAPTIVE_RIDGE_LAMBDA || '1';
  const mla = mlAlphaRankingEnabled() ? '1' : '0';
  const mlc = mlCompositeClusterEnabled() ? '1' : '0';
  const mlwRaw = parseFloat(process.env.ML_RANK_WEIGHT || '0');
  const mlw = Number.isFinite(mlwRaw) ? mlwRaw : 0;
  const am = extra.adaptiveMode || 'fixed';
  const ps = extra.positionSizing || 'invVol';
  const tr = trailingStopEnabled() ? '1' : '0';
  const pit = extra.pitPolicy || 'none';
  const re = extra.regimeEnabled === false ? '0' : '1';
  const po = extra.pillarOverrideKey != null ? String(extra.pillarOverrideKey) : 'none';
  const skml = extra.skipMlRankingAdjustments === false ? '0' : '1';
  return `ic${icp}-rdg${ridge}-${rl}-mla${mla}-mlc${mlc}-mlw${mlw}-am${am}-ps${ps}-tr${tr}-pit${pit}-re${re}-po${po}-skml${skml}`;
}

const YAHOO_DISK_CACHE_DIR = path.join(__dirname, '.cache', 'yahoo');
const QUOTE_BATCH_CHUNK = 50;
const YAHOO_CHART_CONCURRENCY = 10;
const FUNDAMENTALS_FETCH_CONCURRENCY = 8;

function readQuoteDiskCache(ticker) {
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

function writeQuoteDiskCache(ticker, data) {
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

/** Batch Yahoo quote — one round-trip per chunk. */
async function fetchYahooQuotesBatch(symbols) {
  const out = new Map();
  const uniq = [...new Set(symbols.map((s) => String(s).toUpperCase()).filter(Boolean))];
  for (let i = 0; i < uniq.length; i += QUOTE_BATCH_CHUNK) {
    const chunk = uniq.slice(i, i + QUOTE_BATCH_CHUNK);
    try {
      const rows = await yahooFinance.quote(chunk);
      const arr = Array.isArray(rows) ? rows : (rows ? [rows] : []);
      for (const row of arr) {
        const sym = row?.symbol;
        if (sym) out.set(String(sym).toUpperCase(), row);
      }
    } catch (e) {
      console.warn('Yahoo batch quote failed:', e.message);
    }
  }
  return out;
}

function mergeLiveQuoteIntoResult(result, q) {
  if (!q || typeof q !== 'object') return result;
  const price = yfNum(q.regularMarketPrice);
  if (price != null && price > 0) result.price = price;
  const b = yfNum(q.beta);
  if (b != null && Number.isFinite(b)) result.beta = b;
  const mc = yfNum(q.marketCap);
  if (mc != null && mc > 0) result.marketCap = mc;
  if (q.shortName || q.longName) result.name = q.shortName || q.longName || result.name;
  if (q.sector) result.sector = q.sector;
  if (q.industry) result.industry = q.industry;
  const sh = yfNum(q.sharesOutstanding);
  if (sh != null && sh > 0) result.sharesOutstanding = sh;
  return result;
}

/** Parallel map with max concurrency (pool of workers). */
async function mapWithConcurrency(items, limit, mapper) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await mapper(items[i], i);
      } catch (err) {
        results[i] = { __error: err };
      }
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

let mlPredictChain = Promise.resolve();

/** Persistent Python worker: one request at a time (mlPredictChain serializes). */
let mlWorkerProc = null;
let mlWorkerReader = null;
let mlWorkerCurrentResolve = null;
let mlWorkerTimeout = null;

function resetMlWorker(reason) {
  if (reason) console.warn('ML predict worker reset:', reason);
  if (mlWorkerTimeout) {
    clearTimeout(mlWorkerTimeout);
    mlWorkerTimeout = null;
  }
  if (mlWorkerReader) {
    try {
      mlWorkerReader.close();
    } catch {
      /* ignore */
    }
    mlWorkerReader = null;
  }
  if (mlWorkerProc && !mlWorkerProc.killed) {
    try {
      mlWorkerProc.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
  mlWorkerProc = null;
  if (mlWorkerCurrentResolve) {
    const r = mlWorkerCurrentResolve;
    mlWorkerCurrentResolve = null;
    r(null);
  }
}

function ensureMlWorker() {
  if (mlWorkerProc && !mlWorkerProc.killed && mlWorkerReader) return;
  resetMlWorker(null);
  const py = resolvePythonInterpreter();
  mlWorkerProc = spawn(py, [ML_WORKER_SCRIPT], {
    cwd: __dirname,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  mlWorkerReader = readline.createInterface({ input: mlWorkerProc.stdout });
  mlWorkerReader.on('line', (line) => {
    if (!mlWorkerCurrentResolve) return;
    if (mlWorkerTimeout) {
      clearTimeout(mlWorkerTimeout);
      mlWorkerTimeout = null;
    }
    const resolve = mlWorkerCurrentResolve;
    mlWorkerCurrentResolve = null;
    try {
      resolve(JSON.parse(line));
    } catch (e) {
      console.warn('ML worker JSON parse error:', e.message, String(line).slice(0, 200));
      resolve(null);
    }
  });
  mlWorkerProc.stderr.setEncoding('utf8');
  mlWorkerProc.stderr.on('data', (d) => {
    const s = String(d).trim();
    if (s) console.warn('ML worker stderr:', s.slice(0, 400));
  });
  mlWorkerProc.on('error', (err) => {
    console.warn('ML worker spawn error:', err.message);
    resetMlWorker(err.message);
  });
  const procRef = mlWorkerProc;
  procRef.on('close', (code) => {
    if (mlWorkerProc !== procRef) return;
    if (code !== 0 && code != null) {
      resetMlWorker(`exit ${code}`);
    } else {
      mlWorkerProc = null;
      mlWorkerReader = null;
    }
  });
}

function spawnMlPredictPayloadOneshot(payloadObj) {
  return new Promise((resolve) => {
    const py = resolvePythonInterpreter();
    const input = JSON.stringify(payloadObj);
    const proc = spawn(py, [ML_PREDICT_SCRIPT], {
      cwd: __dirname,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const killTimer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, 120000);
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', (err) => {
      clearTimeout(killTimer);
      console.warn('ML predict spawn error:', err.message);
      resolve(null);
    });
    proc.on('close', (code) => {
      clearTimeout(killTimer);
      if (code !== 0) {
        if (stderr) console.warn('ML predict stderr:', String(stderr).slice(0, 500));
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (e) {
        console.warn('ML predict JSON parse error:', e.message);
        resolve(null);
      }
    });
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

function spawnMlPredictPayload(payloadObj) {
  const useWorker = process.env.ML_PREDICT_WORKER !== '0';
  if (!useWorker) {
    return spawnMlPredictPayloadOneshot(payloadObj);
  }
  return new Promise((resolve) => {
    try {
      ensureMlWorker();
      if (!mlWorkerProc?.stdin?.writable) {
        spawnMlPredictPayloadOneshot(payloadObj).then(resolve);
        return;
      }
      if (mlWorkerCurrentResolve) {
        console.warn('ML worker: unexpected concurrent request; falling back to one-shot');
        spawnMlPredictPayloadOneshot(payloadObj).then(resolve);
        return;
      }
      mlWorkerCurrentResolve = resolve;
      mlWorkerTimeout = setTimeout(() => {
        if (mlWorkerCurrentResolve !== resolve) return;
        mlWorkerCurrentResolve = null;
        mlWorkerTimeout = null;
        resetMlWorker('request timeout 120s');
        resolve(null);
      }, 120000);
      mlWorkerProc.stdin.write(`${JSON.stringify(payloadObj)}\n`, (err) => {
        if (err) {
          if (mlWorkerTimeout) {
            clearTimeout(mlWorkerTimeout);
            mlWorkerTimeout = null;
          }
          mlWorkerCurrentResolve = null;
          console.warn('ML worker stdin write error:', err.message);
          resetMlWorker('stdin write failed');
          spawnMlPredictPayloadOneshot(payloadObj).then(resolve);
        }
      });
    } catch (e) {
      console.warn('ML worker error:', e?.message);
      spawnMlPredictPayloadOneshot(payloadObj).then(resolve);
    }
  });
}

async function runMlPredictBatchAsync(featuresRows, sequencesRows) {
  const job = mlPredictChain.then(() => spawnMlPredictPayload({ features: featuresRows, sequences: sequencesRows }));
  mlPredictChain = job.catch(() => null);
  return job;
}

async function runMlPredictAlphaAsync(featuresRows) {
  const job = mlPredictChain.then(() => spawnMlPredictPayload({ model: 'alpha', features: featuresRows }));
  mlPredictChain = job.catch(() => null);
  return job;
}

async function runMlPredictClusterAsync(featuresRows) {
  const job = mlPredictChain.then(() => spawnMlPredictPayload({ model: 'cluster', features: featuresRows }));
  mlPredictChain = job.catch(() => null);
  return job;
}

function mlCompositeClusterEnabled() {
  const v = process.env.ML_COMPOSITE_CLUSTER;
  return v === '1' || String(v).toLowerCase() === 'true';
}

function mlAlphaRankingEnabled() {
  const v = process.env.ML_ALPHA_RANKING;
  return v === '1' || String(v).toLowerCase() === 'true';
}

async function applyMlAlphaRankingToCompositeRankings(rankings, fundamentals, priceHistory, asOfDate, spySeries) {
  if (!mlAlphaRankingEnabled() || !rankings?.length || !spySeries?.length) return rankings;
  const features = [];
  for (const row of rankings) {
    const fund = fundamentals[row.ticker];
    const packed = packMlFundRankRow(fund, row, {
      priceSeries: priceHistory[row.ticker],
      asOfDate,
      benchmarkSeries: spySeries
    });
    if (!packed) return rankings;
    features.push(packed.vector);
  }
  const pred = await runMlPredictAlphaAsync(features);
  if (!pred?.ok || !Array.isArray(pred.alphaScore0to100) || pred.alphaScore0to100.length !== rankings.length) {
    return rankings;
  }
  return rankings
    .map((r, i) => ({
      ...r,
      rulesCompositeScore: r.compositeScore,
      predictedAlpha: pred.predictedAlpha != null ? pred.predictedAlpha[i] : undefined,
      compositeScore: pred.alphaScore0to100[i]
    }))
    .sort((a, b) => b.compositeScore - a.compositeScore);
}

/**
 * Fallback when FRED CPI is unavailable (~3%/yr compound, not official CPI).
 * Primary baseline uses FRED series CPIAUCSL (BLS CPI via St. Louis Fed).
 */
const INFLATION_BASELINE_ANNUAL = 0.03;

const FRED_CPI_SERIES_ID = 'CPIAUCSL';
const FRED_OBSERVATIONS_URL = 'https://api.stlouisfed.org/fred/series/observations';
const CPI_OBSERVATIONS_CACHE = new Map();
const CPI_OBSERVATIONS_TTL_MS = 6 * 60 * 60 * 1000;

function calcBuffettScore(data) {
  const scores = {};
  const criteria = {};

  const marketCap = safeNum(data.marketCap);
  const price = safeNum(data.price);
  const sharesOutstanding = safeNum(data.sharesOutstanding);
  const operatingCF = safeNum(data.operatingCashflow);
  const capex = safeNum(data.capitalExpenditures);
  const beta = safeNum(data.beta, 1);
  const trailingEPS = safeNum(data.trailingEPS);
  const forwardEPS = safeNum(data.forwardEPS);
  const totalCash = safeNum(data.totalCash);
  const totalDebt = safeNum(data.totalDebt);
  const grossMargin = safeNum(data.grossMargin, 0) * 100;  // Convert decimal to percent
  const operatingMargin = safeNum(data.operatingMargin, 0) * 100;  // Convert decimal to percent
  const profitMargin = safeNum(data.profitMargin, 0) * 100;  // Convert decimal to percent
  const roe = safeNum(data.roe, 0) * 100;  // Convert decimal to percent
  const payoutRatio = safeNum(data.payoutRatio, 0) * 100;
  const repurchase = safeNum(data.repurchaseOfStock);
  const forwardPE = safeNum(data.forwardPE);
  const totalRevenue = safeNum(data.totalRevenue);
  const netIncome = safeNum(data.netIncome);

  const calcGrossMargin = grossMargin;
  const calcOperatingMargin = operatingMargin;
  const calcProfitMargin = profitMargin;
  const calcROE = roe;

  const ownerEarnings = operatingCF + capex;
  const ownerEarningsYield = marketCap > 0 ? (ownerEarnings / marketCap) * 100 : 0;
  const riskFreeRate = 4.3;
  
  let oeScore = 4;
  if (ownerEarningsYield >= 8.6) oeScore = 20;
  else if (ownerEarningsYield >= 6.5) oeScore = 16;
  else if (ownerEarningsYield >= 4.3) oeScore = 12;
  else if (ownerEarningsYield >= 2.15) oeScore = 8;
  
  scores.ownerEarnings = oeScore;
  criteria.ownerEarnings = {
    pass: oeScore >= 12,
    value: ownerEarningsYield.toFixed(1),
    multiplier: riskFreeRate > 0 ? (ownerEarningsYield / riskFreeRate).toFixed(1) : 'N/A'
  };

  const normalizedEPS = forwardEPS > 0 && trailingEPS > 0 
    ? (forwardEPS + trailingEPS) / 2 
    : (forwardEPS > 0 ? forwardEPS : (trailingEPS > 0 ? trailingEPS : price * 0.08));
  
  let wacc = 9.5;
  if (beta < 0.8) wacc = 8;
  else if (beta > 1.3) wacc = 11;
  
  const multiplier = Math.min(1 / (wacc / 100), 15);
  const netCashPerShare = sharesOutstanding > 0 ? (totalCash - totalDebt) / sharesOutstanding : 0;
  const intrinsicValue = normalizedEPS * multiplier + netCashPerShare;
  const marginOfSafety = price > 0 ? ((intrinsicValue - price) / price) * 100 : 0;
  
  let mosScore = 4;
  if (marginOfSafety >= 25) mosScore = 20;
  else if (marginOfSafety >= 15) mosScore = 16;
  else if (marginOfSafety >= 5) mosScore = 12;
  else if (marginOfSafety >= 0) mosScore = 8;
  
  scores.marginOfSafety = mosScore;
  criteria.marginOfSafety = {
    pass: mosScore >= 12,
    value: marginOfSafety.toFixed(1),
    iv: intrinsicValue.toFixed(2)
  };

  const signals = [
    forwardEPS > trailingEPS,
    calcOperatingMargin > 0,
    calcProfitMargin > 0,
    safeNum(data.earningsGrowth, 0) > -1 && safeNum(data.earningsGrowth, 0) < 2.5
  ];
  const signalCount = signals.filter(Boolean).length;
  
  let ecScore = 3;
  if (signalCount === 4) ecScore = 15;
  else if (signalCount === 3) ecScore = 11;
  else if (signalCount === 2) ecScore = 7;
  
  scores.earningsConsistency = ecScore;
  criteria.earningsConsistency = {
    pass: ecScore >= 9,
    value: `${signalCount}/4`,
    signals: {
      growth: forwardEPS > trailingEPS,
      opMargin: calcOperatingMargin > 0,
      netMargin: calcProfitMargin > 0,
      peg: safeNum(data.earningsGrowth, 0) > -1 && safeNum(data.earningsGrowth, 0) < 2.5
    }
  };

  let roeSub = 0;
  if (calcROE > 15) roeSub = 3.75;
  else if (calcROE > 10) roeSub = 2.5;
  else if (calcROE > 5) roeSub = 1.25;
  
  // Check buybacks: from cashflow if available, else infer from high ROE + low book value
  const buybacksFromCF = repurchase < 0;
  const buybacksInferred = calcROE > 40 && data.bookValue < 30;  // High ROE with moderate book value suggests buybacks
  const hasBuybacks = buybacksFromCF || buybacksInferred;
  const buybackSub = hasBuybacks ? 3.75 : 1;
  
  let payoutSub = 0;
  if (payoutRatio < 40) payoutSub = 3.75;
  else if (payoutRatio < 60) payoutSub = 2.5;
  else if (payoutRatio < 80) payoutSub = 1.25;
  
  const mqScore = Math.round(roeSub + buybackSub + payoutSub + 0.5);
  
  scores.managementQuality = mqScore;
  const buybackDisplay = buybacksFromCF ? 'Yes (CF)' : (buybacksInferred ? 'Yes (inferred)' : 'No');
  criteria.managementQuality = {
    pass: mqScore >= 9,
    roe: calcROE.toFixed(1),
    buyback: buybackDisplay,
    payout: payoutRatio.toFixed(0) + '%'
  };

  const effectiveGM = calcGrossMargin || grossMargin;
  let bsScore = 3;
  if (effectiveGM >= 60) bsScore = 15;
  else if (effectiveGM >= 40) bsScore = 12;
  else if (effectiveGM >= 25) bsScore = 8;
  else if (effectiveGM >= 15) bsScore = 5;
  
  scores.businessSimplicity = bsScore;
  criteria.businessSimplicity = {
    pass: bsScore >= 8,
    value: effectiveGM.toFixed(1)
  };

  const dcaSignals = [
    calcROE > 15,
    calcOperatingMargin > 15,
    effectiveGM > 40
  ];
  const dcaCount = dcaSignals.filter(Boolean).length;
  
  let dcaScore = 3;
  if (dcaCount === 3) dcaScore = 15;
  else if (dcaCount === 2) dcaScore = 10;
  else if (dcaCount === 1) dcaScore = 6;
  
  scores.durableAdvantage = dcaScore;
  criteria.durableAdvantage = {
    pass: dcaScore >= 10,
    value: `${dcaCount}/3`,
    signals: {
      roe: calcROE > 15,
      opMargin: calcOperatingMargin > 15,
      grossMargin: effectiveGM > 40
    }
  };

  const totalBuffett = Object.values(scores).reduce((a, b) => a + b, 0);
  
  return { scores, criteria, total: totalBuffett, wacc, intrinsicValue };
}

function calcROIC(data) {
  const price = safeNum(data.price);
  const sharesOutstanding = safeNum(data.sharesOutstanding);
  const totalRevenue = safeNum(data.totalRevenue);
  const totalDebt = safeNum(data.totalDebt);
  const shareholderEquity = safeNum(data.shareholderEquity);
  const totalAssets = safeNum(data.totalAssets);
  const beta = safeNum(data.beta, 1);
  
  // Derive from financialData-based values (now populated in fetchQuoteData)
  const operatingMargin = safeNum(data.operatingMargin, 0);
  const grossMargin = safeNum(data.grossMargin, 0);
  const operatingIncome = safeNum(data.operatingIncome);
  const netIncome = safeNum(data.netIncome);
  const roa = safeNum(data.roa, 0);
  const roe = safeNum(data.roe, 0);
  const bookValuePerShare = safeNum(data.bookValue, 0);
  const totalCash = safeNum(data.totalCash, 0);
  
  // NOPAT: operating income * (1 - tax rate)
  const taxRate = 0.21;
  const nopat = operatingIncome > 0 ? operatingIncome * (1 - taxRate) : (totalRevenue > 0 && operatingMargin > 0 ? totalRevenue * operatingMargin * (1 - taxRate) : 0);
  
  // Book equity method
  const bookEquity = shareholderEquity > 0 ? shareholderEquity : (bookValuePerShare * sharesOutstanding);
  const investedCapital_method1 = totalDebt + bookEquity;
  
  // Check if asset turnover seems too high (indicates buybacks eroded book equity)
  const assetTurnoverCheck = investedCapital_method1 > 0 ? totalRevenue / investedCapital_method1 : 0;
  
  let investedCapital = investedCapital_method1;
  let investedCapitalAdjusted = false;
  let adjustmentReason = "";
  
  if (assetTurnoverCheck > 3.0 || (roe > 1.0 && bookValuePerShare < 20)) {
    // Company has likely eroded book equity through buybacks
    // Use ROA-based estimation instead
    let investedCapital_method2 = 0;
    if (roa > 0 && netIncome > 0) {
      // Total Assets = Net Income / ROA
      const estimatedTotalAssets = netIncome / roa;
      // Invested capital = total assets - excess cash
      const excessCash = Math.max(0, totalCash - totalRevenue * 0.05);  // keep 5% of revenue as operating cash
      investedCapital_method2 = estimatedTotalAssets - excessCash;
    }
    
    // Method 3: Cap asset turnover at 2.0x and back-solve
    const investedCapital_method3 = totalRevenue / 2.0;
    
    // Use the higher of method2 and method3 (more conservative)
    const altCapital = Math.max(investedCapital_method2, investedCapital_method3);
    
    if (altCapital > investedCapital_method1) {
      investedCapital = altCapital;
      investedCapitalAdjusted = true;
      adjustmentReason = "Adjusted for share buyback impact on book equity";
    }
  }
  
  // ROIC
  const roic = investedCapital > 0 ? (nopat / investedCapital) * 100 : 
               (roa > 0 ? roa * 100 * (1 - taxRate) : 0);
  
  let wacc = 9.5;
  if (beta < 0.8) wacc = 8;
  else if (beta > 1.2) wacc = 11;
  
  const spread = roic - wacc;
  
  // NOPAT margin
  const nopatMargin = operatingMargin * (1 - taxRate) * 100;
  
  // Asset turnover
  const assetTurnover = investedCapital > 0 ? totalRevenue / investedCapital : 
                       (totalAssets > 0 ? totalRevenue / totalAssets : 0);
  
  let trend = 'Weak';
  if (roic > 20) trend = 'Strong';
  else if (roic >= 15) trend = 'Solid';
  else if (roic >= 10) trend = 'Moderate';
  
  let lever = 'Maintain operational excellence';
  if (nopatMargin < 15 && assetTurnover > 1.0) lever = 'Margin expansion';
  else if (nopatMargin > 15 && assetTurnover < 0.8) lever = 'Capital efficiency';
  else if (nopatMargin < 15 && assetTurnover < 0.8) lever = 'Margin expansion';
  
  let newROIC = roic;
  if (lever === 'Margin expansion' && nopatMargin > 0) {
    newROIC = ((nopatMargin + 2) / 100) * (assetTurnover || 1) * 100;
  } else if (lever === 'Capital efficiency' && assetTurnover > 0) {
    newROIC = nopatMargin / 100 * (assetTurnover + 0.1) * 100;
  }
  
  return { 
    roic: roic.toFixed(1), 
    wacc, 
    spread: spread.toFixed(1), 
    nopatMargin: nopatMargin.toFixed(1), 
    assetTurnover: assetTurnover.toFixed(2), 
    trend, 
    lever, 
    newROIC: newROIC.toFixed(1),
    investedCapitalAdjusted,
    adjustmentReason,
    grossMargin: grossMargin,
    operatingMargin: operatingMargin
  };
}

function calcProfitability(data) {
  const grossMargin = safeNum(data.grossMargin, 0) * 100;  // Convert decimal to percent
  const beta = safeNum(data.beta, 1);
  const operatingMargin = safeNum(data.operatingMargin, 0) * 100;  // Convert decimal to percent
  const freeCashflow = safeNum(data.freeCashflow);
  const netIncome = safeNum(data.netIncome);
  
  let recurring = 5;
  if (grossMargin >= 60) recurring = 25;
  else if (grossMargin >= 50) recurring = 20;
  else if (grossMargin >= 40) recurring = 15;
  else if (grossMargin >= 25) recurring = 10;
  
  let stability = 5;
  if (beta <= 0.7) stability = 25;
  else if (beta <= 1.0) stability = 20;
  else if (beta <= 1.3) stability = 15;
  else if (beta <= 1.6) stability = 10;
  
  let margin = 5;
  if (operatingMargin >= 25) margin = 25;
  else if (operatingMargin >= 18) margin = 20;
  else if (operatingMargin >= 12) margin = 15;
  else if (operatingMargin >= 5) margin = 10;
  
  const fcfRatio = netIncome !== 0 ? Math.abs(freeCashflow / netIncome) : (freeCashflow > 0 ? 0.8 : 0);
  let conversion = 5;
  if (fcfRatio >= 1.0) conversion = 25;
  else if (fcfRatio >= 0.8) conversion = 20;
  else if (fcfRatio >= 0.6) conversion = 15;
  else if (fcfRatio >= 0.4) conversion = 10;
  
  const total = recurring + stability + margin + conversion;
  
  return {
    recurring, stability, margin, conversion, total,
    gm: grossMargin.toFixed(1),
    beta: beta.toFixed(2),
    opMargin: operatingMargin.toFixed(1),
    fcfRatio: (fcfRatio * 100).toFixed(0) + '%'
  };
}

function calcConstraints(data) {
  const forwardPE = safeNum(data.forwardPE);
  const priceToSales = safeNum(data.priceToSales);
  const debtToEquity = safeNum(data.debtToEquity) || safeNum(data.totalDebtToEquity) || 0;
  const earningsGrowth = safeNum(data.earningsGrowth, 0);
  const forwardEPS = safeNum(data.forwardEPS);
  const trailingEPS = safeNum(data.trailingEPS);
  const sector = (data.sector || '').toLowerCase();
  
  let valuation = 'low';
  if (forwardPE > 30 || priceToSales > 10) valuation = 'high';
  else if (forwardPE > 25 || priceToSales > 7) valuation = 'moderate';
  
  let debt = 'low';
  if (debtToEquity > 150) debt = 'high';
  else if (debtToEquity > 80) debt = 'moderate';
  
  const peg = earningsGrowth !== 0 && forwardPE > 0 ? forwardPE / (earningsGrowth * 100) : 
              (forwardEPS < trailingEPS ? 2.6 : 1.5);
  let growth = 'low';
  if (peg > 2.5 || forwardEPS < trailingEPS) growth = 'high';
  else if (peg > 1.5) growth = 'moderate';
  
  let sectorRisk = 'low';
  if (sector.includes('technology') || sector.includes('healthcare') || sector.includes('financial')) {
    sectorRisk = 'moderate';
  }
  
  const allSeverities = [valuation, debt, growth, sectorRisk];
  const overall = allSeverities.includes('high') ? 'High' : (allSeverities.includes('moderate') ? 'Moderate' : 'Low');
  
  return { valuation, debt, growth, sectorRisk, overall, peg: peg.toFixed(1), fwdPE: forwardPE.toFixed(1), de: debtToEquity.toFixed(0) };
}

function calcEntryTiming(data) {
  const price = safeNum(data.price);
  const week52High = safeNum(data.week52High);
  const twoHundredDayMA = safeNum(data.twoHundredDayMA);
  const forwardPE = safeNum(data.forwardPE);
  const marginOfSafety = safeNum(data.marginOfSafety || 0, 0);
  
  const distanceFromHigh = week52High > 0 ? ((week52High - price) / week52High) * 100 : 0;
  let week52Score = 5;
  if (distanceFromHigh <= 5) week52Score = 0;
  else if (distanceFromHigh <= 15) week52Score = 2;
  else if (distanceFromHigh <= 30) week52Score = 4;
  
  const maDistance = twoHundredDayMA > 0 ? ((price - twoHundredDayMA) / twoHundredDayMA) * 100 : 0;
  let maScore = 4;
  if (maDistance > 10) maScore = 0;
  else if (maDistance >= -10) maScore = 2;
  else if (maDistance >= -15) maScore = 3;
  
  let mosScore = 1;
  if (marginOfSafety >= 16) mosScore = 4;
  else if (marginOfSafety >= 12) mosScore = 3;
  else if (marginOfSafety >= 8) mosScore = 2;
  
  let peScore = 0;
  if (forwardPE > 0 && forwardPE < 12) peScore = 4;
  else if (forwardPE < 18) peScore = 3;
  else if (forwardPE < 25) peScore = 2;
  else if (forwardPE < 35) peScore = 1;
  
  const total = week52Score + maScore + peScore + (maScore === 4 ? 2 : 0);
  
  let signal = 'wait';
  if (total >= 13) signal = 'strong_buy';
  else if (total >= 9) signal = 'buy_zone';
  else if (total >= 5) signal = 'accumulate';
  
  // Overextension warning
  let overextendedWarning = null;
  if (maDistance > 40) {
    overextendedWarning = `Trading ${maDistance.toFixed(0)}% above 200-day MA — extreme overextension with high mean-reversion risk`;
  } else if (maDistance > 25) {
    overextendedWarning = `Trading ${maDistance.toFixed(0)}% above 200-day MA — elevated mean-reversion risk`;
  }
  
  return { 
    week52: week52Score, 
    ma: maScore, 
    mos: mosScore, 
    pe: peScore, 
    total, 
    signal, 
    distance: distanceFromHigh.toFixed(1), 
    maDistance: twoHundredDayMA > 0 ? maDistance.toFixed(1) : 'N/A',
    overextended: maDistance > 40,
    overextendedWarning
  };
}

function calcIntrinsicValue(data, wacc) {
  const price = safeNum(data.price);
  const forwardEPS = safeNum(data.forwardEPS);
  const trailingEPS = safeNum(data.trailingEPS);
  const freeCashflow = safeNum(data.freeCashflow);
  const sharesOutstanding = safeNum(data.sharesOutstanding);
  const bookValue = safeNum(data.bookValue);
  const beta = safeNum(data.beta, 1);
  const totalRevenue = safeNum(data.totalRevenue);
  const netIncome = safeNum(data.netIncome);
  const roe = safeNum(data.roe, 0);
  const totalCash = safeNum(data.totalCash, 0);
  const totalDebt = safeNum(data.totalDebt, 0);
  
  let waccRate = wacc || 9.5;
  if (beta < 0.8) waccRate = 8;
  else if (beta > 1.3) waccRate = 11;
  
  const eps = forwardEPS > 0 ? forwardEPS : (trailingEPS > 0 ? trailingEPS : 0);
  
  // EPV with growth adjustment
  const baseMultiplier = Math.min(1 / (waccRate / 100), 15);
  const growthRate = forwardEPS > 0 && trailingEPS > 0 ? (forwardEPS / trailingEPS - 1) : 0;
  const growthBonus = Math.min(growthRate * 10, 5);
  const adjustedMultiplier = Math.min(baseMultiplier + growthBonus, 25);
  
  // Cap net cash impact
  const netCashPerShare = sharesOutstanding > 0 ? (totalCash - totalDebt) / sharesOutstanding : 0;
  const maxDebtDrag = eps * adjustedMultiplier * 0.20;
  const adjustedNetCash = Math.max(netCashPerShare, -maxDebtDrag);
  
  const epvValue = eps * adjustedMultiplier + adjustedNetCash;
  
  // FCF valuation
  const fcfPerShare = sharesOutstanding > 0 ? freeCashflow / sharesOutstanding : 
                     (totalRevenue > 0 ? freeCashflow / totalRevenue * 0.1 : 0);
  const fcfValue = waccRate > 0 && fcfPerShare > 0 ? fcfPerShare / (waccRate / 100) : 0;
  
  // Graham Number or alternative for buyback-heavy companies
  let grahamValue = 0;
  let method3Label = "Graham Number";
  
  if (bookValue < 10 || roe > 1.0) {
    // Graham Number not applicable — use earnings-based alternative
    const conservativePE = Math.min(forwardEPS > 0 ? (price / forwardEPS) : 20, 20);
    grahamValue = forwardEPS * conservativePE;
    method3Label = "Earnings Multiple";
  } else if (eps > 0 && bookValue > 0) {
    grahamValue = Math.sqrt(22.5 * eps * bookValue);
  }
  
  // Use MEDIAN instead of mean to avoid outlier distortion
  const validValues = [epvValue, fcfValue, grahamValue].filter(v => v > 0 && !isNaN(v));
  let intrinsicValue;
  if (validValues.length === 0) {
    intrinsicValue = epvValue;
  } else if (validValues.length === 1) {
    intrinsicValue = validValues[0];
  } else if (validValues.length === 2) {
    intrinsicValue = (validValues[0] + validValues[1]) / 2;
  } else {
    // Sort and use median
    validValues.sort((a, b) => a - b);
    intrinsicValue = validValues[1];  // Median
  }
  
  const undervaluation = price > 0 && intrinsicValue > 0 ? ((intrinsicValue - price) / price) * 100 : 0;
  
  return {
    epv: epvValue > 0 ? epvValue.toFixed(2) : 'N/A',
    fcf: fcfValue > 0 ? fcfValue.toFixed(2) : 'N/A',
    graham: grahamValue > 0 && !isNaN(grahamValue) ? grahamValue.toFixed(2) : 'N/A',
    method3Label,
    avg: intrinsicValue > 0 ? intrinsicValue.toFixed(2) : 'N/A',
    undervaluation: undervaluation.toFixed(1)
  };
}

function getVerdict(buffettScore, marginOfSafety = 0) {
  // If significantly overvalued, cap the verdict regardless of quality score
  if (marginOfSafety < -50) return 'avoid';           // >50% overvalued
  if (marginOfSafety < -25) return 'hold';            // 25-50% overvalued
  
  // If quality is poor, cap at hold
  if (buffettScore < 40) return 'avoid';
  
  // Combined scoring
  if (buffettScore >= 75 && marginOfSafety > 15) return 'strong_buy';
  if (buffettScore >= 60 && marginOfSafety > 5) return 'buy';
  if (buffettScore >= 50 && marginOfSafety > 0) return 'accumulate';
  if (buffettScore >= 50 && marginOfSafety > -15) return 'hold';
  if (buffettScore >= 40 && marginOfSafety > -25) return 'hold';
  
  return 'avoid';
}

async function fetchQuoteData(ticker, options = {}) {
  const { quoteHint = null, bypassCache = false } = options;
  const upper = String(ticker).toUpperCase();

  if (!bypassCache) {
    const mem = QUOTE_CACHE.get(upper);
    if (mem && Date.now() - mem.timestamp < QUOTE_CACHE_TTL) {
      return mergeLiveQuoteIntoResult({ ...mem.data }, quoteHint);
    }
    const diskData = readQuoteDiskCache(upper);
    if (diskData) {
      const merged = mergeLiveQuoteIntoResult({ ...diskData }, quoteHint);
      QUOTE_CACHE.set(upper, { data: merged, timestamp: Date.now() });
      return merged;
    }
  }

  const modules = ['price', 'summaryDetail', 'summaryProfile', 'defaultKeyStatistics',
                   'financialData', 'incomeStatementHistory', 'balanceSheetHistory',
                   'cashflowStatementHistory', 'earningsTrend'];

  const data = await yahooFinance.quoteSummary(ticker, { modules }, YAHOO_QUOTE_SUMMARY_MODULE_OPTS);

  let rankingFundamentals = null;
  try {
    rankingFundamentals = calculateFundamentalScore(data, upper);
  } catch (err) {
    console.error(`rankingFundamentals for ${ticker}:`, err.message);
  }
  
  const p = data.price || {};
  const sd = data.summaryDetail || {};
  const sp = data.summaryProfile || {};
  const ks = data.defaultKeyStatistics || {};
  const fd = data.financialData || {};
  const incHistory = data.incomeStatementHistory?.incomeStatementHistory || [];
  const inc = incHistory[0] || {};
  const bs = data.balanceSheetHistory?.balanceSheetHistory?.[0] || {};
  const cf = data.cashflowStatementHistory?.cashflowStatementHistory?.[0] || {};
  
  // Check data availability
  const hasIncomeHistory = incHistory.length > 0 && (inc.totalRevenue > 0 || inc.grossProfit > 0 || inc.operatingIncome > 0);
  const hasCashflowHistory = cf && (cf.totalCashFromOperatingActivities !== undefined || cf.capitalExpenditures !== undefined);
  const hasBalanceSheet = bs && (bs.totalStockholderEquity > 0 || bs.totalDebt > 0 || bs.totalAssets > 0);
  
  // Derive values from financialData when statement history is unavailable
  const fdRevenue = fd.totalRevenue || 0;
  const fdGrossMargin = fd.grossMargins || 0;
  const fdOpMargin = fd.operatingMargins || 0;
  const fdProfitMargin = fd.profitMargins || 0;
  
  // Use income statement data if available, otherwise derive from financialData
  const totalRevenue = hasIncomeHistory ? inc.totalRevenue : fdRevenue;
  const grossProfit = hasIncomeHistory && inc.grossProfit > 0 ? inc.grossProfit : (fdRevenue > 0 && fdGrossMargin > 0 ? fdRevenue * fdGrossMargin : 0);
  const operatingIncome = hasIncomeHistory && inc.operatingIncome > 0 ? inc.operatingIncome : (fdRevenue > 0 && fdOpMargin > 0 ? fdRevenue * fdOpMargin : 0);
  const netIncome = hasIncomeHistory && inc.netIncome > 0 ? inc.netIncome : (fdRevenue > 0 && fdProfitMargin > 0 ? fdRevenue * fdProfitMargin : 0);
  
  // Operating CF and FCF
  const operatingCF = hasCashflowHistory && cf.totalCashFromOperatingActivities !== undefined 
    ? cf.totalCashFromOperatingActivities 
    : (netIncome > 0 ? netIncome * 1.1 : 0); // Estimate: net income + ~10% for D&A
  const capex = hasCashflowHistory ? Math.abs(cf.capitalExpenditures || 0) : 0;
  const freeCashflow = hasCashflowHistory && cf.totalCashFromOperatingActivities !== undefined
    ? cf.totalCashFromOperatingActivities + (cf.capitalExpenditures || 0)
    : (fd.ebitda ? fd.ebitda * 0.7 : netIncome * 0.8); // Estimate from EBITDA or net income
  
  // Balance sheet - prefer actual data, fall back to derived
  const totalCash = hasBalanceSheet && bs.cash > 0 ? bs.cash : (fd.totalCash || 0);
  const totalDebt = hasBalanceSheet && (bs.totalDebt > 0 || bs.longTermDebt > 0) 
    ? (bs.totalDebt || bs.longTermDebt) 
    : (fd.totalDebt || 0);
  const shareholderEquity = hasBalanceSheet && bs.totalStockholderEquity > 0 
    ? bs.totalStockholderEquity 
    : (ks.bookValue && ks.sharesOutstanding ? ks.bookValue * ks.sharesOutstanding : netIncome * 10);
  const totalAssets = hasBalanceSheet && bs.totalAssets > 0 ? bs.totalAssets : (shareholderEquity + totalDebt);
  
  // Margins - prefer financialData, fall back to derived
  const grossMargin = fdGrossMargin > 0 ? fdGrossMargin : (totalRevenue > 0 && grossProfit > 0 ? grossProfit / totalRevenue : 0);
  const operatingMargin = fdOpMargin > 0 ? fdOpMargin : (totalRevenue > 0 && operatingIncome > 0 ? operatingIncome / totalRevenue : 0);
  const profitMargin = fdProfitMargin > 0 ? fdProfitMargin : (totalRevenue > 0 && netIncome > 0 ? netIncome / totalRevenue : 0);
  
  // Build income statements for trend analysis - use what we have
  const incomeStatements = incHistory.length > 0 && inc.totalRevenue > 0
    ? incHistory.map(y => ({
        totalRevenue: y.totalRevenue || 0,
        costOfRevenue: y.costOfRevenue || 0,
        grossProfit: y.grossProfit || 0,
        totalOperatingExpenses: y.totalOperatingExpenses || 0,
        operatingIncome: y.operatingIncome || 0,
        netIncome: y.netIncome || 0
      }))
    : [{
        totalRevenue,
        grossProfit,
        operatingIncome,
        netIncome
      }];
  
  const result = {
    ticker: p.symbol || ticker,
    name: p.shortName || p.longName || ticker,
    price: p.regularMarketPrice || 0,
    marketCap: p.marketCap || 0,
    sharesOutstanding: p.sharesOutstanding || ks.sharesOutstanding || 0,
    beta: sd.beta || ks.beta || 1,
    trailingEPS: ks.trailingEps || 0,
    forwardEPS: ks.forwardEps || 0,
    forwardPE: safeNum(p.forwardPE || (ks.forwardEps ? p.regularMarketPrice / ks.forwardEps : 0)),
    trailingPE: p.trailingPE || 0,
    priceToSales: sd.priceToSales || 0,
    priceToBook: sd.priceToBook || 0,
    week52High: sd.fiftyTwoWeekHigh || 0,
    week52Low: sd.fiftyTwoWeekLow || 0,
    twoHundredDayMA: sd.twoHundredDayAverage || 0,
    fiftyDayMA: sd.fiftyDayAverage || 0,
    dividendYield: sd.dividendYield || 0,
    dividendRate: sd.dividendRate || 0,
    payoutRatio: sd.payoutRatio || ks.payoutRatio || 0,
    currentRatio: fd.currentRatio || sd.currentRatio || 0,
    debtToEquity: fd.debtToEquity || sd.debtToEquity || 0,
    totalDebtToEquity: sd.totalDebtToEquity || 0,
    earningsGrowth: fd.earningsGrowth || ks.earningsGrowth || 0,
    revenueGrowth: fd.revenueGrowth || ks.revenueGrowth || 0,
    roe: fd.returnOnEquity || ks.returnOnEquity || 0,
    roa: fd.returnOnAssets || ks.returnOnAssets || 0,
    profitMargin: profitMargin,
    operatingMargin: operatingMargin,
    grossMargin: grossMargin,
    freeCashflow: freeCashflow,
    operatingCashflow: operatingCF,
    totalRevenue: totalRevenue,
    grossProfit: grossProfit,
    operatingIncome: operatingIncome,
    netIncome: netIncome,
    capitalExpenditures: capex,
    repurchaseOfStock: cf.repurchaseOfCapitalStock || 0,
    totalCash: totalCash,
    totalDebt: totalDebt,
    totalAssets: totalAssets,
    totalLiabilities: bs.totalLiabilities || 0,
    shareholderEquity: shareholderEquity,
    bookValue: bs.bookValue || ks.bookValue || 0,
    sector: sp.sector || data.assetProfile?.sector || p.sector || '',
    industry: sp.industry || data.assetProfile?.industry || p.industry || '',
    description: sp.longBusinessSummary || data.assetProfile?.longBusinessSummary || '',
    incomeStatements: incomeStatements,
    pegRatio: ks.pegRatio || 0,
    // Data quality tracking
    dataQuality: {
      incomeStatementAvailable: hasIncomeHistory,
      cashflowAvailable: hasCashflowHistory,
      balanceSheetAvailable: hasBalanceSheet,
      estimatedFields: [
        !hasIncomeHistory && totalRevenue > 0 ? 'grossProfit' : null,
        !hasIncomeHistory && totalRevenue > 0 ? 'operatingIncome' : null,
        !hasIncomeHistory && totalRevenue > 0 ? 'netIncome' : null,
        !hasCashflowHistory ? 'freeCashflow' : null,
        !hasCashflowHistory ? 'operatingCashflow' : null,
        !hasBalanceSheet ? 'shareholderEquity' : null,
        !hasBalanceSheet ? 'totalAssets' : null
      ].filter(Boolean)
    },
    rankingFundamentals
  };

  mergeLiveQuoteIntoResult(result, quoteHint);
  if (!bypassCache) {
    QUOTE_CACHE.set(upper, { data: result, timestamp: Date.now() });
    writeQuoteDiskCache(upper, result);
  }
  return result;
}

async function fetchHistoricalData(ticker, months = 18) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  
  const period1 = Math.floor(startDate.getTime() / 1000);
  const period2 = Math.floor(endDate.getTime() / 1000);
  
  const data = await yahooFinance.chart(ticker, {
    period1,
    period2,
    interval: '1d'
  });
  
  return data.quotes.filter(q => q.close != null).map(q => ({
    date: new Date(q.date * 1000),
    close: q.close,
    volume: q.volume
  }));
}

function calculateMomentum(prices, lookbackMonths = 6, smooth = true) {
  if (prices.length < 50) return null;
  
  const now = prices[prices.length - 1].close;
  const lookbackDays = lookbackMonths * 30;
  const lookbackIndex = Math.max(0, prices.length - lookbackDays);
  const startPrice = prices[lookbackIndex].close;
  
  if (!startPrice || startPrice === 0) return null;
  
  const rawMomentum = ((now - startPrice) / startPrice) * 100;
  const tradingDays = prices.length - lookbackIndex;
  const annualizedReturn = Math.pow(now / startPrice, 252 / tradingDays) - 1;
  
  const dailyReturns = [];
  for (let i = lookbackIndex + 1; i < prices.length; i++) {
    const ret = Math.log(prices[i].close / prices[i - 1].close);
    dailyReturns.push(ret);
  }
  
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / dailyReturns.length;
  const volatility = Math.sqrt(variance) * Math.sqrt(252);
  
  const riskAdjMomentum = volatility > 0 ? annualizedReturn / volatility : 0;
  
  const ma50 = prices.slice(-50);
  const ma200 = prices.slice(-200);
  const ma50Value = ma50.reduce((a, b) => a + b.close, 0) / ma50.length;
  const ma200Value = ma200.length > 0 ? ma200.reduce((a, b) => a + b.close, 0) / ma200.length : 0;
  
  let trendStatus = 'downtrend';
  let trendBonus = -1;
  
  if (now > ma50Value && ma50Value > ma200Value) {
    trendStatus = 'strong_uptrend';
    trendBonus = 2;
  } else if (now > ma200Value && now < ma50Value) {
    trendStatus = 'pullback_in_uptrend';
    trendBonus = 1;
  } else if (now < ma200Value && now > ma50Value) {
    trendStatus = 'mixed';
    trendBonus = 0;
  }
  
  let runningMax = prices[lookbackIndex].close;
  let maxDrawdown = 0;
  let volatilityFlagged = false;
  
  for (let i = lookbackIndex; i < prices.length; i++) {
    if (prices[i].close > runningMax) runningMax = prices[i].close;
    const dd = (runningMax - prices[i].close) / runningMax;
    if (dd > maxDrawdown) maxDrawdown = dd;
    
    if (i > lookbackIndex) {
      const dailyRet = Math.abs((prices[i].close - prices[i - 1].close) / prices[i - 1].close);
      if (dailyRet > 0.15) volatilityFlagged = true;
    }
  }
  
  const finalScore = smooth ? riskAdjMomentum + trendBonus : riskAdjMomentum;
  
  return {
    rawMomentum: rawMomentum.toFixed(1),
    annualizedReturn: annualizedReturn.toFixed(3),
    volatility: volatility.toFixed(3),
    riskAdjMomentum: riskAdjMomentum.toFixed(3),
    trendStatus,
    ma50: ma50Value.toFixed(2),
    ma200: ma200Value.toFixed(2),
    maxDrawdown: (-maxDrawdown * 100).toFixed(1),
    volatilityFlagged,
    finalScore: finalScore.toFixed(3)
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getUniverse(universeId) {
  const universe = UNIVERSES[universeId];
  if (!universe) {
    return { error: `Unknown universe: ${universeId}` };
  }
  return universe;
}

// API Endpoints
app.get('/api/quote/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const data = await fetchQuoteData(ticker);
    
    const buffett = calcBuffettScore(data);
    const roic = calcROIC(data);
    const profitability = calcProfitability(data);
    
    res.json({
      success: true,
      ticker,
      data,
      derived: {
        buffett,
        roic,
        profitability
      }
    });
  } catch (error) {
    console.error(`Error fetching quote for ${req.params.ticker}:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/universe/:universeId', (req, res) => {
  const { universeId } = req.params;
  const universe = getUniverse(universeId);
  
  if (universe.error) {
    return res.status(404).json(universe);
  }
  
  res.json({
    success: true,
    universeId,
    tickers: universe
  });
});

app.get('/api/momentum/:universeId', async (req, res) => {
  const { universeId } = req.params;
  const { lookback = '6', smooth = 'true', fresh = 'false' } = req.query;
  
  const universe = getUniverse(universeId);
  if (universe.error) {
    return res.status(404).json(universe);
  }
  
  const cacheKey = `${universeId}-${lookback}-${smooth}`;
  const cached = MOMENTUM_CACHE.get(cacheKey);
  if (cached && fresh !== 'true' && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.json({ ...cached.data, cached: true });
  }
  
  const tickers = universe;
  const lookbackMonths = parseInt(lookback);
  const applySmooth = smooth === 'true';
  
  const results = [];
  const errors = [];
  const BATCH_SIZE = 5;

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(async (ticker) => {
        const [quoteData, historicalData] = await Promise.all([
          fetchQuoteData(ticker).catch(() => null),
          fetchHistoricalData(ticker, 18).catch(() => [])
        ]);
        const momentum = calculateMomentum(historicalData, lookbackMonths, applySmooth);
        return {
          rank: 0,
          ticker,
          name: quoteData?.name || ticker,
          sector: quoteData?.sector || '',
          currentPrice: quoteData?.price || 0,
          ...momentum
        };
      })
    );

    for (let j = 0; j < settled.length; j++) {
      if (settled[j].status === 'fulfilled' && settled[j].value) {
        results.push(settled[j].value);
      } else if (settled[j].status === 'rejected') {
        errors.push({ ticker: batch[j], error: settled[j].reason?.message });
      }
    }

    if (i + BATCH_SIZE < tickers.length) {
      await sleep(150);
    }
  }
  
  results.sort((a, b) => parseFloat(b.finalScore) - parseFloat(a.finalScore));
  results.forEach((r, i) => r.rank = i + 1);
  
  const responseData = {
    success: true,
    universeId,
    lookback: lookbackMonths,
    smooth: applySmooth,
    results,
    errors,
    summary: {
      totalAssets: results.length,
      avgMomentum: (results.reduce((a, b) => a + parseFloat(b.rawMomentum), 0) / results.length).toFixed(1),
      percentUptrend: ((results.filter(r => r.trendStatus === 'strong_uptrend').length / results.length) * 100).toFixed(0),
      medianVolatility: (results.reduce((a, b) => a + parseFloat(b.volatility), 0) / results.length).toFixed(3)
    }
  };
  
  MOMENTUM_CACHE.set(cacheKey, { data: responseData, timestamp: Date.now() });
  
  res.json(responseData);
});

// ── Strategy-aware scanner ──────────────────────────────────────────
const SCAN_CACHE = new Map();

function gradeFromScore(score) {
  if (score >= 80) return { grade: "A", label: "STRONG BUY", color: "#22c55e" };
  if (score >= 70) return { grade: "A-", label: "BUY", color: "#4ade80" };
  if (score >= 60) return { grade: "B+", label: "ACCUMULATE", color: "#86efac" };
  if (score >= 55) return { grade: "B", label: "LEAN BUY", color: "#eab308" };
  if (score >= 45) return { grade: "C+", label: "HOLD", color: "#eab308" };
  if (score >= 35) return { grade: "C", label: "LEAN SELL", color: "#f97316" };
  if (score >= 25) return { grade: "D", label: "SELL", color: "#ef4444" };
  return { grade: "F", label: "STRONG SELL", color: "#dc2626" };
}

function scoreMomentumOnly(momentum) {
  const raw = parseFloat(momentum?.rawMomentum || 0);
  const riskAdj = parseFloat(momentum?.riskAdjMomentum || 0);
  const momentumScore = Math.min(100, Math.max(0, 50 + raw * 3));
  const riskAdjScore = riskAdj >= 1 ? 80 : riskAdj >= 0.5 ? 60 : riskAdj >= 0 ? 40 : 20;
  return Math.round(momentumScore * 0.6 + riskAdjScore * 0.4);
}

function scoreMomentumValue(momentum, quoteData) {
  const momScore = scoreMomentumOnly(momentum);
  const pe = safeNum(quoteData?.forwardPE || quoteData?.trailingPE, 0);
  const pb = safeNum(quoteData?.priceToBook, 0);
  let valScore = 50;
  if (pe > 0) {
    if (pe <= 12) valScore = 90;
    else if (pe <= 18) valScore = 75;
    else if (pe <= 25) valScore = 55;
    else if (pe <= 35) valScore = 35;
    else valScore = 15;
  }
  if (pb > 0) {
    let pbScore = pb <= 2 ? 80 : pb <= 4 ? 55 : pb <= 8 ? 35 : 15;
    valScore = Math.round(valScore * 0.6 + pbScore * 0.4);
  }
  return { total: Math.round(momScore * 0.6 + valScore * 0.4), components: { momentum: momScore, valuation: valScore } };
}

function scoreQualityMomentum(momentum, quoteData) {
  const momScore = scoreMomentumOnly(momentum);
  const roe = safeNum(quoteData?.returnOnEquity, 0) * 100;
  const gm = safeNum(quoteData?.grossMargin || quoteData?.grossProfitMargin, 0);
  const gmPct = gm > 1 ? gm : gm * 100;
  const om = safeNum(quoteData?.operatingMargin, 0);
  const omPct = om > 1 ? om : om * 100;

  let qualScore = 0;
  qualScore += roe >= 25 ? 35 : roe >= 18 ? 28 : roe >= 12 ? 20 : roe >= 5 ? 10 : 0;
  qualScore += gmPct >= 50 ? 35 : gmPct >= 35 ? 25 : gmPct >= 20 ? 15 : 5;
  qualScore += omPct >= 25 ? 30 : omPct >= 15 ? 22 : omPct >= 8 ? 12 : 3;
  qualScore = Math.min(100, qualScore);

  return { total: Math.round(momScore * 0.4 + qualScore * 0.6), components: { momentum: momScore, quality: qualScore } };
}

function scoreFullComposite(momentum, quoteData, enrichedData) {
  const buffett = calcBuffettScore(enrichedData);
  const roicAnalysis = calcROIC(enrichedData);
  const entry = calcEntryTiming(enrichedData);
  const iv = calcIntrinsicValue(enrichedData, buffett.wacc);
  const moat = calcMoatAnalysis(enrichedData, null);
  const aiDisruption = calcAIDisruption(enrichedData);
  const constraints = calcGrowthConstraints(enrichedData, 0);
  const earningsQuality = calcEarningsQuality({ ...enrichedData, roic: parseFloat(roicAnalysis.roic), wacc: buffett.wacc });
  const tsy = calcTotalShareholderYield(enrichedData, iv);

  const composite = calcComposite({
    buffettChecklist: { total: buffett.total },
    moatAnalysis: moat,
    intrinsicValue: iv,
    roicTree: roicAnalysis,
    earningsQuality,
    entryTiming: entry,
    totalShareholderYield: tsy,
    growthConstraints: constraints,
    aiDisruption,
    fundamentals: quoteData,
    price: quoteData.price
  });

  return {
    total: composite.score,
    components: {
      quality: buffett.total,
      moat: moat.moat_score,
      valuation: composite.components?.find(c => c.name === "Valuation")?.score || 0,
      roic: composite.components?.find(c => c.name === "ROIC")?.score || 0,
      momentum: composite.components?.find(c => c.name === "Momentum")?.score || 0
    },
    label: composite.label,
    grade: composite.grade,
    color: composite.color
  };
}

function enrichQuoteData(data) {
  const sharesOutstanding = safeNum(data.sharesOutstanding);
  const price = safeNum(data.price);
  const totalDebt = safeNum(data.totalDebt);
  const shareholderEquity = safeNum(data.shareholderEquity);
  const totalAssets = safeNum(data.totalAssets);
  const netIncome = safeNum(data.netIncome);
  const operatingIncome = safeNum(data.operatingIncome);
  const totalRevenue = safeNum(data.totalRevenue);
  const investedCapital = totalDebt + (shareholderEquity || netIncome * 10);
  const roic = investedCapital > 0 ? (operatingIncome / investedCapital) * 100 :
               (netIncome > 0 && totalAssets > 0 ? (netIncome / totalAssets) * 100 : 0);
  const nopatMargin = totalRevenue > 0 ? (operatingIncome / totalRevenue) * 100 : safeNum(data.operatingMargin) * 100;
  const assetTurnover = totalAssets > 0 ? totalRevenue / totalAssets :
                       (totalRevenue > 0 && price > 0 ? totalRevenue / (sharesOutstanding * price) : 0);
  return {
    ...data,
    roic,
    nopatMargin,
    assetTurnover,
    wacc: data.beta < 0.8 ? 8 : data.beta > 1.2 ? 11 : 9.5,
    gmTrend: 0
  };
}

app.get('/api/scan/:universeId', async (req, res) => {
  const { universeId } = req.params;
  const { strategy = 'momentum', lookback = '6', smooth = 'true', fresh = 'false' } = req.query;
  const strategyClean = (strategy || 'momentum').toLowerCase().trim();

  const universe = getUniverse(universeId);
  if (universe.error) return res.status(404).json(universe);

  const cacheKey = `scan-${universeId}-${strategyClean}-${lookback}-${smooth}-btv2`;
  const cached = SCAN_CACHE.get(cacheKey);
  if (cached && fresh !== 'true' && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.json({ ...cached.data, cached: true });
  }

  const tickers = universe;
  const lookbackMonths = parseInt(lookback);
  const applySmooth = smooth === 'true';
  const needsFundamentals = strategyClean !== 'momentum';

  const results = [];
  const errors = [];
  const BATCH_SIZE = 5;
  const scanBypassCache = fresh === 'true';

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);
    const quoteHints = await fetchYahooQuotesBatch(batch);
    const settled = await Promise.allSettled(
      batch.map(async (ticker) => {
        const hint = quoteHints.get(String(ticker).toUpperCase());
        const [quoteData, historicalData] = await Promise.all([
          fetchQuoteData(ticker, { quoteHint: hint, bypassCache: scanBypassCache }).catch(() => null),
          fetchHistoricalData(ticker, 24).catch(() => [])
        ]);
        if (!quoteData) return null;
        const momentum = calculateMomentum(historicalData, lookbackMonths, applySmooth);
        if (!momentum) return null;

        let strategyScore, components = {}, strategyLabel, strategyGrade;

        if (strategyClean === 'momentum') {
          strategyScore = scoreMomentumOnly(momentum);
          components = { momentum: strategyScore };
        } else if (strategyClean === 'momentum_value') {
          const result = scoreMomentumValue(momentum, quoteData);
          strategyScore = result.total;
          components = result.components;
        } else if (strategyClean === 'quality_momentum') {
          const result = scoreQualityMomentum(momentum, quoteData);
          strategyScore = result.total;
          components = result.components;
        } else if (strategyClean === 'full_composite' || strategyClean === 'full_composite_aggressive' || strategyClean === 'full_composite_turbo') {
          const btComp = computeBacktestStyleComposite(quoteData, historicalData, strategyClean);
          if (btComp) {
            strategyScore = btComp.score;
            components = {
              fundamental: btComp.components.find((c) => c.name === 'Fundamental')?.score,
              dcf: btComp.components.find((c) => c.name === 'DCF')?.score,
              dynamicValuation: btComp.components.find((c) => c.name === 'Dynamic valuation')?.score,
              momentum: btComp.components.find((c) => c.name === 'Momentum')?.score,
              priceValue: btComp.components.find((c) => c.name === 'Price value')?.score
            };
            strategyLabel = btComp.label;
            strategyGrade = btComp.grade;
            if (strategyClean === 'full_composite_aggressive') strategyLabel = `${btComp.label} (Aggressive)`;
            else if (strategyClean === 'full_composite_turbo') strategyLabel = `${btComp.label} (Turbo)`;
          } else {
            const enriched = enrichQuoteData(quoteData);
            const result = scoreFullComposite(momentum, quoteData, enriched);
            strategyScore = result.total;
            components = result.components;
            strategyLabel = result.label;
            strategyGrade = result.grade;
            if (strategyClean === 'full_composite_aggressive') {
              strategyLabel = result.label ? `${result.label} (Aggressive)` : 'Aggressive';
            } else if (strategyClean === 'full_composite_turbo') {
              strategyLabel = result.label ? `${result.label} (Turbo)` : 'Turbo';
            }
          }
        } else {
          strategyScore = scoreMomentumOnly(momentum);
          components = { momentum: strategyScore };
        }

        if (!strategyGrade) {
          const g = gradeFromScore(strategyScore);
          strategyGrade = g.grade;
          strategyLabel = g.label;
        }

        return {
          rank: 0,
          ticker,
          name: quoteData?.name || ticker,
          sector: quoteData?.sector || '',
          currentPrice: quoteData?.price || 0,
          ...momentum,
          strategyScore,
          strategyGrade,
          strategyLabel,
          components
        };
      })
    );

    for (let j = 0; j < settled.length; j++) {
      if (settled[j].status === 'fulfilled' && settled[j].value) {
        results.push(settled[j].value);
      } else {
        errors.push({ ticker: batch[j], error: settled[j].reason?.message || 'failed' });
      }
    }

    if (i + BATCH_SIZE < tickers.length) await sleep(150);
  }

  results.sort((a, b) => b.strategyScore - a.strategyScore);
  results.forEach((r, i) => r.rank = i + 1);

  const responseData = {
    success: true,
    universeId,
    strategy: strategyClean,
    lookback: lookbackMonths,
    smooth: applySmooth,
    results,
    errors,
    summary: {
      totalAssets: results.length,
      avgMomentum: results.length > 0 ? (results.reduce((a, b) => a + parseFloat(b.rawMomentum || 0), 0) / results.length).toFixed(1) : '0',
      percentUptrend: results.length > 0 ? ((results.filter(r => r.trendStatus === 'strong_uptrend').length / results.length) * 100).toFixed(0) : '0',
      medianVolatility: results.length > 0 ? (results.reduce((a, b) => a + parseFloat(b.volatility || 0), 0) / results.length).toFixed(3) : '0',
      avgStrategyScore: results.length > 0 ? Math.round(results.reduce((a, b) => a + b.strategyScore, 0) / results.length) : 0
    }
  };

  SCAN_CACHE.set(cacheKey, { data: responseData, timestamp: Date.now() });
  res.json(responseData);
});

app.get('/api/analysis/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const data = await fetchQuoteData(ticker);
    const [historicalForComposite, historicalSpy] = await Promise.all([
      fetchHistoricalData(ticker, 24).catch(() => []),
      fetchHistoricalData('SPY', 24).catch(() => [])
    ]);

    // Get user network input if exists
    const networkInput = NETWORK_INPUT_CACHE.get(ticker);
    
    // Calculate ROIC components for the analysis
    const sharesOutstanding = safeNum(data.sharesOutstanding);
    const price = safeNum(data.price);
    const totalDebt = safeNum(data.totalDebt);
    const shareholderEquity = safeNum(data.shareholderEquity);
    const totalAssets = safeNum(data.totalAssets);
    const netIncome = safeNum(data.netIncome);
    const operatingIncome = safeNum(data.operatingIncome);
    const totalRevenue = safeNum(data.totalRevenue);
    
    const investedCapital = totalDebt + (shareholderEquity || netIncome * 10);
    const roic = investedCapital > 0 ? (operatingIncome / investedCapital) * 100 : 
                 (netIncome > 0 && totalAssets > 0 ? (netIncome / totalAssets) * 100 : 0);
    const nopatMargin = totalRevenue > 0 ? (operatingIncome / totalRevenue) * 100 : safeNum(data.operatingMargin) * 100;
    const assetTurnover = totalAssets > 0 ? totalRevenue / totalAssets : 
                         (totalRevenue > 0 && price > 0 ? totalRevenue / (sharesOutstanding * price) : 0);
    
    // Enrich data with calculated values
    const enrichedData = {
      ...data,
      roic,
      nopatMargin,
      assetTurnover,
      wacc: data.beta < 0.8 ? 8 : data.beta > 1.2 ? 11 : 9.5,
      gmTrend: 0 // Will be calculated in analysis engine
    };
    
    // Run all analysis sections
    const buffett = calcBuffettScore(enrichedData);
    const roicAnalysis = calcROIC(enrichedData);
    const profitability = calcProfitabilityPath(enrichedData);
    const constraints = calcGrowthConstraints(enrichedData, 0);
    const entry = calcEntryTiming(enrichedData);
    const iv = calcIntrinsicValue(enrichedData, buffett.wacc);
    const moat = calcMoatAnalysis(enrichedData, networkInput);
    const aiDisruption = calcAIDisruption(enrichedData);
    const roicSensitivity = calcROICSensitivity({
      ...enrichedData,
      roic: parseFloat(roicAnalysis.roic),
      nopatMargin: parseFloat(roicAnalysis.nopatMargin),
      assetTurnover: parseFloat(roicAnalysis.assetTurnover)
    });
    const earningsQuality = calcEarningsQuality({
      ...enrichedData,
      roic: parseFloat(roicAnalysis.roic),
      wacc: buffett.wacc
    });
    const tsy = calcTotalShareholderYield(enrichedData, iv);

    let composite = computeBacktestStyleComposite(data, historicalForComposite, 'full_composite');
    let mlFeatures = null;
    let mlAnalysisPredict = null;
    if (!composite) {
      const compositeArgs = {
        buffettChecklist: { total: buffett.total },
        moatAnalysis: moat,
        intrinsicValue: iv,
        roicTree: roicAnalysis,
        earningsQuality,
        entryTiming: entry,
        totalShareholderYield: tsy,
        growthConstraints: constraints,
        aiDisruption,
        fundamentals: data,
        price: data.price
      };
      const rulesProbe = calcCompositeRules(compositeArgs);
      const priceSeriesBt = historicalPricesToBtSeries(historicalForComposite);
      const benchmarkBt = historicalPricesToBtSeries(historicalSpy);
      const asOfDateAnalysis = priceSeriesBt.length > 0
        ? priceSeriesBt[priceSeriesBt.length - 1].date
        : new Date().toISOString().split('T')[0];
      const momC = rulesProbe.components?.find((c) => c.name === 'Momentum');
      const valC = rulesProbe.components?.find((c) => c.name === 'Valuation');
      mlFeatures = buildMlFeatureVector({
        ...compositeArgs,
        momentumNorm: momC?.score ?? 50,
        valuationDyn: valC?.score ?? rulesProbe.valuationScore ?? 50,
        valueScore: 50,
        annualizedVol: 0,
        momQualityScore: 50,
        priceSeries: priceSeriesBt,
        asOfDate: asOfDateAnalysis,
        benchmarkSeries: benchmarkBt.length ? benchmarkBt : undefined
      });

      let mlOpts = {};
      const enableCluster = mlCompositeClusterEnabled();
      const clusterBlendEnv = parseFloat(process.env.ML_CLUSTER_BLEND || '0.45');
      if (enableCluster && mlFeatures?.vector?.length) {
        const predC = await runMlPredictClusterAsync([mlFeatures.vector]);
        if (predC?.ok && Array.isArray(predC.clusterScore0to100) && predC.clusterScore0to100.length > 0) {
          mlOpts.clusterScore0to100 = predC.clusterScore0to100[0];
          mlOpts.clusterBlend = Number.isFinite(clusterBlendEnv) ? Math.max(0, Math.min(1, clusterBlendEnv)) : 0.45;
          mlAnalysisPredict = {
            clusterScore0to100: predC.clusterScore0to100[0],
            clusterProbWinner: predC.clusterProbWinner != null ? predC.clusterProbWinner[0] : null,
            clusterOk: true
          };
        }
      }
      const enableMlComposite = process.env.ML_COMPOSITE_ANALYSIS === '1' || process.env.ML_COMPOSITE_ANALYSIS === 'true';
      if (
        mlOpts.clusterScore0to100 == null
        && enableMlComposite && mlFeatures?.vector?.length
      ) {
        const seq = extractMlLogReturnSeq(priceSeriesBt, asOfDateAnalysis) || Array(60).fill(0);
        const pred = await runMlPredictBatchAsync([mlFeatures.vector], [seq]);
        if (pred?.ok && Array.isArray(pred.structuralScore0to100) && pred.structuralScore0to100.length > 0) {
          mlOpts = {
            ...mlOpts,
            structuralScore0to100: pred.structuralScore0to100[0],
            probPositive20d: pred.probPositive20d != null ? pred.probPositive20d[0] : undefined
          };
          mlAnalysisPredict = {
            ...mlAnalysisPredict,
            structuralScore0to100: pred.structuralScore0to100[0],
            probPositive20d: pred.probPositive20d != null ? pred.probPositive20d[0] : null,
            ok: true
          };
        }
      }

      const hasMlOpts =
        mlOpts.clusterScore0to100 != null
        || mlOpts.structuralScore0to100 != null
        || mlOpts.probPositive20d != null;
      composite = hasMlOpts ? calcComposite(compositeArgs, mlOpts) : rulesProbe;
    }

    const verdict = getVerdict(buffett.total, parseFloat(iv.undervaluation));
    
    const checklist = [
      { name: 'Owner Earnings Yield', pass: buffett.criteria.ownerEarnings.pass, value: `${buffett.criteria.ownerEarnings.value}% yield`, detail: `${buffett.criteria.ownerEarnings.multiplier}x risk-free rate` },
      { name: 'Margin of Safety', pass: buffett.criteria.marginOfSafety.pass, value: `${buffett.criteria.marginOfSafety.value}% discount`, detail: `IV: $${buffett.criteria.marginOfSafety.iv}` },
      { name: 'Earnings Consistency', pass: buffett.criteria.earningsConsistency.pass, value: buffett.criteria.earningsConsistency.value, detail: '4 signals positive' },
      { name: 'Management Quality', pass: buffett.criteria.managementQuality.pass, value: `ROE: ${buffett.criteria.managementQuality.roe}%`, detail: `Buybacks: ${buffett.criteria.managementQuality.buyback}` },
      { name: 'Business Simplicity', pass: buffett.criteria.businessSimplicity.pass, value: `${buffett.criteria.businessSimplicity.value}% GM`, detail: '' },
      { name: 'Durable Advantage', pass: buffett.criteria.durableAdvantage.pass, value: buffett.criteria.durableAdvantage.value, detail: 'durability signals' }
    ];
    
    res.json({
      success: true,
      ticker,
      name: data.name,
      price: data.price,
      sector: data.sector,
      industry: data.industry,
      marketCap: data.marketCap,
      description: data.description,
      verdict,
      dataQuality: data.dataQuality,
      buffettChecklist: {
        items: checklist,
        total: buffett.total
      },
      moatAnalysis: moat,
      aiDisruption,
      roicTree: roicAnalysis,
      roicSensitivity,
      profitabilityPath: profitability,
      growthConstraints: constraints,
      entryTiming: entry,
      intrinsicValue: iv,
      fundamentals: {
        beta: data.beta,
        dividendYield: data.dividendYield,
        payoutRatio: data.payoutRatio,
        forwardPE: data.forwardPE,
        trailingPE: data.trailingPE,
        priceToBook: data.priceToBook
      },
      earningsQuality,
      totalShareholderYield: tsy,
      composite,
      ...(mlFeatures ? { mlFeatures: { names: mlFeatures.names, vector: mlFeatures.vector } } : {}),
      ...(mlAnalysisPredict ? { mlAnalysisPredict } : {})
    });
  } catch (error) {
    console.error(`Error analyzing ${req.params.ticker}:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

function calculateDCF(data) {
  const ticker = data.ticker;
  const name = data.name;
  const currentPrice = safeNum(data.price);
  const sharesOutstanding = safeNum(data.sharesOutstanding);
  const totalRevenue = safeNum(data.totalRevenue);
  const freeCashflow = safeNum(data.freeCashflow);
  const operatingCashflow = safeNum(data.operatingCashflow);
  const capitalExpenditures = safeNum(data.capitalExpenditures);
  const beta = safeNum(data.beta, 1);
  const totalCash = safeNum(data.totalCash, 0);
  const totalDebt = safeNum(data.totalDebt, 0);
  const forwardEPS = safeNum(data.forwardEPS);
  const trailingEPS = safeNum(data.trailingEPS);
  const sector = data.sector || "";
  const industry = data.industry || "";
  const repurchaseOfStock = safeNum(data.repurchaseOfStock, 0);
  
  // Calculate revenue growth from income statements (more reliable than Yahoo's estimate)
  let manualRevenueGrowth = null;
  if (data.incomeStatements && data.incomeStatements.length >= 4) {
    const stmt = data.incomeStatements;
    // Calculate TTM: sum of last 4 quarters
    const ttmRev = (stmt[0]?.totalRevenue || 0) + (stmt[1]?.totalRevenue || 0) + 
                   (stmt[2]?.totalRevenue || 0) + (stmt[3]?.totalRevenue || 0);
    // Calculate prior year TTM (previous 4 quarters - need to look at prior year data)
    // If we have 8 quarters, use periods 4-7 for prior year
    if (stmt.length >= 8) {
      const priorTtmRev = (stmt[4]?.totalRevenue || 0) + (stmt[5]?.totalRevenue || 0) +
                          (stmt[6]?.totalRevenue || 0) + (stmt[7]?.totalRevenue || 0);
      if (ttmRev > 0 && priorTtmRev > 0 && priorTtmRev < ttmRev * 1.5) {
        manualRevenueGrowth = (ttmRev - priorTtmRev) / priorTtmRev;
      }
    }
    // Fallback: use first vs second half of available data
    if (manualRevenueGrowth === null) {
      const currentHalf = (stmt[0]?.totalRevenue || 0) + (stmt[1]?.totalRevenue || 0);
      const priorHalf = (stmt[2]?.totalRevenue || 0) + (stmt[3]?.totalRevenue || 0);
      if (currentHalf > 0 && priorHalf > 0 && priorHalf < currentHalf * 1.5) {
        // Extrapolate YoY from half-year comparison
        manualRevenueGrowth = (currentHalf - priorHalf) / priorHalf;
      }
    }
  } else if (data.incomeStatements && data.incomeStatements.length >= 2) {
    // Fallback: compare first and second period (assume quarterly)
    const stmt = data.incomeStatements;
    const revCurrent = stmt[0]?.totalRevenue || 0;
    const revPrev = stmt[1]?.totalRevenue || 0;
    if (revCurrent > 0 && revPrev > 0 && revPrev < revCurrent * 1.5) {
      // Extrapolate from sequential growth to YoY
      const sequentialGrowth = (revCurrent - revPrev) / revPrev;
      // Quarterly sequential ≈ half of annual growth, so multiply by 2 as rough estimate
      manualRevenueGrowth = Math.min(sequentialGrowth * 2, 0.25);
    }
  }
  
  // Get earnings growth for context only
  const earningsGrowth = safeNum(data.earningsGrowth, 0);
  let yahooRevenueGrowth = safeNum(data.revenueGrowth, 0);
  if (yahooRevenueGrowth > 1) yahooRevenueGrowth = yahooRevenueGrowth / 100;
  
  // Base FCF calculation
  let baseFCF;
  let fcfSource;
  
  // Use operatingCashflow + capex (capex is stored as negative)
  if (operatingCashflow > 0 && capitalExpenditures < 0) {
    baseFCF = operatingCashflow + capitalExpenditures;
    fcfSource = "cashflowStatement";
  } else if (freeCashflow > 0) {
    baseFCF = freeCashflow;
    fcfSource = "financialData_freeCashflow";
  } else if (operatingCashflow > 0) {
    baseFCF = operatingCashflow * 0.85;
    fcfSource = "estimated_from_opcf";
  } else {
    // Estimate from operating income
    const operatingIncome = totalRevenue * safeNum(data.operatingMargin, 0.2);
    baseFCF = operatingIncome * 0.79 * 0.85;
    fcfSource = "estimated_from_operating_income";
  }
  
  if (baseFCF < 0) {
    baseFCF = Math.abs(baseFCF);
    fcfSource = "estimated_absolute";
  }
  
  // FCF Margin
  let fcfMargin = totalRevenue > 0 ? baseFCF / totalRevenue : 0.2;
  fcfMargin = Math.max(0.05, Math.min(0.45, fcfMargin)); // Cap between 5-45%
  
  // === PHASE 1 GROWTH: Use manual YoY calculation first ===
  let phase1Growth = 0.05; // Default 5%
  let growthSource = "default_5pct";
  
  // Priority 1: Manual YoY from income statements
  if (manualRevenueGrowth !== null && manualRevenueGrowth > -0.3 && manualRevenueGrowth < 0.5) {
    phase1Growth = manualRevenueGrowth;
    growthSource = "manual_yoy";
  }
  // Priority 2: Yahoo's revenue growth (if manual not available)
  else if (yahooRevenueGrowth > 0 && yahooRevenueGrowth < 0.5) {
    phase1Growth = yahooRevenueGrowth;
    growthSource = "yahoo_revenueGrowth";
  }
  
  // Apply revenue-based caps (large companies can't grow as fast)
  if (totalRevenue > 200e9) {
    phase1Growth = Math.min(phase1Growth, 0.15); // >$200B: cap at 15%
  } else if (totalRevenue > 50e9) {
    phase1Growth = Math.min(phase1Growth, 0.20); // >$50B: cap at 20%
  } else if (totalRevenue > 5e9) {
    phase1Growth = Math.min(phase1Growth, 0.25); // >$5B: cap at 25%
  } else {
    phase1Growth = Math.min(phase1Growth, 0.35); // small cap: cap at 35%
  }
  
  // Floor: minimum 2% for default, but allow actual data to be lower if explicitly negative
  if (growthSource === "default_5pct") {
    phase1Growth = Math.max(phase1Growth, 0.02);
  }
  
  // === TERMINAL GROWTH RATE ===
  const terminalGrowthRate = 0.025; // 2.5% (nominal GDP growth)
  
  // === PHASE 2 GROWTH: Must always be LESS than Phase 1 ===
  // Start with 60% of Phase 1, but ensure it's below Phase 1
  const phase2TargetBuffer = Math.max(phase1Growth * 0.6, terminalGrowthRate + 0.01);
  // Phase 2 cannot exceed 85% of Phase 1 to ensure proper fade
  let phase2Growth = Math.min(phase2TargetBuffer, phase1Growth * 0.85);
  // Ensure Phase 2 is always below Phase 1
  phase2Growth = Math.min(phase2Growth, phase1Growth - 0.005); // At least 0.5% below Phase 1
  
  // === WACC CALCULATION with quality adjustment ===
  const riskFreeRate = 0.043;
  const equityRiskPremium = 0.055;
  const adjustedBeta = (2/3 * beta) + (1/3 * 1.0);
  const costOfEquity = riskFreeRate + adjustedBeta * equityRiskPremium;
  
  const debtToEquity = totalDebt > 0 && sharesOutstanding * currentPrice > 0 
    ? totalDebt / (sharesOutstanding * currentPrice) 
    : 0;
  
  let costOfDebt;
  if (debtToEquity < 0.3) costOfDebt = 0.035;
  else if (debtToEquity < 0.8) costOfDebt = 0.045;
  else if (debtToEquity < 1.5) costOfDebt = 0.055;
  else costOfDebt = 0.065;
  
  const costOfDebtAfterTax = costOfDebt * (1 - 0.21);
  const marketCap = sharesOutstanding * currentPrice;
  const totalCapital = marketCap + totalDebt;
  const equityWeight = totalCapital > 0 ? marketCap / totalCapital : 0.97;
  const debtWeight = 1 - equityWeight;
  
  let wacc = (equityWeight * costOfEquity) + (debtWeight * costOfDebtAfterTax);
  
  // Quality adjustment: high FCF margin + low debt = lower risk
  const fcfMarginPct = fcfMargin * 100;
  if (fcfMarginPct > 30 && debtToEquity < 1.0) {
    wacc = Math.max(wacc - 0.01, 0.06); // -100bps for fortress balance sheet + high margins
  } else if (fcfMarginPct > 25 && debtToEquity < 1.5) {
    wacc = Math.max(wacc - 0.005, 0.06); // -50bps for high margins
  }
  
  wacc = Math.max(Math.min(wacc, 0.15), 0.06); // Floor 6%, cap 15%
  
  // Terminal FCF margin
  const terminalFCFMargin = fcfMargin > 0.1 ? fcfMargin * 0.95 : fcfMargin * 1.10;
  
  // Net cash
  const netCash = totalCash - totalDebt;
  
  // === BUILD PROJECTIONS with gentle decay toward terminal ===
  const projections = [];
  let prevRevenue = totalRevenue;
  
  // Phase 1 decay: lose 4% of growth rate per year
  const phase1Decay = phase1Growth * 0.04;
  
  // Calculate what growth rate is at end of Phase 1
  const phase1EndRate = Math.max(phase1Growth - (phase1Decay * 4), terminalGrowthRate + 0.005);
  
  // Phase 2 target: approach terminal but never go below it
  const phase2Target = terminalGrowthRate + 0.003;
  
  for (let year = 1; year <= 10; year++) {
    let growth, yearFCFMargin;
    
    if (year <= 5) {
      // Phase 1: gentle decay
      growth = phase1Growth - (phase1Decay * (year - 1));
      // Floor: never below terminal growth
      growth = Math.max(growth, terminalGrowthRate + 0.005);
    } else {
      // Phase 2: LINEAR DECLINE from phase1EndRate to phase2Target
      const yearsIntoPhase2 = year - 5; // 1,2,3,4,5
      const fraction = yearsIntoPhase2 / 5; // 0.2, 0.4, 0.6, 0.8, 1.0
      growth = phase1EndRate - (phase1EndRate - phase2Target) * fraction;
      // This ALWAYS decreases because phase2Target < phase1EndRate
    }
    
    // FCF margin: hold steady Phase 1, fade Phase 2
    if (year <= 5) {
      yearFCFMargin = fcfMargin;
    } else {
      const fade = (year - 5) / 5;
      yearFCFMargin = fcfMargin - (fcfMargin - terminalFCFMargin) * fade;
    }
    
    const revenue = prevRevenue * (1 + growth);
    const fcf = revenue * yearFCFMargin;
    const discountFactor = 1 / Math.pow(1 + wacc, year);
    const presentValue = fcf * discountFactor;
    
    projections.push({
      year,
      revenue,
      revenueGrowth: growth,
      fcfMargin: yearFCFMargin,
      fcf,
      discountFactor,
      presentValue
    });
    
    prevRevenue = revenue;
  }
  
  // SANITY CHECK: verify growth never increases
  for (let i = 1; i < projections.length; i++) {
    if (projections[i].revenueGrowth > projections[i-1].revenueGrowth + 0.0001) {
      console.error(`DCF BUG: Growth increased from year ${i} (${(projections[i-1].revenueGrowth*100).toFixed(2)}%) to year ${i+1} (${(projections[i].revenueGrowth*100).toFixed(2)}%)`);
      // Force fix: set to previous year's rate minus small decay
      projections[i].revenueGrowth = projections[i-1].revenueGrowth - 0.001;
      // Recalculate downstream
      const prev = i > 0 ? projections[i-1].revenue : totalRevenue;
      projections[i].revenue = prev * (1 + projections[i].revenueGrowth);
      projections[i].fcf = projections[i].revenue * projections[i].fcfMargin;
      projections[i].presentValue = projections[i].fcf * projections[i].discountFactor;
    }
  }
  
  // Terminal value
  const year10 = projections[9];
  const effectiveTerminalGrowth = Math.min(terminalGrowthRate, wacc - 0.01);
  const terminalFCF = year10.fcf * (1 + effectiveTerminalGrowth);
  const terminalValue = terminalFCF / (wacc - effectiveTerminalGrowth);
  const pvOfTerminal = terminalValue * year10.discountFactor;
  
  const pvOfFCFs = projections.reduce((sum, p) => sum + p.presentValue, 0);
  const enterpriseValue = pvOfFCFs + pvOfTerminal;
  const equityValue = Math.max(enterpriseValue + netCash, 0);
  const intrinsicValuePerShare = sharesOutstanding > 0 ? equityValue / sharesOutstanding : 0;
  const upside = currentPrice > 0 ? (intrinsicValuePerShare - currentPrice) / currentPrice : 0;
  
  // === BUYBACK ADJUSTMENT ===
  let buybackAdjustedIV = null;
  let buybackYield = 0;
  let futureSharesReduction = 0;
  
  if (repurchaseOfStock < 0 && currentPrice > 0 && sharesOutstanding > 0) {
    buybackYield = Math.abs(repurchaseOfStock) / marketCap;
    
    // Only apply if >1% annual buyback yield
    if (buybackYield > 0.01) {
      // Estimate future share count reduction (conservative: 50% of current rate)
      const annualReduction = buybackYield * 0.5;
      futureSharesReduction = 1 - Math.pow(1 - annualReduction, 10);
      const futureShares = sharesOutstanding * (1 - futureSharesReduction);
      
      // Buyback-adjusted per-share value
      buybackAdjustedIV = equityValue / futureShares;
    }
  }
  
  const buybackAdjustedUpside = buybackAdjustedIV && currentPrice > 0 
    ? (buybackAdjustedIV - currentPrice) / currentPrice 
    : null;
  
  // Sensitivity matrix
  const waccValues = [0.08, 0.085, 0.09, 0.095, 0.10, 0.105, 0.11];
  const terminalGrowthValues = [0.015, 0.02, 0.025, 0.03, 0.035];
  
  const sensitivityMatrix = waccValues.map(w => 
    terminalGrowthValues.map(tg => {
      const tgCapped = Math.min(tg, w - 0.01);
      let pv = 0, prevRev = totalRevenue;
      let y10fcf = 0, y10df = 0;
      
      for (let y = 1; y <= 10; y++) {
        const g = y <= 5 
          ? phase1Growth - (phase1Decay * (y - 1))
          : phase1EndRate - (phase1EndRate - phase2Target) * ((y - 5) / 5);
        const gAdj = Math.max(g, phase2Target);
        
        const m = y <= 5 ? fcfMargin : fcfMargin - (fcfMargin - terminalFCFMargin) * ((y - 5) / 5);
        const rev = prevRev * (1 + gAdj);
        const fcfVal = rev * m;
        const df = 1 / Math.pow(1 + w, y);
        pv += fcfVal * df;
        if (y === 10) { y10fcf = fcfVal; y10df = df; }
        prevRev = rev;
      }
      
      const tv = (y10fcf * (1 + tgCapped)) / (w - tgCapped);
      const pvtv = tv * y10df;
      const ev = pv + pvtv + netCash;
      return Math.max(ev / sharesOutstanding, 0);
    })
  );
  
  // Find market-implied assumptions
  let marketImpliedWacc = null, marketImpliedTg = null;
  let minDiff = Infinity;
  for (let wi = 0; wi < sensitivityMatrix.length; wi++) {
    for (let ti = 0; ti < sensitivityMatrix[wi].length; ti++) {
      const diff = Math.abs(sensitivityMatrix[wi][ti] - currentPrice);
      if (diff < minDiff) {
        minDiff = diff;
        marketImpliedWacc = waccValues[wi];
        marketImpliedTg = terminalGrowthValues[ti];
      }
    }
  }
  
  const terminalPercent = pvOfTerminal / (pvOfFCFs + pvOfTerminal);
  const isFinancialSector = sector.toLowerCase().includes('financial') || sector.toLowerCase().includes('bank');
  const isReit = industry.toLowerCase().includes('reit') || industry.toLowerCase().includes('real estate');
  
  return {
    ticker,
    name,
    currentPrice,
    sharesOutstanding,
    inputs: {
      baseFCF,
      baseFCFPerShare: sharesOutstanding > 0 ? baseFCF / sharesOutstanding : 0,
      baseRevenue: totalRevenue,
      baseRevenuePerShare: sharesOutstanding > 0 ? totalRevenue / sharesOutstanding : 0,
      phase1Growth,
      phase2Growth,
      terminalGrowthRate,
      fcfMargin,
      fcfMarginTerminal: terminalFCFMargin,
      wacc,
      waccComponents: {
        riskFreeRate,
        equityRiskPremium,
        beta,
        adjustedBeta,
        costOfEquity,
        costOfDebt,
        taxRate: 0.21,
        costOfDebtAfterTax,
        marketCap,
        totalDebt,
        equityWeight,
        debtWeight
      },
      netCash,
      netCashPerShare: sharesOutstanding > 0 ? netCash / sharesOutstanding : 0,
      growthSource
    },
    projections: projections.map(p => ({
      year: p.year,
      revenue: p.revenue,
      revenueGrowth: p.revenueGrowth,
      fcfMargin: p.fcfMargin,
      fcf: p.fcf,
      discountFactor: p.discountFactor,
      presentValue: p.presentValue
    })),
    terminalValue: {
      terminalFCF,
      terminalValue,
      pvOfTerminal,
      terminalAsPercentOfTotal: terminalPercent
    },
    valuation: {
      pvOfFCFs,
      pvOfTerminal,
      enterpriseValue,
      netCash,
      equityValue,
      sharesOutstanding,
      intrinsicValuePerShare,
      currentPrice,
      upside,
      marginOfSafety: upside * 100,
      buybackAdjustedIV,
      buybackAdjustedUpside,
      buybackYield,
      futureSharesReduction
    },
    sensitivity: {
      waccValues,
      terminalGrowthValues,
      matrix: sensitivityMatrix
    },
    marketImplied: marketImpliedWacc && marketImpliedTg ? {
      wacc: marketImpliedWacc,
      terminalGrowth: marketImpliedTg
    } : null,
    warnings: {
      terminalHeavy: terminalPercent > 0.75,
      financialSector: isFinancialSector,
      reit: isReit,
      negativeFCF: baseFCF < 0,
      highGrowth: phase1Growth > 0.25,
      acquisitionGrowth: (manualRevenueGrowth > 0.25 || yahooRevenueGrowth > 0.25) && currentPrice < 100e9 ? 
        "Note: High revenue growth may include acquisitions. Organic growth is likely lower. Consider adjusting Phase 1 manually." : null
    },
    dataSources: {
      fcfSource,
      growthSource,
      manualRevenueGrowth: manualRevenueGrowth,
      yahooRevenueGrowth: yahooRevenueGrowth,
      earningsGrowth: earningsGrowth,
      betaSource: "yahoo_5yr_monthly",
      debtDataSource: totalDebt > 0 ? "financialData" : "estimated"
    }
  };
}

// Extract comprehensive metrics from Yahoo Finance quoteSummary data
async function fetchCompMetrics(ticker) {
  try {
    const data = await yahooFinance.quoteSummary(
      ticker,
      { modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'summaryProfile'] },
      YAHOO_QUOTE_SUMMARY_MODULE_OPTS
    );
    
    const p = data.price || {};
    const sd = data.summaryDetail || {};
    const ks = data.defaultKeyStatistics || {};
    const fd = data.financialData || {};
    const sp = data.summaryProfile || {};
    
    const price = yfNum(p.regularMarketPrice);
    const marketCap = yfNum(p.marketCap);
    const sharesOutstanding = yfNum(p.sharesOutstanding) || yfNum(ks.sharesOutstanding);
    const enterpriseValue = yfNum(ks.enterpriseValuationMRQ);
    
    // Valuation metrics with fallbacks
    let trailingPE = yfNum(sd.trailingPE);
    let forwardPE = yfNum(sd.forwardPE) || yfNum(ks.forwardPE);
    let pegRatio = yfNum(ks.pegRatio);
    let priceToSales = yfNum(sd.priceToSalesTrailing12Months);
    let priceToBook = yfNum(ks.priceToBook);
    let evToEbitda = yfNum(ks.enterpriseToEbitda);
    let evToRevenue = yfNum(ks.enterpriseToRevenue);
    
    // Fallback calculations
    const trailingEps = yfNum(ks.trailingEps);
    const forwardEps = yfNum(ks.forwardEps);
    const bookValuePerShare = yfNum(ks.bookValue);
    const totalRevenue = yfNum(fd.totalRevenue);
    const ebitda = yfNum(fd.ebitda);
    const totalDebt = yfNum(fd.totalDebt);
    const totalCash = yfNum(fd.totalCash);
    
    // Calculate missing metrics from available data
    if (!trailingPE && price && trailingEps && trailingEps > 0) {
      trailingPE = price / trailingEps;
    }
    if (!forwardPE && price && forwardEps && forwardEps > 0) {
      forwardPE = price / forwardEps;
    }
    if (!priceToSales && marketCap && totalRevenue && totalRevenue > 0) {
      priceToSales = marketCap / totalRevenue;
    }
    if (!priceToBook && price && bookValuePerShare && bookValuePerShare > 0) {
      priceToBook = price / bookValuePerShare;
    }
    if (!evToEbitda && enterpriseValue && ebitda && ebitda > 0) {
      evToEbitda = enterpriseValue / ebitda;
    }
    if (!evToRevenue && enterpriseValue && totalRevenue && totalRevenue > 0) {
      evToRevenue = enterpriseValue / totalRevenue;
    }
    if (!pegRatio && trailingPE && fd.earningsGrowth && yfNum(fd.earningsGrowth) > 0) {
      pegRatio = trailingPE / (yfNum(fd.earningsGrowth) * 100);
    }
    
    // Margins and growth (convert decimals to percentages)
    const grossMargin = yfNum(fd.grossMargins) !== null ? yfNum(fd.grossMargins) * 100 : null;
    const operatingMargin = yfNum(fd.operatingMargins) !== null ? yfNum(fd.operatingMargins) * 100 : null;
    const revenueGrowth = yfNum(fd.revenueGrowth) !== null ? yfNum(fd.revenueGrowth) * 100 : null;
    const earningsGrowth = yfNum(fd.earningsGrowth) !== null ? yfNum(fd.earningsGrowth) * 100 : null;
    const dividendYield = yfNum(sd.dividendYield) !== null ? yfNum(sd.dividendYield) * 100 : null;
    const roe = yfNum(fd.returnOnEquity);
    
    return {
      ticker,
      name: p.longName || p.shortName || ticker,
      sector: sp.sector || 'Unknown',
      industry: sp.industry || 'Unknown',
      price,
      marketCap,
      sharesOutstanding,
      enterpriseValue,
      trailingPE: trailingPE > 0 && trailingPE < 500 ? trailingPE : null,
      forwardPE: forwardPE > 0 && forwardPE < 500 ? forwardPE : null,
      pegRatio: pegRatio > 0 && pegRatio < 20 ? pegRatio : null,
      priceToSales: priceToSales > 0 && priceToSales < 100 ? priceToSales : null,
      priceToBook: priceToBook > 0 && priceToBook < 100 ? priceToBook : null,
      evToEbitda: evToEbitda > 0 && evToEbitda < 100 ? evToEbitda : null,
      evToRevenue: evToRevenue > 0 && evToRevenue < 50 ? evToRevenue : null,
      grossMargin,
      operatingMargin,
      revenueGrowth,
      earningsGrowth,
      dividendYield,
      roe,
      trailingEps,
      forwardEps,
      bookValuePerShare,
      totalRevenue,
      ebitda,
      totalDebt,
      totalCash
    };
  } catch (err) {
    console.log(`Failed to fetch metrics for ${ticker}: ${err.message}`);
    return null;
  }
}

// DCF endpoint
app.get('/api/dcf/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const data = await fetchQuoteData(ticker);
    const dcf = calculateDCF(data);
    
    res.json({
      success: true,
      ...dcf
    });
  } catch (error) {
    console.error(`Error calculating DCF for ${req.params.ticker}:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Comps endpoint
app.get('/api/comps/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    
    // Check cache
    const cached = COMPS_CACHE.get(ticker);
    if (cached && Date.now() - cached.timestamp < COMPS_CACHE_TTL) {
      return res.json({ ...cached.data, cached: true });
    }
    
    // Get peers from analysis engine
    const fullData = await fetchQuoteData(ticker);
    const { peers: peerTickers, source } = getPeers(ticker, fullData.industry, fullData.sector);
    
    // Fetch target and peer metrics using the dedicated function
    const [target, ...peerResults] = await Promise.all([
      fetchCompMetrics(ticker),
      ...peerTickers.map(t => fetchCompMetrics(t))
    ]);
    
    if (!target) {
      return res.status(500).json({ success: false, error: `Failed to fetch data for ${ticker}` });
    }
    
    const peers = peerResults.filter(p => p !== null);
    
    // Calculate comps
    const comps = calculateComps({
      ticker,
      name: fullData.name,
      industry: fullData.industry,
      sector: fullData.sector,
      ...target,
      peers,
      peerSource: source
    });
    
    const responseData = { success: true, ...comps };
    COMPS_CACHE.set(ticker, { data: responseData, timestamp: Date.now() });
    
    res.json(responseData);
  } catch (error) {
    console.error(`Error calculating comps for ${req.params.ticker}:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Network input endpoint
app.post('/api/analysis/:ticker/network-input', (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  const { networkEffectScore, label } = req.body;
  
  if (networkEffectScore === undefined || !label) {
    return res.status(400).json({ success: false, error: 'networkEffectScore and label required' });
  }
  
  NETWORK_INPUT_CACHE.set(ticker, { score: networkEffectScore, label, timestamp: Date.now() });
  
  res.json({ success: true, message: `Network effect input saved for ${ticker}` });
});

app.get('/api/analysis/:ticker/network-input', (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  const input = NETWORK_INPUT_CACHE.get(ticker);
  
  res.json({
    success: true,
    hasInput: !!input,
    input: input || null
  });
});

// =====================================================================
// BACKTEST FUNDAMENTAL SCORING
// =====================================================================

const TECH_SECTORS = ['technology', 'information technology', 'software', 'semiconductors', 'hardware'];
const HIGH_MARGIN_SOFTWARE = ['software', 'internet', 'cloud'];
const HIGH_MARGIN_HARDWARE = ['semiconductors', 'hardware', 'equipment'];
const HIGH_SWITCHING_SOFTWARE = ['software', 'enterprise software', 'saas', 'cloud'];
const HIGH_SWITCHING_FINANCIAL = ['banks', 'insurance', 'asset management', 'financial'];
const HIGH_SWITCHING_HEALTHCARE = ['healthcare', 'pharmaceuticals', 'biotechnology', 'medical devices'];
const HIGH_RD_INDUSTRIES = ['biotechnology', 'pharmaceuticals', 'software', 'semiconductors', 'technology hardware'];
const HIGH_BARRIER_DEFENSE = ['defense', 'aerospace', 'airlines'];
const HIGH_BARRIER_UTILITY = ['utilities', 'pipeline', 'infrastructure'];
const REGULATED_INDUSTRIES = ['banking', 'insurance', 'financial', 'utilities', 'healthcare'];

function calculateFundamentalScore(data, ticker) {
  try {
    const fd = data.financialData || {};
    const sd = data.summaryDetail || {};
    const ks = data.defaultKeyStatistics || {};
    const p = data.price || {};
    const sp = data.summaryProfile || {};

    const pct = {
      gm: (fd.grossMargins || 0) * 100,
      om: (fd.operatingMargins || 0) * 100,
      nm: (fd.netMargins || fd.profitMargins || 0) * 100,
      roe: (fd.returnOnEquity || 0) * 100,
      roa: (fd.returnOnAssets || 0) * 100,
      revGrowth: (fd.revenueGrowth || 0) * 100,
      earnGrowth: (fd.earningsGrowth || 0) * 100
    };

    // 1. BUFFETT QUALITY (0-100)
    let buffettScore = 0;
    const passChecks = [];

    // Owner earnings yield (simplified)
    const fcf = fd.freeCashFlow || 0;
    const marketCap = p.marketCap || 0;
    const ownerEarningsYield = marketCap > 0 ? (fcf / marketCap) * 100 : 0;
    if (ownerEarningsYield > 4.3) { buffettScore += 17; passChecks.push(true); }
    else if (ownerEarningsYield > 2) { buffettScore += 12; passChecks.push(true); }
    else if (ownerEarningsYield > 0) { buffettScore += 6; }

    // ROE
    if (pct.roe > 20) { buffettScore += 17; passChecks.push(true); }
    else if (pct.roe > 15) { buffettScore += 12; passChecks.push(true); }
    else if (pct.roe > 10) { buffettScore += 6; }

    // Margins
    if (pct.gm > 50) { buffettScore += 17; passChecks.push(true); }
    else if (pct.gm > 40) { buffettScore += 12; passChecks.push(true); }
    else if (pct.gm > 30) { buffettScore += 6; }

    // Debt/Equity
    const de = fd.debtToEquity || 0;
    if (de < 50) { buffettScore += 17; passChecks.push(true); }
    else if (de < 100) { buffettScore += 12; passChecks.push(true); }
    else if (de < 200) { buffettScore += 6; }

    // Earnings consistency
    if (pct.earnGrowth > 10) { buffettScore += 16; passChecks.push(true); }
    else if (pct.earnGrowth > 0) { buffettScore += 10; }
    else { buffettScore += 3; }

    // Buyback signal
    const repurchase = sd.payoutRatio || 0;
    if (repurchase < 0.3 && pct.roe > 15) { buffettScore += 16; passChecks.push(true); }
    else if (repurchase < 0.5) { buffettScore += 10; }

    buffettScore = Math.min(100, Math.max(0, buffettScore));

    // 2. MOAT SCORE (0-100)
    let moatScore = 0;

    // Supply side: margins + growth
    if (pct.gm > 50) moatScore += 20;
    else if (pct.gm > 40) moatScore += 15;
    else if (pct.gm > 30) moatScore += 10;

    if (pct.om > 25) moatScore += 15;
    else if (pct.om > 15) moatScore += 10;
    else if (pct.om > 5) moatScore += 5;

    if (pct.revGrowth > 15) moatScore += 10;
    else if (pct.revGrowth > 5) moatScore += 6;

    // Network effects signal (tech sector)
    const sector = (sp.sector || '').toLowerCase();
    const industry = (sp.industry || '').toLowerCase();
    if (TECH_SECTORS.some(t => sector.includes(t))) {
      if (industry.includes('software') || industry.includes('internet')) moatScore += 20;
      else if (industry.includes('cloud') || industry.includes('platform')) moatScore += 15;
      else moatScore += 8;
    }

    // Switching costs
    if (HIGH_SWITCHING_SOFTWARE.some(s => industry.includes(s))) moatScore += 15;
    if (HIGH_SWITCHING_FINANCIAL.some(s => sector.includes(s) || industry.includes(s))) moatScore += 12;
    if (HIGH_SWITCHING_HEALTHCARE.some(s => industry.includes(s))) moatScore += 10;

    // Learning curve / R&D
    if (HIGH_RD_INDUSTRIES.some(s => industry.includes(s))) {
      if (pct.gm > 50) moatScore += 15;
      else if (pct.gm > 30) moatScore += 8;
    }

    moatScore = Math.min(100, Math.max(0, moatScore));

    // 3. ROIC (simplified)
    const roa = pct.roa || 5;
    const assetTurnover = (fd.totalRevenue || 0) / (p.totalAssets || 1);
    const equity = marketCap / (p.priceToBook || 10);
    const roic = roa * assetTurnover || (pct.nm * assetTurnover) || roa;

    // WACC approximation
    const beta = sd.beta || 1;
    const costOfEquity = 0.043 + beta * 0.055;
    const roicSpread = roic - costOfEquity;

    let roicScore = 0;
    if (roicSpread >= 15) roicScore = 100;
    else if (roicSpread >= 10) roicScore = 85;
    else if (roicSpread >= 5) roicScore = 70;
    else if (roicSpread >= 2) roicScore = 50;
    else if (roicSpread >= 0) roicScore = 30;
    else roicScore = Math.max(0, 20 + roicSpread * 5);

    // 4. EARNINGS QUALITY (simplified)
    const opCash = fd.operatingCashflow || 0;
    const rev = fd.totalRevenue || 1;
    const accruals = Math.abs(pct.nm - (opCash / rev) * 100);
    let eqScore = 50;
    if (accruals < 5) eqScore += 25;
    else if (accruals < 10) eqScore += 15;
    else if (accruals > 20) eqScore -= 20;

    if (pct.nm > 15) eqScore += 15;
    else if (pct.nm > 10) eqScore += 8;

    if (pct.roe > 15) eqScore += 10;
    eqScore = Math.min(100, Math.max(0, eqScore));

    // 5. SHAREHOLDER YIELD (simplified)
    const divYield = (sd.dividendYield || 0) * 100;
    const payout = sd.payoutRatio || 0;
    const buybackYield = payout < 0.3 && pct.roe > 15 ? 2.5 : 0;
    const tsy = divYield + buybackYield;

    let tsyScore = 0;
    if (tsy >= 6) tsyScore = 100;
    else if (tsy >= 4) tsyScore = 80;
    else if (tsy >= 3) tsyScore = 65;
    else if (tsy >= 2) tsyScore = 50;
    else if (tsy >= 1) tsyScore = 30;
    else tsyScore = 15;

    // 6. GROWTH CONSTRAINTS (penalty)
    let constraintPenalty = 0;
    const pe = sd.forwardPE || ks.forwardPE || 0;

    // Valuation constraint
    if (pe > 40) constraintPenalty -= 3;
    else if (pe > 30) constraintPenalty -= 2;

    // Debt constraint
    if (de > 200) constraintPenalty -= 3;
    else if (de > 100) constraintPenalty -= 1;

    // Concentration constraint (revenue growth deceleration)
    if (pct.revGrowth < 2 && pct.earnGrowth < 0) constraintPenalty -= 2;

    // 7. AI DISRUPTION SIGNAL
    let aiBonus = 0;
    const aiThreat = ['software', 'internet', 'cloud', 'platform'].some(s => industry.includes(s));
    if (aiThreat && (industry.includes('enterprise') || industry.includes('legacy'))) aiBonus = -3;
    else if (aiThreat) aiBonus = 2;

    // 8. SIMPLIFIED DCF (0-100)
    const price = p.regularMarketPrice || p.price || sd.previousClose || 0;
    const shares = p.sharesOutstanding || (marketCap > 0 && price > 0 ? marketCap / price : 0);
    const annualFCF = Number(fd.freeCashFlow) || Number(fd.operatingCashflow || 0) * 0.75 || 0;
    const netCash = (Number(fd.totalCash) || 0) - (Number(fd.totalDebt) || 0);

    const wacc = 0.043 + (beta || 1) * 0.055;
    const terminalGrowth = 0.025;
    const baseGrowth = Math.min(Math.max((pct.earnGrowth || pct.revGrowth || 5) / 100, -0.05), 0.30);

    let dcfScore = 50;
    let dcfUpside = 0;
    let dcfIntrinsicValue = 0;

    if (annualFCF > 0 && shares > 0 && price > 0 && wacc > terminalGrowth) {
      let pvFCF = 0;
      let projectedFCF = annualFCF;
      for (let yr = 1; yr <= 5; yr++) {
        const yearGrowth = baseGrowth * (1 - (yr - 1) * 0.15);
        projectedFCF *= (1 + yearGrowth);
        pvFCF += projectedFCF / Math.pow(1 + wacc, yr);
      }
      const terminalValue = (projectedFCF * (1 + terminalGrowth)) / (wacc - terminalGrowth);
      const pvTerminal = terminalValue / Math.pow(1 + wacc, 5);
      const enterpriseValue = pvFCF + pvTerminal + netCash;
      dcfIntrinsicValue = enterpriseValue / shares;
      dcfUpside = (dcfIntrinsicValue - price) / price;

      if (dcfUpside >= 0.40) dcfScore = 100;
      else if (dcfUpside >= 0.25) dcfScore = 85;
      else if (dcfUpside >= 0.10) dcfScore = 70;
      else if (dcfUpside >= 0) dcfScore = 55;
      else if (dcfUpside >= -0.10) dcfScore = 40;
      else if (dcfUpside >= -0.25) dcfScore = 25;
      else dcfScore = 10;
    }

    // FUNDAMENTAL COMPOSITE
    const fundamentalComposite = Math.max(0, Math.min(100,
      buffettScore * 0.25 +
      moatScore * 0.20 +
      roicScore * 0.20 +
      eqScore * 0.15 +
      tsyScore * 0.10 +
      (buffettScore + moatScore) / 2 * 0.10 +
      constraintPenalty +
      aiBonus
    ));

    return {
      ticker,
      name: p.longName || p.shortName || ticker,
      sector: sp.sector || '',
      industry: sp.industry || '',
      marketCap,
      buffettScore,
      moatScore,
      roicScore,
      roicSpread: parseFloat(roicSpread.toFixed(1)),
      eqScore,
      tsyScore,
      totalShareholderYield: parseFloat(tsy.toFixed(2)),
      constraintPenalty,
      aiBonus,
      dcfScore,
      dcfUpside: parseFloat((dcfUpside * 100).toFixed(1)),
      dcfIntrinsicValue: parseFloat(dcfIntrinsicValue.toFixed(2)),
      fundamentalComposite: parseFloat(fundamentalComposite.toFixed(1)),
      forwardPE: sd.forwardPE || ks.forwardPE || 0,
      trailingPE: sd.trailingPE || 0,
      grossMargin: pct.gm,
      operatingMargin: pct.om,
      forwardEps: ks.forwardEps || 0,
      beta: sd.beta || 1
    };
  } catch (e) {
    return null;
  }
}

function calculateDynamicValuation(currentPrice, fundData, priceData, asOfDate) {
  let score = 50;
  let signals = 0;
  let totalSignal = 0;

  const available = priceData.filter(p => p.date <= asOfDate);
  const last252 = available.slice(-252);

  // Signal 1: Price vs 252-day average (mean-reversion signal)
  if (last252.length >= 200) {
    const avgPrice = last252.reduce((s, p) => s + p.close, 0) / last252.length;
    const priceVsAvg = (currentPrice - avgPrice) / avgPrice;

    if (priceVsAvg < -0.20) { totalSignal += 85; signals++; }
    else if (priceVsAvg < -0.10) { totalSignal += 70; signals++; }
    else if (priceVsAvg < 0) { totalSignal += 55; signals++; }
    else if (priceVsAvg < 0.10) { totalSignal += 45; signals++; }
    else if (priceVsAvg < 0.20) { totalSignal += 30; signals++; }
    else { totalSignal += 15; signals++; }
  }

  // Signal 2: Price vs 200-day MA (trend-following signal)
  const last200 = available.slice(-200);
  if (last200.length >= 180) {
    const ma200 = last200.reduce((s, p) => s + p.close, 0) / last200.length;
    const distFrom200 = (currentPrice - ma200) / ma200;

    if (distFrom200 < -0.15) { totalSignal += 80; signals++; }
    else if (distFrom200 < -0.05) { totalSignal += 65; signals++; }
    else if (distFrom200 < 0.10) { totalSignal += 50; signals++; }
    else if (distFrom200 < 0.25) { totalSignal += 35; signals++; }
    else { totalSignal += 15; signals++; }
  }

  // Signal 3: TREND QUALITY — reward smooth, consistent uptrends (PRO-MOMENTUM)
  // This adds unique information: not WHERE the price is, but HOW it got there
  if (available.length >= 126) {
    const last126 = available.slice(-126);

    // Count positive months out of last 6
    let positiveMonths = 0;
    for (let m = 0; m < 6; m++) {
      const startIdx = m * 21;
      const endIdx = Math.min((m + 1) * 21, last126.length - 1);
      if (startIdx < last126.length && endIdx < last126.length) {
        if (last126[endIdx].close > last126[startIdx].close) positiveMonths++;
      }
    }

    // Volatility of returns (lower = smoother trend)
    const rets = [];
    for (let i = 1; i < last126.length; i++) {
      if (last126[i - 1].close > 0) rets.push(Math.log(last126[i].close / last126[i - 1].close));
    }
    const vol = standardDeviation(rets) * Math.sqrt(252);

    // 6-month return
    const mom6m = (last126[last126.length - 1].close - last126[0].close) / last126[0].close;

    // Trend quality: consistent direction + low volatility + positive return
    let trendQuality = 30; // baseline
    if (positiveMonths >= 5 && mom6m > 0.05 && vol < 0.25) trendQuality = 80;
    else if (positiveMonths >= 4 && mom6m > 0.03 && vol < 0.30) trendQuality = 65;
    else if (positiveMonths >= 4 && mom6m > 0) trendQuality = 55;
    else if (positiveMonths >= 3 && mom6m > 0) trendQuality = 45;
    else if (positiveMonths <= 2 && mom6m < 0) trendQuality = 20;
    else if (mom6m < -0.10) trendQuality = 10;

    totalSignal += trendQuality;
    signals++;
  }

  // Quality adjustment
  const qualityAdjustment = (fundData.fundamentalComposite - 50) * 0.15;
  score = signals > 0 ? (totalSignal / signals) + qualityAdjustment : 50;
  score = Math.max(0, Math.min(100, score));

  return { score };
}

const FUNDAMENTALS_CACHE = new Map();
const FUNDAMENTALS_CACHE_TTL = 4 * 60 * 60 * 1000;

async function fetchFundamentals(ticker) {
  const upper = String(ticker).toUpperCase();
  const mem = FUNDAMENTALS_CACHE.get(upper);
  if (mem && Date.now() - mem.timestamp < FUNDAMENTALS_CACHE_TTL) {
    return mem.data;
  }
  const diskRow = readQuoteDiskCache(upper);
  if (diskRow?.rankingFundamentals) {
    FUNDAMENTALS_CACHE.set(upper, { data: diskRow.rankingFundamentals, timestamp: Date.now() });
    return diskRow.rankingFundamentals;
  }
  const quoteMem = QUOTE_CACHE.get(upper);
  if (quoteMem && Date.now() - quoteMem.timestamp < QUOTE_CACHE_TTL && quoteMem.data?.rankingFundamentals) {
    FUNDAMENTALS_CACHE.set(upper, { data: quoteMem.data.rankingFundamentals, timestamp: Date.now() });
    return quoteMem.data.rankingFundamentals;
  }
  try {
    const result = await yahooFinance.quoteSummary(
      ticker,
      { modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'summaryProfile'] },
      YAHOO_QUOTE_SUMMARY_MODULE_OPTS
    );
    const fund = calculateFundamentalScore(result, upper);
    if (fund) {
      FUNDAMENTALS_CACHE.set(upper, { data: fund, timestamp: Date.now() });
    }
    return fund;
  } catch (e) {
    console.error(`Failed fundamentals for ${ticker}: ${e.message}`);
    return null;
  }
}

/** Yahoo quoteSummary modules including statement histories (point-in-time fundamentals). */
const YAHOO_QUOTE_SUMMARY_PIT_MODULES = [
  'price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'summaryProfile',
  'incomeStatementHistory', 'balanceSheetHistory', 'cashflowStatementHistory'
];

/** @type {Map<string, Map<string, { merged: object, statementEndDate: string, stale: boolean }>>} */
const fundamentalsTimeSeriesCache = new Map();

/** One summary per (sim date, KC) when Yahoo only returns periods after cutoff (API window, not parser bug). */
const _pitYahooOnlyFutureWarned = new Set();

/** Raw Yahoo quoteSummary per ticker for PIT (prefetch once per request; value `null` = fetch failed). */
const YAHOO_RAW_PIT_CACHE = new Map();

async function prefetchPitYahooQuoteSummary(ticker) {
  const upper = String(ticker).toUpperCase();
  if (YAHOO_RAW_PIT_CACHE.has(upper)) return;
  try {
    const raw = await yahooFinance.quoteSummary(
      ticker,
      { modules: YAHOO_QUOTE_SUMMARY_PIT_MODULES },
      YAHOO_QUOTE_SUMMARY_MODULE_OPTS
    );
    YAHOO_RAW_PIT_CACHE.set(upper, raw);
  } catch (e) {
    console.warn(`[PIT] quoteSummary failed ${upper}: ${e.message}`);
    YAHOO_RAW_PIT_CACHE.set(upper, null);
  }
}

/** Normalize Yahoo date fields (ISO string, {raw,fmt}, unix sec or ms). */
function yahooEpochToIsoDate(epoch) {
  if (epoch == null || !Number.isFinite(epoch)) return null;
  const ms = epoch > 1e12 ? epoch : epoch * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function yfNumericDate(v) {
  if (v == null) return null;
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  }
  if (typeof v === 'number') {
    return yahooEpochToIsoDate(v);
  }
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }
  if (v && typeof v === 'object') {
    if (typeof v.fmt === 'string') {
      const m = v.fmt.match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) return m[1];
    }
    if (typeof v.raw === 'number') {
      return yahooEpochToIsoDate(v.raw);
    }
    if (typeof v.raw === 'string') {
      const m = v.raw.match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) return m[1];
    }
  }
  return null;
}

/** Calendar date string `asOfDateStr` minus FILING_LAG_DAYS (UTC). */
function knowledgeCutoffIso(asOfDateStr) {
  const d = new Date(`${asOfDateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - FILING_LAG_DAYS);
  return d.toISOString().slice(0, 10);
}

function fiscalQuarterKeyFromEndDate(iso) {
  if (!iso || iso.length < 10) return null;
  const y = parseInt(iso.slice(0, 4), 10);
  const m = parseInt(iso.slice(5, 7), 10);
  const q = m <= 3 ? 1 : m <= 6 ? 2 : m <= 9 ? 3 : 4;
  return `${y}-Q${q}`;
}

function filterStatementsByCutoff(list, knowledgeCutoff) {
  if (!Array.isArray(list)) return [];
  return list.filter((row) => {
    const ed = yfNumericDate(row?.endDate);
    return ed && ed <= knowledgeCutoff;
  });
}

/**
 * Point-in-time fundamentals for backtest/paper: latest statements knowable before asOf (filing lag).
 * @returns {Promise<{ fund: object|null, quarterKey: string|null, statementEndDate: string|null, pitOk: boolean, stale: boolean }>}
 */
async function fetchHistoricalFundamentals(ticker, asOfDateStr, priceHistory) {
  const upper = String(ticker).toUpperCase();
  const kc = knowledgeCutoffIso(asOfDateStr);
  const ph = priceHistory[upper] || priceHistory[ticker];
  const histPx = ph ? getPrice(ph, asOfDateStr) : null;

  if (!YAHOO_RAW_PIT_CACHE.has(upper)) {
    await prefetchPitYahooQuoteSummary(ticker);
  }
  const raw = YAHOO_RAW_PIT_CACHE.get(upper);
  if (raw == null) {
    const fb = await fetchFundamentals(ticker);
    return { fund: fb, quarterKey: null, statementEndDate: null, pitOk: false, stale: true };
  }

  const incAll = raw?.incomeStatementHistory?.incomeStatementHistory || [];
  const incFiltered = filterStatementsByCutoff(incAll, kc).sort((a, b) => {
    const da = yfNumericDate(a.endDate) || '';
    const db = yfNumericDate(b.endDate) || '';
    return db.localeCompare(da);
  });

  if (incFiltered.length === 0) {
    const parsedEnds = incAll.map((r) => yfNumericDate(r?.endDate)).filter(Boolean);
    const allParsed = parsedEnds.length === incAll.length && incAll.length > 0;
    const allAfterKc = allParsed && parsedEnds.every((ed) => ed > kc);
    if (allAfterKc) {
      const wk = `${asOfDateStr}|${kc}`;
      if (!_pitYahooOnlyFutureWarned.has(wk)) {
        _pitYahooOnlyFutureWarned.add(wk);
        const latest = [...parsedEnds].sort().pop();
        console.warn(
          `[PIT] Yahoo quoteSummary only returns recent fiscal periods (latest ~${latest}); all are after knowledge cutoff ${kc} for sim ${asOfDateStr}. Strict point-in-time financials are not available from this API for past rebalance dates — using fallback fund data per ticker.`
        );
      }
    } else {
      console.warn(`[PIT] no income rows <= KC ${kc} for ${upper}`);
    }
    const fb = await fetchFundamentals(ticker);
    return { fund: fb, quarterKey: null, statementEndDate: null, pitOk: false, stale: true };
  }

  const latestInc = incFiltered[0];
  const endIso = yfNumericDate(latestInc.endDate);
  const quarterKey = fiscalQuarterKeyFromEndDate(endIso);

  const tMap = fundamentalsTimeSeriesCache.get(upper) || new Map();
  fundamentalsTimeSeriesCache.set(upper, tMap);

  let mergedTemplate = tMap.get(quarterKey)?.merged;
  const staleByAge = endIso
    ? Math.round((new Date(`${asOfDateStr}T12:00:00`) - new Date(`${endIso}T12:00:00`)) / 86400000) > STALENESS_PENALTY_DAYS
    : false;

  if (!mergedTemplate) {
    console.log(`[PIT] cache MISS ${upper} ${quarterKey || endIso} — building`);
    const bsAll = raw?.balanceSheetHistory?.balanceSheetHistory || [];
    const cfAll = raw?.cashflowStatementHistory?.cashflowStatementHistory || [];
    const bsFiltered = filterStatementsByCutoff(bsAll, kc).sort((a, b) =>
      (yfNumericDate(b.endDate) || '').localeCompare(yfNumericDate(a.endDate) || ''));
    const cfFiltered = filterStatementsByCutoff(cfAll, kc).sort((a, b) =>
      (yfNumericDate(b.endDate) || '').localeCompare(yfNumericDate(a.endDate) || ''));

    const totalRev = Number(latestInc.totalRevenue?.raw ?? latestInc.totalRevenue ?? 0);
    const gp = Number(latestInc.grossProfit?.raw ?? latestInc.grossProfit ?? 0);
    const opInc = Number(latestInc.operatingIncome?.raw ?? latestInc.operatingIncome ?? 0);
    const ni = Number(latestInc.netIncome?.raw ?? latestInc.netIncome ?? 0);
    const gm = totalRev > 0 ? gp / totalRev : 0;
    const om = totalRev > 0 ? opInc / totalRev : 0;
    const nm = totalRev > 0 ? ni / totalRev : 0;

    const prevYear = incFiltered[4] || null;
    let revGrowth = 0;
    let earnGrowth = 0;
    if (prevYear && totalRev > 0) {
      const pr = Number(prevYear.totalRevenue?.raw ?? prevYear.totalRevenue ?? 0);
      const pn = Number(prevYear.netIncome?.raw ?? prevYear.netIncome ?? 0);
      if (pr > 0) revGrowth = (totalRev - pr) / pr;
      if (pn !== 0) earnGrowth = (ni - pn) / Math.abs(pn);
    }

    const bs0 = bsFiltered[0] || {};
    const cf0 = cfFiltered[0] || {};
    const eq = Number(bs0.totalStockholderEquity?.raw ?? bs0.totalStockholderEquity ?? 0);
    const assets = Number(bs0.totalAssets?.raw ?? bs0.totalAssets ?? 0);
    const debt = Number(bs0.totalDebt?.raw ?? bs0.totalDebt ?? bs0.longTermDebt?.raw ?? bs0.longTermDebt ?? 0);
    const cash = Number(bs0.cash?.raw ?? bs0.cash ?? 0);
    const ocf = Number(cf0.totalCashFromOperatingActivities?.raw ?? cf0.totalCashFromOperatingActivities ?? 0);
    const capex = Math.abs(Number(cf0.capitalExpenditures?.raw ?? cf0.capitalExpenditures ?? 0));
    const fcf = ocf - capex;

    mergedTemplate = {
      ...raw,
      incomeStatementHistory: { incomeStatementHistory: incFiltered.slice(0, 8) },
      balanceSheetHistory: { balanceSheetHistory: bsFiltered.slice(0, 8) },
      cashflowStatementHistory: { cashflowStatementHistory: cfFiltered.slice(0, 8) },
      financialData: {
        ...(raw.financialData || {}),
        grossMargins: gm,
        operatingMargins: om,
        profitMargins: nm,
        netMargins: nm,
        revenueGrowth: revGrowth,
        earningsGrowth: earnGrowth,
        returnOnEquity: eq > 0 ? ni / eq : (raw.financialData?.returnOnEquity ?? 0),
        returnOnAssets: assets > 0 ? ni / assets : (raw.financialData?.returnOnAssets ?? 0),
        debtToEquity: eq > 0 ? debt / eq : (raw.financialData?.debtToEquity ?? 0),
        freeCashFlow: fcf || (raw.financialData?.freeCashFlow ?? 0),
        totalCash: cash || (raw.financialData?.totalCash ?? 0),
        totalDebt: debt || (raw.financialData?.totalDebt ?? 0),
        ebitda: raw.financialData?.ebitda ?? 0,
        totalRevenue: totalRev || (raw.financialData?.totalRevenue ?? 0)
      }
    };
    if (quarterKey) {
      tMap.set(quarterKey, { merged: mergedTemplate, statementEndDate: endIso, stale: staleByAge });
    }
  } else {
    console.log(`[PIT] cache HIT ${upper} ${quarterKey}`);
  }

  const merged = {
    ...mergedTemplate,
    price: {
      ...(mergedTemplate.price || raw.price || {}),
      symbol: upper,
      regularMarketPrice: histPx ?? mergedTemplate.price?.regularMarketPrice ?? raw.price?.regularMarketPrice ?? 0
    }
  };

  const fund = calculateFundamentalScore(merged, upper);
  const stale = staleByAge || !fund;
  return { fund, quarterKey, statementEndDate: endIso, pitOk: true, stale };
}

/**
 * Load PIT fundamentals for universe at rebalance date (batched).
 * @returns {Promise<{ map: object, pointInTime: boolean, pitDetail: { ok: number, fallback: number, stale: number } }>}
 */
async function loadPitFundamentalsForUniverse(universe, asOfDateStr, priceHistory) {
  const tickers = universe.filter((t) => t && t !== 'SPY');
  const uncached = tickers.filter((t) => !YAHOO_RAW_PIT_CACHE.has(String(t).toUpperCase()));
  if (uncached.length > 0) {
    await mapWithConcurrency(uncached, FUNDAMENTALS_FETCH_CONCURRENCY, (ticker) => prefetchPitYahooQuoteSummary(ticker));
  }
  const map = {};
  let ok = 0;
  let fallback = 0;
  let stale = 0;
  for (const ticker of tickers) {
    const row = await fetchHistoricalFundamentals(ticker, asOfDateStr, priceHistory);
    if (row.fund && row.pitOk && !row.stale) ok++;
    else if (row.fund && row.pitOk && row.stale) {
      ok++;
      stale++;
    } else fallback++;
    if (row.fund) map[ticker] = row.fund;
  }
  const pointInTime = fallback === 0 && stale === 0;
  return { map, pointInTime, pitDetail: { ok, fallback, stale } };
}

function bt_rankFullComposite(universe, priceHistory, fundamentals, asOfDate) {
  const candidates = [];

  for (const ticker of universe) {
    if (ticker === 'SPY' || !ticker) continue;

    const prices = priceHistory[ticker];
    const fundData = fundamentals[ticker];

    if (!prices || prices.length < 120 || !fundData) continue;

    const momentum = bt_calculateMomentum(prices, asOfDate, 6);
    if (!momentum) continue;

    const priceValue = bt_calculateValueSignal(prices, asOfDate);
    if (!priceValue) continue;

    if (momentum.trendBonus <= -1 && priceValue.valueScore < 40) continue;
    if (momentum.annualizedVol > 0.80) continue;
    if (fundData.fundamentalComposite < 30) continue;
    if (fundData.constraintPenalty <= -7) continue;

    const dynamicVal = calculateDynamicValuation(momentum.currentPrice, fundData, prices, asOfDate);
    candidates.push({ ticker, mom: momentum, priceValue, dynamicVal, fundData });
  }

  const scores = [];

  for (const c of candidates) {
    const momNormalized = Math.max(0, Math.min(100, (c.mom.finalMomentumScore + 1) * 33));
    const dcf = c.fundData.dcfScore || 50;
    const fullComposite = (
      c.fundData.fundamentalComposite * 0.25 +
      dcf * 0.15 +
      c.dynamicVal.score * 0.20 +
      momNormalized * 0.25 +
      c.priceValue.valueScore * 0.15
    );

    scores.push({
      ticker: c.ticker,
      name: c.fundData.name,
      sector: c.fundData.sector,
      fundamentalScore: c.fundData.fundamentalComposite,
      dcfScore: dcf,
      dcfUpside: c.fundData.dcfUpside,
      momentumScore: momNormalized,
      valuationScore: c.dynamicVal.score,
      priceValueScore: c.priceValue.valueScore,
      buffettScore: c.fundData.buffettScore,
      moatScore: c.fundData.moatScore,
      roicSpread: c.fundData.roicSpread,
      eqScore: c.fundData.eqScore,
      aiImpact: c.fundData.aiBonus > 0 ? 'up' : c.fundData.aiBonus < 0 ? 'down' : 'neutral',
      compositeScore: parseFloat(fullComposite.toFixed(1)),
      price: c.mom.currentPrice,
      volatility: c.mom.annualizedVol,
      momentum6m: c.mom.rawMomentum,
      distFromHigh: c.priceValue.distFromHigh
    });
  }

  scores.sort((a, b) => b.compositeScore - a.compositeScore);
  return scores;
}

function bt_rankQualityMomentum(universe, priceHistory, fundamentals, asOfDate) {
  const scores = [];

  for (const ticker of universe) {
    if (ticker === 'SPY' || !ticker) continue;

    const prices = priceHistory[ticker];
    const fundData = fundamentals[ticker];

    if (!prices || prices.length < 120 || !fundData) continue;
    if (fundData.fundamentalComposite < 50) continue;
    if (fundData.constraintPenalty <= -7) continue;

    const momentum = bt_calculateMomentum(prices, asOfDate, 6);
    if (!momentum) continue;

    const momNormalized = Math.max(0, Math.min(100, (momentum.finalMomentumScore + 1) * 33));

    if (momentum.annualizedVol > 0.80) continue;

    scores.push({
      ticker,
      name: fundData.name,
      sector: fundData.sector,
      fundamentalScore: fundData.fundamentalComposite,
      momentumScore: momNormalized,
      compositeScore: momNormalized,
      price: momentum.currentPrice,
      volatility: momentum.annualizedVol,
      momentum6m: momentum.rawMomentum
    });
  }

  scores.sort((a, b) => b.compositeScore - a.compositeScore);
  return scores;
}

// =====================================================================
// BACKTEST ENDPOINT
// =====================================================================

const UNIVERSE_TICKERS = {
  sp500_top50: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'GOOG', 'BRK.B', 'LLY', 'AVGO', 'JPM', 'XOM', 'UNH', 'TSLA', 'V', 'JNJ', 'PG', 'MA', 'HD', 'CVX', 'MRK', 'ABBV', 'PEP', 'COST', 'KO', 'ADBE', 'ACN', 'TMO', 'MCD', 'CSCO', 'ABT', 'DHR', 'CRM', 'WMT', 'BAC', 'LIN', 'CMCSA', 'VRTX', 'NFLX', 'AMD', 'TXN', 'NEE', 'PM', 'ORCL', 'INTU', 'QCOM', 'AMGN', 'UPS', 'HON', 'RTX', 'LOW', 'IBM', 'SPY'],
  vgt: ['MSFT', 'AAPL', 'NVDA', 'AVGO', 'CRM', 'AMD', 'ADBE', 'CSCO', 'ACN', 'INTU', 'TXN', 'QCOM', 'IBM', 'NOW', 'SNOW', 'PANW', 'MU', 'AMAT', 'LRCX', 'KLAC', 'MPWR', 'CDNS', 'FTNT', 'ANET', 'ON', 'HPQ', 'DELL', 'NXPI', 'INTC', 'STX', 'WDC', 'SPY'],
  mag7: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'TSLA', 'SPY'],
  russell_growth: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'TSLA', 'AVGO', 'AMD', 'AMAT', 'NFLX', 'CRM', 'ADBE', 'NOW', 'INTU', 'QCOM', 'TXN', 'MU', 'AMGN', 'SPY'],
  dividend_aristocrats: ['MMM', 'ABT', 'ABBV', 'AFL', 'ADP', 'BALL', 'BAC', 'CAH', 'CCL', 'CAT', 'CB', 'CINF', 'CTAS', 'CVX', 'CLX', 'KO', 'CL', 'COP', 'CTSH', 'CVS', 'SPY']
};

/** UI + chart names for equal-weight universe benchmark (must match `universeId` route param). */
const UNIVERSE_BENCHMARK_LABELS = {
  sp500_top50: { shortLabel: 'S&P Top 50', chartLabel: 'Equal-weight S&P Top 50' },
  vgt: { shortLabel: 'VGT', chartLabel: 'VGT universe (equal-weight)' },
  mag7: { shortLabel: 'Mag 7', chartLabel: 'Mag 7 (equal-weight)' },
  russell_growth: { shortLabel: 'Russell growth', chartLabel: 'Russell growth (equal-weight)' },
  dividend_aristocrats: { shortLabel: 'Div. aristocrats', chartLabel: 'Dividend aristocrats (equal-weight)' }
};

function spearmanCorrelation(xs, ys) {
  if (xs.length !== ys.length || xs.length < 3) return 0;
  const n = xs.length;
  const rank = (arr) => {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    for (let i = 0; i < n; i++) ranks[sorted[i].i] = i + 1;
    return ranks;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  let sumD2 = 0;
  for (let i = 0; i < n; i++) sumD2 += (rx[i] - ry[i]) ** 2;
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

/** Diagnostic-optimized blend: quality-heavy, no DCF/dynamic valuation pillar in composite. */
const DEFAULT_COMPOSITE_WEIGHTS = { fundamental: 0.6, dcf: 0.0, valuation: 0.0, momentum: 0.2, value: 0.2 };
const AGGRESSIVE_COMPOSITE_WEIGHTS = { fundamental: 0.25, dcf: 0.00, valuation: 0.10, momentum: 0.40, value: 0.25 };
const TURBO_COMPOSITE_WEIGHTS = { fundamental: 0.10, dcf: 0.00, valuation: 0.05, momentum: 0.55, value: 0.30 };
const FACTOR_NAMES = ['fundamental', 'dcf', 'valuation', 'momentum', 'value'];
const FACTOR_LABELS = { fundamental: 'Quality', dcf: 'DCF', valuation: 'Valuation', momentum: 'Momentum', value: 'Value' };

/** Convert chart quotes (Date or string) to backtest price rows { date, close }. */
function historicalPricesToBtSeries(prices) {
  if (!prices || prices.length === 0) return [];
  return prices
    .map((p) => {
      const d = p.date;
      const dateStr = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
      return { date: dateStr, close: p.close };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Same 5-pillar blend as backtest `bt_rankFullCompositeV2` (linear momentum term; universe percentile step is omitted for single-name / scan).
 */
function computeBacktestStyleComposite(quoteData, historicalData, strategyClean = 'full_composite') {
  const fund = quoteData?.rankingFundamentals;
  if (!fund) return null;
  const priceSeries = historicalPricesToBtSeries(historicalData);
  if (priceSeries.length < 252) return null;

  const asOfDate = priceSeries[priceSeries.length - 1].date;
  const mom = bt_calculateMomentum(priceSeries, asOfDate, 6, null);
  const val = bt_calculateValueSignal(priceSeries, asOfDate);
  if (!mom || !val) return null;

  const momQ = calculateMomentumQuality(priceSeries, asOfDate);
  const mq = momQ?.score ?? 50;
  const momNorm = Math.max(0, Math.min(100, (mom.finalMomentumScore + 1) * 33));

  let w = DEFAULT_COMPOSITE_WEIGHTS;
  let momentumTerm = momNorm;
  let momQBonus = 0;

  if (strategyClean === 'full_composite_aggressive') {
    w = AGGRESSIVE_COMPOSITE_WEIGHTS;
    momentumTerm = momNorm * 0.65 + mq * 0.35;
  } else if (strategyClean === 'full_composite_turbo') {
    w = TURBO_COMPOSITE_WEIGHTS;
    momentumTerm = momNorm * 0.5 + mq * 0.5;
  } else {
    momQBonus = momQ ? (momQ.score - 50) * 0.1 : 0;
  }

  const dynVal = calculateDynamicValuation(mom.currentPrice, fund, priceSeries, asOfDate);
  const dcf = fund.dcfScore || 50;

  const raw =
    fund.fundamentalComposite * w.fundamental +
    dcf * w.dcf +
    dynVal.score * w.valuation +
    momentumTerm * w.momentum +
    val.valueScore * w.value +
    momQBonus;

  const compositeScore = Math.max(0, Math.min(100, Math.round(raw)));
  const g = gradeFromScore(compositeScore);

  const pillars = [
    { name: 'Fundamental', score: fund.fundamentalComposite, wf: w.fundamental },
    { name: 'DCF', score: dcf, wf: w.dcf },
    { name: 'Dynamic valuation', score: dynVal.score, wf: w.valuation },
    { name: 'Momentum', score: momentumTerm, wf: w.momentum },
    { name: 'Price value', score: val.valueScore, wf: w.value }
  ];

  const components = pillars.map((p) => ({
    name: p.name,
    score: p.score,
    weight: Math.round(p.wf * 100),
    weighted: parseFloat((p.score * p.wf).toFixed(1))
  }));

  const sorted = [...pillars].sort((a, b) => b.score - a.score);
  const strengths = sorted.slice(0, 2).map((s) => ({
    name: s.name,
    score: Math.round(s.score),
    insight: `${Math.round(s.score)}/100 on ${s.name}`
  }));
  const weaknesses = sorted.slice(-2).map((s) => ({
    name: s.name,
    score: Math.round(s.score),
    insight: `${Math.round(s.score)}/100 on ${s.name}`
  }));

  return {
    score: compositeScore,
    grade: g.grade,
    label: g.label,
    color: g.color,
    components,
    strengths,
    weaknesses,
    narrative: `Weighted like Full Composite backtest: fundamental ${Math.round(w.fundamental * 100)}%, DCF ${Math.round(w.dcf * 100)}%, dynamic valuation ${Math.round(w.valuation * 100)}%, momentum ${Math.round(w.momentum * 100)}%, price value ${Math.round(w.value * 100)}%.`,
    catalysts: {},
    finalScore: compositeScore,
    marginOfSafety: null,
    valuationScore: dynVal.score
  };
}

// =====================================================================
// OPTIMIZATION GUARDRAILS
// =====================================================================

const MAX_OPTIMIZATION_ROUNDS = 5;
const MAX_WEIGHT_DELTA_PER_ROUND = 0.03;
const MIN_SHARPE_IMPROVEMENT = 0.05;

const WEIGHT_BOUNDS = {
  fundamental: { min: 0.02, max: 0.70 },
  dcf:         { min: 0, max: 0.25 },
  valuation:   { min: 0.02, max: 0.35 },
  momentum:    { min: 0.02, max: 0.60 },
  value:       { min: 0.02, max: 0.30 }
};

function constrainWeightChanges(currentWeights, suggestedWeights) {
  const constrained = {};
  for (const f of FACTOR_NAMES) {
    const current = currentWeights[f] || 0;
    const suggested = suggestedWeights[f] || 0;
    const delta = Math.max(-MAX_WEIGHT_DELTA_PER_ROUND, Math.min(MAX_WEIGHT_DELTA_PER_ROUND, suggested - current));
    constrained[f] = current + delta;
  }
  const total = FACTOR_NAMES.reduce((s, f) => s + constrained[f], 0);
  for (const f of FACTOR_NAMES) constrained[f] = parseFloat((constrained[f] / total).toFixed(4));
  return constrained;
}

function applyWeightBounds(weights) {
  const bounded = {};
  for (const f of FACTOR_NAMES) {
    const b = WEIGHT_BOUNDS[f] || { min: 0.05, max: 0.35 };
    bounded[f] = Math.max(b.min, Math.min(b.max, weights[f] || 0));
  }
  const total = FACTOR_NAMES.reduce((s, f) => s + bounded[f], 0);
  for (const f of FACTOR_NAMES) bounded[f] = parseFloat((bounded[f] / total).toFixed(4));
  return bounded;
}

function checkWeightStability(weightHistory) {
  if (!weightHistory || weightHistory.length < 3) return { stable: true, maxVariance: '0.0', message: 'Insufficient rounds to assess stability' };
  const recent = weightHistory.slice(-3);
  let maxStd = 0;
  for (const f of FACTOR_NAMES) {
    const vals = recent.map(w => w[f] || 0);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / vals.length;
    const std = Math.sqrt(variance);
    if (std > maxStd) maxStd = std;
  }
  const stable = maxStd < 0.03;
  return {
    stable,
    maxVariance: (maxStd * 100).toFixed(1),
    message: stable ? 'Weights are converging — signal appears genuine' : 'Weights still fluctuating — optimization may be chasing noise'
  };
}

/**
 * Equal-dollar buy-and-hold of universe members (excluding SPY) from `startDate`.
 * SPY is only a broad-market leg for regime/momentum elsewhere, not part of this basket.
 */
function buildEqualWeightUniverseBenchmark(universe, priceHistory, capital, startDate) {
  if (!universe || !Array.isArray(universe) || !(capital > 0) || !startDate) return null;
  const tickers = universe.filter((t) => t && t !== 'SPY');
  const valid = [];
  for (const t of tickers) {
    const ph = priceHistory[t];
    const p0 = getPrice(ph, startDate);
    if (p0 != null && p0 > 0 && Number.isFinite(p0)) valid.push(t);
  }
  if (valid.length === 0) return null;
  const allocPer = capital / valid.length;
  const shares = {};
  for (const t of valid) {
    const p0 = getPrice(priceHistory[t], startDate);
    shares[t] = allocPer / p0;
  }
  return { tickers: valid, shares };
}

/** Same targets as DEFAULT_COMPOSITE_WEIGHTS; reference when an explicit fixed vector is needed. */
const EQUAL_FIXED_COMPOSITE_WEIGHTS = {
  fundamental: 0.6,
  dcf: 0.0,
  valuation: 0.0,
  momentum: 0.2,
  value: 0.2
};

/**
 * Normalize user/API pillar weights to FACTOR_NAMES; accepts `quality` as alias for `fundamental`.
 * @returns {Record<string, number>|null}
 */
function normalizePillarOverride(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = {};
  for (const f of FACTOR_NAMES) {
    const v = raw[f];
    o[f] = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }
  const q = raw.quality;
  if (typeof q === 'number' && Number.isFinite(q)) o.fundamental = q;
  const sum = FACTOR_NAMES.reduce((s, f) => s + (o[f] || 0), 0);
  if (sum <= 0) return null;
  for (const f of FACTOR_NAMES) o[f] = (o[f] || 0) / sum;
  return o;
}

function parsePillarOverrideQuery(qs) {
  if (qs == null || String(qs).trim() === '') return null;
  try {
    const parsed = typeof qs === 'string' ? JSON.parse(qs) : qs;
    return normalizePillarOverride(parsed);
  } catch {
    return null;
  }
}

/** Halve fundamental pillars when PIT fallback or stale snapshot used (renormalize). */
function applyPitStalenessPillarHalving(w) {
  const o = { ...w };
  o.fundamental = (o.fundamental || 0) * 0.5;
  o.dcf = (o.dcf || 0) * 0.5;
  o.valuation = (o.valuation || 0) * 0.5;
  const s = FACTOR_NAMES.reduce((a, f) => a + (o[f] || 0), 0);
  if (s > 0) for (const f of FACTOR_NAMES) o[f] = (o[f] || 0) / s;
  return o;
}

function universeBenchmarkValue(uniBench, priceHistory, date, priceByTicker = null) {
  if (!uniBench || !uniBench.tickers || uniBench.tickers.length === 0) return null;
  let sum = 0;
  let n = 0;
  for (const t of uniBench.tickers) {
    const px = priceByTicker ? priceByTicker[t] : getPrice(priceHistory[t], date);
    if (px != null && px > 0 && Number.isFinite(px)) {
      sum += uniBench.shares[t] * px;
      n++;
    }
  }
  if (n === 0 || !(sum > 0) || !Number.isFinite(sum)) return null;
  return sum;
}

async function runBacktestSimulation(universe, priceHistory, fundamentals, spyPrices, rebalanceDates, topN, capital, strategyClean, weights, getCashInflationMultiplier = null, universeId = null, simOptions = {}) {
  const amOpt =
    simOptions.adaptiveMode != null && simOptions.adaptiveMode !== ''
      ? String(simOptions.adaptiveMode).toLowerCase().trim()
      : '';
  const adaptiveMode = amOpt === 'adaptive' || amOpt === 'conservative' ? amOpt : 'fixed';
  const psRaw = simOptions.positionSizing || (strategyClean === 'full_composite' ? 'invVol' : 'equal');
  const positionSizing = ['equal', 'invVol', 'score', 'invVolBlend'].includes(psRaw) ? psRaw : 'invVol';
  const regimeEnabled = simOptions.regimeEnabled !== false;
  const pillarOverrideNorm =
    adaptiveMode === 'fixed' && simOptions.pillarOverride != null
      ? normalizePillarOverride(simOptions.pillarOverride)
      : null;
  /** When true, skip ML alpha / ML blend so composite ranks reflect pillar weights (factor diagnostics). */
  const skipMlRankingAdjustments = simOptions.skipMlRankingAdjustments === true;

  let initialPillarWeights = null;
  if (strategyClean === 'full_composite' || strategyClean === 'full_composite_aggressive' || strategyClean === 'full_composite_turbo') {
    const defaults = strategyClean === 'full_composite_aggressive' ? AGGRESSIVE_COMPOSITE_WEIGHTS
      : strategyClean === 'full_composite_turbo' ? TURBO_COMPOSITE_WEIGHTS
        : DEFAULT_COMPOSITE_WEIGHTS;
    weights = { ...defaults, ...(weights && typeof weights === 'object' ? weights : {}) };
    initialPillarWeights = { ...weights };
  }
  let cash = capital;
  const holdings = {};
  const tradeLog = [];
  const rebalanceLog = [];
  const holdingsSnapshots = [];
  const factorSnapshots = [];
  const regimeLog = [];
  let totalStopsTriggered = 0;
  let fundamentalsLive = fundamentals || {};
  let pitRunMeta = { pointInTime: true, pitDetail: { ok: 0, fallback: 0, stale: 0 } };
  let nameSwapCount = 0;
  /** Last rebalance adaptive output (for per-step drift cap). */
  let lastAdaptiveWeightsSnapshot = null;

  const rollingIcPeriods = Math.min(24, Math.max(1, parseInt(process.env.ROLLING_IC_PERIODS || '12', 10) || 12));
  const rollingAdaptive = new RollingAdaptiveState(rollingIcPeriods);
  const adaptiveWeightLog =
    process.env.ADAPTIVE_WEIGHT_LOG === '1' || process.env.ADAPTIVE_WEIGHT_LOG === 'true' ? [] : null;

  const spyStartPrice = getPrice(spyPrices, rebalanceDates[0]);
  const spyShares = spyStartPrice ? capital / spyStartPrice : 0;
  const startDate = rebalanceDates[0];
  const uniBench = buildEqualWeightUniverseBenchmark(universe, priceHistory, capital, startDate);
  const uLabels = universeId && UNIVERSE_BENCHMARK_LABELS[universeId]
    ? UNIVERSE_BENCHMARK_LABELS[universeId]
    : { shortLabel: 'Universe', chartLabel: 'Equal-weight universe' };
  const benchmarkMeta = uniBench
    ? {
        type: 'universe_equal_weight',
        universeId: universeId || null,
        shortLabel: uLabels.shortLabel,
        label: uLabels.chartLabel,
        description: `${uLabels.shortLabel}: buy-and-hold equal weight across ${uniBench.tickers.length} names (excl. SPY)`,
        stockCount: uniBench.tickers.length
      }
    : {
        type: 'spy_fallback',
        universeId: universeId || null,
        shortLabel: 'SPY',
        label: 'S&P 500 (SPY)',
        description: 'SPY buy-and-hold (fallback — insufficient universe price data for equal-weight benchmark)',
        stockCount: 0
      };
  const cashInflMult =
    typeof getCashInflationMultiplier === 'function'
      ? getCashInflationMultiplier
      : (iso) => Math.pow(1 + INFLATION_BASELINE_ANNUAL, daysBetween(startDate, iso) / 365.25);
  const usesFundamentals = strategyClean === 'full_composite' || strategyClean === 'full_composite_aggressive' || strategyClean === 'full_composite_turbo' || strategyClean === 'quality_momentum';
  const stopCheckInterval =
    strategyClean === 'full_composite' || strategyClean === 'quality_momentum'
      ? 1
      : strategyClean === 'full_composite_aggressive' || strategyClean === 'full_composite_turbo'
        ? 3
        : 5;

  holdingsSnapshots.push({ date: startDate, cash, holdings: {} });

  const allTradingDays = spyPrices
    .filter(p => p.date >= startDate && p.date <= rebalanceDates[rebalanceDates.length - 1])
    .map(p => p.date);

  let nextRebalanceIdx = 0;
  let rankWeightDebugLogged = false;
  const recentStops = {};
  /** Voluntary SELL only — used for rebuy cooldown (not STOP). */
  const recentSells = {};

  for (let dayIdx = 0; dayIdx < allTradingDays.length; dayIdx++) {
    const date = allTradingDays[dayIdx];

    const dailyPx = {};
    for (const tk of Object.keys(priceHistory)) {
      dailyPx[tk] = getPrice(priceHistory[tk], date);
    }

    if (trailingStopEnabled()) {
      for (const ticker of Object.keys(holdings)) {
        const h = holdings[ticker];
        const px = dailyPx[ticker];
        if (px && px > 0 && h.entryPrice > 0) {
          const prevPeak = h.peakPriceSinceEntry != null ? h.peakPriceSinceEntry : h.entryPrice;
          h.peakPriceSinceEntry = Math.max(prevPeak, px);
        }
      }
    }

    // --- Stop-loss: daily for full_composite / quality_momentum; every 3d aggressive/turbo; else 5d ---
    let snapshotNeeded = false;
    if (dayIdx % stopCheckInterval === 0 && Object.keys(holdings).length > 0) {
      const stopExits = checkStopLosses(holdings, priceHistory, date, fundamentalsLive, strategyClean);
      for (const exit of stopExits) {
        const holding = holdings[exit.ticker];
        if (!holding) continue;
        const proceeds = holding.shares * exit.exitPrice;
        cash += proceeds;
        tradeLog.push({
          date, type: 'STOP', ticker: exit.ticker,
          shares: holding.shares, price: exit.exitPrice, proceeds,
          holdingReturn: (exit.exitPrice - holding.entryPrice) / holding.entryPrice,
          holdingDays: daysBetween(holding.entryDate, date)
        });
        recentStops[exit.ticker] = { exitDate: date, exitPrice: exit.exitPrice };
        delete holdings[exit.ticker];
        totalStopsTriggered++;
        snapshotNeeded = true;
      }
    }

    // --- Re-entry check for recently stopped-out stocks ---
    if (dayIdx % stopCheckInterval === 0) {
      let portfolioValueForReentry = cash;
      for (const [t, h] of Object.entries(holdings)) {
        const p = dailyPx[t];
        if (p) portfolioValueForReentry += h.shares * p;
      }

      const nextRebalForReentry =
        nextRebalanceIdx < rebalanceDates.length ? rebalanceDates[nextRebalanceIdx] : null;

      for (const [ticker, stopInfo] of Object.entries(recentStops)) {
        const prices = priceHistory[ticker];
        if (!prices) continue;
        const lastIx = bsearchLastBeforeOrEqual(prices, date);
        if (lastIx < 19) continue;

        const curPrice = prices[lastIx].close;
        let s20 = 0;
        for (let j = lastIx - 19; j <= lastIx; j++) s20 += prices[j].close;
        const ma20 = s20 / 20;
        const daysSinceExit = daysBetween(stopInfo.exitDate, date);

        if (
          nextRebalForReentry != null &&
          daysBetween(date, nextRebalForReentry) < RE_ENTRY_MIN_DAYS_TO_NEXT_REBALANCE
        ) {
          continue;
        }

        if (daysSinceExit >= RE_ENTRY_MIN_WAIT_DAYS && curPrice > ma20) {
          const fullPosition = portfolioValueForReentry / topN;
          const shares = Math.floor(fullPosition / curPrice);
          if (shares > 0 && cash >= shares * curPrice) {
            const cost = shares * curPrice;
            cash -= cost;
            holdings[ticker] = {
              shares,
              entryPrice: curPrice,
              entryDate: date,
              ...(trailingStopEnabled() ? { peakPriceSinceEntry: curPrice } : {})
            };
            tradeLog.push({ date, type: 'REENTRY', ticker, shares, price: curPrice, cost });
            delete recentStops[ticker];
            snapshotNeeded = true;
          }
        }

        if (daysSinceExit > 60) delete recentStops[ticker];
      }
    }

    // Capture snapshot whenever holdings change between rebalances
    if (snapshotNeeded) {
      const hCopy = {};
      for (const [t, h] of Object.entries(holdings)) hCopy[t] = { shares: h.shares, entryPrice: h.entryPrice, entryDate: h.entryDate };
      holdingsSnapshots.push({ date, cash, holdings: hCopy });
    }

    // --- Rebalance on scheduled dates ---
    if (nextRebalanceIdx < rebalanceDates.length && date >= rebalanceDates[nextRebalanceIdx]) {
      const rebalDate = rebalanceDates[nextRebalanceIdx];
      nextRebalanceIdx++;

      if (usesFundamentals) {
        const pit = await loadPitFundamentalsForUniverse(universe, date, priceHistory);
        fundamentalsLive = pit.map;
        if (!pit.pointInTime) pitRunMeta.pointInTime = false;
        pitRunMeta.pitDetail = pit.pitDetail;
      }

      let regimeMeta;
      let exposure;
      if (!regimeEnabled) {
        exposure = 1.0;
        regimeMeta = { regime: 'disabled', breadthRatio: null };
      } else {
        regimeMeta = calculateMarketRegime(spyPrices, date, universe, priceHistory);
        exposure = getStrategyRegimeExposure(regimeMeta.regime, strategyClean);
      }
      regimeLog.push({ date, regime: regimeMeta.regime, exposure, breadthRatio: regimeMeta.breadthRatio });

      const isAggressiveStrategy = strategyClean === 'full_composite_aggressive' || strategyClean === 'full_composite_turbo';
      const regimeN = adjustedTopNForRegime(regimeMeta.regime, topN);
      const adjustedTopN = isAggressiveStrategy
        ? Math.max(Math.ceil(topN * 0.7), regimeN)
        : Math.max(3, regimeN);

      let weightsRankBt = weights;
      let rebalanceAdaptiveMeta = null;
      const compositeFam =
        strategyClean === 'full_composite' || strategyClean === 'full_composite_aggressive' || strategyClean === 'full_composite_turbo';

      if (compositeFam) {
        if (adaptiveMode === 'fixed') {
          if (pillarOverrideNorm) {
            weightsRankBt = { ...pillarOverrideNorm };
            rebalanceAdaptiveMeta = { icRollingStep: false, note: 'adaptiveMode_fixed_pillarOverride' };
          } else {
            // Static merged weights (DEFAULT + portfolio / passed-in), not a separate hardcoded equal split
            weightsRankBt = { ...weights };
            rebalanceAdaptiveMeta = { icRollingStep: false, note: 'adaptiveMode_fixed_static_weights' };
          }
        } else if (rebalanceLog.length >= 6) {
          const prevSnap = factorSnapshots.length > 0 ? factorSnapshots[factorSnapshots.length - 1] : null;
          const icN = prevSnap?.allRanked?.length ?? 0;
          if (prevSnap && prevSnap.allRanked && prevSnap.allRanked.length >= 6) {
            const wBase = { ...weights };
            const useRidge = process.env.ADAPTIVE_RIDGE === '1' || process.env.ADAPTIVE_RIDGE === 'true';
            const ridgeLambda = parseFloat(process.env.ADAPTIVE_RIDGE_LAMBDA || '1') || 1;
            const composed = composeAdaptiveWeightsForRebalance({
              weights,
              anchorWeights: { ...initialPillarWeights },
              prevRankedRows: prevSnap.allRanked,
              prevDateStr: prevSnap.date,
              asOfDateStr: date,
              priceHistory,
              spySeries: spyPrices,
              rollingState: rollingAdaptive,
              getPrice,
              maxDeltaPerFactor: 0.05,
              useRidge,
              ridgeLambda,
              momentumRegimeOpts: {},
              previousStepWeights: lastAdaptiveWeightsSnapshot,
              icObservationCount: icN,
              icMinObservations: Math.max(10, Math.min(30, universe.length)),
              rebalanceIndex: rebalanceLog.length
            });
            let wUse = composed.weights;
            if (adaptiveMode === 'conservative') {
              const regB = regimeAdjustedCompositeWeights({ ...weights }, spyAbove200dma(spyPrices, date));
              wUse = {};
              for (const f of FACTOR_NAMES) {
                wUse[f] = 0.8 * (regB[f] || 0) + 0.2 * (composed.weights[f] || 0);
              }
              const s0 = FACTOR_NAMES.reduce((a, f) => a + wUse[f], 0);
              for (const f of FACTOR_NAMES) wUse[f] = s0 > 0 ? wUse[f] / s0 : composed.weights[f];
            }
            const adaptiveDebugOn =
              process.env.ADAPTIVE_CLAMP_DEBUG === '1' ||
              String(process.env.ADAPTIVE_CLAMP_DEBUG || '').toLowerCase() === 'true' ||
              process.env.ADAPTIVE_WEIGHT_LOG === '1' ||
              String(process.env.ADAPTIVE_WEIGHT_LOG || '').toLowerCase() === 'true';
            if (adaptiveDebugOn) {
              const pct = (o) =>
                o
                  ? FACTOR_NAMES.map((f) => `${f}=${((o[f] ?? 0) * 100).toFixed(1)}%`).join(' ')
                  : '—';
              console.log(
                `[ADAPTIVE] backtest date=${date} anchor=[${pct(initialPillarWeights)}] prev=[${pct(lastAdaptiveWeightsSnapshot)}] composed=[${pct(composed.weights)}] wUse=[${pct(wUse)}]`,
              );
            }
            for (const f of FACTOR_NAMES) weights[f] = wUse[f];
            weightsRankBt = wUse;
            lastAdaptiveWeightsSnapshot = { ...wUse };
            const mr = composed.momentumRegime;
            rebalanceAdaptiveMeta = {
              icRollingStep: true,
              momentumRegimeTag: mr && typeof mr === 'object' ? (mr.tag ?? null) : mr,
              meanIcByFactor: composed.meanIcByFactor
            };
            if (adaptiveWeightLog) {
              const fundIc = composed.meanIcByFactor?.fundamental ?? 0;
              adaptiveWeightLog.push({
                date,
                meanIcByFactor: composed.meanIcByFactor,
                momentumRegime: composed.momentumRegime,
                periodIc: composed.periodIc,
                weightsAfter: { ...composed.weights },
                pivotedAwayFromQuality: fundIc < 0 && composed.weights.fundamental < wBase.fundamental - 1e-4
              });
            }
          } else {
            weightsRankBt = regimeAdjustedCompositeWeights(weights, spyAbove200dma(spyPrices, date));
            rebalanceAdaptiveMeta = { icRollingStep: false, note: 'prior_rank_too_small' };
          }
        } else {
          weightsRankBt = regimeAdjustedCompositeWeights(weights, spyAbove200dma(spyPrices, date));
          rebalanceAdaptiveMeta = { icRollingStep: false, note: 'warmup_rebalance' };
        }
      }

      if (compositeFam && pitRunMeta.pitDetail && (pitRunMeta.pitDetail.fallback > 0 || pitRunMeta.pitDetail.stale > 0)) {
        weightsRankBt = applyPitStalenessPillarHalving(weightsRankBt);
      }

      if (process.env.RANK_WEIGHT_DEBUG === '1' && compositeFam && !rankWeightDebugLogged) {
        rankWeightDebugLogged = true;
        console.log(
          `[RANK_WEIGHT_DEBUG] first rebalance ${date} adaptiveMode=${adaptiveMode} weightsRankBt=${JSON.stringify(weightsRankBt)}`,
        );
      }

      let rankings;

      if (strategyClean === 'momentum') rankings = bt_rankMomentumOnly(universe, priceHistory, date);
      else if (strategyClean === 'momentum_value') rankings = bt_rankMomentumValue(universe, priceHistory, date);
      else if (strategyClean === 'quality_momentum') rankings = bt_rankQualityMomentumV2(universe, priceHistory, fundamentalsLive, date);
      else if (strategyClean === 'full_composite') rankings = bt_rankFullCompositeV2(universe, priceHistory, fundamentalsLive, date, weightsRankBt);
      else if (strategyClean === 'full_composite_aggressive') {
        rankings = bt_rankFullCompositeV2(universe, priceHistory, fundamentalsLive, date, weightsRankBt, {
          momQThreshold: 10, fundamentalFloor: 15, maxVol: 1.0, strategyLabel: 'full_composite_aggressive',
          blendMomentumWithQuality: { raw: 0.7, quality: 0.3 }
        });
      } else if (strategyClean === 'full_composite_turbo') {
        rankings = bt_rankFullCompositeV2(universe, priceHistory, fundamentalsLive, date, weightsRankBt, {
          momQThreshold: 0, fundamentalFloor: 0, maxVol: 1.2, strategyLabel: 'full_composite_turbo',
          skipConstraintPenalty: true,
          blendMomentumWithQuality: { raw: 0.55, quality: 0.20 }
        });
      } else rankings = bt_rankMomentumValue(universe, priceHistory, date);

      if (
        !skipMlRankingAdjustments &&
        mlAlphaRankingEnabled() &&
        (strategyClean === 'full_composite' || strategyClean === 'full_composite_aggressive' || strategyClean === 'full_composite_turbo') &&
        fundamentalsLive &&
        spyPrices?.length
      ) {
        rankings = await applyMlAlphaRankingToCompositeRankings(rankings, fundamentalsLive, priceHistory, date, spyPrices);
      }

      const mlWBacktest = resolveMlRankWeight(null);
      if (
        !skipMlRankingAdjustments &&
        !mlAlphaRankingEnabled() &&
        (strategyClean === 'full_composite' || strategyClean === 'full_composite_aggressive' || strategyClean === 'full_composite_turbo') &&
        mlWBacktest > 0 &&
        fundamentalsLive
      ) {
        rankings = await applyMlBlendToCompositeRankings(rankings, fundamentalsLive, priceHistory, date, mlWBacktest, spyPrices);
      }

      if (strategyClean === 'full_composite' || strategyClean === 'full_composite_aggressive' || strategyClean === 'full_composite_turbo') {
        factorSnapshots.push({
          date,
          allRanked: rankings.map(r => ({
            ticker: r.ticker, fundamental: r.fundamentalScore, dcf: r.dcfScore,
            valuation: r.valuationScore, momentum: r.momentumScore, value: r.valueScore,
            composite: r.compositeScore, price: r.price
          }))
        });
      }

      const sectorCap = getMaxSectorConcentration(strategyClean);
      const topPicks = usesFundamentals
        ? applySectorLimits(rankings, fundamentalsLive, adjustedTopN, sectorCap)
        : rankings.slice(0, adjustedTopN);

      let portfolioValue = cash;
      for (const [ticker, holding] of Object.entries(holdings)) {
        const price = dailyPx[ticker];
        if (price) portfolioValue += holding.shares * price;
      }

      const investedCapital = portfolioValue * exposure;
      const compositeFamilySizing = strategyClean === 'full_composite' || strategyClean === 'full_composite_aggressive' || strategyClean === 'full_composite_turbo';
      let positionWeights;
      if (strategyClean === 'full_composite_aggressive' || strategyClean === 'full_composite_turbo') {
        positionWeights = calculateAggressiveVolatilityWeights(topPicks);
      } else if (compositeFamilySizing && positionSizing === 'invVol') {
        positionWeights = calculatePositionWeightsInvVol(topPicks, priceHistory, date);
      } else if (compositeFamilySizing && positionSizing === 'invVolBlend') {
        positionWeights = calculatePositionWeightsInvVol(topPicks, priceHistory, date, { equalBlend: 0.4 });
      } else if (compositeFamilySizing && positionSizing === 'score') {
        positionWeights = calculatePositionWeightsScore(topPicks);
      } else {
        positionWeights = calculatePositionWeights(topPicks);
      }

      const targetAllocation = {};
      for (const pick of topPicks) {
        const pw = positionWeights.find(w => w.ticker === pick.ticker);
        targetAllocation[pick.ticker] = {
          targetDollars: pw ? investedCapital * pw.weight : investedCapital / topPicks.length,
          score: pick.combinedScore || pick.compositeScore || 0,
          price: pick.price
        };
      }

      const heldSet = new Set(Object.keys(holdings));
      const incomingCandidates = topPicks.filter((p) => !heldSet.has(p.ticker));
      const lowestTopScore =
        topPicks.length > 0
          ? Math.min(...topPicks.map((p) => p.compositeScore ?? p.combinedScore ?? 0))
          : null;
      const maxHoldings = adjustedTopN + HOLDINGS_OVERFLOW_SLOTS;

      const scoreForTicker = (tick) => {
        const row = rankings.find((r) => r.ticker === tick);
        return row ? (row.compositeScore ?? row.combinedScore ?? 0) : 0;
      };

      const turnoverAllowsSell = (sOld) => {
        if (!incomingCandidates.length) return true;
        if (lowestTopScore == null) return true;
        if (!(sOld > 0)) return true;
        return lowestTopScore >= sOld * (1 + TURNOVER_SCORE_IMPROVEMENT_THRESHOLD);
      };

      const trades = [];

      const doRebalanceSell = (ticker, holding, sellPrice) => {
        nameSwapCount += 1;
        const proceeds = holding.shares * sellPrice;
        cash += proceeds;
        const holdingReturn = (sellPrice - holding.entryPrice) / holding.entryPrice;
        trades.push({
          type: 'SELL', ticker, shares: holding.shares, price: sellPrice, proceeds,
          holdingReturn,
          holdingDays: daysBetween(holding.entryDate, date)
        });
        recentSells[ticker] = { exitDate: date, exitPrice: sellPrice, exitReturn: holdingReturn };
        delete holdings[ticker];
        if (turnoverDebugEnabled()) {
          console.log(`[TURNOVER] SELL ${ticker} @ ${date} holdDays=${daysBetween(holding.entryDate, date)}`);
        }
      };

      const notInTarget = Object.keys(holdings).filter((t) => !targetAllocation[t]);
      const sortedExit = [...notInTarget].sort((a, b) => scoreForTicker(a) - scoreForTicker(b));

      for (const ticker of sortedExit) {
        const holding = holdings[ticker];
        if (!holding || targetAllocation[ticker]) continue;
        const sOld = scoreForTicker(ticker);
        if (!turnoverAllowsSell(sOld)) continue;
        const sellPrice = dailyPx[ticker];
        if (!sellPrice) continue;
        const hDays = daysBetween(holding.entryDate, date);
        if (hDays < MIN_HOLD_DAYS_BEFORE_SELL) {
          if (turnoverDebugEnabled()) {
            console.log(`[HOLD] keep ${ticker} — ${hDays}d < min ${MIN_HOLD_DAYS_BEFORE_SELL}d`);
          }
          continue;
        }
        doRebalanceSell(ticker, holding, sellPrice);
      }

      while (Object.keys(holdings).length > maxHoldings) {
        const pool = Object.keys(holdings).filter((t) => !targetAllocation[t]);
        if (!pool.length) break;
        pool.sort((a, b) => scoreForTicker(a) - scoreForTicker(b));
        const ticker = pool[0];
        const holding = holdings[ticker];
        if (!holding) break;
        const sOld = scoreForTicker(ticker);
        if (!turnoverAllowsSell(sOld)) break;
        const sellPrice = dailyPx[ticker];
        if (!sellPrice) break;
        doRebalanceSell(ticker, holding, sellPrice);
      }

      for (const pick of topPicks) {
        const ticker = pick.ticker;
        const target = targetAllocation[ticker];
        if (!target) continue;
        const currentPrice = dailyPx[ticker];
        if (!currentPrice || currentPrice <= 0) continue;
        const isNewLine = !holdings[ticker];
        if (isNewLine) {
          if (Object.keys(holdings).length >= adjustedTopN) continue;
          const rs = recentSells[ticker];
          if (rs) {
            const ds = daysBetween(rs.exitDate, date);
            if (ds < REBUY_COOLDOWN_DAYS) {
              if (turnoverDebugEnabled()) {
                console.log(`[TURNOVER] skip rebuy ${ticker} — sold ${ds}d ago (<${REBUY_COOLDOWN_DAYS}d)`);
              }
              continue;
            }
            delete recentSells[ticker];
          }
        }
        const currentValue = holdings[ticker] ? holdings[ticker].shares * currentPrice : 0;
        const diffValue = target.targetDollars - currentValue;
        if (diffValue > 50) {
          const sharesToBuy = Math.floor(diffValue / currentPrice);
          if (sharesToBuy > 0 && cash >= sharesToBuy * currentPrice) {
            const cost = sharesToBuy * currentPrice;
            cash -= cost;
            if (holdings[ticker]) {
              const totalShares = holdings[ticker].shares + sharesToBuy;
              const avgPrice = (holdings[ticker].shares * holdings[ticker].entryPrice + cost) / totalShares;
              const pk = holdings[ticker].peakPriceSinceEntry;
              holdings[ticker] = {
                shares: totalShares,
                entryPrice: avgPrice,
                entryDate: holdings[ticker].entryDate,
                ...(trailingStopEnabled() ? { peakPriceSinceEntry: pk != null ? pk : avgPrice } : {})
              };
            } else {
              holdings[ticker] = {
                shares: sharesToBuy,
                entryPrice: currentPrice,
                entryDate: date,
                ...(trailingStopEnabled() ? { peakPriceSinceEntry: currentPrice } : {})
              };
            }
            trades.push({ type: 'BUY', ticker, shares: sharesToBuy, price: currentPrice, cost, score: target.score });
          }
        }
      }

      let postValue = cash;
      for (const [ticker, holding] of Object.entries(holdings)) {
        const price = dailyPx[ticker];
        if (price) postValue += holding.shares * price;
      }

      rebalanceLog.push({
        date,
        portfolioValue: postValue,
        holdings: Object.keys(holdings),
        topPicks: topPicks.map(p => p.ticker),
        tradesExecuted: trades.length,
        regime: regimeMeta.regime,
        exposure,
        ...(compositeFam
          ? {
            pillarWeights: { ...weightsRankBt },
            adaptiveMeta: rebalanceAdaptiveMeta
          }
          : {})
      });

      tradeLog.push(...trades.map(t => ({ ...t, date })));
      const holdingsCopy = {};
      for (const [t, h] of Object.entries(holdings)) holdingsCopy[t] = { shares: h.shares, entryPrice: h.entryPrice, entryDate: h.entryDate };
      holdingsSnapshots.push({ date, cash, holdings: holdingsCopy });
    }
  }

  const dailyValues = [];
  let snapIdx = 0;
  for (const date of allTradingDays) {
    const pxRow = {};
    for (const tk of Object.keys(priceHistory)) {
      pxRow[tk] = getPrice(priceHistory[tk], date);
    }
    const spyPxRow = getPrice(spyPrices, date);
    while (snapIdx < holdingsSnapshots.length - 1 && holdingsSnapshots[snapIdx + 1].date <= date) snapIdx++;
    const snap = holdingsSnapshots[snapIdx];
    let dayValue = snap.cash;
    for (const [ticker, holding] of Object.entries(snap.holdings)) {
      const price = pxRow[ticker];
      if (price) dayValue += holding.shares * price;
    }
    let benchVal = universeBenchmarkValue(uniBench, priceHistory, date, pxRow);
    if (benchVal == null) {
      benchVal = spyShares * spyPxRow;
    }
    let mult = cashInflMult(date);
    if (mult == null || !Number.isFinite(mult) || mult <= 0) {
      mult = Math.pow(1 + INFLATION_BASELINE_ANNUAL, daysBetween(startDate, date) / 365.25);
    }
    const cashInflationAdjusted = capital * mult;
    dailyValues.push({
      date,
      portfolio: dayValue,
      benchmark: benchVal,
      cashInflationAdjusted
    });
  }

  const finalPillarWeights = initialPillarWeights ? { ...weights } : null;

  return {
    dailyValues,
    tradeLog,
    rebalanceLog,
    holdingsSnapshots,
    factorSnapshots,
    holdings,
    cash,
    regimeLog,
    totalStopsTriggered,
    benchmarkMeta,
    adaptiveWeightLog,
    initialPillarWeights,
    finalPillarWeights,
    pointInTime: pitRunMeta.pointInTime,
    pitDetail: pitRunMeta.pitDetail,
    nameSwapCount,
    adaptiveMode,
    positionSizing
  };
}

function computeStrategyRiskMetrics(dailyValues, tradeLog, rebalanceDates, topN) {
  if (!dailyValues || dailyValues.length < 2) return null;
  const dailyReturnsP = [];
  const dailyReturnsB = [];
  for (let i = 1; i < dailyValues.length; i++) {
    if (dailyValues[i - 1].portfolio > 0) dailyReturnsP.push(dailyValues[i].portfolio / dailyValues[i - 1].portfolio - 1);
    if (dailyValues[i - 1].benchmark > 0 && dailyValues[i].benchmark > 0) {
      dailyReturnsB.push(dailyValues[i].benchmark / dailyValues[i - 1].benchmark - 1);
    }
  }
  const n = Math.min(dailyReturnsP.length, dailyReturnsB.length);
  let betaVsBenchmark = 1;
  if (n > 20) {
    const meanP = average(dailyReturnsP.slice(0, n));
    const meanB = average(dailyReturnsB.slice(0, n));
    let cov = 0;
    let varB = 0;
    for (let i = 0; i < n; i++) {
      cov += (dailyReturnsP[i] - meanP) * (dailyReturnsB[i] - meanB);
      varB += Math.pow(dailyReturnsB[i] - meanB, 2);
    }
    betaVsBenchmark = varB > 0 ? cov / varB : 1;
  }

  let cur = null;
  const monthlyReturns = [];
  for (const d of dailyValues) {
    const month = d.date.substring(0, 7);
    if (!cur || cur.month !== month) {
      if (cur) monthlyReturns.push(cur);
      cur = { month, portfolioStart: d.portfolio, portfolioEnd: d.portfolio, benchStart: d.benchmark, benchEnd: d.benchmark };
    } else {
      cur.portfolioEnd = d.portfolio;
      cur.benchEnd = d.benchmark;
    }
  }
  if (cur) monthlyReturns.push(cur);

  const monthlyWithReturns = monthlyReturns.map(m => ({
    portfolioReturn: m.portfolioStart > 0 ? (m.portfolioEnd - m.portfolioStart) / m.portfolioStart : 0,
    benchmarkReturn: m.benchStart > 0 ? (m.benchEnd - m.benchStart) / m.benchStart : 0
  })).filter(m => isFinite(m.portfolioReturn) && isFinite(m.benchmarkReturn));

  const upMonths = monthlyWithReturns.filter(m => m.benchmarkReturn > 0);
  let captureRatioUp = 0;
  if (upMonths.length > 0) {
    const avgPortUp = upMonths.reduce((s, m) => s + m.portfolioReturn, 0) / upMonths.length;
    const avgBenchUp = upMonths.reduce((s, m) => s + m.benchmarkReturn, 0) / upMonths.length;
    captureRatioUp = avgBenchUp !== 0 ? (avgPortUp / avgBenchUp) * 100 : 0;
  }
  const downMonths = monthlyWithReturns.filter(m => m.benchmarkReturn < 0);
  let captureRatioDown = 0;
  if (downMonths.length > 0) {
    const avgPortDown = downMonths.reduce((s, m) => s + m.portfolioReturn, 0) / downMonths.length;
    const avgBenchDown = downMonths.reduce((s, m) => s + m.benchmarkReturn, 0) / downMonths.length;
    captureRatioDown = avgBenchDown !== 0 ? (avgPortDown / avgBenchDown) * 100 : 0;
  }

  const rebalCount = Array.isArray(rebalanceDates) ? rebalanceDates.length : 0;
  const tradeCount = tradeLog ? tradeLog.length : 0;
  const turnoverPct = rebalCount > 0 && topN > 0 ? (tradeCount / (rebalCount * topN)) * 100 : 0;
  const holdingDays = (tradeLog || []).filter(t => t.holdingDays != null && t.holdingDays >= 0).map(t => t.holdingDays);
  const avgHoldingPeriod = holdingDays.length > 0 ? average(holdingDays) : 0;

  return {
    betaVsBenchmark: parseFloat(betaVsBenchmark.toFixed(2)),
    captureRatioUp: parseFloat(captureRatioUp.toFixed(1)),
    captureRatioDown: parseFloat(captureRatioDown.toFixed(1)),
    turnoverPct: parseFloat(turnoverPct.toFixed(1)),
    avgHoldingPeriod: parseFloat(avgHoldingPeriod.toFixed(1))
  };
}

function calculateBacktestMetrics(dailyValues, tradeLog, capital) {
  if (!dailyValues || dailyValues.length < 2) return null;
  const first = dailyValues[0];
  const last = dailyValues[dailyValues.length - 1];
  const years = daysBetween(first.date, last.date) / 365;
  if (years <= 0) return null;

  const totalReturn = (last.portfolio - capital) / capital;
  const annualizedReturn = Math.pow(1 + totalReturn, 1 / years) - 1;
  const benchReturn = last.benchmark > 0 ? (last.benchmark - capital) / capital : 0;
  const benchAnnualized = Math.pow(1 + benchReturn, 1 / years) - 1;

  const dailyReturns = [];
  for (let i = 1; i < dailyValues.length; i++) {
    if (dailyValues[i - 1].portfolio > 0) dailyReturns.push(dailyValues[i].portfolio / dailyValues[i - 1].portfolio - 1);
  }
  const annualizedVol = standardDeviation(dailyReturns) * Math.sqrt(252);
  const riskFreeRate = 0.043;
  const sharpe = annualizedVol > 0 ? (annualizedReturn - riskFreeRate) / annualizedVol : 0;

  return {
    totalReturn, annualizedReturn, benchReturn, benchAnnualized,
    alpha: annualizedReturn - benchAnnualized, sharpe, annualizedVol, years
  };
}

async function runOptimizationWithValidation(universe, priceHistory, fundamentals, spyPrices, rebalanceDates, topN, capital, strategyClean, currentWeights, portfolio, universeId = null) {
  const round = (portfolio.optimizationRound || 0);
  const weightHistory = portfolio.weightHistory || [];

  if (round >= MAX_OPTIMIZATION_ROUNDS) {
    return {
      status: 'capped',
      round,
      maxRounds: MAX_OPTIMIZATION_ROUNDS,
      message: `Optimization frozen at ${MAX_OPTIMIZATION_ROUNDS} rounds to prevent overfitting`,
      currentWeights,
      stability: checkWeightStability(weightHistory)
    };
  }

  const splitIdx = Math.floor(rebalanceDates.length * 0.60);
  if (splitIdx < 3 || rebalanceDates.length - splitIdx < 2) {
    return { status: 'error', message: 'Insufficient data for train/test split' };
  }
  const trainDates = rebalanceDates.slice(0, splitIdx);
  const testDates = rebalanceDates.slice(splitIdx);

  const trainResult = await runBacktestSimulation(universe, priceHistory, fundamentals, spyPrices, trainDates, topN, capital, strategyClean, currentWeights, null, universeId);
  const trainMetrics = calculateBacktestMetrics(trainResult.dailyValues, trainResult.tradeLog, capital);
  if (!trainMetrics) return { status: 'error', message: 'Could not compute training metrics' };

  const sells = trainResult.tradeLog.filter(t => t.type === 'SELL');
  const trainAttribution = computeFactorAttribution(trainResult.factorSnapshots, priceHistory, trainDates, sells, fundamentals, currentWeights);
  if (!trainAttribution || !trainAttribution.suggestedWeights) {
    return { status: 'error', message: 'Factor attribution produced no suggested weights from training period' };
  }

  const constrained = constrainWeightChanges(currentWeights, trainAttribution.suggestedWeights);
  const bounded = applyWeightBounds(constrained);

  const testDefault = await runBacktestSimulation(universe, priceHistory, fundamentals, spyPrices, testDates, topN, capital, strategyClean, currentWeights, null, universeId);
  const testDefaultMetrics = calculateBacktestMetrics(testDefault.dailyValues, testDefault.tradeLog, capital);

  const testOptimized = await runBacktestSimulation(universe, priceHistory, fundamentals, spyPrices, testDates, topN, capital, strategyClean, bounded, null, universeId);
  const testOptimizedMetrics = calculateBacktestMetrics(testOptimized.dailyValues, testOptimized.tradeLog, capital);

  if (!testDefaultMetrics || !testOptimizedMetrics) {
    return { status: 'error', message: 'Could not compute validation metrics' };
  }

  const baselineW = strategyClean === 'full_composite_aggressive' ? AGGRESSIVE_COMPOSITE_WEIGHTS
    : strategyClean === 'full_composite_turbo' ? TURBO_COMPOSITE_WEIGHTS
      : DEFAULT_COMPOSITE_WEIGHTS;
  const baselineTrainSim = await runBacktestSimulation(universe, priceHistory, fundamentals, spyPrices, trainDates, topN, capital, strategyClean, baselineW, null, universeId);
  const improvementInSample = trainMetrics.sharpe - (calculateBacktestMetrics(
    baselineTrainSim.dailyValues,
    [], capital
  )?.sharpe || 0);

  const oosAccepted = testOptimizedMetrics.sharpe >= testDefaultMetrics.sharpe * 0.95;
  const sharpeImprovement = testOptimizedMetrics.sharpe - testDefaultMetrics.sharpe;
  const sharpeDecay = trainMetrics.sharpe > 0 ? ((trainMetrics.sharpe - testOptimizedMetrics.sharpe) / trainMetrics.sharpe * 100) : 0;

  const meetsThreshold = sharpeImprovement >= -MIN_SHARPE_IMPROVEMENT;
  const accepted = oosAccepted && meetsThreshold;

  const newHistory = [...weightHistory];
  let stability;

  if (accepted) {
    newHistory.push(bounded);
    stability = checkWeightStability(newHistory);

    portfolio.config.weights = bounded;
    portfolio.optimizationRound = round + 1;
    portfolio.weightHistory = newHistory;
    portfolio.lastOptimized = new Date().toISOString();
    savePortfolio(portfolio);
  } else {
    stability = checkWeightStability(weightHistory);
  }

  return {
    status: accepted ? 'accepted' : 'rejected',
    round: accepted ? round + 1 : round,
    maxRounds: MAX_OPTIMIZATION_ROUNDS,
    previousWeights: currentWeights,
    newWeights: accepted ? bounded : null,
    suggestedRaw: trainAttribution.suggestedWeights,
    validation: {
      trainPeriod: `${trainDates[0]} to ${trainDates[trainDates.length - 1]}`,
      testPeriod: `${testDates[0]} to ${testDates[testDates.length - 1]}`,
      trainSharpe: parseFloat(trainMetrics.sharpe.toFixed(3)),
      testDefaultSharpe: parseFloat(testDefaultMetrics.sharpe.toFixed(3)),
      testOptimizedSharpe: parseFloat(testOptimizedMetrics.sharpe.toFixed(3)),
      testDefaultReturn: parseFloat((testDefaultMetrics.annualizedReturn * 100).toFixed(1)),
      testOptimizedReturn: parseFloat((testOptimizedMetrics.annualizedReturn * 100).toFixed(1)),
      sharpeDecay: parseFloat(sharpeDecay.toFixed(1)),
      oosAccepted,
      meetsThreshold
    },
    stability,
    reason: accepted
      ? `Sharpe improved and passed out-of-sample validation (decay ${sharpeDecay.toFixed(1)}%)`
      : !oosAccepted
        ? `Failed out-of-sample validation — optimized weights performed worse than current weights`
        : `Improvement below minimum threshold`
  };
}

function computeFactorAttribution(factorSnapshots, priceHistory, rebalanceDates, sells, fundamentals, weights) {
  const w = weights || DEFAULT_COMPOSITE_WEIGHTS;
  if (!factorSnapshots || factorSnapshots.length < 2) return null;

  const periodData = [];
  for (let i = 0; i < factorSnapshots.length - 1; i++) {
    const snap = factorSnapshots[i];
    const nextDate = rebalanceDates[Math.min(i + 1, rebalanceDates.length - 1)];
    if (!nextDate || nextDate === snap.date) continue;

    const withReturns = [];
    for (const stock of snap.allRanked) {
      const prices = priceHistory[stock.ticker];
      if (!prices) continue;
      const entryPrice = stock.price;
      const exitPrice = getPrice(prices, nextDate);
      if (!entryPrice || !exitPrice || entryPrice <= 0) continue;
      const ret = (exitPrice - entryPrice) / entryPrice;
      withReturns.push({ ...stock, realized: ret });
    }
    if (withReturns.length >= 6) {
      periodData.push({ date: snap.date, nextDate, stocks: withReturns });
    }
  }

  if (periodData.length === 0) return null;

  const periodIcsByFactor = {};
  for (const f of FACTOR_NAMES) periodIcsByFactor[f] = [];
  for (const pd of periodData) {
    const returns = pd.stocks.map(s => s.realized);
    for (const f of FACTOR_NAMES) {
      const scores = pd.stocks.map(s => s[f] ?? 0);
      const ic = spearmanCorrelation(scores, returns);
      if (Number.isFinite(ic)) periodIcsByFactor[f].push(ic);
    }
  }
  const avgIC = {};
  const icConfidence = {};
  for (const f of FACTOR_NAMES) {
    const arr = periodIcsByFactor[f];
    avgIC[f] = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    if (arr.length >= 2) {
      const m = avgIC[f];
      let v = 0;
      for (const x of arr) v += (x - m) ** 2;
      const sd = Math.sqrt(v / Math.max(1, arr.length - 1));
      const se = sd / Math.sqrt(arr.length);
      const lower = m - 1.96 * se;
      const upper = m + 1.96 * se;
      const significant = !(lower <= 0 && upper >= 0);
      icConfidence[f] = {
        lower: parseFloat(lower.toFixed(4)),
        upper: parseFloat(upper.toFixed(4)),
        significant
      };
    } else {
      icConfidence[f] = { lower: null, upper: null, significant: false };
    }
  }

  const spreadSums = {};
  const spreadCounts = {};
  for (const f of FACTOR_NAMES) { spreadSums[f] = 0; spreadCounts[f] = 0; }
  for (const pd of periodData) {
    for (const f of FACTOR_NAMES) {
      const sorted = [...pd.stocks].sort((a, b) => (b[f] ?? 0) - (a[f] ?? 0));
      const mid = Math.floor(sorted.length / 2);
      if (mid < 1) continue;
      const topAvg = sorted.slice(0, mid).reduce((s, x) => s + x.realized, 0) / mid;
      const botAvg = sorted.slice(mid).reduce((s, x) => s + x.realized, 0) / (sorted.length - mid);
      spreadSums[f] += topAvg - botAvg;
      spreadCounts[f]++;
    }
  }
  const avgSpread = {};
  for (const f of FACTOR_NAMES) {
    avgSpread[f] = spreadCounts[f] > 0 ? spreadSums[f] / spreadCounts[f] : 0;
  }

  const contribution = { total: 0 };
  for (const f of FACTOR_NAMES) contribution[f] = 0;
  for (const sell of sells) {
    const factorScores = findFactorScores(factorSnapshots, sell.ticker, sell.date);
    if (!factorScores) continue;
    const dollarReturn = sell.holdingReturn * sell.proceeds;
    contribution.total += dollarReturn;
    let compositeSum = 0;
    for (const f of FACTOR_NAMES) compositeSum += (factorScores[f] ?? 0) * (w[f] || 0);
    if (compositeSum > 0) {
      for (const f of FACTOR_NAMES) {
        const share = ((factorScores[f] ?? 0) * (w[f] || 0)) / compositeSum;
        contribution[f] += dollarReturn * share;
      }
    }
  }

  const FACTOR_ATTR_IC_SOFTMAX = 3;
  const icSoftmax = {};
  let icSmSum = 0;
  for (const f of FACTOR_NAMES) {
    icSoftmax[f] = Math.exp((avgIC[f] || 0) * FACTOR_ATTR_IC_SOFTMAX);
    icSmSum += icSoftmax[f];
  }
  const icWeights = {};
  for (const f of FACTOR_NAMES) icWeights[f] = icSmSum > 0 ? icSoftmax[f] / icSmSum : 1 / FACTOR_NAMES.length;
  const suggestedWeights = {};
  for (const f of FACTOR_NAMES) {
    const eff = w[f] || 0;
    let sw = 0.7 * eff + 0.3 * icWeights[f];
    const ci = icConfidence[f];
    if (ci && !ci.significant) sw = eff;
    suggestedWeights[f] = sw;
  }
  const wSum = FACTOR_NAMES.reduce((s, f) => s + suggestedWeights[f], 0);
  for (const f of FACTOR_NAMES) suggestedWeights[f] = parseFloat((suggestedWeights[f] / wSum).toFixed(3));

  const FACTOR_COLORS = { fundamental: '#22c55e', dcf: '#a78bfa', valuation: '#f59e0b', momentum: '#06b6d4', value: '#8b5cf6' };
  const best = FACTOR_NAMES.reduce((a, b) => avgIC[a] > avgIC[b] ? a : b);
  const worst = FACTOR_NAMES.reduce((a, b) => avgIC[a] < avgIC[b] ? a : b);
  let insight = `${FACTOR_LABELS[best]} had the highest average IC (${avgIC[best] >= 0 ? '+' : ''}${(avgIC[best]).toFixed(3)}, spread ${avgSpread[best] >= 0 ? '+' : ''}${(avgSpread[best] * 100).toFixed(1)}%/period).`;
  if (avgIC[worst] < 0) {
    insight += ` ${FACTOR_LABELS[worst]} averaged negative IC (${(avgIC[worst]).toFixed(3)}) — adaptive weights should not increase that pillar when IC stays negative.`;
  } else if (avgIC[worst] < 0.02) {
    insight += ` ${FACTOR_LABELS[worst]} was weak (IC ${(avgIC[worst]).toFixed(3)}).`;
  }
  insight += ` Suggested blend vs effective ranking mix: ${FACTOR_LABELS[best]} ${((w[best] || 0) * 100).toFixed(0)}% → ${(suggestedWeights[best] * 100).toFixed(0)}%.`;

  return {
    factors: FACTOR_NAMES.map(f => ({
      name: f,
      label: FACTOR_LABELS[f],
      ic: parseFloat(avgIC[f].toFixed(4)),
      icConfidence: icConfidence[f],
      spread: parseFloat((avgSpread[f] * 100).toFixed(2)),
      contribution: parseFloat(contribution[f].toFixed(2)),
      originalWeight: w[f] || 0,
      suggestedWeight: suggestedWeights[f],
      color: FACTOR_COLORS[f]
    })),
    totalContribution: parseFloat(contribution.total.toFixed(2)),
    periodsAnalyzed: periodData.length,
    avgStocksPerPeriod: Math.round(periodData.reduce((s, p) => s + p.stocks.length, 0) / periodData.length),
    insight,
    suggestedWeights
  };
}

function findFactorScores(factorSnapshots, ticker, sellDate) {
  for (let i = factorSnapshots.length - 1; i >= 0; i--) {
    if (factorSnapshots[i].date <= sellDate) {
      const stock = factorSnapshots[i].allRanked.find(s => s.ticker === ticker);
      if (stock) return stock;
    }
  }
  return null;
}

function subtractMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().split('T')[0];
}

function daysBetween(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

/** Latest CPI index for calendar month of isoDate (YYYY-MM-DD); FRED uses month-start dates (e.g. 2024-01-01). */
function cpiIndexForTradeDate(sortedObs, isoDate) {
  if (!sortedObs.length) return null;
  const monthAnchor = `${isoDate.slice(0, 7)}-01`;
  let best = null;
  for (let i = 0; i < sortedObs.length; i++) {
    const o = sortedObs[i];
    if (o.date <= monthAnchor) best = o.value;
    else break;
  }
  return best != null ? best : sortedObs[0].value;
}

/**
 * FRED CPI observations (monthly). Free API key: https://fred.stlouisfed.org/docs/api/api_key.html
 * Data: U.S. BLS Consumer Price Index — All Urban Consumers, All Items, Seasonally Adjusted (CPIAUCSL).
 */
async function fetchFredCpiObservations(observationStart, observationEnd, apiKey) {
  const key = (apiKey && String(apiKey).trim()) || '';
  if (!key) return [];

  const cacheKey = `${observationStart}|${observationEnd}|${FRED_CPI_SERIES_ID}`;
  const hit = CPI_OBSERVATIONS_CACHE.get(cacheKey);
  if (hit && Date.now() - hit.ts < CPI_OBSERVATIONS_TTL_MS) return hit.observations;

  try {
    const url = new URL(FRED_OBSERVATIONS_URL);
    url.searchParams.set('series_id', FRED_CPI_SERIES_ID);
    url.searchParams.set('api_key', key);
    url.searchParams.set('file_type', 'json');
    url.searchParams.set('observation_start', observationStart);
    url.searchParams.set('observation_end', observationEnd);

    const res = await fetch(url.toString());
    const json = await res.json();
    if (json.error_code != null || json.error_message) {
      console.warn('FRED CPI:', json.error_message || json.error_code);
      return [];
    }
    const observations = (json.observations || [])
      .map((o) => ({ date: o.date, value: parseFloat(o.value) }))
      .filter((o) => o.date && Number.isFinite(o.value) && o.value > 0);
    observations.sort((a, b) => a.date.localeCompare(b.date));
    CPI_OBSERVATIONS_CACHE.set(cacheKey, { observations, ts: Date.now() });
    return observations;
  } catch (e) {
    console.warn('FRED CPI fetch failed:', e.message || e);
    return [];
  }
}

/**
 * Multiplier vs backtest start (1.0 on start day) for inflation-adjusted cash baseline.
 * Uses CPI ratio when FRED data is usable; otherwise constant compound fallback.
 */
function buildCashInflationMultiplierFn(observations, startDateStr, fallbackAnnual) {
  const sorted = (observations || [])
    .filter((o) => o && o.date && Number.isFinite(o.value) && o.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const compound = (iso) => Math.pow(1 + fallbackAnnual, daysBetween(startDateStr, iso) / 365.25);

  if (sorted.length < 2) {
    return { multiplierFn: compound, usedFred: false };
  }

  const cpiStart = cpiIndexForTradeDate(sorted, startDateStr);
  if (!cpiStart || cpiStart <= 0) {
    return { multiplierFn: compound, usedFred: false };
  }

  return {
    multiplierFn(iso) {
      const c = cpiIndexForTradeDate(sorted, iso);
      if (c && c > 0) return c / cpiStart;
      return compound(iso);
    },
    usedFred: true
  };
}

function standardDeviation(arr) {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const sqDiffs = arr.map(x => Math.pow(x - mean, 2));
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / arr.length);
}

/** Per loaded price array: date string → row index (same array reference as in `priceHistory`). */
const PRICE_INDEX_CACHE = new Map();

function buildPriceDateIndexMap(priceData) {
  const idx = new Map();
  for (let i = 0; i < priceData.length; i++) {
    idx.set(priceData[i].date, i);
  }
  return idx;
}

function getOrBuildPriceDateIndexMap(priceData) {
  if (!priceData || priceData.length === 0) return null;
  let idx = PRICE_INDEX_CACHE.get(priceData);
  if (!idx) {
    idx = buildPriceDateIndexMap(priceData);
    PRICE_INDEX_CACHE.set(priceData, idx);
  }
  return idx;
}

/**
 * Last index in sorted-by-date `prices` with date <= target (ISO YYYY-MM-DD). Returns -1 if none.
 */
function bsearchLastBeforeOrEqual(prices, target) {
  if (!prices || prices.length === 0) return -1;
  if (prices[0].date > target) return -1;
  let lo = 0;
  let hi = prices.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (prices[mid].date <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Simple return from as-of bar to `tradingDays` bars forward (same series indexing). */
function btForwardReturnOverTradingDays(priceSeries, asOfDateStr, tradingDays) {
  if (!priceSeries?.length || !asOfDateStr || tradingDays < 1) return null;
  const i0 = bsearchLastBeforeOrEqual(priceSeries, asOfDateStr);
  if (i0 < 0) return null;
  const i1 = i0 + tradingDays;
  if (i1 >= priceSeries.length) return null;
  const c0 = priceSeries[i0].close;
  const c1 = priceSeries[i1].close;
  if (!(c0 > 0) || !(c1 > 0)) return null;
  return c1 / c0 - 1;
}

/**
 * First index with date >= target. Returns -1 if all dates are before target.
 */
function bsearchFirstOnOrAfter(prices, target) {
  if (!prices || prices.length === 0) return -1;
  const last = prices.length - 1;
  if (prices[last].date < target) return -1;
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (prices[mid].date < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function getPrice(priceData, date) {
  if (!priceData || priceData.length === 0) return null;
  const target = typeof date === 'string' ? date : date.toISOString().split('T')[0];
  const idxMap = getOrBuildPriceDateIndexMap(priceData);
  if (idxMap) {
    const exact = idxMap.get(target);
    if (exact !== undefined) return priceData[exact].close;
  }
  const i = bsearchFirstOnOrAfter(priceData, target);
  if (i >= 0 && i < priceData.length) return priceData[i].close;
  return priceData[priceData.length - 1]?.close || null;
}

function clearBacktestRuntimeCaches() {
  PRICE_INDEX_CACHE.clear();
  YAHOO_RAW_PIT_CACHE.clear();
  fundamentalsTimeSeriesCache.clear();
}

/** Next calendar 15th strictly after `isoDateStr` (YYYY-MM-DD), matching backtest monthly/quarterly anchors. */
function nextMidMonthRebalanceAfter(isoDateStr) {
  if (!isoDateStr || typeof isoDateStr !== 'string') return null;
  const parts = isoDateStr.split('-').map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, m, d] = parts;
  const last = Date.UTC(y, m - 1, d);
  let cy = y;
  let cm = m;
  let fifteenUtc = Date.UTC(cy, cm - 1, 15);
  if (fifteenUtc > last) {
    return `${cy}-${String(cm).padStart(2, '0')}-15`;
  }
  cm += 1;
  if (cm > 12) {
    cm = 1;
    cy += 1;
  }
  return `${cy}-${String(cm).padStart(2, '0')}-15`;
}

/** Per-month counts for correlating equity steps with scheduled rebalances vs stop exits (backtest). */
function buildMonthlyEventsSummary(rebalanceLog, tradeLog) {
  const map = Object.create(null);
  const ensure = (ym) => {
    if (!map[ym]) map[ym] = { month: ym, rebalances: 0, stops: 0 };
    return map[ym];
  };
  for (const r of rebalanceLog || []) {
    if (r.date) ensure(r.date.slice(0, 7)).rebalances += 1;
  }
  for (const t of tradeLog || []) {
    if (t.type === 'STOP' && t.date) ensure(t.date.slice(0, 7)).stops += 1;
  }
  return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
}

/** Paper portfolio: rebalance rows + optional stop-tagged sells (`reason: 'STOP'`). */
function buildPaperMonthlyEventsSummary(rebalanceHistory) {
  const map = Object.create(null);
  for (const rb of rebalanceHistory || []) {
    if (!rb.date) continue;
    const ym = rb.date.slice(0, 7);
    if (!map[ym]) map[ym] = { month: ym, rebalances: 0, stops: 0 };
    map[ym].rebalances += 1;
    for (const s of rb.sells || []) {
      if (s.reason === 'STOP') map[ym].stops += 1;
    }
  }
  return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
}

function getRebalanceDates(startDate, endDate, frequency) {
  const dates = [];
  const end = new Date(endDate);

  if (frequency === 'weekly' || frequency === 'biweekly') {
    const stepDays = frequency === 'weekly' ? 7 : 14;
    const cur = new Date(`${startDate}T12:00:00`);
    while (true) {
      cur.setDate(cur.getDate() + stepDays);
      const ds = cur.toISOString().split('T')[0];
      if (!(ds < endDate)) break;
      dates.push(ds);
    }
    return dates;
  }

  let current = new Date(startDate);

  while (current < end) {
    if (frequency === 'monthly') {
      current.setMonth(current.getMonth() + 1);
    } else if (frequency === 'bimonthly') {
      current.setMonth(current.getMonth() + 2);
    } else if (frequency === 'quarterly') {
      current.setMonth(current.getMonth() + 3);
    } else {
      current.setMonth(current.getMonth() + 1);
    }
    current.setDate(15);

    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const dateStr = `${year}-${month}-15`;

    if (dateStr < endDate) {
      dates.push(dateStr);
    }
  }

  return dates;
}

function bt_calculateMomentum(priceData, asOfDate, lookbackMonths = 6, spyPricesForDynamic = null) {
  const lbMonths = spyPricesForDynamic ? dynamicLookback(spyPricesForDynamic, asOfDate) : lookbackMonths;

  const available = priceData.filter(p => p.date <= asOfDate);
  if (available.length < 60) return null;
  
  const currentPrice = available[available.length - 1].close;
  
  const lookbackDate = subtractMonths(asOfDate, lbMonths);
  const lookbackEntry = available.find(p => p.date >= lookbackDate) || available[0];
  const lookbackPrice = lookbackEntry?.close;
  if (!lookbackPrice) return null;
  
  const rawMomentum = (currentPrice - lookbackPrice) / lookbackPrice;
  
  const lookbackPrices = available.filter(p => p.date >= lookbackDate);
  const dailyReturns = [];
  for (let i = 1; i < lookbackPrices.length; i++) {
    dailyReturns.push(Math.log(lookbackPrices[i].close / lookbackPrices[i - 1].close));
  }
  const stddev = standardDeviation(dailyReturns);
  const annualizedVol = stddev * Math.sqrt(252);
  
  const annualizedReturn = Math.pow(1 + rawMomentum, 12 / lbMonths) - 1;
  const riskAdjustedMomentum = annualizedVol > 0 ? annualizedReturn / annualizedVol : 0;
  
  const last50 = available.slice(-50);
  const last200 = available.slice(-200);
  const ma50 = last50.reduce((s, p) => s + p.close, 0) / last50.length;
  const ma200 = last200.length >= 200 
    ? last200.reduce((s, p) => s + p.close, 0) / last200.length 
    : null;
  
  let trendBonus = 0;
  if (ma200) {
    if (currentPrice > ma50 && ma50 > ma200) trendBonus = 2;
    else if (currentPrice > ma200) trendBonus = 1;
    else if (currentPrice < ma50 && ma50 < ma200) trendBonus = -1;
  }
  
  return {
    rawMomentum,
    annualizedReturn,
    annualizedVol,
    riskAdjustedMomentum,
    trendBonus,
    finalMomentumScore: riskAdjustedMomentum + trendBonus,
    currentPrice,
    lookbackUsed: lbMonths
  };
}

function bt_calculateValueSignal(priceData, asOfDate) {
  const available = priceData.filter(p => p.date <= asOfDate);
  if (available.length < 252) return null;

  const currentPrice = available[available.length - 1].close;
  const last252 = available.slice(-252);
  const last63 = available.slice(-63);
  const last21 = available.slice(-21);

  const high52w = Math.max(...last252.map(p => p.close));
  const distFromHigh = (currentPrice - high52w) / high52w;

  // 200-day MA
  const last200 = available.slice(-200);
  const ma200 = last200.length >= 200 ? last200.reduce((s, p) => s + p.close, 0) / last200.length : null;
  const aboveMA200 = ma200 ? currentPrice > ma200 : false;

  // 6-month momentum
  const price6mAgo = available.length >= 126 ? available[available.length - 126].close : available[0].close;
  const mom6m = (currentPrice - price6mAgo) / price6mAgo;

  // 3-month momentum
  const price3mAgo = available.length >= 63 ? available[available.length - 63].close : available[0].close;
  const mom3m = (currentPrice - price3mAgo) / price3mAgo;

  // 1-month momentum
  const monthAgoPrice = last21[0]?.close || currentPrice;
  const recentMomentum = (currentPrice - monthAgoPrice) / monthAgoPrice;

  // Volatility
  const rets63 = [];
  for (let i = 1; i < last63.length; i++) {
    if (last63[i - 1].close > 0) rets63.push(Math.log(last63[i].close / last63[i - 1].close));
  }
  const vol63 = standardDeviation(rets63) * Math.sqrt(252);

  // CONTINUOUS SCORING: build score from multiple sub-signals, each 0-20 pts
  let valueScore = 0;

  // Sub-signal A (0-25): Trend strength — reward strong, multi-timeframe momentum
  if (mom6m > 0.15 && mom3m > 0.05 && recentMomentum > 0) valueScore += 25;
  else if (mom6m > 0.10 && mom3m > 0) valueScore += 20;
  else if (mom6m > 0.05 && mom3m > 0) valueScore += 15;
  else if (mom6m > 0) valueScore += 10;
  else if (mom6m > -0.10) valueScore += 5;
  else valueScore += 0;

  // Sub-signal B (0-25): Trend position — above MA200 with room to run
  if (aboveMA200 && distFromHigh > -0.15 && distFromHigh < -0.03) valueScore += 25; // pullback in uptrend
  else if (aboveMA200 && distFromHigh > -0.05) valueScore += 18; // near highs, uptrend
  else if (aboveMA200 && distFromHigh > -0.25) valueScore += 15; // further pullback, still uptrend
  else if (aboveMA200) valueScore += 10;
  else if (distFromHigh > -0.15) valueScore += 8; // near highs but below MA
  else valueScore += 3; // downtrend

  // Sub-signal C (0-25): Momentum acceleration — is the trend getting STRONGER?
  const accel = recentMomentum - (mom3m / 3); // 1-month vs monthly avg of 3-month
  if (accel > 0.02) valueScore += 25;
  else if (accel > 0.01) valueScore += 20;
  else if (accel > 0) valueScore += 15;
  else if (accel > -0.01) valueScore += 10;
  else if (accel > -0.03) valueScore += 5;
  else valueScore += 0;

  // Sub-signal D (0-25): Risk efficiency — reward low-vol momentum
  const riskAdj = vol63 > 0 ? mom6m / vol63 : 0;
  if (riskAdj > 1.0) valueScore += 25;
  else if (riskAdj > 0.6) valueScore += 20;
  else if (riskAdj > 0.3) valueScore += 15;
  else if (riskAdj > 0) valueScore += 10;
  else if (riskAdj > -0.3) valueScore += 5;
  else valueScore += 0;

  // 21-day pullback detection as described in the prompt:
  const high21d = Math.max(...last21.map(p => p.close));
  const recentPullback = (currentPrice - high21d) / high21d;

  return {
    distFromHigh,
    recentMomentum,
    recentPullback,
    valueScore: Math.max(0, Math.min(100, valueScore))
  };
}

// =====================================================================
// STRUCTURAL PERFORMANCE IMPROVEMENTS
// =====================================================================

const MAX_SECTOR_CONCENTRATION = 0.35;

function getMaxSectorConcentration(strategyClean) {
  if (strategyClean === 'full_composite_aggressive' || strategyClean === 'full_composite_turbo') return 0.30;
  return MAX_SECTOR_CONCENTRATION;
}

function getRegimeExposureMap(strategyClean) {
  const aggressive = {
    strong_bull: 1.0,
    normal: 0.95,
    pullback: 0.85,
    correction: 0.78,
    caution: 0.7,
    bear: 0.55
  };
  const compositeQuality = {
    strong_bull: 1.0,
    normal: 0.95,
    pullback: 0.85,
    correction: 0.8,
    caution: 0.7,
    bear: 0.5
  };
  const legacyConservative = {
    strong_bull: 1.0,
    normal: 0.9,
    pullback: 0.75,
    correction: 0.68,
    caution: 0.5,
    bear: 0.3
  };
  if (strategyClean === 'full_composite_aggressive' || strategyClean === 'full_composite_turbo') {
    return aggressive;
  }
  if (strategyClean === 'full_composite' || strategyClean === 'quality_momentum') {
    return compositeQuality;
  }
  return legacyConservative;
}

function getStrategyRegimeExposure(regimeName, strategyClean) {
  const map = getRegimeExposureMap(strategyClean);
  return map[regimeName] ?? 1.0;
}

/** Higher number = more defensive regime (used to merge SPY + breadth signals). */
const REGIME_SEVERITY = {
  strong_bull: 0,
  normal: 1,
  pullback: 2,
  correction: 3,
  caution: 4,
  bear: 5
};

function maxSeverityRegime(rA, rB) {
  const a = REGIME_SEVERITY[rA] ?? 1;
  const b = REGIME_SEVERITY[rB] ?? 1;
  return a >= b ? rA : rB;
}

/** Position count from regime (before exposure scaling of dollars). */
function adjustedTopNForRegime(regimeName, configuredTopN) {
  const n = Math.max(1, Math.round(configuredTopN));
  switch (regimeName) {
    case 'strong_bull':
    case 'normal':
      return Math.max(3, n);
    case 'pullback':
      return Math.max(3, n - 2);
    case 'correction':
      return Math.max(3, Math.floor(n * 0.75));
    case 'caution':
      return Math.max(3, Math.floor(n * 0.6));
    case 'bear':
      return Math.max(3, Math.floor(n * 0.5));
    default:
      return Math.max(3, n);
  }
}

function average(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/**
 * SPY trend + drawdown plus breadth (% universe names below 50-DMA).
 * @param {string[]|null} universe
 */
function btReturnForDaysAtIndex(prices, endIdx, days) {
  if (endIdx < days || !prices[endIdx] || !prices[endIdx - days]) return 0;
  const current = prices[endIdx].close;
  const past = prices[endIdx - days].close;
  return past > 0 ? (current - past) / past : 0;
}

function calculateMarketRegime(spyPrices, asOfDate, universe = null, priceHistory = null) {
  const tgt = typeof asOfDate === 'string' ? asOfDate : asOfDate.toISOString().split('T')[0];
  const i = bsearchLastBeforeOrEqual(spyPrices, tgt);
  if (i < 199) return { regime: 'normal', breadthRatio: null };

  const current = spyPrices[i].close;
  let s50 = 0;
  for (let j = i - 49; j <= i; j++) s50 += spyPrices[j].close;
  const ma50 = s50 / 50;
  let s200 = 0;
  for (let j = i - 199; j <= i; j++) s200 += spyPrices[j].close;
  const ma200 = s200 / 200;

  let recentPeak = spyPrices[i].close;
  const i60 = Math.max(0, i - 59);
  for (let j = i60; j <= i; j++) {
    if (spyPrices[j].close > recentPeak) recentPeak = spyPrices[j].close;
  }
  const drawdownFromPeak = (current - recentPeak) / recentPeak;

  let regime = 'normal';
  if (current > ma50 && ma50 > ma200) regime = 'strong_bull';
  else if (current > ma200 && current < ma50) regime = 'pullback';
  else if (current < ma200 && drawdownFromPeak < -0.10) regime = 'bear';
  else if (current < ma200) regime = 'caution';
  else if (drawdownFromPeak < -0.07) regime = 'correction';

  if (current < ma200) regime = maxSeverityRegime(regime, 'caution');

  const ret20 = btReturnForDaysAtIndex(spyPrices, i, 20);
  if (current < ma200 && ret20 < -0.05) regime = maxSeverityRegime(regime, 'bear');

  let breadthRatio = null;
  if (universe && priceHistory && Array.isArray(universe)) {
    let below = 0;
    let tot = 0;
    for (const t of universe) {
      if (!t || t === 'SPY') continue;
      const ph = priceHistory[t];
      if (!ph || ph.length < 50) continue;
      const lo = bsearchLastBeforeOrEqual(ph, tgt);
      if (lo < 49 || ph[lo].date > tgt) continue;
      const px = ph[lo].close;
      let sum50 = 0;
      for (let j = lo - 49; j <= lo; j++) sum50 += ph[j].close;
      const ma5 = sum50 / 50;
      tot++;
      if (px < ma5) below++;
    }
    if (tot > 0) {
      breadthRatio = below / tot;
      if (breadthRatio > 0.6) regime = maxSeverityRegime(regime, 'caution');
      else if (breadthRatio > 0.4) regime = maxSeverityRegime(regime, 'pullback');
    }
  }

  const ret5 = btReturnForDaysAtIndex(spyPrices, i, 5);
  let ma10 = null;
  if (i >= 9) {
    let s10 = 0;
    for (let j = i - 9; j <= i; j++) s10 += spyPrices[j].close;
    ma10 = s10 / 10;
  }
  if (
    regime !== 'strong_bull' &&
    ret5 > 0.03 &&
    ma10 != null &&
    current > ma10 &&
    (REGIME_SEVERITY[regime] ?? 1) > REGIME_SEVERITY.normal
  ) {
    regime = 'normal';
  }

  return { regime, breadthRatio };
}

function bt_returnForDays(prices, days) {
  if (prices.length < days + 1) return 0;
  const current = prices[prices.length - 1].close;
  const past = prices[prices.length - 1 - days].close;
  return past > 0 ? (current - past) / past : 0;
}

function bt_volatilityFromPrices(prices) {
  if (prices.length < 5) return 0;
  const rets = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1].close > 0) rets.push(Math.log(prices[i].close / prices[i - 1].close));
  }
  return standardDeviation(rets) * Math.sqrt(252);
}

function calculateMomentumQuality(priceData, asOfDate) {
  const available = priceData.filter(p => p.date <= asOfDate);
  if (available.length < 252) return null;

  const mom6m = bt_returnForDays(available, 126);
  const mom3m = bt_returnForDays(available, 63);
  const mom1m = bt_returnForDays(available, 21);

  const acceleration = mom1m - (mom6m / 6);

  const vol30 = bt_volatilityFromPrices(available.slice(-30));
  const vol90 = bt_volatilityFromPrices(available.slice(-90));
  const volTrend = vol90 > 0 ? vol30 / vol90 : 1;

  let consecUp = 0;
  for (let i = available.length - 1; i > Math.max(0, available.length - 21); i--) {
    if (available[i].close > (available[i - 1]?.close || 0)) consecUp++;
    else break;
  }

  let score = 50;
  if (acceleration > 0.02) score += 20;
  else if (acceleration > 0) score += 10;
  else if (acceleration > -0.02) score -= 5;
  else score -= 15;

  if (volTrend < 0.8) score += 15;
  else if (volTrend < 1.0) score += 5;
  else if (volTrend > 1.3) score -= 15;

  if (consecUp > 10) score -= 10;
  if (mom3m < 0) score -= 20;

  return { score: Math.max(0, Math.min(100, score)), acceleration, volTrend, mom1m, mom3m, mom6m };
}

function checkStopLosses(holdings, priceHistory, currentDate, fundamentals, strategyClean = 'full_composite') {
  const exits = [];
  const isAggressive = strategyClean === 'full_composite_aggressive' || strategyClean === 'full_composite_turbo';
  const target = typeof currentDate === 'string' ? currentDate : currentDate.toISOString().split('T')[0];

  for (const [ticker, holding] of Object.entries(holdings)) {
    const prices = priceHistory[ticker];
    if (!prices || prices.length === 0) continue;

    const lastAvailIdx = bsearchLastBeforeOrEqual(prices, target);
    if (lastAvailIdx < 0 || prices[lastAvailIdx].date > target || lastAvailIdx < 4) continue;

    const today = prices[lastAvailIdx];

    if (trailingStopEnabled() && holding.peakPriceSinceEntry != null && holding.entryPrice > 0) {
      const daysSinceEntry = daysBetween(holding.entryDate, currentDate);
      if (daysSinceEntry >= TRAILING_STOP_MIN_HOLD_DAYS) {
        const peak = holding.peakPriceSinceEntry;
        const entry = holding.entryPrice;
        const givebackFloor = entry * (1 + TRAILING_STOP_FLOOR);
        if (peak >= entry * (1 + TRAILING_STOP_MIN_PEAK_GAIN) && today.close <= givebackFloor) {
          exits.push({
            ticker, exitPrice: today.close, peakPrice: peak,
            drawdown: (today.close - peak) / peak, stopLevel: 'trailing_giveback',
            trailing: true
          });
          continue;
        }
      }
    }

    const volStart = Math.max(0, lastAvailIdx - 59);
    let sumR = 0;
    let sumSqR = 0;
    let nR = 0;
    for (let k = volStart + 1; k <= lastAvailIdx; k++) {
      if (prices[k - 1].close > 0) {
        const r = Math.log(prices[k].close / prices[k - 1].close);
        sumR += r;
        sumSqR += r * r;
        nR++;
      }
    }
    let annualizedVol = 0.2;
    if (nR > 1) {
      const meanR = sumR / nR;
      const varR = Math.max(0, sumSqR / nR - meanR * meanR);
      annualizedVol = Math.sqrt(varR) * Math.sqrt(252);
    }
    const monthlyVol = annualizedVol / Math.sqrt(12);

    const volMultiplier = isAggressive ? 3.5 : 2.0;
    let minStop = isAggressive ? 0.15 : 0.10;
    if (!isAggressive && (strategyClean === 'full_composite' || strategyClean === 'quality_momentum')) {
      minStop = 0.12;
    }
    const maxStop = isAggressive ? 0.35 : 0.20;
    const volStop = -Math.max(monthlyVol * volMultiplier, minStop);
    const adjustedStop = Math.max(volStop, -maxStop);
    const finalStop = adjustedStop;

    const entryPrice = holding.entryPrice;
    if (!entryPrice || entryPrice <= 0) continue;

    const entryIdx = bsearchFirstOnOrAfter(prices, holding.entryDate);
    if (entryIdx < 0 || entryIdx > lastAvailIdx) continue;
    if (lastAvailIdx - entryIdx + 1 < 5) continue;

    const todayReturn = (today.close - entryPrice) / entryPrice;

    const confirmDays = isAggressive ? 3 : 2;
    let confirmedBelow = 0;
    for (let c = 0; c < confirmDays; c++) {
      const idx = lastAvailIdx - c;
      if (idx < 0) break;
      const ret = (prices[idx].close - entryPrice) / entryPrice;
      if (ret < finalStop) confirmedBelow++;
    }

    if (confirmedBelow >= confirmDays) {
      exits.push({
        ticker,
        exitPrice: today.close,
        entryPrice,
        drawdown: todayReturn,
        stopLevel: finalStop,
        trailing: false
      });
    }
  }
  return exits;
}

/** Redistribute weight down from names above maxW; renormalize. */
function applyMaxPositionWeightCap(weights, maxW = MAX_POSITION_WEIGHT_BACKTEST) {
  if (!weights || !weights.length) return weights;
  for (let iter = 0; iter < 12; iter++) {
    let excess = 0;
    for (const w of weights) {
      if (w.weight > maxW + 1e-9) {
        excess += w.weight - maxW;
        w.weight = maxW;
      }
    }
    if (excess <= 1e-8) break;
    const recipients = weights.filter((w) => w.weight < maxW - 1e-9);
    const sumRec = recipients.reduce((s, w) => s + w.weight, 0);
    if (sumRec <= 1e-12) {
      const add = excess / weights.length;
      weights.forEach((w) => { w.weight += add; });
    } else {
      recipients.forEach((w) => { w.weight += excess * (w.weight / sumRec); });
    }
    const t = weights.reduce((s, w) => s + w.weight, 0);
    if (t > 0) weights.forEach((w) => { w.weight /= t; });
  }
  return weights;
}

function getDailySimpleReturnsToDate(priceData, asOfDate, lookbackDays = 60) {
  const avail = priceData.filter(p => p.date <= asOfDate);
  if (avail.length < lookbackDays + 2) return [];
  const slice = avail.slice(-(lookbackDays + 1));
  const rets = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1].close > 0) rets.push(slice[i].close / slice[i - 1].close - 1);
  }
  return rets;
}

/**
 * Inverse annualized vol weights (composite default), optional blend toward equal weight, then 10% cap.
 * @param {{ equalBlend?: number }} options - equalBlend in [0,1]: e.g. 0.4 => 40% equal, 60% invVol
 */
function calculatePositionWeightsInvVol(topPicks, priceHistory, asOfDate, options = {}) {
  if (!topPicks.length) return [];
  const vols = topPicks.map((p) => {
    const ph = priceHistory[p.ticker];
    if (!ph) return 0.02;
    const rets = getDailySimpleReturnsToDate(ph, asOfDate, 60);
    const sd = rets.length > 3 ? standardDeviation(rets) : 0.015;
    const ann = sd * Math.sqrt(252);
    return Math.max(ann, 0.01);
  });
  const inv = vols.map((v) => 1 / v);
  const s = inv.reduce((a, b) => a + b, 0);
  let weights = topPicks.map((p, i) => ({
    ticker: p.ticker,
    weight: s > 0 ? inv[i] / s : 1 / topPicks.length
  }));
  const blendRaw = options.equalBlend;
  const equalBlend =
    blendRaw != null && Number.isFinite(Number(blendRaw)) ? Math.max(0, Math.min(1, Number(blendRaw))) : 0;
  if (equalBlend > 0 && weights.length > 0) {
    const eq = 1 / weights.length;
    weights = weights.map((w) => ({
      ...w,
      weight: (1 - equalBlend) * w.weight + equalBlend * eq
    }));
    const t = weights.reduce((a, w) => a + w.weight, 0);
    if (t > 0) weights.forEach((w) => { w.weight /= t; });
  }
  return applyMaxPositionWeightCap(weights, MAX_POSITION_WEIGHT_BACKTEST);
}

/** Score-proportional weights + 10% cap. */
function calculatePositionWeightsScore(topPicks) {
  if (!topPicks.length) return [];
  const scores = topPicks.map(p => p.compositeScore || p.combinedScore || 50);
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const range = maxScore - minScore;
  const weights = topPicks.map((pick, i) => {
    const normalized = range > 0 ? (scores[i] - minScore) / range : 0.5;
    const multiplier = 0.5 + normalized * 1.0;
    return { ticker: pick.ticker, weight: multiplier };
  });
  let total = weights.reduce((s, w) => s + w.weight, 0);
  weights.forEach(w => w.weight = w.weight / total);
  return applyMaxPositionWeightCap(weights, MAX_POSITION_WEIGHT_BACKTEST);
}

function calculatePositionWeights(topPicks) {
  if (!topPicks.length) return [];
  const scores = topPicks.map(p => p.compositeScore || p.combinedScore || 50);
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const range = maxScore - minScore;

  const weights = topPicks.map((pick, i) => {
    const normalized = range > 0 ? (scores[i] - minScore) / range : 0.5;
    const multiplier = 0.5 + normalized * 1.0;
    return { ticker: pick.ticker, weight: multiplier };
  });

  let total = weights.reduce((s, w) => s + w.weight, 0);
  weights.forEach(w => w.weight = w.weight / total);

  return applyMaxPositionWeightCap(weights, MAX_POSITION_WEIGHT_BACKTEST);
}

/** Blend 50% inverse-vol and 50% score-proportional; 10% cap per name (aggressive / turbo). */
function calculateAggressiveVolatilityWeights(topPicks) {
  if (!topPicks.length) return [];

  const invVols = topPicks.map(p => 1 / Math.max(p.volatility != null ? p.volatility : 0.2, 0.10));
  const totalInv = invVols.reduce((s, v) => s + v, 0);

  const scores = topPicks.map(p => p.compositeScore || 50);
  const totalScore = scores.reduce((s, v) => s + v, 0);

  const weights = topPicks.map((p, i) => {
    const volW = totalInv > 0 ? invVols[i] / totalInv : 1 / topPicks.length;
    const scoreW = totalScore > 0 ? scores[i] / totalScore : 1 / topPicks.length;
    return { ticker: p.ticker, weight: volW * 0.5 + scoreW * 0.5 };
  });

  let total = weights.reduce((s, w) => s + w.weight, 0);
  weights.forEach(w => w.weight = w.weight / total);

  return applyMaxPositionWeightCap(weights, MAX_POSITION_WEIGHT_BACKTEST);
}

function applySectorLimits(rankings, fundamentals, topN, maxSectorFrac = MAX_SECTOR_CONCENTRATION) {
  if (!fundamentals) return rankings.slice(0, topN);
  const selected = [];
  const sectorWeights = {};

  for (const pick of rankings) {
    const sector = fundamentals[pick.ticker]?.sector || 'Unknown';
    const currentWeight = sectorWeights[sector] || 0;
    if (currentWeight + (1 / topN) > maxSectorFrac) continue;
    selected.push(pick);
    sectorWeights[sector] = currentWeight + (1 / topN);
    if (selected.length >= topN) break;
  }
  return selected;
}

function dynamicLookback(spyPrices, asOfDate) {
  const available = spyPrices.filter(p => p.date <= asOfDate);
  if (available.length < 252) return 6;

  const mom12m = bt_returnForDays(available, 252);
  const mom6m = bt_returnForDays(available, 126);
  const mom3m = bt_returnForDays(available, 63);

  if (mom12m > 0.10 && mom6m > 0.05 && mom3m > 0.02) return 8;
  if (Math.sign(mom12m) !== Math.sign(mom3m)) return 4;
  return 6;
}

/** Percentile rank 0–100 of finalMomentumScore within candidate set (min→0, max→100). */
function bt_momentumPercentilesForCandidates(candidates) {
  const momPercentiles = {};
  if (!candidates.length) return momPercentiles;
  const sorted = [...candidates.map((c) => c.mom.finalMomentumScore)].sort((a, b) => a - b);
  candidates.forEach((c) => {
    const rank = sorted.filter((s) => s < c.mom.finalMomentumScore).length;
    momPercentiles[c.ticker] = sorted.length > 1 ? (rank / (sorted.length - 1)) * 100 : 50;
  });
  return momPercentiles;
}

// ============================================
// BACKTEST RANKING FUNCTIONS (4 DISTINCT STRATEGIES)
// ============================================

function bt_rankMomentumOnly(universe, priceHistory, asOfDate) {
  const spyPrices = priceHistory['SPY'];
  const candidates = [];

  for (const ticker of universe) {
    if (ticker === 'SPY' || !ticker) continue;
    const prices = priceHistory[ticker];
    if (!prices || prices.length < 120) continue;

    const mom = bt_calculateMomentum(prices, asOfDate, 6, spyPrices);
    if (!mom) continue;
    if (mom.annualizedVol > 0.80) continue;

    candidates.push({ ticker, mom });
  }

  const results = [];
  for (const c of candidates) {
    const momNorm = Math.max(0, Math.min(100, (c.mom.finalMomentumScore + 2) * 25));
    results.push({
      ticker: c.ticker,
      compositeScore: momNorm,
      momentumScore: momNorm,
      price: c.mom.currentPrice,
      volatility: c.mom.annualizedVol,
      strategy: 'momentum_only'
    });
  }

  results.sort((a, b) => b.compositeScore - a.compositeScore);
  return results;
}

function bt_rankMomentumValue(universe, priceHistory, asOfDate) {
  const spyPrices = priceHistory['SPY'];
  const candidates = [];

  for (const ticker of universe) {
    if (ticker === 'SPY' || !ticker) continue;
    const prices = priceHistory[ticker];
    if (!prices || prices.length < 120) continue;

    const mom = bt_calculateMomentum(prices, asOfDate, 6, spyPrices);
    const val = bt_calculateValueSignal(prices, asOfDate);
    if (!mom || !val) continue;
    if (mom.annualizedVol > 0.80) continue;
    if (mom.trendBonus < 0 && val.valueScore < 40) continue;

    candidates.push({ ticker, mom, val });
  }

  const results = [];
  for (const c of candidates) {
    const momNorm = Math.max(0, Math.min(100, (c.mom.finalMomentumScore + 1) * 33));
    const combined = momNorm * 0.60 + c.val.valueScore * 0.40;
    results.push({
      ticker: c.ticker,
      compositeScore: combined,
      momentumScore: momNorm,
      valueScore: c.val.valueScore,
      price: c.mom.currentPrice,
      volatility: c.mom.annualizedVol,
      strategy: 'momentum_value'
    });
  }

  results.sort((a, b) => b.compositeScore - a.compositeScore);
  return results;
}

function bt_rankQualityMomentumV2(universe, priceHistory, fundamentals, asOfDate) {
  const spyPrices = priceHistory['SPY'];
  const candidates = [];

  for (const ticker of universe) {
    if (ticker === 'SPY' || !ticker) continue;
    const prices = priceHistory[ticker];
    if (!prices || prices.length < 120) continue;

    const fund = fundamentals?.[ticker];
    if (!fund) continue;
    if (fund.fundamentalComposite < 50) continue;

    const mom = bt_calculateMomentum(prices, asOfDate, 6, spyPrices);
    if (!mom) continue;
    if (mom.annualizedVol > 0.80) continue;

    const momQ = calculateMomentumQuality(prices, asOfDate);
    if (momQ && momQ.score < 25) continue;

    candidates.push({ ticker, mom, fund, momQ });
  }

  const results = [];
  for (const c of candidates) {
    const momNorm = Math.max(0, Math.min(100, (c.mom.finalMomentumScore + 2) * 25));
    results.push({
      ticker: c.ticker,
      compositeScore: momNorm,
      momentumScore: momNorm,
      fundamentalScore: c.fund.fundamentalComposite,
      price: c.mom.currentPrice,
      volatility: c.mom.annualizedVol,
      strategy: 'quality_momentum'
    });
  }

  results.sort((a, b) => b.compositeScore - a.compositeScore);
  return results;
}

function bt_rankFullCompositeV2(universe, priceHistory, fundamentals, asOfDate, dynWeights, opts = {}) {
  const spyPrices = priceHistory['SPY'];
  const momQThreshold = opts.momQThreshold ?? 25;
  const fundamentalFloor = opts.fundamentalFloor ?? 20;
  const maxVol = opts.maxVol ?? 0.80;
  const strategyLabel = opts.strategyLabel || 'full_composite';
  const skipConstraintPenalty = !!opts.skipConstraintPenalty;
  const blendMQ = opts.blendMomentumWithQuality;

  // PASS 1: collect candidates (percentiles computed only for aggressive/turbo)
  const candidates = [];
  for (const ticker of universe) {
    if (ticker === 'SPY' || !ticker) continue;
    const prices = priceHistory[ticker];
    if (!prices || prices.length < 120) continue;

    const fund = fundamentals?.[ticker];
    if (!fund) continue;
    if (fundamentalFloor > 0 && fund.fundamentalComposite < fundamentalFloor) continue;
    if (!skipConstraintPenalty && fund.constraintPenalty <= -7) continue;

    const mom = bt_calculateMomentum(prices, asOfDate, 6, spyPrices);
    const val = bt_calculateValueSignal(prices, asOfDate);
    if (!mom || !val) continue;
    if (mom.annualizedVol > maxVol) continue;

    const momQ = calculateMomentumQuality(prices, asOfDate);
    if (momQThreshold > 0 && momQ && momQ.score < momQThreshold) continue;

    candidates.push({ ticker, mom, val, fund, momQ, prices });
  }

  const usePercentileMom = strategyLabel === 'full_composite_aggressive' || strategyLabel === 'full_composite_turbo';
  const momPercentiles = usePercentileMom ? bt_momentumPercentilesForCandidates(candidates) : {};

  // PASS 2: build final composite scores using percentile-normalized momentum
  const results = [];
  for (const c of candidates) {
    // Use percentile for aggressive (wide candidate set), linear for conservative (preserves absolute magnitude)
    const momNorm = usePercentileMom
      ? (momPercentiles[c.ticker] ?? 50)
      : Math.max(0, Math.min(100, (c.mom.finalMomentumScore + 1) * 33));
    const mqScore = c.momQ?.score ?? 50;
    let momentumTerm = momNorm;
    if (blendMQ && blendMQ.raw != null && blendMQ.quality != null) {
      const sum = blendMQ.raw + blendMQ.quality;
      momentumTerm = sum > 0 ? momNorm * (blendMQ.raw / sum) + mqScore * (blendMQ.quality / sum) : momNorm;
    }
    const dynVal = calculateDynamicValuation(c.mom.currentPrice, c.fund, c.prices, asOfDate);

    const w = dynWeights || DEFAULT_COMPOSITE_WEIGHTS;
    const dcf = c.fund.dcfScore || 50;

    const momQBonus = blendMQ ? 0 : (c.momQ ? (c.momQ.score - 50) * 0.1 : 0);
    const fullScore = (
      c.fund.fundamentalComposite * w.fundamental +
      dcf * w.dcf +
      dynVal.score * w.valuation +
      momentumTerm * w.momentum +
      c.val.valueScore * w.value
    ) + momQBonus;

    results.push({
      ticker: c.ticker,
      compositeScore: fullScore,
      fundamentalScore: c.fund.fundamentalComposite,
      dcfScore: dcf,
      dcfUpside: c.fund.dcfUpside,
      momentumScore: momentumTerm,
      momentumQuality: c.momQ?.score || 50,
      valuationScore: dynVal.score,
      valueScore: c.val.valueScore,
      price: c.mom.currentPrice,
      volatility: c.mom.annualizedVol,
      lookbackUsed: c.mom.lookbackUsed,
      strategy: strategyLabel
    });
  }

  results.sort((a, b) => b.compositeScore - a.compositeScore);

  if (process.env.DCF_IC_DIAGNOSTIC === '1' && results.length >= 5) {
    const xs = [];
    const ys = [];
    for (const r of results) {
      const series = priceHistory[r.ticker];
      if (!series) continue;
      const fwd = btForwardReturnOverTradingDays(series, asOfDate, 42);
      if (fwd == null) continue;
      xs.push(r.dcfScore);
      ys.push(fwd);
    }
    if (xs.length >= 5) {
      const rho = spearmanCorrelation(xs, ys);
      console.log(`[DCF_IC_DIAGNOSTIC] asOf=${asOfDate} n=${xs.length} spearman(dcfScore,~42d_fwd_ret)=${rho != null ? rho.toFixed(4) : 'n/a'}`);
    }
  }

  return results;
}

/** Log-return sequence for ML/RNN (length seqLen). */
function extractMlLogReturnSeq(priceHistory, asOfDate, seqLen = 60) {
  if (!priceHistory || priceHistory.length < 2) return null;
  const avail = priceHistory.filter((p) => p.date <= asOfDate);
  const slice = avail.slice(-(seqLen + 1));
  const seq = [];
  for (let i = 1; i < slice.length; i++) {
    const a = slice[i - 1].close;
    const b = slice[i].close;
    if (a > 0 && b > 0) seq.push(Math.log(b / a));
  }
  if (seq.length < seqLen) {
    seq.splice(0, 0, ...Array(seqLen - seq.length).fill(0));
  }
  return seq.slice(-seqLen);
}

/** Prefer explicit PYTHON; else project .venv so ML works under `npm run server` without activating venv. */
function resolvePythonInterpreter() {
  if (process.env.PYTHON) return process.env.PYTHON;
  const unix = path.join(__dirname, '.venv', 'bin', 'python3');
  if (existsSync(unix)) return unix;
  const win = path.join(__dirname, '.venv', 'Scripts', 'python.exe');
  if (existsSync(win)) return win;
  return 'python3';
}

function resolveMlRankWeight(portfolio) {
  const envW = parseFloat(process.env.ML_RANK_WEIGHT || '0');
  const envOk = Number.isFinite(envW) ? Math.max(0, Math.min(1, envW)) : 0;
  const cfg = portfolio?.config?.mlRankWeight;
  if (cfg != null && cfg !== '') {
    const v = parseFloat(cfg);
    if (Number.isFinite(v)) return Math.max(0, Math.min(1, v));
  }
  return envOk;
}

async function applyMlBlendToCompositeRankings(rankings, fundamentals, priceHistory, asOfDate, mlRankWeight, spySeries = null) {
  if (mlRankWeight <= 0 || !rankings?.length) return rankings;
  const features = [];
  const sequences = [];
  for (const row of rankings) {
    const fund = fundamentals[row.ticker];
    const packed = packMlFundRankRow(fund, row, {
      priceSeries: priceHistory[row.ticker],
      asOfDate,
      ...(spySeries?.length ? { benchmarkSeries: spySeries } : {})
    });
    if (!packed) return rankings;
    features.push(packed.vector);
    sequences.push(extractMlLogReturnSeq(priceHistory[row.ticker], asOfDate) || Array(60).fill(0));
  }
  const pred = await runMlPredictBatchAsync(features, sequences);
  if (!pred?.ok || !Array.isArray(pred.mlScore) || pred.mlScore.length !== rankings.length) return rankings;
  return rankings
    .map((r, i) => {
      const ml = pred.mlScore[i];
      const blended = (1 - mlRankWeight) * r.compositeScore + mlRankWeight * ml;
      return { ...r, compositeScore: blended, mlModelScore: ml };
    })
    .sort((a, b) => b.compositeScore - a.compositeScore);
}

function bt_rankStocks(universe, priceHistory, asOfDate, strategy = 'momentum_value') {
  const scores = [];
  
  for (const ticker of universe) {
    if (ticker === 'SPY' || ticker === ' ') continue;
    
    const prices = priceHistory[ticker];
    if (!prices || prices.length < 120) continue;
    
    const momentum = bt_calculateMomentum(prices, asOfDate, 6);
    const value = bt_calculateValueSignal(prices, asOfDate);
    
    if (!momentum || !value) continue;
    
    const momNormalized = Math.max(0, Math.min(100, (momentum.finalMomentumScore + 1) * 33));
    
    let combined;
    if (strategy === 'momentum') {
      combined = momNormalized;
    } else {
      combined = momNormalized * 0.6 + value.valueScore * 0.4;
    }
    
    if (momentum.trendBonus < 0 && value.valueScore < 40) continue;
    if (momentum.annualizedVol > 0.80) continue;
    
    scores.push({
      ticker,
      momentumScore: momNormalized,
      valueScore: value.valueScore,
      combinedScore: combined,
      price: momentum.currentPrice,
      volatility: momentum.annualizedVol
    });
  }
  
  scores.sort((a, b) => b.combinedScore - a.combinedScore);
  return scores;
}

async function bt_fetchPriceHistory(ticker, startDate, endDate) {
  try {
    const result = await yahooFinance.chart(ticker, {
      period1: startDate,
      period2: endDate,
      interval: '1d'
    });
    
    if (!result || !result.quotes || result.quotes.length === 0) {
      return null;
    }
    
    return result.quotes
      .filter(q => q.date && q.close)
      .map(q => ({
        date: typeof q.date === 'string' ? q.date.substring(0, 10) : q.date.toISOString().substring(0, 10),
        close: q.close
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch (err) {
    console.error(`Failed to fetch ${ticker}:`, err.message);
    return null;
  }
}

/** Compact performance row for /api/backtest/diagnostic (same math as full backtest response). */
function extractDiagnosticPerformance(sim, capital) {
  const { dailyValues, tradeLog } = sim;
  if (!dailyValues || dailyValues.length < 2) return null;
  const first = dailyValues[0];
  const last = dailyValues[dailyValues.length - 1];
  const years = daysBetween(first.date, last.date) / 365;
  const totalReturn = (last.portfolio - capital) / capital;
  const annualizedReturn = Math.pow(1 + totalReturn, 1 / years) - 1;
  const benchReturn = last.benchmark > 0 ? (last.benchmark - capital) / capital : 0;
  const benchAnnualized = Math.pow(1 + benchReturn, 1 / years) - 1;
  const alpha = annualizedReturn - benchAnnualized;

  const dailyReturns = [];
  for (let i = 1; i < dailyValues.length; i++) {
    if (dailyValues[i - 1].portfolio > 0) dailyReturns.push(dailyValues[i].portfolio / dailyValues[i - 1].portfolio - 1);
  }
  const annualizedVol = standardDeviation(dailyReturns) * Math.sqrt(252);
  const riskFreeRate = 0.043;
  const sharpe = annualizedVol > 0 ? (annualizedReturn - riskFreeRate) / annualizedVol : 0;

  let peak = 0;
  let maxDrawdown = 0;
  for (const d of dailyValues) {
    if (d.portfolio > peak) peak = d.portfolio;
    const dd = (d.portfolio - peak) / peak;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }

  const sells = tradeLog.filter((t) => t.type === 'SELL');
  const stops = tradeLog.filter((t) => t.type === 'STOP');
  const allExits = [...sells, ...stops];
  const winners = allExits.filter((t) => t.holdingReturn > 0);
  const winRate = allExits.length > 0 ? winners.length / allExits.length : 0;

  const monthlyReturns = [];
  let currentMonthData = null;
  for (const d of dailyValues) {
    const month = d.date.substring(0, 7);
    if (!currentMonthData || currentMonthData.month !== month) {
      if (currentMonthData) monthlyReturns.push(currentMonthData);
      currentMonthData = { month, portfolioStart: d.portfolio, portfolioEnd: d.portfolio, benchStart: d.benchmark, benchEnd: d.benchmark };
    } else {
      currentMonthData.portfolioEnd = d.portfolio;
      currentMonthData.benchEnd = d.benchmark;
    }
  }
  if (currentMonthData) monthlyReturns.push(currentMonthData);
  const monthlyWithReturns = monthlyReturns
    .map((m) => ({
      portfolio: ((m.portfolioEnd - m.portfolioStart) / m.portfolioStart) * 100,
      benchmark: ((m.benchEnd - m.benchStart) / m.benchStart) * 100
    }))
    .filter((m) => !isNaN(m.portfolio) && isFinite(m.portfolio));
  const monthsBeating = monthlyWithReturns.filter((m) => m.portfolio > m.benchmark).length;
  const hitRate = monthlyWithReturns.length > 0 ? monthsBeating / monthlyWithReturns.length : 0;

  return {
    totalReturn: (totalReturn * 100).toFixed(2),
    annualizedReturn: (annualizedReturn * 100).toFixed(2),
    alpha: (alpha * 100).toFixed(2),
    sharpe: sharpe.toFixed(2),
    maxDrawdown: (maxDrawdown * 100).toFixed(2),
    vol: (annualizedVol * 100).toFixed(2),
    winRate: (winRate * 100).toFixed(1),
    hitRate: (hitRate * 100).toFixed(1),
    period: `${first.date} to ${last.date}`
  };
}

app.get('/api/backtest/:universeId', async (req, res) => {
  const { universeId } = req.params;
  const {
    period = '3y',
    rebalanceFreq: rebalanceFreqRaw = 'monthly',
    topN = 10,
    strategy = 'momentum_value',
    initialCapital = 10000,
    optimize = 'false',
    adaptiveMode: adaptiveModeRaw = 'fixed',
    positionSizing: positionSizingRaw,
    pillarOverride: pillarOverrideQuery,
    regimeEnabled: regimeEnabledQuery,
    usePaperWeights: usePaperWeightsQuery,
    mlRanking: mlRankingQuery
  } = req.query;

  const rebalanceFreq = String(rebalanceFreqRaw || 'monthly').toLowerCase().trim();
  const allowedFreq = ['monthly', 'quarterly', 'weekly', 'biweekly', 'bimonthly'];
  if (!allowedFreq.includes(rebalanceFreq)) {
    return res.status(400).json({ success: false, error: `Invalid rebalanceFreq (use ${allowedFreq.join(', ')})` });
  }

  const adaptiveRaw = String(adaptiveModeRaw ?? 'fixed').toLowerCase().trim();
  const adaptiveMode =
    adaptiveRaw === 'adaptive' || adaptiveRaw === 'conservative' ? adaptiveRaw : 'fixed';
  const strategyClean = (strategy || 'momentum_value').toLowerCase().trim();
  const psQ = positionSizingRaw != null && String(positionSizingRaw).trim() !== '' ? String(positionSizingRaw).toLowerCase().trim() : null;
  const positionSizing =
    psQ && ['equal', 'invVol', 'score', 'invVolBlend'].includes(psQ)
      ? psQ
      : strategyClean === 'full_composite' || strategyClean === 'full_composite_aggressive' || strategyClean === 'full_composite_turbo'
        ? 'invVol'
        : 'equal';
  const needsFundamentals =
    strategyClean === 'full_composite' ||
    strategyClean === 'full_composite_aggressive' ||
    strategyClean === 'full_composite_turbo' ||
    strategyClean === 'quality_momentum';
  const capital = parseFloat(initialCapital) || 10000;
  const regimeEnabled = regimeEnabledQuery !== 'false' && regimeEnabledQuery !== false;
  const pillarOverrideNormalized = parsePillarOverrideQuery(pillarOverrideQuery);
  const pillarOverrideKey = pillarOverrideNormalized ? JSON.stringify(pillarOverrideNormalized) : 'none';
  const usePaperWeights =
    usePaperWeightsQuery === 'true' ||
    usePaperWeightsQuery === true ||
    usePaperWeightsQuery === '1';
  const enableMlOnBacktest =
    mlRankingQuery === 'true' || mlRankingQuery === true || mlRankingQuery === '1';
  const skipMlRankingAdjustmentsForBacktest = !enableMlOnBacktest;

  let tradingWeights = null;
  if (strategyClean === 'full_composite') {
    if (usePaperWeights) {
      const portfolio = loadPortfolio();
      if (portfolio && portfolio.config && portfolio.config.strategy === 'full_composite' && portfolio.config.weights) {
        tradingWeights = portfolio.config.weights;
      }
    }
  } else if (strategyClean === 'full_composite_aggressive') {
    if (usePaperWeights) {
      const portfolio = loadPortfolio();
      if (portfolio && portfolio.config && portfolio.config.strategy === 'full_composite_aggressive' && portfolio.config.weights) {
        tradingWeights = portfolio.config.weights;
      }
    }
    if (!tradingWeights) tradingWeights = { ...AGGRESSIVE_COMPOSITE_WEIGHTS };
  } else if (strategyClean === 'full_composite_turbo') {
    if (usePaperWeights) {
      const portfolio = loadPortfolio();
      if (portfolio && portfolio.config && portfolio.config.strategy === 'full_composite_turbo' && portfolio.config.weights) {
        tradingWeights = portfolio.config.weights;
      }
    }
    if (!tradingWeights) tradingWeights = { ...TURBO_COMPOSITE_WEIGHTS };
  }
  const weightsKey = tradingWeights ? JSON.stringify(tradingWeights) : 'default';
  const cpiCacheTag = process.env.FRED_API_KEY && String(process.env.FRED_API_KEY).trim() ? 'fred' : 'const';
  const simCfgTag = backtestSimConfigCacheTag({
    adaptiveMode,
    positionSizing,
    pitPolicy: needsFundamentals ? 'pit' : 'none',
    regimeEnabled,
    pillarOverrideKey,
    skipMlRankingAdjustments: skipMlRankingAdjustmentsForBacktest
  });

  const cacheKey = `${BACKTEST_CACHE_VERSION}-${universeId}-${period}-${rebalanceFreq}-${topN}-${strategyClean}-${capital}-${weightsKey}-${cpiCacheTag}-${simCfgTag}-${adaptiveMode}-${positionSizing}-${pillarOverrideKey}-${regimeEnabled ? 're1' : 're0'}-${usePaperWeights ? 'pw1' : 'pw0'}`;
  const cached = BACKTEST_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < BACKTEST_CACHE_TTL) {
    return res.json({
      success: true,
      ...cached.data,
      cached: true,
      mlRankingEnabled: enableMlOnBacktest
    });
  }
  
  const universe = UNIVERSE_TICKERS[universeId];
  if (!universe) {
    return res.status(400).json({ success: false, error: 'Unknown universe' });
  }

  const periodDays = { '1y': 365, '2y': 730, '3y': 1095, '5y': 1825 };
  const days = periodDays[period] || 1095;
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
  const lookbackStart = new Date(startDate.getTime() - 400 * 24 * 60 * 60 * 1000);
  const startDateStr = lookbackStart.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  const backtestStartDate = startDate.toISOString().split('T')[0];
  
  try {
    clearBacktestRuntimeCaches();
    const tickersToFetch = [...new Set([...universe, 'SPY'])].filter(t => t && t.trim() !== '');
    const priceHistory = {};
    
    const priceRows = await mapWithConcurrency(tickersToFetch, YAHOO_CHART_CONCURRENCY, async (ticker) => {
      const data = await bt_fetchPriceHistory(ticker, startDateStr, endDateStr);
      return { ticker, data };
    });
    for (const row of priceRows) {
      if (row?.data && !row.__error) priceHistory[row.ticker] = row.data;
    }

    let fundamentals = null;
    if (needsFundamentals) {
      fundamentals = {};
      const tickersForFundamentals = tickersToFetch.filter(t => t !== 'SPY');
      const fundRows = await mapWithConcurrency(tickersForFundamentals, FUNDAMENTALS_FETCH_CONCURRENCY, async (ticker) => {
        const fund = await fetchFundamentals(ticker);
        return { ticker, fund };
      });
      for (const row of fundRows) {
        if (row?.fund && !row.__error) fundamentals[row.ticker] = row.fund;
      }
    }
    
    // Generate rebalance dates
    const rebalanceDates = getRebalanceDates(backtestStartDate, endDateStr, rebalanceFreq);
    if (rebalanceDates.length < 2) {
      return res.status(400).json({ success: false, error: 'Insufficient rebalance dates' });
    }
    
    const spyPrices = priceHistory['SPY'];
    if (!spyPrices || spyPrices.length === 0) {
      return res.status(500).json({ success: false, error: 'Could not fetch SPY benchmark data. Try again.' });
    }

    const simStart = rebalanceDates[0];
    const simEnd = rebalanceDates[rebalanceDates.length - 1];
    const cpiObsStart = subtractMonths(simStart, 60);
    const fredKey = process.env.FRED_API_KEY;
    const cpiObservations = await fetchFredCpiObservations(cpiObsStart, simEnd, fredKey);
    const { multiplierFn: cashInflationMult, usedFred: inflationFromFred } = buildCashInflationMultiplierFn(
      cpiObservations,
      simStart,
      INFLATION_BASELINE_ANNUAL
    );

    const inflationBaselineMeta = inflationFromFred
      ? {
          source: 'fred_cpiaucsl',
          seriesId: FRED_CPI_SERIES_ID,
          publisher: 'Federal Reserve Economic Data (FRED), Federal Reserve Bank of St. Louis',
          detail: 'U.S. CPI All Urban Consumers, All Items, Seasonally Adjusted (BLS via FRED). Baseline = nominal dollars with same purchasing power as the backtest start month (monthly CPI ratio).'
        }
      : {
          source: 'constant_fallback',
          seriesId: null,
          publisher: null,
          detail: fredKey
            ? 'FRED returned no usable CPI for this range — using ~3%/yr compound fallback.'
            : 'Set FRED_API_KEY for official U.S. CPI (free key: fred.stlouisfed.org/docs/api/api_key.html). Using ~3%/yr compound fallback.'
        };

    const sim = await runBacktestSimulation(
      universe,
      priceHistory,
      fundamentals,
      spyPrices,
      rebalanceDates,
      parseInt(topN),
      capital,
      strategyClean,
      tradingWeights,
      cashInflationMult,
      universeId,
      {
        adaptiveMode,
        positionSizing,
        pillarOverride: pillarOverrideNormalized || undefined,
        regimeEnabled,
        skipMlRankingAdjustments: skipMlRankingAdjustmentsForBacktest
      }
    );

    const {
      dailyValues,
      tradeLog,
      rebalanceLog,
      factorSnapshots,
      holdings,
      regimeLog,
      totalStopsTriggered,
      benchmarkMeta,
      adaptiveWeightLog,
      initialPillarWeights,
      finalPillarWeights,
      pointInTime,
      pitDetail,
      nameSwapCount
    } = sim;

    if (!dailyValues || dailyValues.length < 2) {
      return res.status(500).json({ success: false, error: 'Backtest produced insufficient data' });
    }

    const first = dailyValues[0];
    const last = dailyValues[dailyValues.length - 1];
    const years = daysBetween(first.date, last.date) / 365;

    const totalReturn = (last.portfolio - capital) / capital;
    const annualizedReturn = Math.pow(1 + totalReturn, 1 / years) - 1;
    const benchReturn = last.benchmark > 0 ? (last.benchmark - capital) / capital : 0;
    const benchAnnualized = Math.pow(1 + benchReturn, 1 / years) - 1;
    const alpha = annualizedReturn - benchAnnualized;

    const dailyReturns = [];
    const benchDailyReturns = [];
    for (let i = 1; i < dailyValues.length; i++) {
      if (dailyValues[i - 1].portfolio > 0) dailyReturns.push(dailyValues[i].portfolio / dailyValues[i - 1].portfolio - 1);
      if (dailyValues[i].benchmark > 0 && dailyValues[i - 1].benchmark > 0) benchDailyReturns.push(dailyValues[i].benchmark / dailyValues[i - 1].benchmark - 1);
    }

    const annualizedVol = standardDeviation(dailyReturns) * Math.sqrt(252);
    const benchVol = benchDailyReturns.length > 0 ? standardDeviation(benchDailyReturns) * Math.sqrt(252) : 0;
    const riskFreeRate = 0.043;
    const sharpe = annualizedVol > 0 ? (annualizedReturn - riskFreeRate) / annualizedVol : 0;
    const benchSharpe = benchVol > 0 ? (benchAnnualized - riskFreeRate) / benchVol : 0;

    let peak = 0, maxDrawdown = 0, benchPeak = 0, benchMaxDD = 0;
    for (const d of dailyValues) {
      if (d.portfolio > peak) peak = d.portfolio;
      const dd = (d.portfolio - peak) / peak;
      if (dd < maxDrawdown) maxDrawdown = dd;
      if (d.benchmark > benchPeak) benchPeak = d.benchmark;
      const bdd = (d.benchmark - benchPeak) / benchPeak;
      if (bdd < benchMaxDD) benchMaxDD = bdd;
    }

    const sells = tradeLog.filter(t => t.type === 'SELL');
    const stops = tradeLog.filter(t => t.type === 'STOP');
    const allExits = [...sells, ...stops];
    const winners = allExits.filter(t => t.holdingReturn > 0);
    const winRate = allExits.length > 0 ? winners.length / allExits.length : 0;
    const avgWin = winners.length > 0 ? winners.reduce((s, t) => s + t.holdingReturn, 0) / winners.length : 0;
    const losers = allExits.filter(t => t.holdingReturn <= 0);
    const avgLoss = losers.length > 0 ? losers.reduce((s, t) => s + t.holdingReturn, 0) / losers.length : 0;

    const swapsTotal = nameSwapCount ?? 0;
    const rebalanceCountForSwaps = Math.max(1, rebalanceLog.length);
    const nameSwapsPerRebalance = swapsTotal / rebalanceCountForSwaps;
    const monthsInRun = Math.max(years * 12, 1 / 12);
    const monthlyTurnoverEstimate = swapsTotal / monthsInRun;
    const exitsWithDays = allExits.filter((t) => t.holdingDays != null && Number.isFinite(t.holdingDays));
    const avgHoldingPeriodDays =
      exitsWithDays.length > 0
        ? exitsWithDays.reduce((s, t) => s + t.holdingDays, 0) / exitsWithDays.length
        : null;

    const oneMonthSells = tradeLog.filter(
      (t) => t.type === 'SELL' && t.holdingDays != null && t.holdingDays <= 35
    );
    const oneMonthSellCount = oneMonthSells.length;
    const oneMonthSellAvgReturnPct =
      oneMonthSells.length > 0
        ? (oneMonthSells.reduce((s, t) => s + (t.holdingReturn || 0), 0) / oneMonthSells.length) * 100
        : 0;
    let rebuyWithin60d = 0;
    for (let ti = 0; ti < tradeLog.length; ti++) {
      const t = tradeLog[ti];
      if (t.type !== 'BUY') continue;
      for (let sj = ti - 1; sj >= 0; sj--) {
        const s = tradeLog[sj];
        if (s.type !== 'SELL' || s.ticker !== t.ticker) continue;
        const gap = daysBetween(s.date, t.date);
        if (gap > 0 && gap <= 60) rebuyWithin60d += 1;
        break;
      }
    }

    const monthlyReturns = [];
    let currentMonthData = null;
    for (const d of dailyValues) {
      const month = d.date.substring(0, 7);
      if (!currentMonthData || currentMonthData.month !== month) {
        if (currentMonthData) monthlyReturns.push(currentMonthData);
        currentMonthData = { month, portfolioStart: d.portfolio, portfolioEnd: d.portfolio, benchStart: d.benchmark, benchEnd: d.benchmark };
      } else {
        currentMonthData.portfolioEnd = d.portfolio;
        currentMonthData.benchEnd = d.benchmark;
      }
    }
    if (currentMonthData) monthlyReturns.push(currentMonthData);

    const monthlyWithReturns = monthlyReturns.map(m => ({
      month: m.month,
      portfolio: ((m.portfolioEnd - m.portfolioStart) / m.portfolioStart) * 100,
      benchmark: ((m.benchEnd - m.benchStart) / m.benchStart) * 100
    })).filter(m => !isNaN(m.portfolio) && isFinite(m.portfolio));

    const monthlyEventsSummary = buildMonthlyEventsSummary(rebalanceLog, tradeLog);

    const monthsBeating = monthlyWithReturns.filter(m => m.portfolio > m.benchmark).length;
    const hitRate = monthlyWithReturns.length > 0 ? (monthsBeating / monthlyWithReturns.length) * 100 : 0;

    const currentHoldings = [];
    const lastDate = rebalanceDates[rebalanceDates.length - 1];
    for (const [ticker, holding] of Object.entries(holdings)) {
      const price = getPrice(priceHistory[ticker], lastDate);
      if (price) {
        currentHoldings.push({ ticker, shares: holding.shares, entryPrice: holding.entryPrice, currentPrice: price, return: ((price - holding.entryPrice) / holding.entryPrice) * 100 });
      }
    }

    let factorAttribution = null;
    if ((strategyClean === 'full_composite' || strategyClean === 'full_composite_aggressive' || strategyClean === 'full_composite_turbo') && factorSnapshots.length >= 2) {
      const weightsForAttribution = finalPillarWeights || tradingWeights;
      factorAttribution = computeFactorAttribution(factorSnapshots, priceHistory, rebalanceDates, sells, fundamentals, weightsForAttribution);
    }

    let optimization = null;
    if (optimize === 'true' && (strategyClean === 'full_composite' || strategyClean === 'full_composite_aggressive' || strategyClean === 'full_composite_turbo')) {
      const portfolio = loadPortfolio();
      if (portfolio && portfolio.config && portfolio.config.strategy === strategyClean) {
        const defaultW = strategyClean === 'full_composite_aggressive' ? AGGRESSIVE_COMPOSITE_WEIGHTS
          : strategyClean === 'full_composite_turbo' ? TURBO_COMPOSITE_WEIGHTS
            : DEFAULT_COMPOSITE_WEIGHTS;
        const currentWeights = portfolio.config.weights || defaultW;
        optimization = await runOptimizationWithValidation(universe, priceHistory, fundamentals, spyPrices, rebalanceDates, parseInt(topN), capital, strategyClean, currentWeights, portfolio, universeId);
        if (optimization.status === 'accepted' && optimization.newWeights) tradingWeights = optimization.newWeights;
      }
    }

    const aggressiveMetrics = (strategyClean === 'full_composite_aggressive' || strategyClean === 'full_composite_turbo')
      ? computeStrategyRiskMetrics(dailyValues, tradeLog, rebalanceDates, parseInt(topN))
      : null;

    const portfolioForStatus = loadPortfolio();
    const optimizationStatus = {
      round: portfolioForStatus?.optimizationRound || 0,
      maxRounds: MAX_OPTIMIZATION_ROUNDS,
      frozen: (portfolioForStatus?.optimizationRound || 0) >= MAX_OPTIMIZATION_ROUNDS,
      weightHistory: portfolioForStatus?.weightHistory || [],
      lastOptimized: portfolioForStatus?.lastOptimized || null,
      stability: checkWeightStability(portfolioForStatus?.weightHistory || [])
    };

    const regimeSummary = regimeLog.length > 0 ? {
      totalPeriods: regimeLog.length,
      regimes: regimeLog.reduce((acc, r) => { acc[r.regime] = (acc[r.regime] || 0) + 1; return acc; }, {}),
      avgExposure: parseFloat((regimeLog.reduce((s, r) => s + r.exposure, 0) / regimeLog.length).toFixed(2)),
      exposureMap: getRegimeExposureMap(strategyClean)
    } : null;

    const responseData = {
      strategy,
      benchmark: benchmarkMeta,
      universe: universeId,
      period,
      rebalanceFreq,
      topN: parseInt(topN),
      initialCapital: capital,
      pointInTime: needsFundamentals ? pointInTime : null,
      pitDetail: needsFundamentals ? pitDetail : null,
      adaptiveMode,
      positionSizing,
      regimeEnabled,
      usePaperWeights,
      mlRankingEnabled: enableMlOnBacktest,
      pillarOverride: pillarOverrideNormalized || undefined,
      activeWeights: tradingWeights || (strategyClean === 'full_composite_aggressive' ? AGGRESSIVE_COMPOSITE_WEIGHTS : strategyClean === 'full_composite_turbo' ? TURBO_COMPOSITE_WEIGHTS : DEFAULT_COMPOSITE_WEIGHTS),
      initialPillarWeights: initialPillarWeights || undefined,
      finalPillarWeights: finalPillarWeights || undefined,
      factorAttribution,
      optimization,
      optimizationStatus,

      riskManagement: {
        regimeSummary,
        totalStopsTriggered,
        stopsDetail: stops.length > 0 ? stops.slice(0, 20).map(s => ({ date: s.date, ticker: s.ticker, return: ((s.holdingReturn || 0) * 100).toFixed(1) + '%' })) : []
      },

      inflationSource: inflationBaselineMeta.source,
      inflationSeriesId: inflationBaselineMeta.seriesId,
      inflationPublisher: inflationBaselineMeta.publisher,
      inflationDetail: inflationBaselineMeta.detail,
      inflationBaselineAnnualPct: inflationFromFred ? null : Math.round(INFLATION_BASELINE_ANNUAL * 1000) / 10,

      performance: {
        totalReturn: (totalReturn * 100).toFixed(2),
        annualizedReturn: (annualizedReturn * 100).toFixed(2),
        benchmarkReturn: (benchReturn * 100).toFixed(2),
        benchmarkAnnualized: (benchAnnualized * 100).toFixed(2),
        alpha: (alpha * 100).toFixed(2),
        sharpe: sharpe.toFixed(2),
        benchmarkSharpe: benchSharpe.toFixed(2),
        maxDrawdown: (maxDrawdown * 100).toFixed(2),
        benchmarkMaxDD: (benchMaxDD * 100).toFixed(2),
        annualizedVol: (annualizedVol * 100).toFixed(2),
        benchmarkVol: (benchVol * 100).toFixed(2),
        winRate: (winRate * 100).toFixed(1),
        avgWin: (avgWin * 100).toFixed(1),
        avgLoss: (avgLoss * 100).toFixed(1),
        hitRate: hitRate.toFixed(1),
        totalTrades: tradeLog.length,
        totalStops: stops.length,
        period: `${first.date} to ${last.date}`,
        years: years.toFixed(1),
        aggressiveMetrics,
        nameSwapsTotal: swapsTotal,
        nameSwapsPerRebalance: parseFloat(nameSwapsPerRebalance.toFixed(4)),
        monthlyTurnover: parseFloat(monthlyTurnoverEstimate.toFixed(4)),
        avgHoldingPeriodDays: avgHoldingPeriodDays != null ? parseFloat(avgHoldingPeriodDays.toFixed(1)) : null,
        oneMonthSellCount,
        oneMonthSellAvgReturnPct: parseFloat(oneMonthSellAvgReturnPct.toFixed(1)),
        rebuyWithin60d
      },

      equityCurve: dailyValues,
      monthlyReturns: monthlyWithReturns,
      monthlyEventsSummary,
      trades: tradeLog,
      rebalances: rebalanceLog,
      currentHoldings,
      ...(adaptiveWeightLog && adaptiveWeightLog.length ? { adaptiveWeightLog } : {})
    };

    BACKTEST_CACHE.set(cacheKey, { data: responseData, timestamp: Date.now() });

    res.json({ success: true, ...responseData });
    
  } catch (error) {
    console.error('Backtest error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    clearBacktestRuntimeCaches();
  }
});

/**
 * GET /api/backtest/diagnostic/:universeId
 * Runs full_composite backtests (bimonthly, top 15 by default) for factor attribution.
 * Query ablation=1 adds five Q60/M20/V20 runs varying regime and position sizing.
 */
app.get('/api/backtest/diagnostic/:universeId', async (req, res) => {
  const { universeId } = req.params;
  const period = req.query.period || '3y';
  const topN = parseInt(String(req.query.topN || '15'), 10);
  const capital = parseFloat(String(req.query.initialCapital || '10000')) || 10000;
  const rebalanceFreq = 'bimonthly';
  const strategyClean = 'full_composite';
  const regimeEnabledDefault = req.query.regimeEnabled !== 'false' && req.query.regimeEnabled !== false;
  const useAblation =
    req.query.ablation === '1' || req.query.ablation === 'true' || String(req.query.ablation || '').toLowerCase() === 'true';

  const universe = UNIVERSE_TICKERS[universeId];
  if (!universe) {
    return res.status(400).json({ success: false, error: 'Unknown universe' });
  }

  const periodDays = { '1y': 365, '2y': 730, '3y': 1095, '5y': 1825 };
  const days = periodDays[period] || 1095;
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
  const lookbackStart = new Date(startDate.getTime() - 400 * 24 * 60 * 60 * 1000);
  const startDateStr = lookbackStart.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  const backtestStartDate = startDate.toISOString().split('T')[0];

  const optimalQ60M20V20 = { fundamental: 0.6, dcf: 0, valuation: 0, momentum: 0.2, value: 0.2 };

  const factorAttributionRunDefs = [
    {
      name: 'Equal-weight five pillars',
      description: '20% each: quality, DCF, valuation, momentum, value (fixed)',
      adaptiveMode: 'fixed',
      pillarOverride: { fundamental: 1, dcf: 1, valuation: 1, momentum: 1, value: 1 }
    },
    {
      name: 'Quality only',
      description: '100% fundamental/quality pillar (fixed)',
      adaptiveMode: 'fixed',
      pillarOverride: { fundamental: 1, dcf: 0, valuation: 0, momentum: 0, value: 0 }
    },
    {
      name: 'Momentum only',
      description: '100% momentum (fixed)',
      adaptiveMode: 'fixed',
      pillarOverride: { fundamental: 0, dcf: 0, valuation: 0, momentum: 1, value: 0 }
    },
    {
      name: 'Quality + momentum 50/50',
      description: 'Fixed blend, no DCF/valuation',
      adaptiveMode: 'fixed',
      pillarOverride: { fundamental: 0.5, dcf: 0, valuation: 0, momentum: 0.5, value: 0 }
    },
    {
      name: 'Quality 60%, value 20%, momentum 20%',
      description: 'No DCF / dynamic valuation (fixed)',
      adaptiveMode: 'fixed',
      pillarOverride: { fundamental: 0.6, dcf: 0, valuation: 0, momentum: 0.2, value: 0.2 }
    },
    {
      name: 'Adaptive baseline',
      description: 'Rolling IC adaptive weights; anchor = server DEFAULT_COMPOSITE_WEIGHTS',
      adaptiveMode: 'adaptive',
      pillarOverride: null
    }
  ];

  const ablationRunDefs = [
    {
      name: 'Optimal baseline',
      description: 'Q60/M20/V20 fixed, regime on, inverse-vol sizing',
      adaptiveMode: 'fixed',
      pillarOverride: optimalQ60M20V20,
      regimeEnabled: true,
      positionSizing: 'invVol'
    },
    {
      name: 'No regime (100% exposure)',
      description: 'Same weights; regime overlay off (full exposure, no defensive top-N cut)',
      adaptiveMode: 'fixed',
      pillarOverride: optimalQ60M20V20,
      regimeEnabled: false,
      positionSizing: 'invVol'
    },
    {
      name: 'Equal weight sizing',
      description: 'Same weights; equal position sizes within top picks',
      adaptiveMode: 'fixed',
      pillarOverride: optimalQ60M20V20,
      regimeEnabled: true,
      positionSizing: 'equal'
    },
    {
      name: 'No regime + equal sizing',
      description: 'Regime off + equal weights',
      adaptiveMode: 'fixed',
      pillarOverride: optimalQ60M20V20,
      regimeEnabled: false,
      positionSizing: 'equal'
    },
    {
      name: 'InvVol + 40% equal blend',
      description: '60% inverse-vol / 40% equal blend per rebalance',
      adaptiveMode: 'fixed',
      pillarOverride: optimalQ60M20V20,
      regimeEnabled: true,
      positionSizing: 'invVolBlend'
    }
  ];

  const runDefs = useAblation ? ablationRunDefs : factorAttributionRunDefs;

  try {
    clearBacktestRuntimeCaches();
    const tickersToFetch = [...new Set([...universe, 'SPY'])].filter((t) => t && t.trim() !== '');
    const priceHistory = {};
    const priceRows = await mapWithConcurrency(tickersToFetch, YAHOO_CHART_CONCURRENCY, async (ticker) => {
      const data = await bt_fetchPriceHistory(ticker, startDateStr, endDateStr);
      return { ticker, data };
    });
    for (const row of priceRows) {
      if (row?.data && !row.__error) priceHistory[row.ticker] = row.data;
    }

    const fundamentals = {};
    const tickersForFundamentals = tickersToFetch.filter((t) => t !== 'SPY');
    const fundRows = await mapWithConcurrency(tickersForFundamentals, FUNDAMENTALS_FETCH_CONCURRENCY, async (ticker) => {
      const fund = await fetchFundamentals(ticker);
      return { ticker, fund };
    });
    for (const row of fundRows) {
      if (row?.fund && !row.__error) fundamentals[row.ticker] = row.fund;
    }

    const rebalanceDates = getRebalanceDates(backtestStartDate, endDateStr, rebalanceFreq);
    if (rebalanceDates.length < 2) {
      return res.status(400).json({ success: false, error: 'Insufficient rebalance dates' });
    }

    const spyPrices = priceHistory['SPY'];
    if (!spyPrices || !spyPrices.length) {
      return res.status(500).json({ success: false, error: 'Could not fetch SPY benchmark data. Try again.' });
    }

    const simStart = rebalanceDates[0];
    const simEnd = rebalanceDates[rebalanceDates.length - 1];
    const cpiObsStart = subtractMonths(simStart, 60);
    const fredKey = process.env.FRED_API_KEY;
    const cpiObservations = await fetchFredCpiObservations(cpiObsStart, simEnd, fredKey);
    const { multiplierFn: cashInflationMult } = buildCashInflationMultiplierFn(
      cpiObservations,
      simStart,
      INFLATION_BASELINE_ANNUAL
    );

    const runs = [];
    for (const def of runDefs) {
      const runRegimeEnabled = def.regimeEnabled !== undefined ? def.regimeEnabled : regimeEnabledDefault;
      const runPositionSizing = def.positionSizing || 'invVol';
      const sim = await runBacktestSimulation(
        universe,
        priceHistory,
        fundamentals,
        spyPrices,
        rebalanceDates,
        topN,
        capital,
        strategyClean,
        null,
        cashInflationMult,
        universeId,
        {
          adaptiveMode: def.adaptiveMode,
          positionSizing: runPositionSizing,
          pillarOverride: def.pillarOverride != null ? def.pillarOverride : undefined,
          regimeEnabled: runRegimeEnabled,
          // ML layers replace rules composite with model scores — would make every diagnostic run identical
          skipMlRankingAdjustments: true
        }
      );
      const performance = extractDiagnosticPerformance(sim, capital);
      runs.push({
        name: def.name,
        description: def.description || '',
        config: {
          adaptiveMode: def.adaptiveMode,
          rebalanceFreq,
          topN,
          strategy: strategyClean,
          positionSizing: runPositionSizing,
          regimeEnabled: runRegimeEnabled,
          pillarOverride: def.pillarOverride != null ? normalizePillarOverride(def.pillarOverride) : null
        },
        performance
      });
    }

    res.json({
      success: true,
      diagnostic: true,
      ablation: useAblation,
      universe: universeId,
      period,
      rebalanceFreq,
      topN,
      initialCapital: capital,
      regimeEnabled: regimeEnabledDefault,
      runs
    });
  } catch (error) {
    console.error('Diagnostic backtest error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    clearBacktestRuntimeCaches();
  }
});

// =====================================================================
// PAPER TRADE — Persistence
// =====================================================================

const PAPER_PORTFOLIO_PATH = './paper-portfolio.json';

function loadPortfolio() {
  if (!existsSync(PAPER_PORTFOLIO_PATH)) return null;
  try {
    return JSON.parse(readFileSync(PAPER_PORTFOLIO_PATH, 'utf-8'));
  } catch { return null; }
}

function savePortfolio(portfolio) {
  if (portfolio === null) {
    writeFileSync(PAPER_PORTFOLIO_PATH, 'null');
  } else {
    writeFileSync(PAPER_PORTFOLIO_PATH, JSON.stringify(portfolio, null, 2));
  }
}

function createEmptyPortfolio(config) {
  return {
    config,
    initialCapital: config.initialCapital,
    cash: config.initialCapital,
    holdings: [],
    navHistory: [],
    rebalanceHistory: [],
    recentSells: {},
    createdAt: new Date().toISOString().split('T')[0],
    lastRebalance: null,
    lastNavUpdate: null
  };
}

// =====================================================================
// OPTIMIZATION — Reset / Freeze
// =====================================================================

app.post('/api/optimization/reset', (req, res) => {
  const portfolio = loadPortfolio();
  if (!portfolio) return res.status(404).json({ success: false, error: 'No portfolio found' });

  const defaultW = portfolio.config?.strategy === 'full_composite_aggressive' ? AGGRESSIVE_COMPOSITE_WEIGHTS
    : portfolio.config?.strategy === 'full_composite_turbo' ? TURBO_COMPOSITE_WEIGHTS
      : DEFAULT_COMPOSITE_WEIGHTS;
  portfolio.config.weights = { ...defaultW };
  portfolio.config._weightsVersion = 4;
  delete portfolio.optimizationRound;
  delete portfolio.weightHistory;
  delete portfolio.lastOptimized;
  savePortfolio(portfolio);

  BACKTEST_CACHE.clear();

  res.json({
    success: true,
    message: 'Optimization state cleared. Weights reset to defaults. You have 5 new optimization rounds.',
    weights: defaultW
  });
});

app.post('/api/optimization/freeze', (req, res) => {
  const portfolio = loadPortfolio();
  if (!portfolio) return res.status(404).json({ success: false, error: 'No portfolio found' });

  portfolio.optimizationRound = MAX_OPTIMIZATION_ROUNDS;
  savePortfolio(portfolio);

  res.json({
    success: true,
    message: 'Weights are now frozen. No further optimization rounds will run.',
    round: MAX_OPTIMIZATION_ROUNDS,
    weights: portfolio.config?.weights || (portfolio.config?.strategy === 'full_composite_aggressive' ? AGGRESSIVE_COMPOSITE_WEIGHTS : portfolio.config?.strategy === 'full_composite_turbo' ? TURBO_COMPOSITE_WEIGHTS : DEFAULT_COMPOSITE_WEIGHTS)
  });
});

app.get('/api/optimization/status', (req, res) => {
  const portfolio = loadPortfolio();
  const round = portfolio?.optimizationRound || 0;
  const frozen = round >= MAX_OPTIMIZATION_ROUNDS;
  const defaultW = portfolio?.config?.strategy === 'full_composite_aggressive' ? AGGRESSIVE_COMPOSITE_WEIGHTS
    : portfolio?.config?.strategy === 'full_composite_turbo' ? TURBO_COMPOSITE_WEIGHTS
      : DEFAULT_COMPOSITE_WEIGHTS;
  const weights = portfolio?.config?.weights || defaultW;
  const weightHistory = portfolio?.weightHistory || [];

  res.json({
    success: true,
    round,
    maxRounds: MAX_OPTIMIZATION_ROUNDS,
    frozen,
    weights,
    weightHistory,
    lastOptimized: portfolio?.lastOptimized || null,
    stability: checkWeightStability(weightHistory)
  });
});

// =====================================================================
// PAPER TRADE — Init / Reset
// =====================================================================

app.post('/api/paper-trade/init', (req, res) => {
  const existing = loadPortfolio();
  if (existing) {
    return res.status(409).json({ success: false, error: 'Portfolio already exists. DELETE /api/paper-trade/reset first.' });
  }
  const {
    initialCapital = 100000,
    strategy = 'full_composite',
    universe = 'sp500_top50',
    topN = 15,
    mlRankWeight: mlBody,
    adaptiveMode: initAdaptive,
    positionSizing: initPosSize,
    regimeEnabled: initRegimeEnabled
  } = req.body || {};
  let mlRankWeight = parseFloat(process.env.ML_RANK_WEIGHT || '0');
  if (!Number.isFinite(mlRankWeight)) mlRankWeight = 0;
  mlRankWeight = Math.max(0, Math.min(1, mlRankWeight));
  if (mlBody != null && mlBody !== '') {
    const v = parseFloat(mlBody);
    if (Number.isFinite(v)) mlRankWeight = Math.max(0, Math.min(1, v));
  }
  const amInitRaw = initAdaptive != null && initAdaptive !== '' ? String(initAdaptive).toLowerCase().trim() : '';
  const amInit = amInitRaw === 'adaptive' || amInitRaw === 'conservative' ? amInitRaw : 'fixed';
  const psInitRaw = initPosSize != null && String(initPosSize).trim() !== '' ? String(initPosSize).toLowerCase().trim() : null;
  const psInit =
    psInitRaw && ['equal', 'invVol', 'score', 'invVolBlend'].includes(psInitRaw)
      ? psInitRaw
      : strategy === 'full_composite' || strategy === 'full_composite_aggressive' || strategy === 'full_composite_turbo'
        ? 'invVol'
        : undefined;
  const regimeEnabledInit =
    initRegimeEnabled === false || initRegimeEnabled === 'false' ? false : true;
  const config = {
    initialCapital: parseFloat(initialCapital),
    strategy,
    universe,
    topN: parseInt(topN),
    weights:
      strategy === 'full_composite'
        ? { ...DEFAULT_COMPOSITE_WEIGHTS }
        : strategy === 'full_composite_aggressive'
          ? { ...AGGRESSIVE_COMPOSITE_WEIGHTS }
          : strategy === 'full_composite_turbo'
            ? { ...TURBO_COMPOSITE_WEIGHTS }
            : null,
    _weightsVersion: strategy === 'full_composite' || strategy === 'full_composite_aggressive' || strategy === 'full_composite_turbo' ? 4 : undefined,
    mlRankWeight,
    adaptiveMode: amInit,
    regimeEnabled: regimeEnabledInit,
    ...(psInit ? { positionSizing: psInit } : {})
  };
  if (!UNIVERSE_TICKERS[config.universe]) {
    return res.status(400).json({ success: false, error: `Unknown universe: ${config.universe}` });
  }
  const portfolio = createEmptyPortfolio(config);
  savePortfolio(portfolio);
  res.json({ success: true, portfolio });
});

app.delete('/api/paper-trade/reset', (req, res) => {
  savePortfolio(null);
  res.json({ success: true, message: 'Portfolio reset.' });
});

// =====================================================================
// PAPER TRADE — Snapshot (record daily NAV)
// =====================================================================

async function takeNavSnapshot(portfolio) {
  const today = new Date().toISOString().split('T')[0];

  const tickers = [...new Set([
    ...portfolio.holdings.map(h => h.ticker),
    'SPY'
  ])].filter(Boolean);

  const prices = {};
  for (const ticker of tickers) {
    try {
      const quote = await yahooFinance.quote(ticker);
      prices[ticker] = quote?.regularMarketPrice || null;
    } catch { prices[ticker] = null; }
    await sleep(100);
  }

  let portfolioValue = portfolio.cash;
  for (const h of portfolio.holdings) {
    const px = prices[h.ticker];
    if (px) portfolioValue += h.shares * px;
    else portfolioValue += h.shares * h.entryPrice;
  }

  if (trailingStopEnabled() && portfolio.holdings.length > 0) {
    for (const h of portfolio.holdings) {
      const px = prices[h.ticker];
      if (px != null && Number.isFinite(px) && px > 0) {
        const prev = h.peakPriceSinceEntry != null ? h.peakPriceSinceEntry : h.entryPrice;
        h.peakPriceSinceEntry = Math.max(prev, px);
      }
    }
  }

  const spyPrice = prices['SPY'];
  let spyValue = portfolio.initialCapital;
  if (spyPrice && portfolio.navHistory.length === 0) {
    portfolio._spyStartPrice = spyPrice;
  }
  if (spyPrice && portfolio._spyStartPrice) {
    spyValue = portfolio.initialCapital * (spyPrice / portfolio._spyStartPrice);
  } else if (portfolio.navHistory.length > 0) {
    spyValue = portfolio.navHistory[portfolio.navHistory.length - 1].spyValue;
  }

  const todayEntry = { date: today, portfolioValue: parseFloat(portfolioValue.toFixed(2)), spyValue: parseFloat(spyValue.toFixed(2)) };
  const existingIdx = portfolio.navHistory.findIndex(n => n.date === today);

  if (existingIdx >= 0) {
    portfolio.navHistory[existingIdx] = todayEntry;
  } else {
    portfolio.navHistory.push(todayEntry);
  }
  portfolio.lastNavUpdate = today;
  savePortfolio(portfolio);
  return portfolio;
}

app.post('/api/paper-trade/snapshot', async (req, res) => {
  try {
    let portfolio = loadPortfolio();
    if (!portfolio) return res.status(404).json({ success: false, error: 'No portfolio. POST /api/paper-trade/init first.' });
    portfolio = await takeNavSnapshot(portfolio);
    res.json({ success: true, latestNav: portfolio.navHistory[portfolio.navHistory.length - 1] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// =====================================================================
// PAPER TRADE — Portfolio (GET, with auto-snapshot)
// =====================================================================

/** Mean(portfolio return) / mean(SPY return) on SPY-up vs SPY-down days, as % (null if not computable). */
function computePaperCaptureRatios(navHistory) {
  if (!navHistory || navHistory.length < 2) return { upCapture: null, downCapture: null };
  let upPortSum = 0;
  let upBenchSum = 0;
  let upCount = 0;
  let downPortSum = 0;
  let downBenchSum = 0;
  let downCount = 0;
  for (let i = 1; i < navHistory.length; i++) {
    const prev = navHistory[i - 1];
    const cur = navHistory[i];
    const pv0 = prev.portfolioValue;
    const pv1 = cur.portfolioValue;
    const sv0 = prev.spyValue;
    const sv1 = cur.spyValue;
    if (!(pv0 > 0) || !(sv0 > 0)) continue;
    const portRet = (pv1 - pv0) / pv0;
    const benchRet = (sv1 - sv0) / sv0;
    if (benchRet > 0) {
      upPortSum += portRet;
      upBenchSum += benchRet;
      upCount++;
    } else if (benchRet < 0) {
      downPortSum += portRet;
      downBenchSum += benchRet;
      downCount++;
    }
  }
  const upAvgBench = upCount > 0 ? upBenchSum / upCount : 0;
  const downAvgBench = downCount > 0 ? downBenchSum / downCount : 0;
  const upCapture =
    upCount > 0 && Math.abs(upAvgBench) > 1e-12
      ? (upPortSum / upCount / upAvgBench) * 100
      : null;
  const downCapture =
    downCount > 0 && Math.abs(downAvgBench) > 1e-12
      ? (downPortSum / downCount / downAvgBench) * 100
      : null;
  return { upCapture, downCapture };
}

app.get('/api/paper-trade/portfolio', async (req, res) => {
  try {
    let portfolio = loadPortfolio();
    if (!portfolio) return res.json({ success: true, portfolio: null });

    if (portfolio.holdings.length > 0) {
      portfolio = await takeNavSnapshot(portfolio);
    }

    const tickers = portfolio.holdings.map(h => h.ticker);
    const currentPrices = {};
    for (const ticker of tickers) {
      try {
        const quote = await yahooFinance.quote(ticker);
        currentPrices[ticker] = quote?.regularMarketPrice || null;
      } catch { currentPrices[ticker] = null; }
      await sleep(50);
    }

    let totalValue = portfolio.cash;
    const enrichedHoldings = portfolio.holdings.map(h => {
      const currentPrice = currentPrices[h.ticker] || h.entryPrice;
      const marketValue = h.shares * currentPrice;
      totalValue += h.shares * currentPrice;
      const pnl = (currentPrice - h.entryPrice) * h.shares;
      const pnlPct = h.entryPrice > 0 ? ((currentPrice / h.entryPrice) - 1) * 100 : 0;
      return { ...h, currentPrice, marketValue, pnl, pnlPct: parseFloat(pnlPct.toFixed(2)) };
    });

    enrichedHoldings.forEach(h => {
      h.weight = totalValue > 0 ? parseFloat(((h.marketValue / totalValue) * 100).toFixed(1)) : 0;
    });

    const totalReturn = portfolio.initialCapital > 0
      ? ((totalValue / portfolio.initialCapital) - 1) * 100 : 0;

    let spyReturn = 0;
    if (portfolio.navHistory.length > 0) {
      const latestSpy = portfolio.navHistory[portfolio.navHistory.length - 1].spyValue;
      spyReturn = ((latestSpy / portfolio.initialCapital) - 1) * 100;
    }

    const alpha = totalReturn - spyReturn;
    const daysActive = Math.floor((Date.now() - new Date(portfolio.createdAt).getTime()) / (86400000));

    let nextRebalance = null;
    if (portfolio.lastRebalance) {
      nextRebalance = nextMidMonthRebalanceAfter(portfolio.lastRebalance);
    } else if (portfolio.createdAt) {
      nextRebalance = nextMidMonthRebalanceAfter(portfolio.createdAt);
    }

    const monthlyEventsSummary = buildPaperMonthlyEventsSummary(portfolio.rebalanceHistory);

    const activeWeights = portfolio.config?.weights || null;
    const weightHistory = (portfolio.rebalanceHistory || [])
      .filter(rb => rb.report?.weightChanges)
      .slice(-5)
      .map(rb => ({
        date: rb.date,
        weights: rb.report.weightChanges.new,
        alpha: rb.report.alpha
      }));

    const captures = computePaperCaptureRatios(portfolio.navHistory);
    const lastRb =
      portfolio.rebalanceHistory && portfolio.rebalanceHistory.length > 0
        ? portfolio.rebalanceHistory[portfolio.rebalanceHistory.length - 1]
        : null;
    const stratPaper = (portfolio.config?.strategy || 'full_composite').toLowerCase().trim();
    const notionalRegimeExposure =
      lastRb?.regime && lastRb.regime !== 'disabled'
        ? parseFloat((getStrategyRegimeExposure(lastRb.regime, stratPaper) * 100).toFixed(1))
        : lastRb?.regime === 'disabled'
          ? 100
          : null;
    const posWeights = enrichedHoldings.filter((h) => h.weight > 0);
    let weightSpread = null;
    let largestPosition = null;
    let smallestPosition = null;
    if (posWeights.length > 0) {
      const byW = [...posWeights].sort((a, b) => b.weight - a.weight);
      largestPosition = { ticker: byW[0].ticker, weight: byW[0].weight };
      smallestPosition = { ticker: byW[byW.length - 1].ticker, weight: byW[byW.length - 1].weight };
      if (smallestPosition.weight > 0) {
        weightSpread = parseFloat((largestPosition.weight / smallestPosition.weight).toFixed(2));
      }
    }
    const cashPct = totalValue > 0 ? parseFloat(((portfolio.cash / totalValue) * 100).toFixed(2)) : 0;
    const cashDragRough =
      totalValue > 0
        ? parseFloat(((portfolio.cash / totalValue) * spyReturn).toFixed(2))
        : null;

    res.json({
      success: true,
      portfolio: {
        config: portfolio.config,
        createdAt: portfolio.createdAt,
        lastRebalance: portfolio.lastRebalance,
        nextRebalance,
        cash: parseFloat(portfolio.cash.toFixed(2)),
        holdings: enrichedHoldings,
        summary: {
          totalValue: parseFloat(totalValue.toFixed(2)),
          totalReturn: parseFloat(totalReturn.toFixed(2)),
          spyReturn: parseFloat(spyReturn.toFixed(2)),
          alpha: parseFloat(alpha.toFixed(2)),
          daysActive,
          holdingsCount: portfolio.holdings.length,
          upCapture: captures.upCapture != null ? parseFloat(captures.upCapture.toFixed(1)) : null,
          downCapture: captures.downCapture != null ? parseFloat(captures.downCapture.toFixed(1)) : null,
          currentRegime: lastRb?.regime ?? null,
          adjustedTopN: lastRb?.adjustedTopN ?? null,
          notionalRegimeExposure,
          cashPct,
          weightSpread,
          largestPosition,
          smallestPosition,
          cashDragRough
        },
        navHistory: portfolio.navHistory,
        rebalanceCount: portfolio.rebalanceHistory.length,
        monthlyEventsSummary,
        activeWeights,
        weightHistory
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// =====================================================================
// PAPER TRADE — Rebalance (run model, execute paper trades)
// =====================================================================

// Uses unified DEFAULT_COMPOSITE_WEIGHTS, FACTOR_NAMES, FACTOR_LABELS defined above

/**
 * @param {object|null} weightContext - For composite: { weightsBeforeAdaptive, weightsAfterAdaptive } (backtest-style IC step applied before this rank).
 */
function generateRebalanceReport(portfolio, sells, rankings, priceHistory, currentPrices, weightContext = null) {
  const prevRebalance = portfolio.rebalanceHistory.length > 0
    ? portfolio.rebalanceHistory[portfolio.rebalanceHistory.length - 1]
    : null;
  const defaultW = portfolio.config?.strategy === 'full_composite_aggressive' ? AGGRESSIVE_COMPOSITE_WEIGHTS
    : portfolio.config?.strategy === 'full_composite_turbo' ? TURBO_COMPOSITE_WEIGHTS
      : DEFAULT_COMPOSITE_WEIGHTS;
  const currentWeights = portfolio.config.weights || defaultW;
  const isFirstRebalance = !prevRebalance;

  if (isFirstRebalance) {
    return {
      periodReturn: 0, spyReturn: 0, alpha: 0,
      soldPerformance: [], missedOpportunities: [], factorPerformance: [],
      weightChanges: { previous: { ...currentWeights }, new: { ...currentWeights }, changes: [] },
      narrative: 'Initial rebalance — no prior data to analyze. Weights set to defaults.'
    };
  }

  const weightsBeforeAdaptive = weightContext?.weightsBeforeAdaptive
    ? { ...weightContext.weightsBeforeAdaptive }
    : { ...currentWeights };
  const weightsAfterAdaptive = weightContext?.weightsAfterAdaptive
    ? { ...weightContext.weightsAfterAdaptive }
    : { ...weightsBeforeAdaptive };

  // Period returns
  const prevNav = portfolio.navHistory.length >= 2
    ? portfolio.navHistory[portfolio.navHistory.length - 2]
    : portfolio.navHistory[portfolio.navHistory.length - 1];
  const latestNav = portfolio.navHistory[portfolio.navHistory.length - 1];
  const periodReturn = prevNav && latestNav
    ? ((latestNav.portfolioValue - prevNav.portfolioValue) / prevNav.portfolioValue) * 100
    : 0;
  const spyReturn = prevNav && latestNav
    ? ((latestNav.spyValue - prevNav.spyValue) / prevNav.spyValue) * 100
    : 0;
  const alpha = periodReturn - spyReturn;

  // Sold performance
  const soldPerformance = sells.map(s => ({
    ticker: s.ticker,
    pnl: s.pnl,
    pnlPct: s.pnlPct,
    reason: 'Dropped out of top N'
  }));

  // Missed opportunities: universe stocks not held that gained the most
  const heldTickers = new Set(portfolio.holdings.map(h => h.ticker));
  const prevDate = prevRebalance.date;
  const missedOpportunities = [];
  const rankedTickers = new Set(rankings.map(r => r.ticker));

  for (const ticker of Object.keys(priceHistory)) {
    if (ticker === 'SPY' || heldTickers.has(ticker)) continue;
    const ph = priceHistory[ticker];
    if (!ph || ph.length < 2) continue;
    const prevIdx = ph.findIndex(p => p.date >= prevDate);
    if (prevIdx < 0) continue;
    const prevPrice = ph[prevIdx].close;
    const curPrice = ph[ph.length - 1].close;
    if (!prevPrice || prevPrice <= 0) continue;
    const ret = ((curPrice - prevPrice) / prevPrice) * 100;
    if (ret > 0) {
      const rank = rankings.findIndex(r => r.ticker === ticker);
      missedOpportunities.push({
        ticker, returnPct: parseFloat(ret.toFixed(1)),
        currentRank: rank >= 0 ? rank + 1 : null,
        wasRanked: rankedTickers.has(ticker)
      });
    }
  }
  missedOpportunities.sort((a, b) => b.returnPct - a.returnPct);
  const topMissed = missedOpportunities.slice(0, 5);

  // Factor performance: use previous allRankings to see which factors predicted returns
  const prevRankings = prevRebalance.allRankings || [];
  const factorPerformance = [];
  const factorMap = {
    fundamental: 'fundamentalScore', dcf: 'dcfScore',
    valuation: 'valuationScore', momentum: 'momentumScore', value: 'valueScore'
  };

  if (prevRankings.length >= 4) {
    const withReturns = [];
    for (const r of prevRankings) {
      const ph = priceHistory[r.ticker];
      if (!ph || ph.length < 2) continue;
      const prevIdx = ph.findIndex(p => p.date >= prevDate);
      if (prevIdx < 0) continue;
      const prevPrice = ph[prevIdx].close;
      const curPrice = ph[ph.length - 1].close;
      if (!prevPrice || prevPrice <= 0) continue;
      withReturns.push({ ...r, realized: ((curPrice - prevPrice) / prevPrice) * 100 });
    }

    if (withReturns.length >= 4) {
      withReturns.sort((a, b) => b.realized - a.realized);
      const mid = Math.floor(withReturns.length / 2);
      const winners = withReturns.slice(0, mid);
      const losers = withReturns.slice(mid);

      for (const f of FACTOR_NAMES) {
        const key = factorMap[f] || f;
        const avgWin = winners.reduce((s, r) => s + (r[key] || 0), 0) / winners.length;
        const avgLose = losers.reduce((s, r) => s + (r[key] || 0), 0) / losers.length;
        const spread = avgWin - avgLose;
        let contribution;
        if (spread > 5) contribution = 'strong';
        else if (spread > 2) contribution = 'moderate';
        else if (spread > 0) contribution = 'weak';
        else contribution = 'negative';
        factorPerformance.push({
          name: f, label: FACTOR_LABELS[f],
          avgScoreWinners: parseFloat(avgWin.toFixed(1)),
          avgScoreLosers: parseFloat(avgLose.toFixed(1)),
          spread: parseFloat(spread.toFixed(1)),
          contribution
        });
      }
    }
  }

  // --- Long-term IC analysis across all rebalance history ---
  const longTermIC = {};
  for (const f of FACTOR_NAMES) longTermIC[f] = 0;
  let longTermPeriods = 0;

  if (portfolio.rebalanceHistory.length >= 2) {
    for (let i = 0; i < portfolio.rebalanceHistory.length - 1; i++) {
      const rb = portfolio.rebalanceHistory[i];
      const nextRb = portfolio.rebalanceHistory[i + 1];
      const allRanked = rb.allRankings || [];
      if (allRanked.length < 6) continue;

      const withRet = [];
      for (const r of allRanked) {
        const ph = priceHistory[r.ticker];
        if (!ph || ph.length < 2) continue;
        const startIdx = ph.findIndex(p => p.date >= rb.date);
        const endIdx = ph.findIndex(p => p.date >= nextRb.date);
        if (startIdx < 0 || endIdx < 0) continue;
        const sp = ph[startIdx].close;
        const ep = ph[endIdx].close;
        if (!sp || sp <= 0) continue;
        withRet.push({ ...r, realized: (ep - sp) / sp });
      }
      if (withRet.length < 6) continue;

      const returns = withRet.map(s => s.realized);
      let validPeriod = false;
      for (const f of FACTOR_NAMES) {
        const key = factorMap[f] || f;
        const scores = withRet.map(s => s[key] ?? 0);
        const ic = spearmanCorrelation(scores, returns);
        if (isFinite(ic)) { longTermIC[f] += ic; validPeriod = true; }
      }
      if (validPeriod) longTermPeriods++;
    }
    if (longTermPeriods > 0) {
      for (const f of FACTOR_NAMES) longTermIC[f] /= longTermPeriods;
    }
  }

  const hasLongTerm = longTermPeriods >= 2;
  const newWeights = { ...weightsAfterAdaptive };

  const changes = FACTOR_NAMES.map(f => ({
    factor: f,
    label: FACTOR_LABELS[f],
    from: parseFloat((weightsBeforeAdaptive[f] * 100).toFixed(1)),
    to: parseFloat((weightsAfterAdaptive[f] * 100).toFixed(1)),
    direction: weightsAfterAdaptive[f] > weightsBeforeAdaptive[f] + 0.001 ? 'increased'
             : weightsAfterAdaptive[f] < weightsBeforeAdaptive[f] - 0.001 ? 'decreased' : 'unchanged'
  }));

  // Build narrative
  let narrative = `Portfolio returned ${periodReturn >= 0 ? '+' : ''}${periodReturn.toFixed(1)}% vs S&P ${spyReturn >= 0 ? '+' : ''}${spyReturn.toFixed(1)}% (alpha: ${alpha >= 0 ? '+' : ''}${alpha.toFixed(1)}%).`;

  if (factorPerformance.length > 0) {
    const best = factorPerformance.reduce((a, b) => a.spread > b.spread ? a : b);
    const worst = factorPerformance.reduce((a, b) => a.spread < b.spread ? a : b);
    narrative += ` This period: ${best.label} was strongest predictor (spread +${best.spread.toFixed(1)}).`;
    if (worst.spread < 1) {
      narrative += ` ${worst.label} was weak (spread ${worst.spread >= 0 ? '+' : ''}${worst.spread.toFixed(1)}).`;
    }
  }

  if (hasLongTerm) {
    const bestLT = FACTOR_NAMES.reduce((a, b) => longTermIC[a] > longTermIC[b] ? a : b);
    const worstLT = FACTOR_NAMES.reduce((a, b) => longTermIC[a] < longTermIC[b] ? a : b);
    narrative += ` Long-term IC (${longTermPeriods} periods): ${FACTOR_LABELS[bestLT]} strongest (IC ${longTermIC[bestLT] >= 0 ? '+' : ''}${longTermIC[bestLT].toFixed(3)})`;
    if (longTermIC[worstLT] < 0.01) {
      narrative += `, ${FACTOR_LABELS[worstLT]} weakest (IC ${longTermIC[worstLT].toFixed(3)})`;
    }
    narrative += '.';
  }

  const increased = changes.filter(c => c.direction === 'increased');
  const decreased = changes.filter(c => c.direction === 'decreased');
  if (increased.length > 0) {
    narrative += ` Shifting weight toward ${increased.map(c => `${c.label} (${c.from}% → ${c.to}%)`).join(', ')}.`;
  }
  if (decreased.length > 0) {
    narrative += ` Reducing ${decreased.map(c => `${c.label} (${c.from}% → ${c.to}%)`).join(', ')}.`;
  }

  if (topMissed.length > 0) {
    const missedStr = topMissed.slice(0, 3).map(m =>
      `${m.ticker} (+${m.returnPct}%${m.currentRank ? ` ranked #${m.currentRank}` : ' unranked'})`
    ).join(', ');
    narrative += ` Missed: ${missedStr}.`;
  }

  return {
    periodReturn: parseFloat(periodReturn.toFixed(1)),
    spyReturn: parseFloat(spyReturn.toFixed(1)),
    alpha: parseFloat(alpha.toFixed(1)),
    soldPerformance,
    missedOpportunities: topMissed,
    factorPerformance,
    longTermIC: hasLongTerm ? Object.fromEntries(FACTOR_NAMES.map(f => [f, parseFloat(longTermIC[f].toFixed(4))])) : null,
    longTermPeriods,
    weightChanges: {
      previous: Object.fromEntries(FACTOR_NAMES.map(f => [f, parseFloat((weightsBeforeAdaptive[f] * 100).toFixed(1))])),
      new: Object.fromEntries(FACTOR_NAMES.map(f => [f, parseFloat((weightsAfterAdaptive[f] * 100).toFixed(1))])),
      changes
    },
    newWeightsRaw: newWeights,
    narrative
  };
}

app.post('/api/paper-trade/rebalance', async (req, res) => {
  try {
    clearBacktestRuntimeCaches();
    let portfolio = loadPortfolio();
    if (!portfolio) return res.status(404).json({ success: false, error: 'No portfolio. POST /api/paper-trade/init first.' });

    const { strategy, universe: universeId, topN } = portfolio.config;
    const universe = UNIVERSE_TICKERS[universeId];
    if (!universe) return res.status(400).json({ success: false, error: 'Unknown universe' });

    const today = new Date().toISOString().split('T')[0];
    const lookbackStart = new Date(Date.now() - 500 * 86400000).toISOString().split('T')[0];

    const priceHistory = {};
    const tickersToFetch = [...new Set([...universe, 'SPY'])].filter(Boolean);
    const paperPriceRows = await mapWithConcurrency(tickersToFetch, YAHOO_CHART_CONCURRENCY, async (ticker) => {
      const data = await bt_fetchPriceHistory(ticker, lookbackStart, today);
      return { ticker, data };
    });
    for (const row of paperPriceRows) {
      if (row?.data && !row.__error) priceHistory[row.ticker] = row.data;
    }

    const needsFundamentals = strategy === 'full_composite' || strategy === 'full_composite_aggressive' || strategy === 'full_composite_turbo' || strategy === 'quality_momentum';
    let fundamentals = null;
    if (needsFundamentals) {
      fundamentals = {};
      const fundTickers = tickersToFetch.filter(t => t !== 'SPY');
      const paperFundRows = await mapWithConcurrency(fundTickers, FUNDAMENTALS_FETCH_CONCURRENCY, async (ticker) => {
        const fund = await fetchFundamentals(ticker);
        return { ticker, fund };
      });
      for (const row of paperFundRows) {
        if (row?.fund && !row.__error) fundamentals[row.ticker] = row.fund;
      }
    }

    let fundamentalsLive = fundamentals;
    let pitPaperMeta = { pointInTime: true, pitDetail: { ok: 0, fallback: 0, stale: 0 } };
    if (needsFundamentals) {
      const pit = await loadPitFundamentalsForUniverse(universe, today, priceHistory);
      fundamentalsLive = pit.map;
      pitPaperMeta = { pointInTime: pit.pointInTime, pitDetail: pit.pitDetail };
    }

    // Ensure weights exist; reset to new defaults when schema version bumps
    if (strategy === 'full_composite') {
      if (!portfolio.config.weights || !portfolio.config._weightsVersion || portfolio.config._weightsVersion < 4) {
        portfolio.config.weights = { ...DEFAULT_COMPOSITE_WEIGHTS };
        portfolio.config._weightsVersion = 4;
      }
    }
    if (strategy === 'full_composite_aggressive') {
      if (!portfolio.config.weights || !portfolio.config._weightsVersion || portfolio.config._weightsVersion < 2) {
        portfolio.config.weights = { ...AGGRESSIVE_COMPOSITE_WEIGHTS };
        portfolio.config._weightsVersion = 2;
      }
    }
    if (strategy === 'full_composite_turbo') {
      if (!portfolio.config.weights || !portfolio.config._weightsVersion || portfolio.config._weightsVersion < 2) {
        portfolio.config.weights = { ...TURBO_COMPOSITE_WEIGHTS };
        portfolio.config._weightsVersion = 2;
      }
    }

    const amPaper =
      portfolio.config.adaptiveMode != null && portfolio.config.adaptiveMode !== ''
        ? String(portfolio.config.adaptiveMode).toLowerCase().trim()
        : '';
    const adaptiveModeCfg = amPaper === 'adaptive' || amPaper === 'conservative' ? amPaper : 'fixed';
    const psPaperRaw =
      portfolio.config.positionSizing != null && String(portfolio.config.positionSizing).trim() !== ''
        ? String(portfolio.config.positionSizing).toLowerCase().trim()
        : null;
    const positionSizingPaper =
      psPaperRaw && ['equal', 'invVol', 'score', 'invVolBlend'].includes(psPaperRaw)
        ? psPaperRaw
        : strategy === 'full_composite' || strategy === 'full_composite_aggressive' || strategy === 'full_composite_turbo'
          ? 'invVol'
          : 'equal';

    const defaultWForAdaptive = strategy === 'full_composite_aggressive' ? AGGRESSIVE_COMPOSITE_WEIGHTS
      : strategy === 'full_composite_turbo' ? TURBO_COMPOSITE_WEIGHTS
        : DEFAULT_COMPOSITE_WEIGHTS;
    const weightsBeforeAdaptive = { ...(portfolio.config.weights || defaultWForAdaptive) };
    let weightsForRank = { ...weightsBeforeAdaptive };
    const compositePaper =
      strategy === 'full_composite' || strategy === 'full_composite_aggressive' || strategy === 'full_composite_turbo';
    if (compositePaper) {
      if (adaptiveModeCfg === 'fixed') {
        weightsForRank = { ...weightsBeforeAdaptive };
      } else if (portfolio.rebalanceHistory.length >= 6) {
        const prevRb = portfolio.rebalanceHistory[portfolio.rebalanceHistory.length - 1];
        const prevRows = prevRb?.allRankings;
        if (prevRows && prevRows.length >= 6) {
          const rollingIcPeriods = Math.min(24, Math.max(1, parseInt(process.env.ROLLING_IC_PERIODS || '12', 10) || 12));
          const rollingAdaptive = rebuildRollingStateFromRebalanceHistory(
            portfolio.rebalanceHistory,
            priceHistory,
            getPrice,
            rollingIcPeriods
          );
          const useRidge = process.env.ADAPTIVE_RIDGE === '1' || process.env.ADAPTIVE_RIDGE === 'true';
          const ridgeLambda = parseFloat(process.env.ADAPTIVE_RIDGE_LAMBDA || '1') || 1;
          const composed = composeAdaptiveWeightsForRebalance({
            weights: weightsBeforeAdaptive,
            anchorWeights: { ...defaultWForAdaptive },
            prevRankedRows: prevRows,
            prevDateStr: prevRb.date,
            asOfDateStr: today,
            priceHistory,
            spySeries: priceHistory['SPY'],
            rollingState: rollingAdaptive,
            getPrice,
            maxDeltaPerFactor: 0.05,
            useRidge,
            ridgeLambda,
            momentumRegimeOpts: {},
            previousStepWeights: { ...weightsBeforeAdaptive },
            icObservationCount: prevRows.length,
            icMinObservations: Math.max(10, Math.min(30, universe.length)),
            rebalanceIndex: portfolio.rebalanceHistory.length
          });
          let wUse = composed.weights;
          if (adaptiveModeCfg === 'conservative') {
            const regB = regimeAdjustedCompositeWeights({ ...weightsBeforeAdaptive }, spyAbove200dma(priceHistory['SPY'], today));
            wUse = {};
            for (const f of FACTOR_NAMES) {
              wUse[f] = 0.8 * (regB[f] || 0) + 0.2 * (composed.weights[f] || 0);
            }
            const s0 = FACTOR_NAMES.reduce((a, f) => a + wUse[f], 0);
            for (const f of FACTOR_NAMES) wUse[f] = s0 > 0 ? wUse[f] / s0 : composed.weights[f];
          }
          weightsForRank = wUse;
        } else {
          weightsForRank = regimeAdjustedCompositeWeights(weightsForRank, spyAbove200dma(priceHistory['SPY'], today));
        }
      } else {
        weightsForRank = regimeAdjustedCompositeWeights(weightsForRank, spyAbove200dma(priceHistory['SPY'], today));
      }
    }
    if (compositePaper && pitPaperMeta.pitDetail && (pitPaperMeta.pitDetail.fallback > 0 || pitPaperMeta.pitDetail.stale > 0)) {
      weightsForRank = applyPitStalenessPillarHalving(weightsForRank);
    }
    portfolio.config.weights = { ...weightsForRank };

    // Run ranking (PIT fundamentals when applicable; adaptive after 6+ prior rebalances)
    let rankings;
    if (strategy === 'full_composite') {
      rankings = bt_rankFullCompositeV2(universe, priceHistory, fundamentalsLive, today, weightsForRank);
    } else if (strategy === 'full_composite_aggressive') {
      rankings = bt_rankFullCompositeV2(universe, priceHistory, fundamentalsLive, today, weightsForRank, {
        momQThreshold: 10, fundamentalFloor: 15, maxVol: 1.0, strategyLabel: 'full_composite_aggressive',
        blendMomentumWithQuality: { raw: 0.7, quality: 0.3 }
      });
    } else if (strategy === 'full_composite_turbo') {
      rankings = bt_rankFullCompositeV2(universe, priceHistory, fundamentalsLive, today, weightsForRank, {
        momQThreshold: 0, fundamentalFloor: 0, maxVol: 1.2, strategyLabel: 'full_composite_turbo',
        skipConstraintPenalty: true,
        blendMomentumWithQuality: { raw: 0.55, quality: 0.20 }
      });
    } else if (strategy === 'quality_momentum') {
      rankings = bt_rankQualityMomentumV2(universe, priceHistory, fundamentalsLive, today);
    } else if (strategy === 'momentum') {
      rankings = bt_rankMomentumOnly(universe, priceHistory, today);
    } else {
      rankings = bt_rankMomentumValue(universe, priceHistory, today);
    }

    const mlW = resolveMlRankWeight(portfolio);
    const spyPaper = priceHistory['SPY'];
    if (mlAlphaRankingEnabled()
      && (strategy === 'full_composite' || strategy === 'full_composite_aggressive' || strategy === 'full_composite_turbo')
      && fundamentalsLive && spyPaper?.length) {
      rankings = await applyMlAlphaRankingToCompositeRankings(rankings, fundamentalsLive, priceHistory, today, spyPaper);
    }
    if (!mlAlphaRankingEnabled()
      && (strategy === 'full_composite' || strategy === 'full_composite_aggressive' || strategy === 'full_composite_turbo')
      && mlW > 0 && fundamentalsLive) {
      rankings = await applyMlBlendToCompositeRankings(rankings, fundamentalsLive, priceHistory, today, mlW, spyPaper);
    }

    const regimeEnabledPaper = portfolio.config.regimeEnabled !== false;
    const regimeMetaPaper = regimeEnabledPaper
      ? calculateMarketRegime(spyPaper, today, universe, priceHistory)
      : { regime: 'disabled', breadthRatio: null };
    const isAggressiveStrategyPaper = strategy === 'full_composite_aggressive' || strategy === 'full_composite_turbo';
    const regimeNPaper = adjustedTopNForRegime(regimeMetaPaper.regime, topN);
    const adjustedTopNPaper = isAggressiveStrategyPaper
      ? Math.max(Math.ceil(topN * 0.7), regimeNPaper)
      : Math.max(3, regimeNPaper);

    const sectorCap = getMaxSectorConcentration(strategy);
    const usesFundamentalsPaper =
      strategy === 'full_composite' || strategy === 'full_composite_aggressive' || strategy === 'full_composite_turbo';
    const topPicks =
      usesFundamentalsPaper && fundamentalsLive
        ? applySectorLimits(rankings, fundamentalsLive, adjustedTopNPaper, sectorCap)
        : rankings.slice(0, adjustedTopNPaper);
    const topTickers = new Set(topPicks.map(p => p.ticker));

    if (!portfolio.recentSells || typeof portfolio.recentSells !== 'object') portfolio.recentSells = {};

    const heldSetPaper = new Set(portfolio.holdings.map((h) => h.ticker));
    const incomingCandidatesPaper = topPicks.filter((p) => !heldSetPaper.has(p.ticker));
    const lowestTopScorePaper =
      topPicks.length > 0
        ? Math.min(...topPicks.map((p) => p.compositeScore ?? p.combinedScore ?? 0))
        : null;
    const turnoverBrakeStrategies =
      strategy === 'full_composite' ||
      strategy === 'full_composite_aggressive' ||
      strategy === 'full_composite_turbo' ||
      strategy === 'quality_momentum';

    const allowsSellPaper = (sOld) => {
      if (!turnoverBrakeStrategies) return true;
      if (!incomingCandidatesPaper.length) return true;
      if (lowestTopScorePaper == null) return true;
      if (!(sOld > 0)) return true;
      return lowestTopScorePaper >= sOld * (1 + TURNOVER_SCORE_IMPROVEMENT_THRESHOLD);
    };

    const maxHoldingsPaper = adjustedTopNPaper + HOLDINGS_OVERFLOW_SLOTS;

    // Current prices for held stocks
    const allRelevantTickers = [...new Set([
      ...portfolio.holdings.map(h => h.ticker),
      ...topPicks.map(p => p.ticker),
      'SPY'
    ])];
    const currentPrices = {};
    for (const ticker of allRelevantTickers) {
      const ph = priceHistory[ticker];
      if (ph && ph.length > 0) {
        currentPrices[ticker] = ph[ph.length - 1].close;
      }
    }

    const sells = [];
    let remainingHoldings = [...portfolio.holdings];

    const scorePaper = (tick) => {
      const row = rankings.find((r) => r.ticker === tick);
      return row ? (row.compositeScore ?? row.combinedScore ?? 0) : 0;
    };

    const pushRotationSell = (h, sellPrice) => {
      const proceeds = h.shares * sellPrice;
      portfolio.cash += proceeds;
      const exitReturn = (sellPrice - h.entryPrice) / h.entryPrice;
      portfolio.recentSells[h.ticker] = { exitDate: today, exitPrice: sellPrice, exitReturn };
      sells.push({
        ticker: h.ticker,
        shares: h.shares,
        entryPrice: h.entryPrice,
        sellPrice,
        pnl: parseFloat(((sellPrice - h.entryPrice) * h.shares).toFixed(2)),
        pnlPct: parseFloat((((sellPrice / h.entryPrice) - 1) * 100).toFixed(2)),
        reason: 'ROTATION'
      });
      remainingHoldings = remainingHoldings.filter((x) => x.ticker !== h.ticker);
    };

    const notInTop = remainingHoldings.filter((h) => !topTickers.has(h.ticker));
    const sortedExitPaper = [...notInTop].sort((a, b) => scorePaper(a.ticker) - scorePaper(b.ticker));

    for (const h of sortedExitPaper) {
      if (!remainingHoldings.some((x) => x.ticker === h.ticker)) continue;
      if (topTickers.has(h.ticker)) continue;
      const sOld = scorePaper(h.ticker);
      if (!allowsSellPaper(sOld)) continue;
      const sellPrice = currentPrices[h.ticker] || h.entryPrice;
      const hDays = daysBetween(h.entryDate, today);
      if (hDays < MIN_HOLD_DAYS_BEFORE_SELL) {
        if (turnoverDebugEnabled()) {
          console.log(`[HOLD] paper keep ${h.ticker} — ${hDays}d < min ${MIN_HOLD_DAYS_BEFORE_SELL}d`);
        }
        continue;
      }
      pushRotationSell(h, sellPrice);
    }

    while (remainingHoldings.length > maxHoldingsPaper) {
      const pool = remainingHoldings.filter((h) => !topTickers.has(h.ticker));
      if (!pool.length) break;
      pool.sort((a, b) => scorePaper(a.ticker) - scorePaper(b.ticker));
      const h = pool[0];
      if (!allowsSellPaper(scorePaper(h.ticker))) break;
      const sellPrice = currentPrices[h.ticker] || h.entryPrice;
      pushRotationSell(h, sellPrice);
    }

    // New buys: regime-sized topN, positionSizing for composite — matches backtest
    const heldTickers = new Set(remainingHoldings.map(h => h.ticker));
    const newPicks = topPicks.filter(p => !heldTickers.has(p.ticker));
    const totalSlots = adjustedTopNPaper;
    const slotsUsed = remainingHoldings.length;
    const slotsAvailable = totalSlots - slotsUsed;

    const buys = [];
    if (slotsAvailable > 0 && newPicks.length > 0) {
      const buyTargets = [];
      for (const p of newPicks) {
        if (buyTargets.length >= slotsAvailable) break;
        const rs = portfolio.recentSells[p.ticker];
        if (rs && daysBetween(rs.exitDate, today) < REBUY_COOLDOWN_DAYS) {
          if (turnoverDebugEnabled()) {
            console.log(`[TURNOVER] paper skip rebuy ${p.ticker} — cooldown`);
          }
          continue;
        }
        buyTargets.push(p);
      }
      let volWeights;
      if (strategy === 'full_composite_aggressive' || strategy === 'full_composite_turbo') {
        volWeights = calculateAggressiveVolatilityWeights(buyTargets);
      } else if (compositePaper && positionSizingPaper === 'invVol') {
        volWeights = calculatePositionWeightsInvVol(buyTargets, priceHistory, today);
      } else if (compositePaper && positionSizingPaper === 'invVolBlend') {
        volWeights = calculatePositionWeightsInvVol(buyTargets, priceHistory, today, { equalBlend: 0.4 });
      } else if (compositePaper && positionSizingPaper === 'score') {
        volWeights = calculatePositionWeightsScore(buyTargets);
      } else {
        volWeights = calculatePositionWeights(buyTargets);
      }
      const weightByTicker = new Map(volWeights.map((vw) => [vw.ticker, vw.weight]));
      const cashForNewBuys = portfolio.cash;
      const equalFallback = buyTargets.length > 0 ? 1 / buyTargets.length : 0;

      for (let i = 0; i < buyTargets.length; i++) {
        const pick = buyTargets[i];
        const buyPrice = currentPrices[pick.ticker];
        if (!buyPrice || buyPrice <= 0) continue;
        const w = weightByTicker.get(pick.ticker) ?? equalFallback;
        const dollars = cashForNewBuys * w;
        const shares = Math.floor(dollars / buyPrice);
        if (shares <= 0) continue;
        const cost = shares * buyPrice;
        portfolio.cash -= cost;
        if (portfolio.recentSells[pick.ticker]) delete portfolio.recentSells[pick.ticker];
        remainingHoldings.push({
          ticker: pick.ticker,
          shares,
          entryPrice: buyPrice,
          entryDate: today,
          ...(trailingStopEnabled() ? { peakPriceSinceEntry: buyPrice } : {}),
          scores: {
            composite: pick.compositeScore,
            fundamental: pick.fundamentalScore,
            momentum: pick.momentumScore,
            valuation: pick.valuationScore,
            value: pick.valueScore
          }
        });
        buys.push({
          ticker: pick.ticker,
          shares,
          buyPrice,
          cost: parseFloat(cost.toFixed(2)),
          scores: {
            composite: pick.compositeScore,
            fundamental: pick.fundamentalScore,
            momentum: pick.momentumScore,
            valuation: pick.valuationScore,
            value: pick.valueScore
          }
        });
      }
    }

    portfolio.holdings = remainingHoldings;
    portfolio.lastRebalance = today;

    // Record SPY start price on first rebalance
    if (!portfolio._spyStartPrice && currentPrices['SPY']) {
      portfolio._spyStartPrice = currentPrices['SPY'];
    }

    const report = (strategy === 'full_composite' || strategy === 'full_composite_aggressive' || strategy === 'full_composite_turbo')
      ? generateRebalanceReport(portfolio, sells, rankings, priceHistory, currentPrices, {
        weightsBeforeAdaptive,
        weightsAfterAdaptive: weightsForRank
      })
      : null;

    const allRankingsEntry = topPicks.map(p => ({
      ticker: p.ticker,
      compositeScore: p.compositeScore,
      fundamentalScore: p.fundamentalScore,
      momentumScore: p.momentumScore,
      valuationScore: p.valuationScore,
      valueScore: p.valueScore,
      dcfScore: p.dcfScore
    }));

    // Take NAV snapshot first to get live prices
    portfolio = await takeNavSnapshot(portfolio);

    const livePortfolioValue = portfolio.navHistory.length > 0
      ? portfolio.navHistory[portfolio.navHistory.length - 1].portfolioValue
      : portfolio.cash + remainingHoldings.reduce((sum, h) => {
          return sum + h.shares * (currentPrices[h.ticker] || h.entryPrice);
        }, 0);

    // Log rebalance
    const rebalanceEntry = {
      date: today,
      regime: regimeMetaPaper.regime,
      adjustedTopN: adjustedTopNPaper,
      sells,
      buys,
      allRankings: allRankingsEntry,
      portfolioValue: parseFloat(livePortfolioValue.toFixed(2)),
      cashAfter: parseFloat(portfolio.cash.toFixed(2))
    };
    if (report) {
      rebalanceEntry.report = {
        periodReturn: report.periodReturn,
        spyReturn: report.spyReturn,
        alpha: report.alpha,
        soldPerformance: report.soldPerformance,
        missedOpportunities: report.missedOpportunities,
        factorPerformance: report.factorPerformance,
        weightChanges: report.weightChanges,
        narrative: report.narrative
      };
    }
    portfolio.rebalanceHistory.push(rebalanceEntry);

    savePortfolio(portfolio);

    const isCompositePaper = strategy === 'full_composite' || strategy === 'full_composite_aggressive' || strategy === 'full_composite_turbo';
    const activeWeightsPct = isCompositePaper
      ? Object.fromEntries(FACTOR_NAMES.map(f => [f, parseFloat(((weightsForRank[f] ?? 0) * 100).toFixed(1))]))
      : null;
    const weightAdaptation = isCompositePaper && portfolio.rebalanceHistory.length >= 6
      ? {
          before: Object.fromEntries(FACTOR_NAMES.map(f => [f, parseFloat(((weightsBeforeAdaptive[f] ?? 0) * 100).toFixed(1))])),
          after: Object.fromEntries(FACTOR_NAMES.map(f => [f, parseFloat(((weightsForRank[f] ?? 0) * 100).toFixed(1))])),
          periodsAnalyzed: portfolio.rebalanceHistory.length
        }
      : null;

    res.json({
      success: true,
      rebalance: {
        date: today,
        pointInTime: needsFundamentals ? pitPaperMeta.pointInTime : null,
        pitDetail: needsFundamentals ? pitPaperMeta.pitDetail : null,
        regime: regimeMetaPaper.regime,
        adjustedTopN: adjustedTopNPaper,
        adaptiveMode: adaptiveModeCfg,
        positionSizing: positionSizingPaper,
        sells,
        buys,
        rankings: topPicks.map(p => ({
          ticker: p.ticker,
          compositeScore: p.compositeScore,
          fundamentalScore: p.fundamentalScore,
          momentumScore: p.momentumScore
        })),
        holdingsAfter: remainingHoldings.length,
        cashAfter: parseFloat(portfolio.cash.toFixed(2)),
        activeWeights: activeWeightsPct,
        weightAdaptation,
        report: report ? {
          periodReturn: report.periodReturn,
          spyReturn: report.spyReturn,
          alpha: report.alpha,
          narrative: report.narrative,
          weightChanges: report.weightChanges
        } : null
      }
    });
  } catch (e) {
    console.error('Paper trade rebalance error:', e);
    res.status(500).json({ success: false, error: e.message });
  } finally {
    clearBacktestRuntimeCaches();
  }
});

// =====================================================================
// PAPER TRADE — History
// =====================================================================

app.get('/api/paper-trade/history', (req, res) => {
  const portfolio = loadPortfolio();
  if (!portfolio) return res.json({ success: true, history: null });

  res.json({
    success: true,
    history: {
      navHistory: portfolio.navHistory,
      rebalanceHistory: portfolio.rebalanceHistory,
      createdAt: portfolio.createdAt,
      config: portfolio.config
    }
  });
});

/**
 * Single rebalance log entry by calendar date (YYYY-MM-DD).
 * Duplicate dates (rare): default returns the last rebalance on that day; use occurrence=0,1,... (chronological among matches).
 */
app.get('/api/paper-trade/rebalance-entry', (req, res) => {
  const date = req.query.date;
  if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    return res.status(400).json({ success: false, error: 'Missing or invalid date (use YYYY-MM-DD)' });
  }
  const portfolio = loadPortfolio();
  if (!portfolio) {
    return res.status(404).json({ success: false, error: 'No paper portfolio' });
  }
  const hist = portfolio.rebalanceHistory || [];
  const indices = [];
  for (let i = 0; i < hist.length; i++) {
    if (hist[i].date === date.trim()) indices.push(i);
  }
  if (indices.length === 0) {
    return res.status(404).json({ success: false, error: 'No rebalance found for that date' });
  }

  const occRaw = req.query.occurrence;
  let occurrenceIdx;
  if (occRaw != null && occRaw !== '') {
    const occ = parseInt(occRaw, 10);
    if (!Number.isFinite(occ) || occ < 0 || occ >= indices.length) {
      return res.status(400).json({
        success: false,
        error: `occurrence must be 0..${indices.length - 1} (${indices.length} rebalance(s) on that date)`
      });
    }
    occurrenceIdx = occ;
  } else {
    occurrenceIdx = indices.length - 1;
  }

  const chosenArrayIndex = indices[occurrenceIdx];
  const rebalance = hist[chosenArrayIndex];

  res.json({
    success: true,
    rebalance,
    occurrence: occurrenceIdx,
    matchCount: indices.length,
    date: date.trim()
  });
});

// =====================================================================

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});


const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Kill the existing process or use a different port.`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});
