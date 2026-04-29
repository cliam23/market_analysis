import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import yf from 'yahoo-finance2';
import path from 'path';
import { spawn } from 'child_process';
import readline from 'readline';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import cron from 'node-cron';
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
import {
  QLearningTradingAgent,
  encodeState,
  encodeAction,
  decodeAction,
  regimeStringToBucket,
  computeConvergenceMetrics,
  detectOverPruning,
  TOTAL_ACTIONS,
  TOTAL_STATES
} from './q-learning-agent.js';
import { DQNAgent, computeRlReward as computeDqnReward } from './dqn-agent.js';
import { runAutoTrader, getAutoPortfolio, openShortOptionLeg, manageOptionLegsOnce } from './options-auto-trader.js';
import {
  getOptionsChain,
  getIvRank,
  submitPaperOrder,
  buildOsiSymbol,
  USE_MOCK as OPTIONS_USE_MOCK
} from './options-service.js';
import { loadWheelPortfolio, saveWheelPortfolio, selectWheelTargets, getWheelSummary, WHEEL_CONFIG } from './wheel-portfolio-service.js';

import { REPO_ROOT, dataPath, OPTIONS_PORTFOLIO_PATH, RL_AGENT_JSON_PATH, RL_AGENT_TOP50_PATH, RL_AGENT_TOP150_PATH, DQN_AGENT_JSON_PATH, DQN_AGENT_BEST_JSON_PATH, ML_PREDICT_SCRIPT, ML_WORKER_SCRIPT, PAPER_PORTFOLIO_PATH, PAPER_PORTFOLIO_TOP50_PATH, PAPER_PORTFOLIO_TOP150_PATH, CONGRESS_SIGNAL_PATH } from './server/config/paths.js';
import { readFile as fsReadFile, writeFile as fsWriteFile } from 'fs/promises';
import {
  YAHOO_QUOTE_SUMMARY_MODULE_OPTS,
  MOMENTUM_CACHE,
  NETWORK_INPUT_CACHE,
  COMPS_CACHE,
  QUOTE_CACHE,
  BACKTEST_CACHE,
  CACHE_TTL,
  COMPS_CACHE_TTL,
  QUOTE_CACHE_TTL,
  BACKTEST_CACHE_TTL,
  BACKTEST_CACHE_VERSION,
  FILING_LAG_DAYS,
  STALENESS_PENALTY_DAYS,
  TURNOVER_SCORE_IMPROVEMENT_THRESHOLD,
  MIN_HOLD_DAYS_BEFORE_SELL,
  HOLDINGS_OVERFLOW_SLOTS,
  SCORE_FLOOR,
  REGIME_MAX_POSITIONS,
  REBUY_COOLDOWN_DAYS,
  RE_ENTRY_MIN_WAIT_DAYS,
  RE_ENTRY_MIN_DAYS_TO_NEXT_REBALANCE,
  MAX_POSITION_WEIGHT_BACKTEST,
  TRAILING_STOP_MIN_PEAK_GAIN,
  TRAILING_STOP_FLOOR,
  TRAILING_STOP_MIN_HOLD_DAYS,
  YAHOO_DISK_CACHE_DIR,
  QUOTE_BATCH_CHUNK,
  YAHOO_CHART_CONCURRENCY,
  FUNDAMENTALS_FETCH_CONCURRENCY,
  YAHOO_CHART_DELAY_MS
} from './server/config/constants.js';
import {
  DEFAULT_COMPOSITE_WEIGHTS,
  AGGRESSIVE_COMPOSITE_WEIGHTS,
  TURBO_COMPOSITE_WEIGHTS,
  FACTOR_NAMES,
  FACTOR_LABELS,
  MAX_OPTIMIZATION_ROUNDS,
  MAX_WEIGHT_DELTA_PER_ROUND,
  MIN_SHARPE_IMPROVEMENT,
  WEIGHT_BOUNDS,
  EQUAL_FIXED_COMPOSITE_WEIGHTS
} from './server/config/factors.js';
import { UNIVERSES, UNIVERSE_TICKERS, UNIVERSE_BENCHMARK_LABELS } from './server/config/universes.js';
import { spearmanCorrelation, pearsonCorrelation } from './server/utils/math.js';
import { daysBetween, subtractMonths, isoAddDays } from './server/utils/dates.js';
import { yfNum, yahooApiSymbol } from './server/data/yahoo-parse.js';
import {
  readQuoteDiskCache,
  writeQuoteDiskCache,
  writeChartDiskCache,
  readChartDiskCacheStale,
  filterChartRowsToRange
} from './server/data/yahoo-disk-cache.js';
import { createEarningsFetchers } from './server/data/earnings-fetch.js';
import { withYahooRetry, isYahooRateLimitError } from './server/utils/yahoo-retry.js';
import { evaluateHedgeNeed, hedgePremiumForPeriod } from './server/backtest/hedge.js';
import {
  rawAvgEarningsSurpriseRatio,
  rawEpsRevisionDelta,
  rawRevenueAcceleration,
  hasUsableEarningsRaw
} from './server/scoring/earnings-signals.js';
import { validateDailyChartRows, validationStrictEnabled } from './server/data/bar-validation.js';
import {
  readGoldBarsForRange,
  goldLayerReadEnabled,
  writeGoldBars,
  goldLayerWriteEnabled
} from './server/data/gold-bars-store.js';
import {
  resetBtChartFetchStats,
  bumpChartSource,
  pushValidationSlice,
  getDataQualitySnapshot
} from './server/data/bt-fetch-stats.js';
import {
  readLocalUiSnapshot,
  writeLocalUiSnapshot,
  isSnapshotFresh,
  localUiSnapshotsReadEnabled,
  localUiSnapshotWriteEnabled
} from './server/data/local-ui-snapshots.js';

/** In-memory TTL cache for expensive diagnostics / backtest responses (not paper trade / RL / options). */
const API_RESPONSE_CACHE = new Map();
const API_CACHE_TTL_5M = 5 * 60 * 1000;
const API_CACHE_TTL_10M = 10 * 60 * 1000;

function apiCacheUrlKey(req) {
  try {
    const host = req.get?.('host') || 'localhost';
    const proto = req.protocol || 'http';
    const u = new URL(req.originalUrl || '/', `${proto}://${host}`);
    u.searchParams.delete('_t');
    return `${u.pathname}${u.search}`;
  } catch {
    return String(req.originalUrl || '').replace(/([?&])_t=[^&]*/g, '').replace(/\?&/, '?');
  }
}

function apiCacheBodyDigest(body) {
  return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex').slice(0, 40);
}

function getApiResponseCache(key, ttlMs) {
  const entry = API_RESPONSE_CACHE.get(key);
  if (entry && Date.now() - entry.ts < ttlMs) return entry.data;
  API_RESPONSE_CACHE.delete(key);
  return null;
}

function setApiResponseCache(key, data) {
  API_RESPONSE_CACHE.set(key, { data, ts: Date.now() });
}

/** Skip read-through when `?_t=` is present; fresh run still writes cache. */
function skipApiResponseCacheRead(req) {
  return req.query && req.query._t !== undefined && String(req.query._t) !== '';
}

function normalizeOptionsPortfolio(obj) {
  const o = obj && typeof obj === 'object' ? obj : {};
  return {
    positions: Array.isArray(o.positions) ? o.positions : [],
    closedPositions: Array.isArray(o.closedPositions) ? o.closedPositions : [],
    history: Array.isArray(o.history) ? o.history : [],
    cashReserved: Number(o.cashReserved) || 0,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString()
  };
}

function emptyOptionsPortfolio() {
  return {
    positions: [],
    closedPositions: [],
    history: [],
    cashReserved: 0,
    createdAt: new Date().toISOString()
  };
}

function loadOptionsPortfolio() {
  try {
    if (!existsSync(OPTIONS_PORTFOLIO_PATH)) return null;
    const raw = JSON.parse(readFileSync(OPTIONS_PORTFOLIO_PATH, 'utf8'));
    return normalizeOptionsPortfolio(raw);
  } catch {
    return null;
  }
}

function saveOptionsPortfolio(portfolio) {
  writeFileSync(OPTIONS_PORTFOLIO_PATH, JSON.stringify(portfolio, null, 2), 'utf8');
}

/** Which RL agent to load for eval/paper/backtest: `dqn` | `qlearning` (env `RL_AGENT_TYPE`, default `qlearning`). */
const RL_AGENT_TYPE = process.env.RL_AGENT_TYPE || 'qlearning';

/**
 * When unset/false, GET /api/backtest default and paper trade skip trained policy (rules-only).
 * Explicit `rlAgent=true` on backtest still uses the agent. Training endpoints ignore this.
 * Set `RL_ENABLED=true` to opt back in without code changes.
 */
function rlEvalEnvEnabled() {
  return process.env.RL_ENABLED === 'true' || process.env.RL_ENABLED === '1';
}

function normalizeRlAgentType(t) {
  const s = String(t ?? '').toLowerCase().trim();
  if (s === 'qlearning' || s === 'q-learning' || s === 'q' || s === 'tabular') return 'qlearning';
  return 'dqn';
}

function rlAgentTypeEffective() {
  return normalizeRlAgentType(RL_AGENT_TYPE);
}

function isDqnAgentInstance(agent) {
  return agent instanceof DQNAgent;
}

/** True when a loaded agent can produce RL decisions (96-action DQN / Q-table). */
function trainedRlAgentReadyForInference(agent = TRAINED_RL_AGENT) {
  if (!agent) return false;
  try {
    const na = agent.nActions;
    if (na !== TOTAL_ACTIONS) {
      console.warn(`[RL] Agent action space mismatch: nActions=${na}, expected ${TOTAL_ACTIONS}`);
      return false;
    }
    const q0 = agent.getQ(0, 0);
    if (!Number.isFinite(q0)) return false;
    const sel = agent.selectAction(0, true, { randomAction: false });
    if (sel == null || typeof sel.actionIdx !== 'number') return false;
    if (sel.actionIdx < 0 || sel.actionIdx >= TOTAL_ACTIONS) return false;
    return true;
  } catch (e) {
    console.warn('[RL] Agent inference check failed:', e.message);
    return false;
  }
}

/** Policy size for cache / stats: flat Q length or DQN state×action product. */
function rlAgentPolicyParamSize(agent) {
  if (!agent) return 0;
  if (agent.Q && typeof agent.Q.length === 'number') return agent.Q.length;
  return TOTAL_STATES * TOTAL_ACTIONS;
}

function loadRlAgentFromDisk(agentTypeOverride, universeId = null) {
  const kind = normalizeRlAgentType(agentTypeOverride ?? RL_AGENT_TYPE);
  if (kind === 'dqn') {
    try {
      if (!existsSync(DQN_AGENT_JSON_PATH)) return new DQNAgent();
      const raw = JSON.parse(readFileSync(DQN_AGENT_JSON_PATH, 'utf8'));
      if (!raw || raw.kind !== 'dqn' || !Array.isArray(raw.weightsOnline)) return new DQNAgent();
      return DQNAgent.deserialize(raw);
    } catch {
      return new DQNAgent();
    }
  }
  const fp = universeId ? getRlAgentPathForUniverse(universeId) : RL_AGENT_JSON_PATH;
  try {
    if (!existsSync(fp)) return new QLearningTradingAgent();
    const raw = JSON.parse(readFileSync(fp, 'utf8'));
    if (!raw || raw.version == null || !Array.isArray(raw.Q)) return new QLearningTradingAgent();
    return QLearningTradingAgent.deserialize(raw);
  } catch {
    return new QLearningTradingAgent();
  }
}

/** In-memory agent for eval / paper (null if no valid `rl-agent.json`). Refreshed on save and server start. */
let TRAINED_RL_AGENT = null;

/** Tabular Q-learning agents for sp500_top50 / sp500_top150 (dual files). */
const RL_AGENTS_BY_UNIVERSE = Object.create(null);

function getRlAgentPathForUniverse(universeId) {
  const u = String(universeId || '').trim();
  if (u === 'sp500_top150') return RL_AGENT_TOP150_PATH;
  if (u === 'sp500_top50') return RL_AGENT_TOP50_PATH;
  return RL_AGENT_JSON_PATH;
}

function loadQlAgentFromFileAbs(fp) {
  if (!existsSync(fp)) return null;
  try {
    const raw = JSON.parse(readFileSync(fp, 'utf8'));
    if (!raw || raw.version == null || !Array.isArray(raw.Q)) return null;
    const agent = QLearningTradingAgent.deserialize(raw);
    return trainedRlAgentReadyForInference(agent) ? agent : null;
  } catch {
    return null;
  }
}

function refreshQlAgentsFromDisk() {
  RL_AGENTS_BY_UNIVERSE['sp500_top50'] = loadQlAgentFromFileAbs(RL_AGENT_TOP50_PATH);
  RL_AGENTS_BY_UNIVERSE['sp500_top150'] = loadQlAgentFromFileAbs(RL_AGENT_TOP150_PATH);
}

/** Q-learning: per-universe agent for top50/top150; legacy rl-agent.json for other universes. DQN: global TRAINED_RL_AGENT. */
function getQlAgentForUniverse(universeId) {
  if (rlAgentTypeEffective() === 'dqn') return TRAINED_RL_AGENT;
  const u = String(universeId || '').trim();
  if (u === 'sp500_top50' || u === 'sp500_top150') return RL_AGENTS_BY_UNIVERSE[u] ?? null;
  return TRAINED_RL_AGENT;
}

function countRlStatesVisited(agent) {
  if (!agent) return 0;
  if (Number.isFinite(agent.statesVisited)) return agent.statesVisited;
  if (!agent.visitCounts?.length) return 0;
  let n = 0;
  for (let i = 0; i < agent.visitCounts.length; i++) {
    if (agent.visitCounts[i] > 0) n++;
  }
  return n;
}

function refreshTrainedRlAgentFromDisk(options = {}) {
  const logLoad = options.logLoad !== false;
  const kind = rlAgentTypeEffective();
  try {
    if (kind === 'dqn') {
      if (!existsSync(DQN_AGENT_JSON_PATH)) {
        TRAINED_RL_AGENT = null;
        return;
      }
      const raw = JSON.parse(readFileSync(DQN_AGENT_JSON_PATH, 'utf8'));
      if (!raw || raw.kind !== 'dqn' || !Array.isArray(raw.weightsOnline)) {
        TRAINED_RL_AGENT = null;
        return;
      }
      TRAINED_RL_AGENT = DQNAgent.deserialize(raw);
      if (!trainedRlAgentReadyForInference(TRAINED_RL_AGENT)) {
        console.warn('[RL] DQN deserialized but failed validation — treating as no agent (rules-based fallback).');
        TRAINED_RL_AGENT = null;
        return;
      }
      if (logLoad) {
        console.log(
          `[RL] Loaded DQN: h=${TRAINED_RL_AGENT.hiddenSize}, ${TRAINED_RL_AGENT.totalUpdates} updates, ${countRlStatesVisited(TRAINED_RL_AGENT)} states visited (replay trainSteps=${TRAINED_RL_AGENT.trainSteps ?? 0})`,
        );
      }
      return;
    }
    if (!existsSync(RL_AGENT_JSON_PATH)) {
      TRAINED_RL_AGENT = null;
    } else {
      const raw = JSON.parse(readFileSync(RL_AGENT_JSON_PATH, 'utf8'));
      if (!raw || raw.version == null || !Array.isArray(raw.Q)) {
        TRAINED_RL_AGENT = null;
      } else {
        TRAINED_RL_AGENT = QLearningTradingAgent.deserialize(raw);
        if (!trainedRlAgentReadyForInference(TRAINED_RL_AGENT)) {
          console.warn('[RL] Q-learning agent failed validation — treating as no agent.');
          TRAINED_RL_AGENT = null;
        } else if (logLoad) {
          console.log(
            `[RL] Loaded legacy Q-learning agent (rl-agent.json): ${TRAINED_RL_AGENT.totalUpdates} Q-updates, ${countRlStatesVisited(TRAINED_RL_AGENT)} states visited`,
          );
        }
      }
    }
    refreshQlAgentsFromDisk();
    if (logLoad) {
      for (const uid of ['sp500_top50', 'sp500_top150']) {
        const a = RL_AGENTS_BY_UNIVERSE[uid];
        if (a) {
          console.log(
            `[RL] Loaded Q-learning agent for ${uid}: ${a.totalUpdates} Q-updates, ${countRlStatesVisited(a)} states visited`,
          );
        }
      }
    }
    return;
  } catch (e) {
    console.warn('[RL] Failed to load trained agent:', e.message);
    TRAINED_RL_AGENT = null;
  }
}

function writeRlAgentFileOnly(agent, universeId = null) {
  if (isDqnAgentInstance(agent)) {
    writeFileSync(DQN_AGENT_JSON_PATH, JSON.stringify(agent.serialize(), null, 2), 'utf8');
    return;
  }
  const fp = universeId ? getRlAgentPathForUniverse(universeId) : RL_AGENT_JSON_PATH;
  writeFileSync(fp, JSON.stringify(agent.serialize(), null, 2), 'utf8');
}

/** Persist agent; updates TRAINED_RL_AGENT and/or RL_AGENTS_BY_UNIVERSE. Pass universeId for dual Q-learning files. */
function saveRlAgentToDisk(agent, universeId = null) {
  writeRlAgentFileOnly(agent, universeId);
  if (isDqnAgentInstance(agent)) {
    TRAINED_RL_AGENT = agent;
    return;
  }
  const uid = String(universeId || '').trim();
  if (uid === 'sp500_top50' || uid === 'sp500_top150') {
    RL_AGENTS_BY_UNIVERSE[uid] = agent;
  } else {
    TRAINED_RL_AGENT = agent;
  }
}

refreshTrainedRlAgentFromDisk({ logLoad: true });
if (
  (TRAINED_RL_AGENT != null || RL_AGENTS_BY_UNIVERSE['sp500_top50'] || RL_AGENTS_BY_UNIVERSE['sp500_top150']) &&
  !rlEvalEnvEnabled()
) {
  console.log(
    '[RL] Trained agent on disk, but RL_ENABLED is not true — backtest default and paper trade use rules-only. Export RL_ENABLED=true to evaluate the policy.',
  );
}

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

// Ensure data directory exists on startup (Railway persistent volume)
if (process.env.DATA_DIR) {
  try {
    mkdirSync(process.env.DATA_DIR, { recursive: true });
    console.log(`[startup] Data directory: ${process.env.DATA_DIR}`);
  } catch (e) {
    console.warn(`[startup] Could not create DATA_DIR: ${e.message || String(e)}`);
  }
}

app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      'http://localhost:5173',
      'http://localhost:4173',
      process.env.FRONTEND_URL
    ].filter(Boolean);

    if (!origin) return callback(null, true);
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    if (allowed.includes(origin)) return callback(null, true);
    if (process.env.NODE_ENV === 'production') {
      return callback(new Error(`CORS blocked: ${origin}`));
    }
    callback(null, true);
  },
  credentials: true
}));
app.use(express.json());

const yahooFinance = new yf({ 
  suppressNotices: ['yahooSurvey'] 
});

async function fetchWithTimeout(fn, timeoutMs = 8000) {
  return Promise.race([
    fn(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Yahoo fetch timeout')), timeoutMs)
    )
  ]);
}

/** Yahoo quoteSummary/chart/quote with timeout + 429 exponential backoff. */
async function fetchYahooOp(fn, timeoutMs = 8000) {
  return withYahooRetry(() => fetchWithTimeout(fn, timeoutMs), { maxRetries: 4 });
}

const { fetchEarningsHistory, fetchAllEarnings } = createEarningsFetchers({ yahooFinance, fetchWithTimeout: fetchYahooOp });

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

function pickCompositeScoreForRebalanceFloor(p) {
  const c = p.compositeScore;
  if (c != null && Number.isFinite(c)) return c;
  const b = p.combinedScore;
  if (b != null && Number.isFinite(b)) return b;
  return 0;
}

/** After ranker + sector caps: keep only names at/above floor (still in rank order). */
function filterCompositePicksByRebalanceScoreFloor(picks) {
  return picks.filter((p) => pickCompositeScoreForRebalanceFloor(p) >= SCORE_FLOOR);
}

/** Days from rebalance date to next earnings (null if unknown). `fundamentals` is ticker-keyed live map. */
function daysUntilEarnings(ticker, rebalanceDate, fundamentals) {
  const f = fundamentals[ticker] ?? fundamentals[String(ticker || '').toUpperCase()];
  if (!f) return null;
  const ed = f.earningsDate ?? f.earningsTimestamp ?? null;
  if (ed == null) return null;
  const earningsMs = typeof ed === 'number' ? (ed > 1e12 ? ed : ed * 1000) : new Date(ed).getTime();
  if (!Number.isFinite(earningsMs)) return null;
  const rebalanceMs = new Date(rebalanceDate).getTime();
  if (!Number.isFinite(rebalanceMs)) return null;
  return (earningsMs - rebalanceMs) / (1000 * 60 * 60 * 24);
}

function turnoverDebugEnabled() {
  const v = process.env.TURNOVER_DEBUG;
  return v === '1' || String(v || '').toLowerCase() === 'true';
}

/** Per-ticker PIT fundamental cache HIT/MISS (very noisy during backtests). Set PIT_CACHE_LOG=1 to enable. */
function pitCacheLogEnabled() {
  const v = process.env.PIT_CACHE_LOG;
  return v === '1' || String(v || '').toLowerCase() === 'true';
}

/** Per-episode lines during POST /api/rl/train. Set RL_TRAIN_LOG=1 to enable. */
function rlTrainProgressLogEnabled() {
  const v = process.env.RL_TRAIN_LOG;
  return v === '1' || String(v || '').toLowerCase() === 'true';
}

/** Occasional quote/metrics fetch failures (often expected for some tickers). Set FETCH_DEBUG=1 to log. */
function fetchDebugLogEnabled() {
  const v = process.env.FETCH_DEBUG;
  return v === '1' || String(v || '').toLowerCase() === 'true';
}

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
  const cf =
    extra.correlationFilter === true || extra.correlationFilter === 'true' || extra.correlationFilter === 1 ? '1' : '0';
  const mxc =
    extra.maxCorrelated != null && Number.isFinite(extra.maxCorrelated)
      ? String(Math.max(1, Math.floor(extra.maxCorrelated)))
      : '3';
  const clb =
    extra.correlationLookbackDays != null && Number.isFinite(extra.correlationLookbackDays)
      ? String(Math.max(20, Math.floor(extra.correlationLookbackDays)))
      : 'd60';
  const hd =
    extra.hedging === true || extra.hedging === 'true' || extra.hedging === 1 ? '1' : '0';
  const rlev = rlEvalEnvEnabled() ? '1' : '0';
  return `ic${icp}-rdg${ridge}-${rl}-mla${mla}-mlc${mlc}-mlw${mlw}-am${am}-ps${ps}-tr${tr}-pit${pit}-re${re}-po${po}-skml${skml}-cf${cf}-mxc${mxc}-clb${clb}-hd${hd}-rlev${rlev}`;
}

/**
 * Composite pillar blend: redistributes weight from pillars with unavailable scores (null / non-finite)
 * onto remaining pillars proportionally. Skips config weights that are 0.
 */
function compositeWeightedWithRedistribution(weights, pillarScores) {
  const keys = ['fundamental', 'dcf', 'valuation', 'momentum', 'value', 'earningsMomentum'];
  let redistribute = 0;
  const parts = [];
  for (const k of keys) {
    const wt = Number(weights[k]) || 0;
    if (wt <= 1e-12) continue;
    const s = pillarScores[k];
    if (s == null || !Number.isFinite(s)) {
      redistribute += wt;
    } else {
      parts.push({ w: wt, s });
    }
  }
  if (parts.length === 0) return NaN;
  const sumW = parts.reduce((acc, p) => acc + p.w, 0);
  if (sumW <= 1e-12) return NaN;
  let total = 0;
  for (const p of parts) {
    const adjW = p.w + redistribute * (p.w / sumW);
    total += adjW * p.s;
  }
  return total;
}

/** Cross-sectional percentile → 0–100; missing raw values → 50. */
function percentileScoresFromRaw(tickerOrder, rawByTicker) {
  const scores = new Map();
  const valid = tickerOrder.filter((t) => {
    const v = rawByTicker.get(t);
    return v != null && Number.isFinite(v);
  });
  if (valid.length === 0) {
    for (const t of tickerOrder) scores.set(t, 50);
    return scores;
  }
  if (valid.length === 1) {
    for (const t of tickerOrder) scores.set(t, valid.includes(t) ? 50 : 50);
    return scores;
  }
  const sorted = [...valid].sort((a, b) => rawByTicker.get(a) - rawByTicker.get(b));
  const rankMid = new Map();
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    const baseVal = rawByTicker.get(sorted[i]);
    while (j < sorted.length && rawByTicker.get(sorted[j]) === baseVal) j++;
    const mid = (i + j - 1) / 2;
    for (let k = i; k < j; k++) rankMid.set(sorted[k], mid);
    i = j;
  }
  const denom = sorted.length - 1;
  for (const t of tickerOrder) {
    if (!rankMid.has(t)) scores.set(t, 50);
    else scores.set(t, (rankMid.get(t) / denom) * 100);
  }
  return scores;
}

/**
 * Per-ticker 0–100 earnings momentum pillar (40% surprise, 40% revision, 20% revenue accel), cross-sectionally ranked.
 * Trailing EPS actuals are backward-looking; epsTrend uses live Yahoo estimates (PIT approximation, same spirit as fundamentals snapshot).
 */
function buildEarningsMomentumScoreByTicker(tickers, earningsMap) {
  const em = earningsMap instanceof Map ? earningsMap : new Map();
  const surpriseRaw = new Map();
  const revisionRaw = new Map();
  const revenueRaw = new Map();
  for (const t of tickers) {
    const U = String(t).toUpperCase();
    const ed = em.get(U) ?? em.get(t) ?? null;
    if (!hasUsableEarningsRaw(ed)) {
      surpriseRaw.set(t, null);
      revisionRaw.set(t, null);
      revenueRaw.set(t, null);
    } else {
      surpriseRaw.set(t, rawAvgEarningsSurpriseRatio(ed));
      revisionRaw.set(t, rawEpsRevisionDelta(ed));
      revenueRaw.set(t, rawRevenueAcceleration(ed));
    }
  }
  const sP = percentileScoresFromRaw(tickers, surpriseRaw);
  const rP = percentileScoresFromRaw(tickers, revisionRaw);
  const vP = percentileScoresFromRaw(tickers, revenueRaw);
  const out = new Map();
  for (const t of tickers) {
    const U = String(t).toUpperCase();
    const ed = em.get(U) ?? em.get(t) ?? null;
    if (!hasUsableEarningsRaw(ed)) {
      out.set(t, null);
      continue;
    }
    const a = sP.get(t) ?? 50;
    const b = rP.get(t) ?? 50;
    const c = vP.get(t) ?? 50;
    out.set(t, Math.max(0, Math.min(100, a * 0.4 + b * 0.4 + c * 0.2)));
  }
  return out;
}

/**
 * Single-name pillar score from a full-universe earnings map (rebuilds cross-section each call — prefer buildEarningsMomentumScoreByTicker in hot paths).
 * @param {object|null} earningsData — parsed earnings for one ticker ({ ticker, quarters, epsTrend })
 * @param {Map<string, object|null>} allEarningsData — ticker → earnings for the ranking universe
 */
function computeEarningsMomentumScore(earningsData, allEarningsData) {
  if (!(allEarningsData instanceof Map) || allEarningsData.size === 0) return null;
  const t0 = String(earningsData?.ticker || '').toUpperCase();
  if (!t0) return null;
  if (!hasUsableEarningsRaw(earningsData)) return null;
  const tickers = [...allEarningsData.keys()].map((k) => String(k).toUpperCase());
  const m = buildEarningsMomentumScoreByTicker(tickers, allEarningsData);
  return m.get(t0) ?? m.get(earningsData?.ticker) ?? null;
}

/** Batch Yahoo quote — one round-trip per chunk. */
async function fetchYahooQuotesBatch(symbols) {
  const out = new Map();
  const uniq = [...new Set(symbols.map((s) => String(s).toUpperCase()).filter(Boolean))];
  /** Yahoo API symbol -> universe keys that should receive the same row */
  const byApi = new Map();
  for (const u of uniq) {
    const api = String(yahooApiSymbol(u)).toUpperCase();
    if (!byApi.has(api)) byApi.set(api, []);
    byApi.get(api).push(u);
  }
  const apiList = [...byApi.keys()];
  for (let i = 0; i < apiList.length; i += QUOTE_BATCH_CHUNK) {
    const chunk = apiList.slice(i, i + QUOTE_BATCH_CHUNK);
    try {
      const rows = await fetchYahooOp(() => yahooFinance.quote(chunk), 8000);
      const arr = Array.isArray(rows) ? rows : (rows ? [rows] : []);
      for (const row of arr) {
        const sym = String(row?.symbol || '').toUpperCase();
        const keys = byApi.get(sym) || [sym];
        for (const k of keys) out.set(k, row);
      }
    } catch (e) {
      console.warn(`Yahoo batch quote failed (timeout/error) tickers=${chunk.join(',')}:`, e.message);
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
  const ch = yfNum(q.regularMarketChangePercent);
  if (ch != null && Number.isFinite(ch)) result.regularMarketChangePercent = ch;
  if (q.fullExchangeName || q.exchangeName) {
    result.exchangeName = q.fullExchangeName || q.exchangeName || result.exchangeName;
  }
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
    cwd: REPO_ROOT,
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
      cwd: REPO_ROOT,
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

  let data;
  try {
    data = await fetchYahooOp(
      () => yahooFinance.quoteSummary(yahooApiSymbol(ticker), { modules }, YAHOO_QUOTE_SUMMARY_MODULE_OPTS),
      8000
    );
  } catch (e) {
    console.warn(`[Yahoo] quoteSummary failed ${upper}:`, e.message);
    throw e;
  }

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
    regularMarketChangePercent:
      p.regularMarketChangePercent != null && Number.isFinite(Number(p.regularMarketChangePercent))
        ? Number(p.regularMarketChangePercent)
        : null,
    exchangeName: p.fullExchangeName || p.exchange || p.exchangeName || '',
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
  
  const data = await fetchYahooOp(
    () =>
      yahooFinance.chart(yahooApiSymbol(ticker), {
        period1,
        period2,
        interval: '1d'
      }),
    8000
  );

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
      regularMarketChangePercent: data.regularMarketChangePercent ?? null,
      exchangeName: data.exchangeName || '',
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
    if (isYahooRateLimitError(error)) {
      return res.status(429).json({
        success: false,
        error: 'Yahoo Finance rate limited. Please wait a moment and try again.',
        retryAfter: 30
      });
    }
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
    const data = await fetchYahooOp(
      () =>
        yahooFinance.quoteSummary(
          yahooApiSymbol(ticker),
          { modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'summaryProfile'] },
          YAHOO_QUOTE_SUMMARY_MODULE_OPTS
        ),
      8000
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
    if (fetchDebugLogEnabled()) {
      console.warn(`[fetch] metrics ${ticker}: ${err.message}`);
    }
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

    const etSrc = p.earningsTimestamp;
    let earningsTimestamp = null;
    if (etSrc != null) {
      const raw = typeof etSrc === 'object' && etSrc !== null && 'raw' in etSrc ? etSrc.raw : etSrc;
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        earningsTimestamp = raw > 1e12 ? raw : raw * 1000;
      } else if (typeof raw === 'string') {
        const t = Date.parse(raw);
        if (Number.isFinite(t)) earningsTimestamp = t;
      }
    }
    const earningsDate =
      earningsTimestamp != null && Number.isFinite(earningsTimestamp)
        ? new Date(earningsTimestamp).toISOString().slice(0, 10)
        : null;

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
      beta: sd.beta || 1,
      earningsDate,
      earningsTimestamp
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
    const result = await fetchYahooOp(
      () =>
        yahooFinance.quoteSummary(
          yahooApiSymbol(ticker),
          { modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'summaryProfile'] },
          YAHOO_QUOTE_SUMMARY_MODULE_OPTS
        ),
      8000
    );
    const fund = calculateFundamentalScore(result, upper);
    if (fund) {
      FUNDAMENTALS_CACHE.set(upper, { data: fund, timestamp: Date.now() });
    }
    return fund;
  } catch (e) {
    console.warn(`[Yahoo] fundamentals fetch failed ${upper}: ${e.message}`);
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

/** One line per ticker when PIT income filter is empty (expected for some names; fallback still runs). */
const _pitNoIncomeRowsWarned = new Set();

/** One line per ticker when quoteSummary fails during PIT prefetch. */
const _pitQuoteSummaryFailWarned = new Set();

/** Raw Yahoo quoteSummary per ticker for PIT (prefetch once per request; value `null` = fetch failed). */
const YAHOO_RAW_PIT_CACHE = new Map();

async function prefetchPitYahooQuoteSummary(ticker) {
  const upper = String(ticker).toUpperCase();
  if (YAHOO_RAW_PIT_CACHE.has(upper)) return;
  const apiSym = yahooApiSymbol(ticker);
  try {
    const raw = await fetchYahooOp(
      () =>
        yahooFinance.quoteSummary(apiSym, { modules: YAHOO_QUOTE_SUMMARY_PIT_MODULES }, YAHOO_QUOTE_SUMMARY_MODULE_OPTS),
      8000
    );
    YAHOO_RAW_PIT_CACHE.set(upper, raw);
  } catch (e) {
    if (fetchDebugLogEnabled()) {
      console.warn(`[PIT] quoteSummary failed ${upper} (${apiSym}): ${e.message}`);
    } else if (!_pitQuoteSummaryFailWarned.has(upper)) {
      _pitQuoteSummaryFailWarned.add(upper);
      console.warn(`[PIT] quoteSummary failed ${upper}: ${e.message}`);
    }
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
    } else if (!_pitNoIncomeRowsWarned.has(upper)) {
      _pitNoIncomeRowsWarned.add(upper);
      console.warn(
        `[PIT] no income statement rows on or before knowledge cutoff for ${upper} (Yahoo PIT window); using fundamentals fallback.`
      );
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
    if (pitCacheLogEnabled()) {
      console.log(`[PIT] cache MISS ${upper} ${quarterKey || endIso} — building`);
    }
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
  } else if (pitCacheLogEnabled()) {
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

function spyRealizedVolAnnualized(spySeries, asOfDateStr) {
  if (!spySeries || !spySeries.length) return 0.2;
  const ix = bsearchLastBeforeOrEqual(spySeries, asOfDateStr);
  if (ix < 20) return 0.2;
  const rets = [];
  for (let j = ix - 19; j <= ix; j++) {
    if (j < 1) continue;
    const c0 = spySeries[j - 1].close;
    const c1 = spySeries[j].close;
    if (c0 > 0) rets.push(c1 / c0 - 1);
  }
  if (rets.length < 2) return 0.2;
  return standardDeviation(rets) * Math.sqrt(252);
}

function avgTopNAvgComposite(rankings, n = 15) {
  if (!rankings || !rankings.length) return 50;
  const sorted = [...rankings].sort(
    (a, b) => (b.compositeScore ?? b.combinedScore ?? 0) - (a.compositeScore ?? a.combinedScore ?? 0)
  );
  const slice = sorted.slice(0, Math.min(n, sorted.length));
  const sum = slice.reduce((s, r) => s + (r.compositeScore ?? r.combinedScore ?? 50), 0);
  return sum / slice.length;
}

async function runBacktestSimulation(universe, priceHistory, fundamentals, spyPrices, rebalanceDates, topN, capital, strategyClean, weights, getCashInflationMultiplier = null, universeId = null, simOptions = {}) {
  const amOpt =
    simOptions.adaptiveMode != null && simOptions.adaptiveMode !== ''
      ? String(simOptions.adaptiveMode).toLowerCase().trim()
      : '';
  const compositeFamBt =
    strategyClean === 'full_composite' ||
    strategyClean === 'full_composite_aggressive' ||
    strategyClean === 'full_composite_turbo';
  const rlModeRaw = simOptions.rlMode != null ? String(simOptions.rlMode).toLowerCase().trim() : 'off';
  const rlMode = rlModeRaw === 'train' || rlModeRaw === 'eval' ? rlModeRaw : 'off';
  /** Q-learning train episodes need a stable composite score distribution; eval/backtest keep requested adaptive mode. */
  const adaptiveMode =
    rlMode === 'train'
      ? 'fixed'
      : amOpt === 'adaptive' || amOpt === 'conservative'
        ? amOpt
        : 'fixed';
  if (rlMode === 'train' && simOptions && typeof simOptions === 'object') {
    simOptions.adaptiveMode = 'fixed';
  }
  const psRaw = simOptions.positionSizing || (strategyClean === 'full_composite' ? 'invVol' : 'equal');
  const positionSizing = ['equal', 'invVol', 'score', 'invVolBlend'].includes(psRaw) ? psRaw : 'invVol';
  const regimeEnabled = simOptions.regimeEnabled !== false;
  const pillarOverrideNorm =
    adaptiveMode === 'fixed' && simOptions.pillarOverride != null
      ? normalizePillarOverride(simOptions.pillarOverride)
      : null;
  /** When true, skip ML alpha / ML blend so composite ranks reflect pillar weights (factor diagnostics). */
  const skipMlRankingAdjustments = simOptions.skipMlRankingAdjustments === true;

  const correlationFilter =
    simOptions.correlationFilter === true ||
    simOptions.correlationFilter === 'true' ||
    simOptions.correlationFilter === 1 ||
    String(simOptions.correlationFilter || '').toLowerCase() === 'true';
  const maxCorrelatedPeers =
    simOptions.maxCorrelated != null && Number.isFinite(Number(simOptions.maxCorrelated))
      ? Math.max(1, Math.floor(Number(simOptions.maxCorrelated)))
      : 3;
  const correlationLookbackDays =
    simOptions.correlationLookbackDays != null && Number.isFinite(Number(simOptions.correlationLookbackDays))
      ? Math.max(20, Math.floor(Number(simOptions.correlationLookbackDays)))
      : 60;
  /** When true, composite train/eval skips `fetchAllEarnings` (avoids Yahoo 429 storm when earningsMomentum > 0). */
  const rlTrainSkipEarningsFetch =
    simOptions.rlTrainSkipEarningsFetch === true ||
    simOptions.rlTrainSkipEarningsFetch === 'true' ||
    simOptions.rlTrainSkipEarningsFetch === 1 ||
    String(simOptions.rlTrainSkipEarningsFetch || '').toLowerCase() === 'true';
  const rlRandomAgent = simOptions.rlRandomAgent === true;
  const rlAgentQuery =
    simOptions.rlAgent === true || simOptions.rlAgent === 'true' || simOptions.rlAgent === 1 || rlRandomAgent;
  const rlCompositeActive = rlAgentQuery && rlMode !== 'off' && compositeFamBt;
  let rlAgentInstance = simOptions.rlQLearningAgent ?? null;
  if (rlCompositeActive && !rlAgentInstance) {
    rlAgentInstance =
      rlMode === 'eval'
        ? rlAgentTypeEffective() === 'dqn'
          ? TRAINED_RL_AGENT ?? loadRlAgentFromDisk('dqn')
          : getQlAgentForUniverse(universeId) ?? loadRlAgentFromDisk(undefined, universeId)
        : rlAgentTypeEffective() === 'dqn'
          ? new DQNAgent()
          : new QLearningTradingAgent();
  }

  let initialPillarWeights = null;
  if (strategyClean === 'full_composite' || strategyClean === 'full_composite_aggressive' || strategyClean === 'full_composite_turbo') {
    const defaults = strategyClean === 'full_composite_aggressive' ? AGGRESSIVE_COMPOSITE_WEIGHTS
      : strategyClean === 'full_composite_turbo' ? TURBO_COMPOSITE_WEIGHTS
        : DEFAULT_COMPOSITE_WEIGHTS;
    weights = { ...defaults, ...(weights && typeof weights === 'object' ? weights : {}) };
    initialPillarWeights = { ...weights };
  }

  const needBacktestEarningsMap =
    compositeFamBt &&
    !rlTrainSkipEarningsFetch &&
    Math.max(
      Number(weights?.earningsMomentum) || 0,
      Number(pillarOverrideNorm?.earningsMomentum) || 0
    ) > 1e-9;
  const preloadedEarningsMap =
    simOptions.preloadedEarningsMap instanceof Map ? simOptions.preloadedEarningsMap : null;
  let simEarningsMap = null;
  if (needBacktestEarningsMap) {
    simEarningsMap = preloadedEarningsMap ?? (await fetchAllEarnings(universe));
  }

  let cash = capital;
  const hedgingEnabled =
    simOptions.hedging === true ||
    simOptions.hedging === 'true' ||
    simOptions.hedging === 1 ||
    String(simOptions.hedging || '').toLowerCase() === 'true';
  let activeHedge = null;
  let totalHedgesOpened = 0;
  let totalHedgeCost = 0;
  let totalHedgeGain = 0;

  const holdings = {};
  const tradeLog = [];
  const rebalanceLog = [];
  const holdingsSnapshots = [];
  const factorSnapshots = [];
  const regimeLog = [];
  const rlLog = [];
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
  /** Voluntary SELL and STOP exits — rebuy cooldown keyed by exitDate (exit day). */
  const recentSells = {};

  let prevRlStateIdx = null;
  let prevRlActionIdx = null;
  let lastRlPostPort = null;
  let lastRlPostBench = null;
  let rlLastPvForReturn = null;
  let rlPeakSinceRebal = null;
  let rlMaxDdSinceRebal = 0;
  let rlDailyReturns = [];

  for (let dayIdx = 0; dayIdx < allTradingDays.length; dayIdx++) {
    const date = allTradingDays[dayIdx];

    const dailyPx = {};
    for (const tk of Object.keys(priceHistory)) {
      dailyPx[tk] = getPrice(priceHistory[tk], date);
    }

    if (rlCompositeActive && rlAgentInstance) {
      let pvRl = cash;
      for (const [t, h] of Object.entries(holdings)) {
        const p = dailyPx[t];
        if (p) pvRl += h.shares * p;
      }
      if (rlLastPvForReturn != null && rlLastPvForReturn > 0) {
        rlDailyReturns.push(pvRl / rlLastPvForReturn - 1);
      }
      rlLastPvForReturn = pvRl;
      if (rlPeakSinceRebal != null) {
        rlPeakSinceRebal = Math.max(rlPeakSinceRebal, pvRl);
        const dd = rlPeakSinceRebal > 0 ? pvRl / rlPeakSinceRebal - 1 : 0;
        if (dd < rlMaxDdSinceRebal) rlMaxDdSinceRebal = dd;
      }
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
      const stopExits = checkStopLosses(holdings, priceHistory, date, fundamentalsLive, strategyClean, universeId);
      for (const exit of stopExits) {
        const holding = holdings[exit.ticker];
        if (!holding) continue;
        const proceeds = holding.shares * exit.exitPrice;
        cash += proceeds;
        const stopReturn = (exit.exitPrice - holding.entryPrice) / holding.entryPrice;
        tradeLog.push({
          date, type: 'STOP', ticker: exit.ticker,
          shares: holding.shares, price: exit.exitPrice, proceeds,
          holdingReturn: stopReturn,
          holdingDays: daysBetween(holding.entryDate, date)
        });
        recentStops[exit.ticker] = { exitDate: date, exitPrice: exit.exitPrice };
        recentSells[exit.ticker] = { exitDate: date, exitPrice: exit.exitPrice, exitReturn: stopReturn };
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

        const sellCooldown = recentSells[ticker];
        if (sellCooldown && daysBetween(sellCooldown.exitDate, date) < REBUY_COOLDOWN_DAYS) {
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
            delete recentSells[ticker];
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
      /** True when this rebalance is the last in the simulated window (terminal transition for RL). */
      const rlRebalanceIsLastInWindow = nextRebalanceIdx >= rebalanceDates.length;

      const cooldownMap = new Map(
        Object.keys(recentSells)
          .filter((t) => daysBetween(recentSells[t].exitDate, date) < REBUY_COOLDOWN_DAYS)
          .map((t) => [t, recentSells[t]])
      );
      if (
        cooldownMap.size > 0 ||
        process.env.BACKTEST_COOLDOWN_LOG === '1' ||
        String(process.env.BACKTEST_COOLDOWN_LOG || '').toLowerCase() === 'true'
      ) {
        console.log(`[Cooldown] ${date}: blocked tickers =`, [...cooldownMap.keys()]);
      }

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
      const regimeExposureBaseline = exposure;

      const isAggressiveStrategy = strategyClean === 'full_composite_aggressive' || strategyClean === 'full_composite_turbo';
      const regimeN = adjustedTopNForRegime(regimeMeta.regime, topN);
      let adjustedTopN = isAggressiveStrategy
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
        } else if (rebalanceLog.length >= 3) {
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

      /** Earnings map is built once per simulation (quarterly data; unchanged across rebalance dates in one run). */
      const earningsMapForRank =
        compositeFam && (weightsRankBt?.earningsMomentum ?? 0) > 1e-9 && !rlTrainSkipEarningsFetch
          ? simEarningsMap
          : null;

      let rankings;

      if (strategyClean === 'momentum') rankings = bt_rankMomentumOnly(universe, priceHistory, date);
      else if (strategyClean === 'momentum_value') rankings = bt_rankMomentumValue(universe, priceHistory, date);
      else if (strategyClean === 'quality_momentum') rankings = bt_rankQualityMomentumV2(universe, priceHistory, fundamentalsLive, date);
      else if (strategyClean === 'full_composite') {
        rankings = bt_rankFullCompositeV2(universe, priceHistory, fundamentalsLive, date, weightsRankBt, {
          earningsMap: earningsMapForRank
        });
      } else if (strategyClean === 'full_composite_aggressive') {
        rankings = bt_rankFullCompositeV2(universe, priceHistory, fundamentalsLive, date, weightsRankBt, {
          momQThreshold: 10, fundamentalFloor: 15, maxVol: 1.0, strategyLabel: 'full_composite_aggressive',
          blendMomentumWithQuality: { raw: 0.7, quality: 0.3 },
          earningsMap: earningsMapForRank
        });
      } else if (strategyClean === 'full_composite_turbo') {
        rankings = bt_rankFullCompositeV2(universe, priceHistory, fundamentalsLive, date, weightsRankBt, {
          momQThreshold: 0, fundamentalFloor: 0, maxVol: 1.2, strategyLabel: 'full_composite_turbo',
          skipConstraintPenalty: true,
          blendMomentumWithQuality: { raw: 0.55, quality: 0.20 },
          earningsMap: earningsMapForRank
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

      // ── Congress signal nudge (STOCK Act disclosures) ─────────────────────
      // Soft boost: max +3pts on compositeScore. Only applied when rebalance
      // date is ≤45 days old (current holdings). Historical runs are unaffected.
      const MAX_CONGRESS_BOOST = 3;
      const congressIsRecent = Math.abs(Date.now() - new Date(date).getTime()) < 45 * 24 * 60 * 60 * 1000;
      if (congressIsRecent) {
        for (const r of rankings) {
          const cs = getCongressScore(r.ticker);
          r.congressScore = cs.score;
          r.congressSentiment = cs.sentiment;
          if (cs.hasSignal) {
            const boost = parseFloat(((cs.score / 10) * MAX_CONGRESS_BOOST).toFixed(2));
            r.compositeScore = (r.compositeScore ?? 0) + boost;
            r.congressBoosted = boost;
            r.congressPoliticians = cs.politicians;
          }
        }
        // Re-sort after nudge
        rankings.sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0));
      }

      let portfolioValuePre = cash;
      for (const [ticker, holding] of Object.entries(holdings)) {
        const price = dailyPx[ticker];
        if (price) portfolioValuePre += holding.shares * price;
      }
      const benchPreRebal = universeBenchmarkValue(uniBench, priceHistory, date, dailyPx);
      const spyPxBench = getPrice(spyPrices, date);
      const benchPre =
        benchPreRebal != null
          ? benchPreRebal
          : spyPxBench > 0 && spyShares
            ? spyPxBench * spyShares
            : lastRlPostBench != null
              ? lastRlPostBench
              : capital;

      let rlRebalMeta = null;
      let rlLastReward = null;
      let rlSkipThisRebalance = false;

      let effectiveSizing = positionSizing;
      if (rlCompositeActive && rlAgentInstance) {
        const fcRaw = simOptions.forceConstantAction;
        const forceActionIdx =
          fcRaw !== undefined &&
          fcRaw !== null &&
          fcRaw !== '' &&
          Number.isFinite(Number(fcRaw))
            ? Math.max(0, Math.min(TOTAL_ACTIONS - 1, Math.floor(Number(fcRaw))))
            : null;

        const avgTop = avgTopNAvgComposite(rankings, 15);
        const breadthRatio =
          typeof regimeMeta.breadthRatio === 'number' && Number.isFinite(regimeMeta.breadthRatio)
            ? regimeMeta.breadthRatio
            : 0.5;
        const realizedVol = spyRealizedVolAnnualized(spyPrices, date);
        const recentAlpha =
          lastRlPostPort != null && lastRlPostPort > 0 && lastRlPostBench != null && lastRlPostBench > 0
            ? (portfolioValuePre / lastRlPostPort - 1) - (benchPre / lastRlPostBench - 1)
            : 0;
        const stateIdx = encodeState({
          regimeBucket: regimeStringToBucket(regimeMeta.regime),
          recentAlpha,
          breadthRatio,
          realizedVol,
          avgTopScore: avgTop
        });

        if (prevRlStateIdx != null) {
          const portRet = lastRlPostPort > 0 ? portfolioValuePre / lastRlPostPort - 1 : 0;
          const benchRet = lastRlPostBench > 0 ? benchPre / lastRlPostBench - 1 : 0;
          const volWindow =
            rlDailyReturns.length > 1 ? standardDeviation(rlDailyReturns) * Math.sqrt(252) : 0.15;
          rlLastReward = computeDqnReward(
            portRet,
            benchRet,
            volWindow,
            rlMaxDdSinceRebal,
            simOptions?.rlGamma ?? 3
          );
          if (rlMode === 'train' && prevRlActionIdx != null) {
            rlAgentInstance.update(prevRlStateIdx, prevRlActionIdx, rlLastReward, stateIdx, rlRebalanceIsLastInWindow);
          }
        }

        if (forceActionIdx !== null) {
          const actionIdxUse = forceActionIdx;
          const exploredUse = false;
          const trainForcedRandom = false;
          const sel = { actionIdx: forceActionIdx, explored: false, epsilon: 0, fallback: false };
          const decFinal = decodeAction(actionIdxUse);
          exposure = decFinal.exposure;
          adjustedTopN = Math.max(3, Math.min(decFinal.positionCount, rankings.length));
          effectiveSizing = decFinal.sizingMethod;
          prevRlStateIdx = stateIdx;
          prevRlActionIdx = actionIdxUse;
          rlSkipThisRebalance = (decFinal.rebalanceWait ?? 'standard') === 'skip';
          rlRebalMeta = {
            exposure: decFinal.exposure,
            positionCount: decFinal.positionCount,
            sizingMethod: decFinal.sizingMethod,
            rebalanceWait: decFinal.rebalanceWait,
            stateIdx,
            actionIdx: actionIdxUse,
            explored: exploredUse,
            fallback: false,
            reward: rlLastReward,
            oracleConstantAction: true
          };
          rlLog.push({
            date,
            stateIdx,
            actionIdx: actionIdxUse,
            explored: exploredUse,
            fallback: false,
            epsilon: sel.epsilon,
            trainForcedRandom,
            exposure: decFinal.exposure,
            positionCount: decFinal.positionCount,
            sizingMethod: decFinal.sizingMethod,
            rebalanceWait: decFinal.rebalanceWait,
            reward: rlLastReward
          });
        } else {
          const forceExploit = rlMode === 'eval';
          let sel = rlAgentInstance.selectAction(stateIdx, forceExploit, { randomAction: rlRandomAgent });
          let actionIdxUse = sel.actionIdx;
          let exploredUse = sel.explored;
          let trainForcedRandom = false;
          if (rlMode === 'train' && !rlRandomAgent) {
            if (sel.fallback && Math.random() < 0.72) {
              actionIdxUse = Math.floor(Math.random() * TOTAL_ACTIONS);
              exploredUse = true;
              trainForcedRandom = true;
              sel = { ...sel, actionIdx: actionIdxUse, explored: true, epsilon: 1, fallback: false };
            } else if (
              !exploredUse &&
              Math.random() < (rlAgentInstance.totalUpdates < 40000 ? 0.58 : 0.32)
            ) {
              actionIdxUse = Math.floor(Math.random() * TOTAL_ACTIONS);
              exploredUse = true;
              trainForcedRandom = true;
              sel = { ...sel, actionIdx: actionIdxUse, explored: true, epsilon: 1 };
            }
          }
          const dec = decodeAction(actionIdxUse);
          let bullFloorApplied = false;
          if (rlCompositeActive && regimeMeta.regime === 'strong_bull' && dec.exposure < 0.8) {
            const bullActionIdxs = [];
            for (let eIdx = 2; eIdx <= 3; eIdx++) {
              for (let pIdx = 0; pIdx <= 3; pIdx++) {
                for (let sIdx = 0; sIdx <= 2; sIdx++) {
                  bullActionIdxs.push(encodeAction(eIdx, pIdx, sIdx));
                }
              }
            }
            const bestBullAction = bullActionIdxs.reduce((best, aIdx) =>
              rlAgentInstance.getQ(stateIdx, aIdx) > rlAgentInstance.getQ(stateIdx, best) ? aIdx : best,
              bullActionIdxs[0]
            );
            actionIdxUse = bestBullAction;
            const decBull = decodeAction(bestBullAction);
            exposure = decBull.exposure;
            adjustedTopN = Math.max(3, Math.min(decBull.positionCount, rankings.length));
            effectiveSizing = decBull.sizingMethod;
            bullFloorApplied = true;
            console.log(`[RL] strong_bull floor applied: ${date} overrode exp=${dec.exposure} → ${decBull.exposure}`);
          } else {
            exposure = dec.exposure;
            adjustedTopN = Math.max(3, Math.min(dec.positionCount, rankings.length));
            effectiveSizing = dec.sizingMethod;
          }
          prevRlStateIdx = stateIdx;
          prevRlActionIdx = actionIdxUse;
          const decFinal = decodeAction(actionIdxUse);
          rlSkipThisRebalance = (decFinal.rebalanceWait ?? 'standard') === 'skip';
          rlRebalMeta = {
            exposure: decFinal.exposure,
            positionCount: decFinal.positionCount,
            sizingMethod: decFinal.sizingMethod,
            rebalanceWait: decFinal.rebalanceWait,
            stateIdx,
            actionIdx: actionIdxUse,
            explored: exploredUse,
            fallback: sel.fallback && !trainForcedRandom,
            reward: rlLastReward,
            ...(bullFloorApplied ? { bullFloorApplied: true } : {})
          };
          rlLog.push({
            date,
            stateIdx,
            actionIdx: actionIdxUse,
            explored: exploredUse,
            fallback: sel.fallback && !trainForcedRandom,
            epsilon: sel.epsilon,
            trainForcedRandom,
            exposure: decFinal.exposure,
            positionCount: decFinal.positionCount,
            sizingMethod: decFinal.sizingMethod,
            rebalanceWait: decFinal.rebalanceWait,
            reward: rlLastReward
          });
        }
      }

      {
        const hardMaxPositions = REGIME_MAX_POSITIONS[regimeMeta.regime] ?? 13;
        if (rlCompositeActive && rlAgentInstance) {
          adjustedTopN = Math.max(3, Math.min(adjustedTopN, hardMaxPositions, rankings.length));
        } else {
          adjustedTopN = Math.max(3, Math.min(adjustedTopN, Math.min(topN, hardMaxPositions), rankings.length));
        }
      }

      regimeLog.push({
        date,
        regime: regimeMeta.regime,
        exposure,
        breadthRatio: regimeMeta.breadthRatio,
        regimeExposureBaseline,
        rlActive: !!(rlCompositeActive && rlAgentInstance)
      });

      if (strategyClean === 'full_composite' || strategyClean === 'full_composite_aggressive' || strategyClean === 'full_composite_turbo') {
        factorSnapshots.push({
          date,
          allRanked: rankings.map(r => ({
            ticker: r.ticker, fundamental: r.fundamentalScore, dcf: r.dcfScore,
            valuation: r.valuationScore, momentum: r.momentumScore, value: r.valueScore,
            earningsMomentum: r.earningsMomentumScore != null && Number.isFinite(r.earningsMomentumScore) ? r.earningsMomentumScore : null,
            composite: r.compositeScore, price: r.price
          }))
        });
      }

      if (!rlSkipThisRebalance) {
        const sectorCap = getMaxSectorConcentration(strategyClean);
        let topPicks;
        if (compositeFamBt && correlationFilter && rankings && rankings.length > 0) {
          const corrPoolSize = Math.min(adjustedTopN * 2, rankings.length);
          const corrPool = usesFundamentals
            ? applySectorLimits(rankings, fundamentalsLive, corrPoolSize, sectorCap)
            : rankings.slice(0, corrPoolSize);
          const corrPoolRanked = filterCompositePicksByRebalanceScoreFloor(corrPool);
          const corrMat = computeCorrelationMatrix(
            corrPoolRanked.map((p) => p.ticker),
            priceHistory,
            correlationLookbackDays,
            date
          );
          const { selected } = applyCorrelationFilter(
            corrPoolRanked,
            corrMat,
            adjustedTopN,
            maxCorrelatedPeers
          );
          topPicks = selected;
        } else {
          topPicks = usesFundamentals
            ? applySectorLimits(rankings, fundamentalsLive, adjustedTopN, sectorCap)
            : rankings.slice(0, adjustedTopN);
        }
        if (
          strategyClean === 'full_composite' ||
          strategyClean === 'full_composite_aggressive' ||
          strategyClean === 'full_composite_turbo'
        ) {
          topPicks = filterCompositePicksByRebalanceScoreFloor(topPicks);
        }
        const rebalanceSlotCap = topPicks.length;

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
        } else if (compositeFamilySizing && effectiveSizing === 'invVol') {
          positionWeights = calculatePositionWeightsInvVol(topPicks, priceHistory, date);
        } else if (compositeFamilySizing && effectiveSizing === 'invVolBlend') {
          positionWeights = calculatePositionWeightsInvVol(topPicks, priceHistory, date, { equalBlend: 0.4 });
        } else if (compositeFamilySizing && effectiveSizing === 'score') {
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
        const maxHoldings = rebalanceSlotCap + HOLDINGS_OVERFLOW_SLOTS;

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
            const compositeForBuy = pick.compositeScore ?? pick.combinedScore ?? 0;
            if (compositeForBuy < SCORE_FLOOR) {
              continue;
            }
            const dteBt = daysUntilEarnings(ticker, date, fundamentalsLive);
            if (dteBt !== null && dteBt >= 0 && dteBt <= 10) {
              console.log(`[EarningsFilter] Skipping ${ticker} — earnings in ${dteBt.toFixed(1)} days`);
              continue;
            }
            if (Object.keys(holdings).length >= rebalanceSlotCap) continue;
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
          ...(compositeFam && rankings && rankings.length
            ? { avgTopScore: parseFloat(avgTopNAvgComposite(rankings, 15).toFixed(2)) }
            : {}),
          ...(compositeFam
            ? {
              pillarWeights: { ...weightsRankBt },
              adaptiveMeta: rebalanceAdaptiveMeta,
              requestedTopN: adjustedTopN,
              effectiveTargetN: rebalanceSlotCap,
              compositeScoreFloor: SCORE_FLOOR
            }
            : {}),
          ...(rlRebalMeta ? { rlAgent: rlRebalMeta, adjustedTopN } : {})
        });

        tradeLog.push(...trades.map(t => ({ ...t, date })));
      } else {
        let postValueSkip = cash;
        for (const [ticker, holding] of Object.entries(holdings)) {
          const price = dailyPx[ticker];
          if (price) postValueSkip += holding.shares * price;
        }
        rebalanceLog.push({
          date,
          portfolioValue: postValueSkip,
          holdings: Object.keys(holdings),
          topPicks: Object.keys(holdings),
          tradesExecuted: 0,
          regime: regimeMeta.regime,
          exposure,
          rlAction: 'SKIP_REBALANCE',
          ...(compositeFam && rankings && rankings.length
            ? { avgTopScore: parseFloat(avgTopNAvgComposite(rankings, 15).toFixed(2)) }
            : {}),
          ...(compositeFam
            ? {
              pillarWeights: { ...weightsRankBt },
              adaptiveMeta: rebalanceAdaptiveMeta,
              requestedTopN: adjustedTopN,
              effectiveTargetN: Object.keys(holdings).length,
              compositeScoreFloor: SCORE_FLOOR
            }
            : {}),
          ...(rlRebalMeta ? { rlAgent: rlRebalMeta, adjustedTopN } : {})
        });
      }

      let hedgePremiumThisRebal = 0;
      let hedgePatch = {};
      if (hedgingEnabled) {
        let portfolioValuePostRebal = cash;
        for (const [ticker, holding] of Object.entries(holdings)) {
          const price = dailyPx[ticker];
          if (price) portfolioValuePostRebal += holding.shares * price;
        }
        if (activeHedge) {
          hedgePremiumThisRebal = hedgePremiumForPeriod(activeHedge, date, activeHedge.notionalHedge);
          if (hedgePremiumThisRebal > 0) {
            cash -= hedgePremiumThisRebal;
            totalHedgeCost += hedgePremiumThisRebal;
            activeHedge.lastPremiumAccrualDate = date;
          }
        }
        const hedgeDec = evaluateHedgeNeed(regimeMeta.regime, portfolioValuePostRebal, activeHedge);
        if (hedgeDec.action === 'CLOSE_HEDGE' && activeHedge) {
          const pOpen = getPrice(spyPrices, activeHedge.openDate) || activeHedge.spyPxAtOpen;
          const pClose = getPrice(spyPrices, date);
          let hedgePnL = 0;
          if (pOpen > 0 && pClose > 0) {
            const spyRet = pClose / pOpen - 1;
            if (spyRet < 0) hedgePnL = activeHedge.notionalHedge * Math.abs(spyRet);
          }
          cash += hedgePnL;
          totalHedgeGain += hedgePnL;
          hedgePatch = {
            hedgeAction: 'CLOSE_HEDGE',
            hedgeNotional: activeHedge.notionalHedge,
            hedgeCost: parseFloat(hedgePremiumThisRebal.toFixed(2)),
            hedgePnL: parseFloat(hedgePnL.toFixed(2)),
            hedgeReason: hedgeDec.reason
          };
          activeHedge = null;
        } else if (hedgeDec.action === 'OPEN_HEDGE') {
          const spyPx0 = getPrice(spyPrices, date) || 0;
          activeHedge = {
            openDate: date,
            regime: hedgeDec.regime,
            notionalHedge: hedgeDec.notionalHedge,
            hedgePct: hedgeDec.hedgePct,
            spyPxAtOpen: spyPx0,
            lastPremiumAccrualDate: date
          };
          totalHedgesOpened += 1;
          hedgePatch = {
            hedgeAction: 'OPEN_HEDGE',
            hedgeNotional: hedgeDec.notionalHedge,
            hedgeCost: 0,
            hedgePnL: null,
            hedgeDescription: hedgeDec.description
          };
        } else {
          hedgePatch = activeHedge
            ? {
                hedgeAction: 'HOLD',
                hedgeNotional: activeHedge.notionalHedge,
                hedgeCost: parseFloat(hedgePremiumThisRebal.toFixed(2)),
                hedgePnL: null
              }
            : { hedgeAction: 'HOLD', hedgeNotional: null, hedgeCost: 0, hedgePnL: null };
        }
        if (rebalanceLog.length > 0 && rebalanceLog[rebalanceLog.length - 1].date === date) {
          Object.assign(rebalanceLog[rebalanceLog.length - 1], hedgePatch);
        }
      }

      const holdingsCopy = {};
      for (const [t, h] of Object.entries(holdings)) holdingsCopy[t] = { shares: h.shares, entryPrice: h.entryPrice, entryDate: h.entryDate };
      holdingsSnapshots.push({ date, cash, holdings: holdingsCopy });

      if (rlCompositeActive && rlAgentInstance) {
        let pvPostRebal = cash;
        for (const [ticker, holding] of Object.entries(holdings)) {
          const price = dailyPx[ticker];
          if (price) pvPostRebal += holding.shares * price;
        }
        rlLastPvForReturn = pvPostRebal;
        rlPeakSinceRebal = pvPostRebal;
        rlMaxDdSinceRebal = 0;
        rlDailyReturns = [];
        const benchCl =
          universeBenchmarkValue(uniBench, priceHistory, date, dailyPx) ??
          (spyPxBench > 0 && spyShares ? spyPxBench * spyShares : benchPre);
        lastRlPostPort = pvPostRebal;
        lastRlPostBench = benchCl;
      }
    }
  }

  if (hedgingEnabled && allTradingDays.length > 0) {
    const hEnd = activeHedge;
    const endD = allTradingDays[allTradingDays.length - 1];
    if (hEnd && daysBetween(hEnd.openDate, endD) > 0) {
      const premEnd = hedgePremiumForPeriod(hEnd, endD, hEnd.notionalHedge);
      if (premEnd > 0) {
        cash -= premEnd;
        totalHedgeCost += premEnd;
        hEnd.lastPremiumAccrualDate = endD;
      }
      const pOpenE = getPrice(spyPrices, hEnd.openDate) || hEnd.spyPxAtOpen;
      const pCloseE = getPrice(spyPrices, endD);
      let hedgePnLEnd = 0;
      if (pOpenE > 0 && pCloseE > 0) {
        const spyRetE = pCloseE / pOpenE - 1;
        if (spyRetE < 0) hedgePnLEnd = hEnd.notionalHedge * Math.abs(spyRetE);
      }
      cash += hedgePnLEnd;
      totalHedgeGain += hedgePnLEnd;
      activeHedge = null;
      if (holdingsSnapshots.length > 0) {
        holdingsSnapshots[holdingsSnapshots.length - 1].cash = cash;
      }
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
    positionSizing,
    rlLog,
    rlAgentInstance: rlCompositeActive ? rlAgentInstance : null,
    hedgeStats: hedgingEnabled
      ? {
          enabled: true,
          totalOpened: totalHedgesOpened,
          totalHedgeCost: parseFloat(totalHedgeCost.toFixed(2)),
          totalHedgeGain: parseFloat(totalHedgeGain.toFixed(2)),
          netHedgeImpact: parseFloat((totalHedgeGain - totalHedgeCost).toFixed(2)),
          costDrag: parseFloat(totalHedgeCost.toFixed(2)),
          protectionGain: parseFloat(totalHedgeGain.toFixed(2))
        }
      : {
          enabled: false,
          totalOpened: 0,
          totalHedgeCost: 0,
          totalHedgeGain: 0,
          netHedgeImpact: 0,
          costDrag: 0,
          protectionGain: 0
        }
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

const REGIME_SPLIT_KEYS = ['strong_bull', 'normal', 'pullback', 'caution', 'bear'];

function normalizeRegimeForSplit(reg) {
  const r = String(reg || 'normal').toLowerCase();
  if (r === 'correction') return 'pullback';
  if (!REGIME_SPLIT_KEYS.includes(r)) return 'normal';
  return r;
}

function medianArr(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stdArr(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, x) => s + (x - mean) ** 2, 0) / (arr.length - 1));
}

/** Per-regime metrics from daily equity; regime at end of each day labels the daily return. */
function computeRegimeSplitPerformance(dailyValues, spyPrices, universe, priceHistory) {
  const empty = () => ({
    daysInRegime: 0,
    return: 0,
    alpha: 0,
    sharpe: 0,
    maxDD: 0,
    benchmarkReturn: 0,
    numPeriods: 0
  });
  const buckets = Object.fromEntries(REGIME_SPLIT_KEYS.map((k) => [k, { pRets: [], bRets: [] }]));
  const segments = Object.fromEntries(REGIME_SPLIT_KEYS.map((k) => [k, 0]));
  let prevReg = null;
  for (let i = 1; i < dailyValues.length; i++) {
    const meta = calculateMarketRegime(spyPrices, dailyValues[i].date, universe, priceHistory);
    const reg = normalizeRegimeForSplit(meta.regime);
    const pRet = dailyValues[i].portfolio / dailyValues[i - 1].portfolio - 1;
    const bRet =
      dailyValues[i - 1].benchmark > 0 && dailyValues[i].benchmark > 0
        ? dailyValues[i].benchmark / dailyValues[i - 1].benchmark - 1
        : 0;
    if (buckets[reg]) {
      buckets[reg].pRets.push(pRet);
      buckets[reg].bRets.push(bRet);
      if (prevReg !== reg) segments[reg]++;
    }
    prevReg = reg;
  }

  const out = {};
  for (const k of REGIME_SPLIT_KEYS) {
    const { pRets, bRets } = buckets[k];
    const n = pRets.length;
    if (n < 5) {
      out[k] = { ...empty(), daysInRegime: n, numPeriods: segments[k] };
      continue;
    }
    let eq = 1;
    let beq = 1;
    let peak = 1;
    let maxDD = 0;
    for (let j = 0; j < n; j++) {
      eq *= 1 + pRets[j];
      beq *= 1 + bRets[j];
      if (eq > peak) peak = eq;
      const dd = peak > 0 ? (eq - peak) / peak : 0;
      if (dd < maxDD) maxDD = dd;
    }
    const totalRet = eq - 1;
    const benchRet = beq - 1;
    const rawAlpha = totalRet - benchRet;
    let sharpe = null;
    if (n >= 60) {
      const excess = pRets.map((pr, j) => pr - bRets[j]);
      const stdEx = standardDeviation(excess);
      const meanEx = excess.reduce((a, b) => a + b, 0) / excess.length;
      sharpe = stdEx > 0 ? parseFloat(((meanEx / stdEx) * Math.sqrt(252)).toFixed(2)) : 0;
    }
    out[k] = {
      daysInRegime: n,
      return: parseFloat((totalRet * 100).toFixed(2)),
      alpha: parseFloat((rawAlpha * 100).toFixed(2)),
      sharpe,
      maxDD: parseFloat((maxDD * 100).toFixed(2)),
      benchmarkReturn: parseFloat((benchRet * 100).toFixed(2)),
      numPeriods: segments[k]
    };
  }
  return out;
}

function buildRegimeDiversification(regimeSplit) {
  const alphas = [];
  let observed = 0;
  let positive = 0;
  for (const k of REGIME_SPLIT_KEYS) {
    const row = regimeSplit[k];
    if (!row || row.daysInRegime < 5) continue;
    observed++;
    const a = row.alpha;
    alphas.push(a);
    if (a > 0) positive++;
  }
  if (observed === 0) {
    return {
      positiveAlphaRegimes: 0,
      totalRegimesObserved: 0,
      worstRegimeAlpha: null,
      bestRegimeAlpha: null,
      alphaRange: null,
      robustnessScore: 0
    };
  }
  const worstRegimeAlpha = Math.min(...alphas);
  const bestRegimeAlpha = Math.max(...alphas);
  const alphaRange = bestRegimeAlpha - worstRegimeAlpha;
  const robustnessScore = Math.max(0, Math.min(1, positive / observed));
  return {
    positiveAlphaRegimes: positive,
    totalRegimesObserved: observed,
    worstRegimeAlpha: parseFloat(worstRegimeAlpha.toFixed(2)),
    bestRegimeAlpha: parseFloat(bestRegimeAlpha.toFixed(2)),
    alphaRange: parseFloat(alphaRange.toFixed(2)),
    robustnessScore: parseFloat(robustnessScore.toFixed(4))
  };
}

function buildMonthlyAlphaSeries(monthlyWithReturns) {
  if (!monthlyWithReturns?.length) {
    return { monthlyAlphas: [], stabilityScore: 0.5, recencyDiscountScore: 0.5, medianMonthlyAlpha: 0 };
  }
  const monthlyAlphas = monthlyWithReturns.map((m) => Number(m.portfolio) - Number(m.benchmark));
  const pos = monthlyAlphas.filter((x) => x > 0).length;
  const frac = monthlyAlphas.length ? pos / monthlyAlphas.length : 0;
  const sd = stdArr(monthlyAlphas);
  const stabilityScore = Math.max(0, Math.min(1, frac * (1 - Math.min(1, sd / 10))));
  const recent = monthlyAlphas.slice(-12);
  const longAvg = monthlyAlphas.reduce((a, b) => a + b, 0) / monthlyAlphas.length;
  const recentAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : longAvg;
  const recencyDiscountScore = 1 / (1 + Math.max(0, recentAvg - longAvg) / 15);
  return { monthlyAlphas, stabilityScore, recencyDiscountScore, medianMonthlyAlpha: medianArr(monthlyAlphas) };
}

function simplicityScoreFromWeights(weights) {
  if (!weights || typeof weights !== 'object') return 0.5;
  let nz = 0;
  for (const f of FACTOR_NAMES) {
    if (Math.abs(Number(weights[f]) || 0) > 1e-6) nz++;
  }
  return Math.max(0, Math.min(1, 1 - nz / 6));
}

/** Conservative haircut on forward alpha estimate (not applied to confidence score itself). */
const FORWARD_ALPHA_DAMPING = 0.7;

function buildForwardScoresAndEstimate({
  monthlyWithReturns,
  regimeDiversification,
  weights,
  historicalAnnualAlphaPct
}) {
  const { stabilityScore, recencyDiscountScore, medianMonthlyAlpha } = buildMonthlyAlphaSeries(monthlyWithReturns);
  const robustness = regimeDiversification?.robustnessScore ?? 0;
  const simplicity = simplicityScoreFromWeights(weights);
  const forwardConfidence = Math.max(
    0,
    Math.min(
      1,
      0.35 * stabilityScore + 0.3 * robustness + 0.2 * simplicity + 0.15 * recencyDiscountScore
    )
  );
  const histAlpha = Number(historicalAnnualAlphaPct);
  const medianAnnualizedExcess = medianMonthlyAlpha * 12;
  const rawEst = Math.min(
    Number.isFinite(histAlpha) ? histAlpha : 0,
    Number.isFinite(medianAnnualizedExcess) ? medianAnnualizedExcess : histAlpha
  );
  const estimatedAnnualAlpha = parseFloat((rawEst * FORWARD_ALPHA_DAMPING).toFixed(2));
  const low = parseFloat((estimatedAnnualAlpha * 0.5).toFixed(2));
  const high = parseFloat((estimatedAnnualAlpha * 1.5).toFixed(2));
  return {
    scores: {
      stability: parseFloat(stabilityScore.toFixed(4)),
      robustness: parseFloat(robustness.toFixed(4)),
      simplicity: parseFloat(simplicity.toFixed(4)),
      recencyDiscount: parseFloat(recencyDiscountScore.toFixed(4)),
      forwardConfidence: parseFloat(forwardConfidence.toFixed(4))
    },
    forwardEstimate: {
      estimatedAnnualAlpha,
      confidenceBand: { low, high },
      basis:
        'Conservative blend: min(long-run annualized alpha, monthly-median annualized excess) with a damping factor; confidence score is separate from this estimate.'
    },
    badges: {
      stableSignal: stabilityScore >= 0.55,
      regimeRobust: (regimeDiversification?.positiveAlphaRegimes ?? 0) >= Math.max(1, (regimeDiversification?.totalRegimesObserved ?? 1) * 0.5),
      recencyWarning: recencyDiscountScore < 0.45
    }
  };
}

function buildForwardInterpretationLine(scores, regimeDiversification, badges) {
  const parts = [];
  parts.push(
    `Forward confidence ${(scores.forwardConfidence * 100).toFixed(0)}% blends sub-period stability (${(scores.stability * 100).toFixed(0)}%), regime robustness (${(scores.robustness * 100).toFixed(0)}%), weight simplicity (${(scores.simplicity * 100).toFixed(0)}%), and recency discount (${(scores.recencyDiscount * 100).toFixed(0)}%).`
  );
  if (regimeDiversification?.totalRegimesObserved) {
    parts.push(
      `Positive alpha in ${regimeDiversification.positiveAlphaRegimes}/${regimeDiversification.totalRegimesObserved} sampled regimes (worst regime alpha ${regimeDiversification.worstRegimeAlpha}%).`
    );
  }
  if (badges.recencyWarning) parts.push('Recent performance looks elevated vs long-run average — forward estimate is conservative.');
  return parts.join(' ');
}

function buildMonthlyReturnsFromDailyValues(dailyValues) {
  if (!dailyValues?.length) return [];
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
  return monthlyReturns
    .map((m) => ({
      month: m.month,
      portfolio: ((m.portfolioEnd - m.portfolioStart) / m.portfolioStart) * 100,
      benchmark: ((m.benchEnd - m.benchStart) / m.benchStart) * 100
    }))
    .filter((m) => !isNaN(m.portfolio) && isFinite(m.portfolio));
}

/** Deep forward confidence: sub-period backtests + regime split on primary `period` sim. */
function mergeDeepForwardScores(subperiodAlphas, regimeDiversification, weights, primaryAlphaPct) {
  const vals = subperiodAlphas.filter((x) => x != null && Number.isFinite(x));
  const pos = vals.filter((a) => a > 0).length;
  const stability_score = vals.length ? pos / vals.length : 0;
  const robustness = regimeDiversification?.robustnessScore ?? 0;
  const simplicity = simplicityScoreFromWeights(weights);
  const a1 = subperiodAlphas[0];
  const a3 = subperiodAlphas.length > 2 ? subperiodAlphas[2] : subperiodAlphas[subperiodAlphas.length - 1];
  const recent = a1 != null && Number.isFinite(a1) ? a1 : primaryAlphaPct;
  const long = a3 != null && Number.isFinite(a3) ? a3 : primaryAlphaPct;
  const recency_discount_score = 1 / (1 + Math.max(0, recent - long) / 15);
  const forwardConfidence = Math.max(
    0,
    Math.min(1, 0.35 * stability_score + 0.3 * robustness + 0.2 * simplicity + 0.15 * recency_discount_score)
  );
  const med = medianArr(vals);
  const rawEst = Math.min(primaryAlphaPct, med);
  const estimatedAnnualAlpha = parseFloat((rawEst * FORWARD_ALPHA_DAMPING).toFixed(2));
  return {
    scores: {
      stability: parseFloat(stability_score.toFixed(4)),
      robustness: parseFloat(Number(robustness).toFixed(4)),
      simplicity: parseFloat(simplicity.toFixed(4)),
      recencyDiscount: parseFloat(recency_discount_score.toFixed(4)),
      forwardConfidence: parseFloat(forwardConfidence.toFixed(4))
    },
    forwardEstimate: {
      estimatedAnnualAlpha,
      confidenceBand: {
        low: parseFloat((estimatedAnnualAlpha * 0.5).toFixed(2)),
        high: parseFloat((estimatedAnnualAlpha * 1.5).toFixed(2))
      },
      basis:
        'Conservative blend: min(primary-window annualized alpha, median sub-period alpha) with damping; confidence score is separate from this estimate.'
    }
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

  const FACTOR_COLORS = {
    fundamental: '#22c55e',
    dcf: '#a78bfa',
    valuation: '#f59e0b',
    momentum: '#06b6d4',
    value: '#8b5cf6',
    earningsMomentum: '#ec4899'
  };
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

    if (dateStr <= endDate) {
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

// ─────────────────────────────────────────────────────────────────────────────
// CONGRESSIONAL TRADING SIGNAL  (Financial Modeling Prep — STOCK Act disclosures)
//
// Set FMP_API_KEY in .env (free tier ~250 calls/day). Degrades gracefully if absent.
// Data file: congress-signal.json (gitignored runtime artifact).
// Senate-only fetch per ticker (1 HTTP call) keeps weekly full-universe refresh
// under the daily budget; enable House by adding /house-disclosure in fetchCongressTrades.
// ─────────────────────────────────────────────────────────────────────────────

/** FMP API key from env (trimmed, first line only). */
function fmpApiKey() {
  const raw = process.env.FMP_API_KEY;
  if (raw == null || String(raw).trim() === '') return '';
  return String(raw).trim().split(/\r?\n/)[0].trim();
}

/**
 * Pull STOCK Act disclosures from Financial Modeling Prep (Senate + optional House).
 * Returns a unified array matching the shape expected by computeCongressScore, or null if empty/error.
 */
async function fetchCongressTrades(ticker, fromDate) {
  const key = fmpApiKey();
  if (!key) return null;

  const cutoff = fromDate
    ? new Date(fromDate).getTime()
    : Date.now() - 60 * 24 * 60 * 60 * 1000;

  const BASE = 'https://financialmodelingprep.com/api/v4';

  async function fetchEndpoint(path, chamber) {
    try {
      const url = `${BASE}${path}?symbol=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(key)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        console.warn(`[Congress] FMP non-JSON ${path} ${ticker} HTTP ${res.status}:`, text.slice(0, 200));
        return [];
      }
      if (!res.ok) {
        console.warn(`[Congress] FMP HTTP ${res.status} ${path} ${ticker}:`, text.slice(0, 200));
        return [];
      }
      if (!Array.isArray(data)) {
        const errMsg = data?.['Error Message'] || data?.error || data?.message;
        if (errMsg) console.warn(`[Congress] FMP ${ticker}:`, String(errMsg).slice(0, 200));
        return [];
      }

      return data
        .map((t) => {
          const rawDate = t.transactionDate ?? t.disclosureDate ?? t.dateRecieved ?? t.dateReceived ?? '';
          if (!rawDate) return null;
          if (new Date(rawDate).getTime() < cutoff) return null;

          const firstName = t.firstName ?? '';
          const lastName = t.lastName ?? t.representative ?? '';
          const name = `${firstName} ${lastName}`.trim() || 'Unknown';

          const raw = (t.type ?? t.transactionType ?? '').toLowerCase();
          let transaction = 'Other';
          if (/purchase|buy/i.test(raw)) transaction = 'Buy';
          else if (/sale|sell/i.test(raw)) transaction = 'Sell';

          return {
            name,
            party: t.party ?? '?',
            chamber,
            transaction,
            transactionDate: rawDate,
            filingDate: t.dateRecieved ?? t.dateReceived ?? t.disclosureDate ?? rawDate,
            amount: t.amount ?? '?',
            state: t.state ?? '?',
            office: t.office ?? name,
          };
        })
        .filter(Boolean);
    } catch (e) {
      console.warn(`[Congress] FMP ${path} ${ticker}:`, e?.message || e);
      return [];
    }
  }

  // Senate only: 1 call per ticker (~150 calls for full universe — within FMP free 250/day)
  const senateTrades = await fetchEndpoint('/senate-trading', 'Senate');
  // House: second call per ticker — uncomment if your plan budget allows
  // const houseTrades = await fetchEndpoint('/house-disclosure', 'House');
  // const combined = [...senateTrades, ...houseTrades];
  const combined = senateTrades;
  return combined.length > 0 ? combined : null;
}

/**
 * Score 0–10 from normalized trade records (FMP / legacy-shaped).
 * Each unique-politician buy = +1pt (×2 if within 21 days); sell = −1pt.
 * Clamped to [0,10].
 */
function computeCongressScore(trades) {
  if (!trades || trades.length === 0) {
    return { score: 0, netBuys: 0, netSells: 0, uniquePoliticians: 0, sentiment: 'neutral', hasSignal: false, politicians: [], recentTrades: [] };
  }
  const now = Date.now();
  const MS_21D = 21 * 24 * 60 * 60 * 1000;
  let rawScore = 0, netBuys = 0, netSells = 0;
  const politicians = new Set();
  const recentTrades = [];

  for (const t of trades) {
    const tDate = new Date(t.transactionDate || t.filingDate || '').getTime();
    if (isNaN(tDate) || (now - tDate) > 60 * 24 * 60 * 60 * 1000) continue;
    const isBuy  = /buy|purchase/i.test(t.transaction ?? '');
    const isSell = /sell|sale/i.test(t.transaction ?? '');
    const weight = (now - tDate) < MS_21D ? 2 : 1;
    politicians.add(t.name ?? t.politician ?? 'Unknown');
    if (isBuy)  { netBuys++;  rawScore += weight; }
    else if (isSell) { netSells++; rawScore -= weight; }
    recentTrades.push({
      name: t.name ?? t.politician ?? 'Unknown', party: t.party ?? '?', chamber: t.chamber ?? '?',
      action: isBuy ? 'Buy' : isSell ? 'Sell' : t.transaction,
      date: t.transactionDate ?? t.filingDate ?? '', amount: t.amount ?? '?',
      isRecent: (now - tDate) < MS_21D,
    });
  }
  const score = parseFloat(Math.max(0, Math.min(10, rawScore)).toFixed(1));
  return {
    score, netBuys, netSells,
    uniquePoliticians: politicians.size,
    politicians: [...politicians].slice(0, 5),
    recentTrades: recentTrades.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10),
    hasSignal: score >= 3,
    sentiment: score >= 5 ? 'bullish' : score >= 3 ? 'mild' : netSells > netBuys ? 'bearish' : 'neutral',
  };
}

/**
 * Fetch + persist congress signal for all given tickers.
 * 300 ms delay between calls — politeness toward FMP.
 */
async function refreshCongressSignal(tickers) {
  if (!fmpApiKey()) {
    console.log('[Congress] FMP_API_KEY not set — skipping refresh');
    return {};
  }
  const fromDate = (() => { const d = new Date(); d.setDate(d.getDate() - 60); return d.toISOString().split('T')[0]; })();
  const results = {};
  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    try {
      const trades = await fetchCongressTrades(ticker, fromDate);
      results[ticker] = { ...computeCongressScore(trades), ticker, refreshedAt: new Date().toISOString() };
    } catch {
      results[ticker] = { score: 0, ticker, error: true, refreshedAt: new Date().toISOString() };
    }
    if (i < tickers.length - 1) await new Promise(r => setTimeout(r, 300));
  }
  await fsWriteFile(CONGRESS_SIGNAL_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), tickers: results }, null, 2));
  console.log(`[Congress] Refreshed ${Object.keys(results).length} tickers → congress-signal.json`);
  return results;
}

// In-memory cache — loaded at startup, refreshed by weekly cron
let congressSignalCache = {};

/** O(1) lookup — returns zeroed default when ticker has no data. */
function getCongressScore(ticker) {
  return congressSignalCache[String(ticker || '').toUpperCase()]
    ?? { score: 0, netBuys: 0, netSells: 0, uniquePoliticians: 0, sentiment: 'neutral', hasSignal: false, politicians: [] };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * getRollingHV
 *
 * Computes 30-day historical (realized) volatility for a ticker
 * using ONLY price data available on or before `asOfDate`.
 * No look-ahead: prices after asOfDate are excluded.
 *
 * Returns annualized HV as a decimal (e.g. 0.25 = 25%).
 * Returns null if insufficient data.
 *
 * @param {string} ticker
 * @param {string} asOfDate  - ISO date string "YYYY-MM-DD"
 * @param {number} window    - trading days to use (default 30)
 */
function getRollingHV(ticker, asOfDate, window = 30) {
  try {
    const root = String(ticker || '').trim().toUpperCase();
    if (!root || !asOfDate) return null;
    const cachePath = path.join(REPO_ROOT, '.cache', 'yahoo', `${root}.json`);
    if (!existsSync(cachePath)) return null;

    const raw = JSON.parse(readFileSync(cachePath, 'utf8'));

    // Normalize to array of {date, close} sorted ascending
    let prices = [];
    if (Array.isArray(raw.prices)) {
      prices = raw.prices
        .filter((p) => p && p.date && (p.close ?? p.adjClose ?? p.price) != null)
        .map((p) => ({
          date: String(p.date).split('T')[0],
          close: Number(p.close ?? p.adjClose ?? p.price)
        }))
        .filter((p) => Number.isFinite(p.close) && p.close > 0);
    } else if (raw.history && typeof raw.history === 'object') {
      prices = Object.entries(raw.history)
        .map(([date, data]) => ({
          date,
          close:
            typeof data === 'number'
              ? Number(data)
              : Number(data?.close ?? data?.adjClose ?? data?.price)
        }))
        .filter((p) => Number.isFinite(p.close) && p.close > 0);
    }

    prices = prices
      .filter((p) => p.date <= asOfDate)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-(window + 1)); // need window+1 prices to compute window returns

    if (prices.length < window + 1) return null;

    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      const c0 = prices[i - 1].close;
      const c1 = prices[i].close;
      if (c0 > 0 && c1 > 0) returns.push(Math.log(c1 / c0));
    }
    if (returns.length < 5) return null;

    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance =
      returns.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, returns.length - 1);
    const hvAnnualized = Math.sqrt(variance * 252);
    if (!Number.isFinite(hvAnnualized) || hvAnnualized <= 0) return null;
    return parseFloat(hvAnnualized.toFixed(4));
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THREE-PAPER ACADEMIC OPTIONS SIGNAL SYSTEM
//
// Synthesizes findings from:
//   Bakshi & Kapadia (2003) — negative VRP; delta-hedged sell edge scales with vol
//   Cao & Han (2013)        — idiosyncratic vol cross-section; dealers overprice high-IVOL
//   Goyal & Saretto (2007)  — log(RV) - log(IV) mispricing signal; straddle alpha
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getPriceArray — internal helper for computeIVOL.
 * Returns the last `n` closing prices ≤ asOf from the same on-disk cache
 * that getRollingHV uses (.cache/yahoo/{TICKER}.json).
 * Returns null when data is insufficient (< 80% fill).
 */
function getPriceArray(ticker, asOf, n) {
  try {
    const root = String(ticker || '').trim().toUpperCase();
    if (!root || !asOf) return null;
    const cachePath = path.join(REPO_ROOT, '.cache', 'yahoo', `${root}.json`);
    if (!existsSync(cachePath)) return null;

    const raw = JSON.parse(readFileSync(cachePath, 'utf8'));
    let prices = [];
    if (Array.isArray(raw.prices)) {
      prices = raw.prices
        .filter((p) => p && p.date && (p.close ?? p.adjClose ?? p.price) != null)
        .map((p) => ({ date: String(p.date).split('T')[0], close: Number(p.close ?? p.adjClose ?? p.price) }))
        .filter((p) => Number.isFinite(p.close) && p.close > 0);
    } else if (raw.history && typeof raw.history === 'object') {
      prices = Object.entries(raw.history)
        .map(([date, data]) => ({
          date,
          close: typeof data === 'number' ? Number(data) : Number(data?.close ?? data?.adjClose ?? data?.price)
        }))
        .filter((p) => Number.isFinite(p.close) && p.close > 0);
    }

    prices = prices
      .filter((p) => p.date <= asOf)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-n);

    return prices.length >= Math.floor(n * 0.8) ? prices.map((p) => p.close) : null;
  } catch { return null; }
}

/**
 * computeGSSignal — Goyal & Saretto (2007) volatility mispricing signal.
 *
 * signal = log(RV_252d) − log(IV_ATM)
 *   signal << 0  →  IV >> RV  →  options significantly overpriced  →  strong sell edge
 *   signal ≈  0  →  IV ≈ RV  →  fairly priced                      →  weak edge
 *   signal >> 0  →  RV >> IV  →  options cheap                      →  avoid selling
 *
 * gsNorm is mapped to [0,1] where 1.0 = strongest sell signal (most negative gs).
 */
function computeGSSignal(ticker, asOf, ivAtm) {
  if (!ticker || !ivAtm || ivAtm <= 0) return null;
  try {
    const rv252 = getRollingHV(ticker, asOf, 252);
    if (!rv252 || rv252 <= 0) return null;

    const gsSignal = Math.log(rv252) - Math.log(ivAtm);
    const overpricingRatio = parseFloat((ivAtm / rv252).toFixed(3));

    // Map [-1.5, +0.5] → [0, 1]: most negative (strong overpricing) = 1.0
    const SIGNAL_MIN = -1.5, SIGNAL_MAX = 0.5;
    const gsNorm = parseFloat(
      Math.max(0, Math.min(1, (SIGNAL_MAX - gsSignal) / (SIGNAL_MAX - SIGNAL_MIN))).toFixed(3)
    );

    let interpretation;
    if (gsSignal < -0.5)
      interpretation = `Strong edge: IV is ${((overpricingRatio - 1) * 100).toFixed(0)}% above 12-month realized — options significantly overpriced.`;
    else if (gsSignal < -0.2)
      interpretation = 'Moderate edge: IV modestly above realized vol. Normal premium-selling conditions.';
    else if (gsSignal < 0.1)
      interpretation = 'Fairly priced: IV and realized vol are close. Minimal mispricing signal.';
    else
      interpretation = 'Avoid selling: realized vol exceeds implied — options are cheap.';

    return {
      gsSignal:         parseFloat(gsSignal.toFixed(4)),
      gsNorm,
      rv252:            parseFloat((rv252 * 100).toFixed(2)),    // pct
      ivAtmPct:         parseFloat((ivAtm  * 100).toFixed(2)),   // pct
      overpricingRatio,
      sellEdge:         gsSignal < -0.1,
      interpretation
    };
  } catch { return null; }
}

/**
 * computeIVOL — Cao & Han (2013) idiosyncratic volatility.
 *
 * Regresses 21-day daily returns on SPY (CAPM single factor).
 * IVOL = annualised stdev of residuals.
 *
 * Higher IVOL → dealers charge more to supply options → structurally overpriced → stronger sell edge.
 */
function computeIVOL(ticker, asOf) {
  if (!ticker) return null;
  try {
    const LOOKBACK = 22; // C&H use 1-month residuals (+1 for returns)
    const stockPx = getPriceArray(ticker, asOf, LOOKBACK);
    const spyPx   = getPriceArray('SPY',   asOf, LOOKBACK);
    if (!stockPx || !spyPx) return null;

    const len = Math.min(stockPx.length, spyPx.length);
    const stockRets = [], spyRets = [];
    for (let i = 1; i < len; i++) {
      const sRet = (stockPx[i] - stockPx[i - 1]) / stockPx[i - 1];
      const mRet = (spyPx[i]   - spyPx[i - 1])   / spyPx[i - 1];
      if (Number.isFinite(sRet) && Number.isFinite(mRet)) { stockRets.push(sRet); spyRets.push(mRet); }
    }
    if (stockRets.length < 15) return null;

    // OLS: R_stock = α + β × R_spy
    const n = stockRets.length;
    const sumX  = spyRets.reduce((a, x) => a + x, 0);
    const sumY  = stockRets.reduce((a, y) => a + y, 0);
    const sumXY = spyRets.reduce((a, x, i) => a + x * stockRets[i], 0);
    const sumXX = spyRets.reduce((a, x) => a + x * x, 0);
    const denom = n * sumXX - sumX * sumX;
    if (Math.abs(denom) < 1e-12) return null;

    const beta  = (n * sumXY - sumX * sumY) / denom;
    const alpha = (sumY - beta * sumX) / n;

    const residuals = stockRets.map((r, i) => r - (alpha + beta * spyRets[i]));
    const meanR = residuals.reduce((a, r) => a + r, 0) / residuals.length;
    const variance = residuals.reduce((a, r) => a + (r - meanR) ** 2, 0) / (residuals.length - 1);
    const ivol = Math.sqrt(variance * 252);

    if (!Number.isFinite(ivol) || ivol <= 0) return null;
    return {
      ivol:    parseFloat(ivol.toFixed(4)),
      ivolPct: parseFloat((ivol * 100).toFixed(2)),
      beta:    parseFloat(beta.toFixed(3))
    };
  } catch { return null; }
}

/**
 * computeVRPIntensity — Bakshi & Kapadia (2003) vol risk premium intensity.
 *
 * vrpIntensity = (IV_ATM / HV_30) − 1, scaled by vol-regime multiplier.
 * B&K finding: delta-hedged losses scale with vol level (~3× difference
 * between high-vol and low-vol regimes per their Table 3).
 */
function computeVRPIntensity(ticker, asOf, ivAtm) {
  if (!ticker || !ivAtm || ivAtm <= 0) return null;
  try {
    const hv30 = getRollingHV(ticker, asOf, 30);
    if (!hv30 || hv30 <= 0) return null;

    const ivPremium = (ivAtm / hv30) - 1;

    // B&K Table 3 vol-regime multiplier
    const hv30Pct = hv30 * 100;
    const regimeBoost = hv30Pct < 10 ? 0.70 : hv30Pct < 14 ? 1.00 : hv30Pct < 18 ? 1.30 : 1.60;
    const vrpIntensity = ivPremium * regimeBoost;

    // Normalize [-0.5, 1.5] → [0, 1]
    const VRP_MIN = -0.5, VRP_MAX = 1.5;
    const vrpNorm = parseFloat(
      Math.max(0, Math.min(1, (vrpIntensity - VRP_MIN) / (VRP_MAX - VRP_MIN))).toFixed(3)
    );

    return {
      vrpIntensity: parseFloat(vrpIntensity.toFixed(3)),
      ivPremium:    parseFloat(ivPremium.toFixed(3)),
      hv30Pct:      parseFloat(hv30Pct.toFixed(2)),
      regimeBoost,
      vrpNorm,
      sellEdge: ivPremium > 0.05
    };
  } catch { return null; }
}

/**
 * getBKVolRegimeBoost — Bakshi & Kapadia (2003) market-level sizing multiplier.
 *
 * In high-vol regimes the negative VRP effect is ~3× stronger so we can
 * be proportionally more selective / aggressive. Uses SPY 30-day realized vol.
 * Range [0.7, 1.5]; baseline 1.0.
 */
function getBKVolRegimeBoost(asOf) {
  try {
    const spyHV30 = getRollingHV('SPY', asOf, 30);
    if (!spyHV30) return 1.0;
    const pct = spyHV30 * 100;
    return pct < 10 ? 0.7 : pct < 14 ? 1.0 : pct < 18 ? 1.2 : 1.5;
  } catch { return 1.0; }
}

/**
 * buildSellScore — composite academic sell score (0-1, higher = stronger edge).
 * Weights: G&S 40%, C&H 30%, B&K 30% (vol-regime-boosted).
 *
 * @param {object|null} gs   result of computeGSSignal
 * @param {number}      ivolPct   IVOL cross-sectional percentile [0,1]
 * @param {object|null} vrp  result of computeVRPIntensity
 * @param {number}      bkBoost  getBKVolRegimeBoost result
 * @param {number}      ivRank  fallback IVR [0-100]
 */
function buildSellScore(gs, ivolPct, vrp, bkBoost, ivRank) {
  const gsNorm     = gs?.gsNorm   ?? (ivRank > 50 ? 0.55 : 0.35);
  const vrpNorm    = vrp?.vrpNorm ?? (ivRank > 40 ? 0.40 : 0.25);
  const vrpBoosted = Math.min(1, vrpNorm * (bkBoost ?? 1.0));
  const ivolComp   = Number.isFinite(ivolPct) ? ivolPct : 0.5;

  const sellScore = parseFloat((0.40 * gsNorm + 0.30 * ivolComp + 0.30 * vrpBoosted).toFixed(4));

  const signalCount = [
    gs?.sellEdge  ?? (ivRank > 50),
    vrp?.sellEdge ?? (ivRank > 40),
    ivolComp > 0.40
  ].filter(Boolean).length;

  return { sellScore, signalCount, academicSellEdge: signalCount >= 2 };
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

function checkStopLosses(holdings, priceHistory, currentDate, fundamentals, strategyClean = 'full_composite', universeId = null) {
  const exits = [];
  const isAggressive = strategyClean === 'full_composite_aggressive' || strategyClean === 'full_composite_turbo';
  const maxStop = isAggressive ? 0.35 : (universeId === 'sp500_top50' ? 0.28 : 0.20);
  const hardCircuit = -maxStop;
  const target = typeof currentDate === 'string' ? currentDate : currentDate.toISOString().split('T')[0];

  for (const [ticker, holding] of Object.entries(holdings)) {
    const prices = priceHistory[ticker];
    if (!prices || prices.length === 0) continue;

    const lastAvailIdx = bsearchLastBeforeOrEqual(prices, target);
    if (lastAvailIdx < 0 || prices[lastAvailIdx].date > target || lastAvailIdx < 4) continue;

    const today = prices[lastAvailIdx];

    const entryPrice = holding.entryPrice;
    if (!entryPrice || entryPrice <= 0) continue;

    const entryIdx = bsearchFirstOnOrAfter(prices, holding.entryDate);
    if (entryIdx < 0 || entryIdx > lastAvailIdx) continue;
    if (lastAvailIdx - entryIdx + 1 < 5) continue;

    const stopPx = entryPrice * (1 + hardCircuit);

    // Intraday (daily bar): circuit trips if low or gap-open breaches stop price — not only on rebalance closes.
    const dayLow =
      today.low != null && Number.isFinite(today.low) ? today.low : today.close;
    const dayOpen =
      today.open != null && Number.isFinite(today.open) ? today.open : today.close;
    const effectiveExtreme = Math.min(dayLow, dayOpen);
    if (effectiveExtreme <= stopPx) {
      exits.push({
        ticker,
        exitPrice: stopPx,
        entryPrice,
        drawdown: hardCircuit,
        stopLevel: hardCircuit,
        trailing: false,
        circuitBreaker: true,
        intraday: true
      });
      continue;
    }

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
    const volStop = -Math.max(monthlyVol * volMultiplier, minStop);
    const adjustedStop = Math.max(volStop, -maxStop);
    const finalStop = adjustedStop;

    const todayReturn = (today.close - entryPrice) / entryPrice;

    // Same-day close still at/beyond hard cap (no usable low/open vs stopPx edge case).
    if (todayReturn <= hardCircuit) {
      exits.push({
        ticker,
        exitPrice: today.close,
        entryPrice,
        drawdown: todayReturn,
        stopLevel: hardCircuit,
        trailing: false,
        circuitBreaker: true,
        intraday: false
      });
      continue;
    }

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
        trailing: false,
        circuitBreaker: false
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

/** Daily log returns keyed by bar end date (aligned across tickers on matching dates). */
function logReturnMapByEndDate(priceData, asOfDate, lookbackDays) {
  const avail = (priceData || [])
    .filter((p) => p && p.date && p.date <= asOfDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (avail.length < lookbackDays + 2) return new Map();
  const slice = avail.slice(-(lookbackDays + 1));
  const m = new Map();
  for (let i = 1; i < slice.length; i++) {
    const a = slice[i - 1].close;
    const b = slice[i].close;
    if (a > 0 && b > 0) m.set(slice[i].date, Math.log(b / a));
  }
  return m;
}

function correlationPairKey(ta, tb) {
  const a = String(ta);
  const b = String(tb);
  return a.localeCompare(b) <= 0 ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Pairwise Pearson correlation of daily log returns over `lookbackDays` ending at `asOfDate`.
 * @returns {{ pairs: Record<string, number>, clusters: string[][] }}
 */
function computeCorrelationMatrix(tickers, priceData, lookbackDays = 60, asOfDate = null) {
  const asOf = asOfDate || new Date().toISOString().split('T')[0];
  const uniq = [...new Set((tickers || []).map((t) => String(t).trim()).filter(Boolean))];
  const maps = new Map();
  for (const t of uniq) {
    const series = priceData?.[t];
    if (!series || !series.length) continue;
    maps.set(t, logReturnMapByEndDate(series, asOf, lookbackDays));
  }
  const pairs = {};
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const ta = uniq[i];
      const tb = uniq[j];
      const m1 = maps.get(ta);
      const m2 = maps.get(tb);
      if (!m1 || !m2 || m1.size === 0 || m2.size === 0) {
        pairs[correlationPairKey(ta, tb)] = 0;
        continue;
      }
      const xs = [];
      const ys = [];
      for (const [dt, r1] of m1) {
        const r2 = m2.get(dt);
        if (r2 != null) {
          xs.push(r1);
          ys.push(r2);
        }
      }
      const rho = pearsonCorrelation(xs, ys);
      pairs[correlationPairKey(ta, tb)] = rho != null && Number.isFinite(rho) ? rho : 0;
    }
  }
  const adj = new Map();
  for (const t of uniq) adj.set(t, []);
  const thresh = 0.7;
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const ta = uniq[i];
      const tb = uniq[j];
      const c = pairs[correlationPairKey(ta, tb)] ?? 0;
      if (c > thresh) {
        adj.get(ta).push(tb);
        adj.get(tb).push(ta);
      }
    }
  }
  const seen = new Set();
  const clusters = [];
  for (const t of uniq) {
    if (seen.has(t)) continue;
    const comp = [];
    const stack = [t];
    seen.add(t);
    while (stack.length) {
      const u = stack.pop();
      comp.push(u);
      for (const v of adj.get(u) || []) {
        if (!seen.has(v)) {
          seen.add(v);
          stack.push(v);
        }
      }
    }
    clusters.push(comp.sort((a, b) => a.localeCompare(b)));
  }
  return { pairs, clusters };
}

/**
 * Greedy diversification: walk ranked rows; skip if already have `maxCorrelated` names with corr > 0.7.
 * @param {object} correlationMatrix - result of computeCorrelationMatrix (`{ pairs }`)
 */
function applyCorrelationFilter(rankedTickers, correlationMatrix, maxPositions, maxCorrelated = 3) {
  const pairMap =
    correlationMatrix && typeof correlationMatrix === 'object' && correlationMatrix.pairs
      ? correlationMatrix.pairs
      : {};
  const corrAB = (a, b) => {
    if (!a || !b || a === b) return 0;
    const k = correlationPairKey(a, b);
    const v = pairMap[k];
    return v != null && Number.isFinite(v) ? v : 0;
  };
  const selected = [];
  const skipped = [];
  for (const row of rankedTickers || []) {
    if (selected.length >= maxPositions) break;
    const t = row.ticker;
    let highCorr = 0;
    for (const ex of selected) {
      if (corrAB(t, ex.ticker) > 0.7) highCorr++;
    }
    if (highCorr >= maxCorrelated) {
      skipped.push({
        ticker: t,
        reason: `correlated_gt_0.7_with_${highCorr}_existing (maxCorrelated=${maxCorrelated})`
      });
    } else {
      selected.push(row);
    }
  }
  return { selected, skipped };
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
  const earningsMap = opts.earningsMap instanceof Map ? opts.earningsMap : null;

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

  const wEm = dynWeights?.earningsMomentum ?? 0;
  const earningsScoreByTicker =
    wEm > 1e-9 && earningsMap && earningsMap.size
      ? buildEarningsMomentumScoreByTicker(
          candidates.map((c) => c.ticker),
          earningsMap
        )
      : null;

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
    let emScore = null;
    if (wEm > 1e-9) {
      emScore = earningsScoreByTicker != null ? earningsScoreByTicker.get(c.ticker) ?? null : null;
    }

    const momQBonus = blendMQ ? 0 : (c.momQ ? (c.momQ.score - 50) * 0.1 : 0);
    const pillarScores = {
      fundamental: c.fund.fundamentalComposite,
      dcf,
      valuation: dynVal.score,
      momentum: momentumTerm,
      value: c.val.valueScore,
      earningsMomentum: emScore
    };
    const fullScore = compositeWeightedWithRedistribution(w, pillarScores) + momQBonus;

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
      earningsMomentumScore: emScore,
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
  const unix = path.join(REPO_ROOT, '.venv', 'bin', 'python3');
  if (existsSync(unix)) return unix;
  const win = path.join(REPO_ROOT, '.venv', 'Scripts', 'python.exe');
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

const CHART_DISK_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

/** Coalesce concurrent identical chart requests (same ticker + date range). */
const btFetchChartInflight = new Map();

function finalizeChartRows(rows, ticker, source) {
  if (!rows?.length) return null;
  const v = validateDailyChartRows(rows, { ticker: String(ticker).toUpperCase() });
  pushValidationSlice(v);
  if (validationStrictEnabled() && v.errors.length > 0) {
    return null;
  }
  bumpChartSource(source);
  return rows;
}

async function bt_fetchPriceHistory(ticker, startDate, endDate) {
  const k = `${String(ticker).toUpperCase()}|${startDate}|${endDate}`;
  let p = btFetchChartInflight.get(k);
  if (!p) {
    p = bt_fetchPriceHistoryCore(ticker, startDate, endDate).finally(() => {
      btFetchChartInflight.delete(k);
    });
    btFetchChartInflight.set(k, p);
  }
  const out = await p;
  if (YAHOO_CHART_DELAY_MS > 0) await sleep(YAHOO_CHART_DELAY_MS);
  return out;
}

async function bt_fetchPriceHistoryCore(ticker, startDate, endDate) {
  bt_fetchPriceHistory.lastStaleWarning = null;
  const upper = String(ticker).toUpperCase();

  const goldPack = readGoldBarsForRange(upper, startDate, endDate);
  if (goldPack?.rows?.length >= 5) {
    const fin = finalizeChartRows(goldPack.rows, ticker, 'gold');
    if (fin) return fin;
  }

  // Serve from disk cache if data is fresh and covers the full requested range
  const cachePath = path.join(YAHOO_DISK_CACHE_DIR, `${upper}-chart.json`);
  if (existsSync(cachePath)) {
    try {
      const raw = JSON.parse(readFileSync(cachePath, 'utf-8'));
      if (raw?.data?.length && raw.fetchedAt && Date.now() - raw.fetchedAt < CHART_DISK_CACHE_TTL_MS) {
        if (raw.data[0].date <= startDate) {
          const clipped = filterChartRowsToRange(raw.data, startDate, endDate);
          if (clipped.length >= 5) {
            const fin = finalizeChartRows(clipped, ticker, 'diskFresh');
            if (fin) return fin;
          }
        }
      }
    } catch { /* fall through to live fetch */ }
  }

  const mapQuotes = (result) => {
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
  };

  const fetchOnce = async () => {
    const result = await fetchYahooOp(
      () =>
        yahooFinance.chart(yahooApiSymbol(ticker), {
          period1: startDate,
          period2: endDate,
          interval: '1d'
        }),
      12000
    );
    return mapQuotes(result);
  };

  const tryAttempt = async (label) => {
    try {
      const rows = await fetchOnce();
      if (rows?.length) return rows;
      console.warn(`[Yahoo] chart empty ${upper} (${label})`);
    } catch (err) {
      console.warn(`[Yahoo] chart failed ${upper} (${label}):`, err.message);
    }
    return null;
  };

  let got = await tryAttempt('attempt 1');
  if (got?.length) {
    const fin = finalizeChartRows(got, ticker, 'yahoo');
    if (fin) {
      writeChartDiskCache(upper, got);
      if (goldLayerWriteEnabled()) {
        try {
          writeGoldBars(upper, got);
        } catch (e) {
          console.warn('[gold] write failed', upper, e.message);
        }
      }
      return fin;
    }
  }

  await new Promise((r) => setTimeout(r, 3000));
  got = await tryAttempt('attempt 2');
  if (got?.length) {
    const fin = finalizeChartRows(got, ticker, 'yahoo');
    if (fin) {
      writeChartDiskCache(upper, got);
      if (goldLayerWriteEnabled()) {
        try {
          writeGoldBars(upper, got);
        } catch (e) {
          console.warn('[gold] write failed', upper, e.message);
        }
      }
      return fin;
    }
  }

  await new Promise((r) => setTimeout(r, 5000));
  got = await tryAttempt('attempt 3');
  if (got?.length) {
    const fin = finalizeChartRows(got, ticker, 'yahoo');
    if (fin) {
      writeChartDiskCache(upper, got);
      if (goldLayerWriteEnabled()) {
        try {
          writeGoldBars(upper, got);
        } catch (e) {
          console.warn('[gold] write failed', upper, e.message);
        }
      }
      return fin;
    }
  }

  const stale = readChartDiskCacheStale(ticker);
  if (stale?.length) {
    const clipped = filterChartRowsToRange(stale, startDate, endDate);
    if (clipped.length >= 5) {
      bt_fetchPriceHistory.lastStaleWarning = 'Using cached chart data (may be stale).';
      console.warn(`[Yahoo] ${upper}: using stale disk chart cache (${clipped.length} rows in range)`);
      const fin = finalizeChartRows(clipped, ticker, 'stale');
      if (fin) return fin;
    }
  }

  return null;
}
bt_fetchPriceHistory.lastStaleWarning = null;

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

/** One row for GET /api/diagnostics/hedge-impact (hedgeStats null when hedging off). */
function buildHedgeImpactConfigRow(name, hedging, rl, sim, capital) {
  const perf = extractDiagnosticPerformance(sim, capital);
  const hedgeStats = hedging
    ? (() => {
        const hs = sim.hedgeStats || {};
        return {
          totalOpened: hs.totalOpened ?? 0,
          netImpact: hs.netHedgeImpact ?? 0,
          costDrag: hs.costDrag ?? 0,
          protectionGain: hs.protectionGain ?? 0
        };
      })()
    : null;
  if (!perf) {
    return { name, hedging, rl, totalReturn: null, alpha: null, sharpe: null, maxDrawdown: null, hedgeStats };
  }
  return {
    name,
    hedging,
    rl,
    totalReturn: parseFloat(perf.totalReturn),
    alpha: parseFloat(perf.alpha),
    sharpe: parseFloat(perf.sharpe),
    maxDrawdown: parseFloat(perf.maxDrawdown),
    hedgeStats
  };
}

function summarizeEquityCurvePerf(sim, capital) {
  const perf = extractDiagnosticPerformance(sim, capital);
  if (!perf) return { totalReturn: null, sharpe: null, maxDrawdown: null };
  return {
    totalReturn: parseFloat(perf.totalReturn),
    sharpe: parseFloat(perf.sharpe),
    maxDrawdown: parseFloat(perf.maxDrawdown)
  };
}

/** Daily points with value = portfolio (or benchmark) / capital * 100. */
function buildNormalizedEquityPoints(dailyValues, capital, valueKey = 'portfolio') {
  if (!dailyValues?.length || !capital || capital <= 0) return [];
  const out = [];
  for (const d of dailyValues) {
    const raw = d[valueKey];
    if (raw == null || !Number.isFinite(Number(raw))) continue;
    const value = parseFloat(((Number(raw) / capital) * 100).toFixed(4));
    out.push({ date: d.date, value });
  }
  return out;
}

function summarizeBenchmarkLegFromSim(sim, capital) {
  const perf = extractBenchmarkLegPerformance(sim?.dailyValues, capital);
  if (!perf) return { totalReturn: null, sharpe: null, maxDrawdown: null };
  return {
    totalReturn: parseFloat(perf.totalReturn),
    sharpe: parseFloat(perf.sharpe),
    maxDrawdown: parseFloat(perf.maxDrawdown)
  };
}

/** True when diagnostics equity curve can plot an RL-eval line (DQN or per-universe Q-learning). */
function trainedRlForEquityCurvesDiagnostics(universeId) {
  if (rlAgentTypeEffective() === 'dqn') {
    const agent = TRAINED_RL_AGENT ?? loadRlAgentFromDisk('dqn');
    return agent && isDqnAgentInstance(agent) && (Number(agent.totalUpdates) || 0) > 0;
  }
  const a = getQlAgentForUniverse(universeId);
  return a != null && trainedRlAgentReadyForInference(a);
}

/** Numeric perf row for POST /api/rl/train auto-eval (Sharpe/alpha used for overfitRatio). */
function extractRlTrainEvalBlock(sim, capital, periodDescription) {
  const base = extractDiagnosticPerformance(sim, capital);
  if (!base) {
    return {
      period: periodDescription,
      totalReturn: null,
      alpha: null,
      sharpe: null,
      maxDrawdown: null
    };
  }
  return {
    period: periodDescription,
    totalReturn: parseFloat(base.totalReturn),
    alpha: parseFloat(base.alpha),
    sharpe: parseFloat(base.sharpe),
    maxDrawdown: parseFloat(base.maxDrawdown),
    span: base.period
  };
}

/** Renormalize pillar weights for factor diagnostics (dcf/valuation allowed 0). */
function normalizeFactorDiagWeights(raw) {
  const o = FACTOR_NAMES.reduce((acc, f) => {
    acc[f] = raw && typeof raw[f] === 'number' && Number.isFinite(raw[f]) ? raw[f] : 0;
    return acc;
  }, {});
  const s = FACTOR_NAMES.reduce((a, f) => a + o[f], 0);
  if (s > 0) for (const f of FACTOR_NAMES) o[f] = o[f] / s;
  return o;
}

/** Performance of the universe equal-weight leg (benchmark series) as if it were the portfolio. */
function extractBenchmarkLegPerformance(dailyValues, capital) {
  if (!dailyValues || dailyValues.length < 2) return null;
  const dv = dailyValues.map((d) => ({ ...d, portfolio: d.benchmark }));
  return extractDiagnosticPerformance({ dailyValues: dv, tradeLog: [] }, capital);
}

function summarizeFactorDiagnosticRun(name, weightsRaw, sim, capital, priceHistory, rebalanceDates, fundamentals) {
  const weights = normalizeFactorDiagWeights(weightsRaw);
  const perf = extractDiagnosticPerformance(sim, capital);
  const sells = (sim.tradeLog || []).filter((t) => t.type === 'SELL' || t.type === 'STOP');
  let avgIC = null;
  try {
    const attr = computeFactorAttribution(
      sim.factorSnapshots,
      priceHistory,
      rebalanceDates,
      sells,
      fundamentals,
      weights
    );
    if (attr && attr.avgIC) {
      avgIC = {};
      for (const f of FACTOR_NAMES) {
        const v = attr.avgIC[f];
        avgIC[f] = v != null && Number.isFinite(v) ? parseFloat(v.toFixed(4)) : 0;
      }
    }
  } catch {
    avgIC = null;
  }
  return {
    name,
    weights,
    totalReturn: parseFloat(perf.totalReturn),
    annualizedReturn: parseFloat(perf.annualizedReturn),
    alpha: parseFloat(perf.alpha),
    sharpe: parseFloat(perf.sharpe),
    maxDrawdown: parseFloat(perf.maxDrawdown),
    winRate: parseFloat(perf.winRate),
    numTrades: sim.tradeLog?.length ?? 0,
    ...(avgIC ? { avgIC } : {})
  };
}

function factorDiagnosticSubperiodTriple(sim, capital) {
  const perf = extractDiagnosticPerformance(sim, capital);
  if (!perf) return { totalReturn: 0, alpha: 0, sharpe: 0, maxDrawdown: 0 };
  return {
    totalReturn: parseFloat(perf.totalReturn),
    alpha: parseFloat(perf.alpha),
    sharpe: parseFloat(perf.sharpe),
    maxDrawdown: parseFloat(perf.maxDrawdown)
  };
}

/** Count windows with alpha > 0 among 1y / 2y / 3y. */
function factorDiagnosticConsistency(subperiods) {
  if (!subperiods) return undefined;
  let positive = 0;
  for (const k of ['1y', '2y', '3y']) {
    const a = subperiods[k]?.alpha;
    if (a != null && Number.isFinite(a) && a > 0) positive++;
  }
  if (positive === 3) return 'stable';
  if (positive === 2) return 'mixed';
  return 'unstable';
}

/** Compare trailing 1y alpha to full 3y alpha (percentage points). */
function factorDiagnosticRecentStrength(subperiods) {
  const a1 = subperiods?.['1y']?.alpha;
  const a3 = subperiods?.['3y']?.alpha;
  if (a1 == null || a3 == null || !Number.isFinite(a1) || !Number.isFinite(a3)) return null;
  if (a1 > a3) return 'strengthening';
  if (a1 < a3 - 2) return 'decaying';
  return 'steady';
}

function buildFactorDiagnosticRecommendation(configs) {
  const byName = (n) => configs.find((c) => c.name === n);
  const singles = ['Momentum only', 'Value only', 'Quality only', 'Earnings only'].map(byName).filter(Boolean);
  const combos = [
    'Equal M/V/Q',
    'Current best',
    'M30/V30/Q15/E25',
    'M30/V30/E40',
    'M35/V25/Q15/E25'
  ]
    .map(byName)
    .filter(Boolean);
  const bestSharpe = (arr) => {
    if (!arr.length) return null;
    return arr.reduce((a, b) => (b.sharpe > a.sharpe ? b : a));
  };
  const bs = bestSharpe(singles);
  const bc = bestSharpe(combos);
  const sPart = bs ? `${bs.name} (Sharpe ${bs.sharpe})` : 'n/a';
  const cPart = bc ? `${bc.name} (Sharpe ${bc.sharpe})` : 'n/a';
  return `Best single factor: ${sPart}. Best combo: ${cPart}.`;
}

/**
 * GET /api/diagnostics/factors/:universeId
 * Sequential pillar-only and blend full_composite runs (no RL, no ML rank adjustments).
 * Query `subperiods=true`: each config runs three backtests (1y, 2y, 3y) only; response adds
 * `subperiods`, `consistency` (stable | mixed | unstable), and `recentStrength` (strengthening | steady | decaying).
 */
app.get('/api/diagnostics/factors/:universeId', async (req, res) => {
  const { universeId } = req.params;
  const subperiodsMode =
    req.query.subperiods === 'true' ||
    req.query.subperiods === true ||
    String(req.query.subperiods || '').toLowerCase() === 'true';
  const diagTimeoutMs = subperiodsMode ? 3600000 : 600000;
  req.setTimeout(diagTimeoutMs);
  res.setTimeout(diagTimeoutMs);
  const period = String(req.query.period || '3y').trim();
  const rebalanceFreqRaw = String(req.query.rebalanceFreq || 'bimonthly').toLowerCase().trim();
  const allowedFreq = ['monthly', 'bimonthly', 'quarterly', 'weekly', 'biweekly'];
  const rebalanceFreq = allowedFreq.includes(rebalanceFreqRaw) ? rebalanceFreqRaw : 'bimonthly';
  const topN = Math.max(1, parseInt(String(req.query.topN || '15'), 10) || 15);
  const capital = parseFloat(String(req.query.initialCapital || '10000')) || 10000;

  const universe = UNIVERSE_TICKERS[universeId];
  if (!universe) {
    return res.status(400).json({ success: false, error: 'Unknown universe' });
  }

  const factorsCacheKey = `diag/factors:${apiCacheUrlKey(req)}`;
  if (!skipApiResponseCacheRead(req)) {
    const hit = getApiResponseCache(factorsCacheKey, API_CACHE_TTL_10M);
    if (hit) return res.json({ ...hit, cached: true });
  }

  const periodDays = { '1y': 365, '2y': 730, '3y': 1095, '5y': 1825, '7y': 2555 };
  const mainDays = periodDays[period] || 1095;
  const chartSpanDays = subperiodsMode ? Math.max(mainDays, periodDays['3y']) : mainDays;
  const endDate = new Date();
  const mainSimStart = new Date(endDate.getTime() - mainDays * 24 * 60 * 60 * 1000);
  const chartRangeStart = new Date(endDate.getTime() - chartSpanDays * 24 * 60 * 60 * 1000);
  const lookbackStart = new Date(chartRangeStart.getTime() - 400 * 24 * 60 * 60 * 1000);
  const startDateStr = lookbackStart.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  const backtestStartDate = mainSimStart.toISOString().split('T')[0];

  const pillarRuns = [
    {
      name: 'Momentum only',
      weights: { momentum: 1, value: 0, fundamental: 0, dcf: 0, valuation: 0 }
    },
    {
      name: 'Value only',
      weights: { momentum: 0, value: 1, fundamental: 0, dcf: 0, valuation: 0 }
    },
    {
      name: 'Quality only',
      weights: { momentum: 0, value: 0, fundamental: 1, dcf: 0, valuation: 0 }
    },
    {
      name: 'Equal M/V/Q',
      weights: { momentum: 0.33, value: 0.33, fundamental: 0.34, dcf: 0, valuation: 0 }
    },
    {
      name: 'Current best',
      weights: { ...DEFAULT_COMPOSITE_WEIGHTS }
    },
    {
      name: 'Earnings only',
      weights: { earningsMomentum: 1, momentum: 0, value: 0, fundamental: 0, dcf: 0, valuation: 0 }
    },
    {
      name: 'M30/V30/Q15/E25',
      weights: { momentum: 0.3, value: 0.3, fundamental: 0.15, earningsMomentum: 0.25, dcf: 0, valuation: 0 }
    },
    {
      name: 'M30/V30/E40',
      weights: { momentum: 0.3, value: 0.3, earningsMomentum: 0.4, fundamental: 0, dcf: 0, valuation: 0 }
    },
    {
      name: 'M35/V25/Q15/E25',
      weights: { momentum: 0.35, value: 0.25, fundamental: 0.15, earningsMomentum: 0.25, dcf: 0, valuation: 0 }
    }
  ];

  const simOptionsBase = {
    adaptiveMode: 'fixed',
    positionSizing: 'invVol',
    regimeEnabled: true,
    rlAgent: false,
    rlMode: 'off',
    skipMlRankingAdjustments: true
  };

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
    const start3yIso = new Date(endDate.getTime() - periodDays['3y'] * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const fredKey = process.env.FRED_API_KEY;
    const cpiObsStart = subperiodsMode ? subtractMonths(start3yIso, 60) : subtractMonths(simStart, 60);
    const cpiObservations = await fetchFredCpiObservations(cpiObsStart, simEnd, fredKey);
    const { multiplierFn: cashInflationMult } = buildCashInflationMultiplierFn(
      cpiObservations,
      simStart,
      INFLATION_BASELINE_ANNUAL
    );

    const configs = [];
    let lastSim = null;
    for (let ci = 0; ci < pillarRuns.length; ci++) {
      const def = pillarRuns[ci];
      if (subperiodsMode) {
        const subperiods = {};
        let sim3y = null;
        let rebalanceDates3y = null;
        for (const lbl of ['1y', '2y', '3y']) {
          console.log(`Subperiod check: config ${ci + 1}/${pillarRuns.length}, period ${lbl}...`);
          const d = periodDays[lbl];
          const subStart = new Date(endDate.getTime() - d * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          const rd = getRebalanceDates(subStart, endDateStr, rebalanceFreq);
          if (rd.length < 2) {
            subperiods[lbl] = { totalReturn: 0, alpha: 0, sharpe: 0, maxDrawdown: 0 };
            continue;
          }
          const subSimStart = rd[0];
          const { multiplierFn: cashInflSub } = buildCashInflationMultiplierFn(
            cpiObservations,
            subSimStart,
            INFLATION_BASELINE_ANNUAL
          );
          const subSim = await runBacktestSimulation(
            universe,
            priceHistory,
            fundamentals,
            spyPrices,
            rd,
            topN,
            capital,
            'full_composite',
            def.weights,
            cashInflSub,
            universeId,
            { ...simOptionsBase }
          );
          if (lbl === '3y') {
            sim3y = subSim;
            rebalanceDates3y = rd;
          }
          subperiods[lbl] = factorDiagnosticSubperiodTriple(subSim, capital);
        }
        lastSim = sim3y;
        if (sim3y && rebalanceDates3y) {
          const row = summarizeFactorDiagnosticRun(
            def.name,
            def.weights,
            sim3y,
            capital,
            priceHistory,
            rebalanceDates3y,
            fundamentals
          );
          configs.push({
            ...row,
            subperiods,
            consistency: factorDiagnosticConsistency(subperiods),
            recentStrength: factorDiagnosticRecentStrength(subperiods)
          });
        } else {
          configs.push({
            name: def.name,
            weights: normalizeFactorDiagWeights(def.weights),
            totalReturn: 0,
            annualizedReturn: 0,
            alpha: 0,
            sharpe: 0,
            maxDrawdown: 0,
            winRate: 0,
            numTrades: 0,
            error: 'Insufficient rebalance dates for 3y window',
            subperiods,
            consistency: factorDiagnosticConsistency(subperiods),
            recentStrength: factorDiagnosticRecentStrength(subperiods)
          });
        }
      } else {
        const sim = await runBacktestSimulation(
          universe,
          priceHistory,
          fundamentals,
          spyPrices,
          rebalanceDates,
          topN,
          capital,
          'full_composite',
          def.weights,
          cashInflationMult,
          universeId,
          { ...simOptionsBase }
        );
        lastSim = sim;
        configs.push(summarizeFactorDiagnosticRun(def.name, def.weights, sim, capital, priceHistory, rebalanceDates, fundamentals));
      }
    }

    if (lastSim?.dailyValues) {
      const benchPerf = extractBenchmarkLegPerformance(lastSim.dailyValues, capital);
      if (benchPerf) {
        configs.push({
          name: 'Universe equal-weight benchmark',
          weights: null,
          totalReturn: parseFloat(benchPerf.totalReturn),
          annualizedReturn: parseFloat(benchPerf.annualizedReturn),
          alpha: parseFloat(benchPerf.alpha),
          sharpe: parseFloat(benchPerf.sharpe),
          maxDrawdown: parseFloat(benchPerf.maxDrawdown),
          winRate: parseFloat(benchPerf.winRate),
          numTrades: 0,
          note: 'Buy-and-hold equal-weight universe leg (same benchmark series as each run); not a separate simulation.'
        });
      }
    }

    const recommendation = buildFactorDiagnosticRecommendation(configs);

    const factorsPayload = {
      success: true,
      universe: universeId,
      period,
      rebalanceFreq,
      topN,
      initialCapital: capital,
      ...(subperiodsMode ? { subperiods: true } : {}),
      configs,
      recommendation
    };
    setApiResponseCache(factorsCacheKey, factorsPayload);
    res.json(factorsPayload);
  } catch (error) {
    console.error('[diagnostics/factors]', error);
    res.status(500).json({ success: false, error: error.message || String(error) });
  } finally {
    clearBacktestRuntimeCaches();
  }
});

/** M40 / V40 / Q20 — locked to server default composite (diagnostic baseline). */
const UNIVERSE_COMPARE_WEIGHTS = { ...DEFAULT_COMPOSITE_WEIGHTS };

/**
 * GET /api/diagnostics/universe-compare
 * Sequential 3y bimonthly full_composite runs: sp500_top50 vs sp500_top150 (M40/V40/Q20, no RL).
 */
app.get('/api/diagnostics/universe-compare', async (req, res) => {
  const uniCompareKey = `diag/universe-compare:${apiCacheUrlKey(req)}`;
  if (!skipApiResponseCacheRead(req)) {
    const hit = getApiResponseCache(uniCompareKey, API_CACHE_TTL_10M);
    if (hit) return res.json({ ...hit, cached: true });
  }
  req.setTimeout(1200000);
  res.setTimeout(1200000);
  const period = '3y';
  const rebalanceFreq = 'bimonthly';
  const topN = 15;
  const capital = 10000;
  const periodDays = { '1y': 365, '2y': 730, '3y': 1095, '5y': 1825, '7y': 2555 };
  const days = periodDays[period] || 1095;
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
  const lookbackStart = new Date(startDate.getTime() - 400 * 24 * 60 * 60 * 1000);
  const startDateStr = lookbackStart.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  const backtestStartDate = startDate.toISOString().split('T')[0];

  const simOpts = {
    adaptiveMode: 'fixed',
    positionSizing: 'invVol',
    regimeEnabled: true,
    rlAgent: false,
    rlMode: 'off',
    skipMlRankingAdjustments: true
  };

  // Pre-fetch all unique tickers once (top50 is a subset of top150)
  const allTickers = [...new Set([
    ...(UNIVERSE_TICKERS['sp500_top50'] || []),
    ...(UNIVERSE_TICKERS['sp500_top150'] || []),
    'SPY'
  ])].filter((t) => t && t.trim() !== '');

  const sharedPriceHistory = {};
  const sharedFundamentals = {};
  const [priceRows, fundRows] = await Promise.all([
    mapWithConcurrency(allTickers, YAHOO_CHART_CONCURRENCY, async (ticker) => {
      const data = await bt_fetchPriceHistory(ticker, startDateStr, endDateStr);
      return { ticker, data };
    }),
    mapWithConcurrency(allTickers.filter((t) => t !== 'SPY'), FUNDAMENTALS_FETCH_CONCURRENCY, async (ticker) => {
      const fund = await fetchFundamentals(ticker);
      return { ticker, fund };
    })
  ]);
  for (const row of priceRows) {
    if (row?.data && !row.__error) sharedPriceHistory[row.ticker] = row.data;
  }
  for (const row of fundRows) {
    if (row?.fund && !row.__error) sharedFundamentals[row.ticker] = row.fund;
  }

  async function runOne(universeId) {
    const universe = UNIVERSE_TICKERS[universeId];
    if (!universe) throw new Error(`Unknown universe: ${universeId}`);
    const priceHistory = sharedPriceHistory;
    const fundamentals = sharedFundamentals;
    const rebalanceDates = getRebalanceDates(backtestStartDate, endDateStr, rebalanceFreq);
    if (rebalanceDates.length < 2) throw new Error('Insufficient rebalance dates');
    const spyPrices = priceHistory['SPY'];
    if (!spyPrices?.length) throw new Error('Could not fetch SPY benchmark data');
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
    const sim = await runBacktestSimulation(
      universe,
      priceHistory,
      fundamentals,
      spyPrices,
      rebalanceDates,
      topN,
      capital,
      'full_composite',
      { ...UNIVERSE_COMPARE_WEIGHTS },
      cashInflationMult,
      universeId,
      { ...simOpts }
    );
    const perf = extractDiagnosticPerformance(sim, capital);
    const risk = computeStrategyRiskMetrics(sim.dailyValues, sim.tradeLog, rebalanceDates, topN);
    const tickerLabel = universeId === 'sp500_top50' ? 50 : universeId === 'sp500_top150' ? 150 : universe.filter((t) => t && t !== 'SPY').length;
    return {
      universe: universeId,
      tickers: tickerLabel,
      totalReturn: parseFloat(perf.totalReturn),
      alpha: parseFloat(perf.alpha),
      sharpe: parseFloat(perf.sharpe),
      maxDrawdown: parseFloat(perf.maxDrawdown),
      avgTurnover: risk != null && Number.isFinite(risk.turnoverPct) ? risk.turnoverPct : null
    };
  }

  try {
    clearBacktestRuntimeCaches();
    const [row50, row150] = await Promise.all([runOne('sp500_top50'), runOne('sp500_top150')]);
    const uniComparePayload = {
      success: true,
      comparison: [row50, row150],
      improvement: {
        returnDelta: row150.totalReturn - row50.totalReturn,
        alphaDelta: row150.alpha - row50.alpha,
        sharpeDelta: row150.sharpe - row50.sharpe
      }
    };
    setApiResponseCache(uniCompareKey, uniComparePayload);
    res.json(uniComparePayload);
  } catch (error) {
    console.error('[diagnostics/universe-compare]', error);
    res.status(500).json({ success: false, error: error.message || String(error) });
  } finally {
    clearBacktestRuntimeCaches();
  }
});

/**
 * GET /api/diagnostics/hedge-impact
 * Four sequential full_composite backtests (same data): Rules vs RL × hedge off/on.
 * RL rows use rlMode=eval with the active agent type (Q-learning per universe or DQN).
 */
app.get('/api/diagnostics/hedge-impact', async (req, res) => {
  req.setTimeout(1800000);
  res.setTimeout(1800000);

  const universeId =
    req.query.universeId != null && String(req.query.universeId).trim() !== ''
      ? String(req.query.universeId).trim()
      : 'sp500_top150';
  const period =
    req.query.period != null && String(req.query.period).trim() !== ''
      ? String(req.query.period).trim()
      : '3y';

  const periodDays = { '1y': 365, '2y': 730, '3y': 1095, '5y': 1825, '7y': 2555 };
  const days = periodDays[period];
  if (days == null) {
    return res.status(400).json({ success: false, error: `Unsupported period: ${period}` });
  }

  const hedgeImpactKey = `diag/hedge-impact:${apiCacheUrlKey(req)}`;
  if (!skipApiResponseCacheRead(req)) {
    const hit = getApiResponseCache(hedgeImpactKey, API_CACHE_TTL_10M);
    if (hit) return res.json({ ...hit, cached: true });
  }

  const rebalanceFreq = 'bimonthly';
  const topN = 15;
  const capital = 10000;
  const strategyClean = 'full_composite';
  const tradingWeights = { ...DEFAULT_COMPOSITE_WEIGHTS };

  const simBaseOpts = {
    adaptiveMode: 'fixed',
    positionSizing: 'invVol',
    regimeEnabled: true,
    skipMlRankingAdjustments: true,
    correlationFilter: false
  };

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
  const lookbackStart = new Date(startDate.getTime() - 400 * 24 * 60 * 60 * 1000);
  const startDateStr = lookbackStart.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  const backtestStartDate = startDate.toISOString().split('T')[0];

  try {
    clearBacktestRuntimeCaches();
    const universe = UNIVERSE_TICKERS[universeId];
    if (!universe) {
      return res.status(400).json({ success: false, error: `Unknown universe: ${universeId}` });
    }

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
    if (!spyPrices?.length) {
      return res.status(500).json({ success: false, error: 'Could not fetch SPY benchmark data' });
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

    const preloadedEarningsMap = await fetchAllEarnings(universe);

    const runSim = (extra) =>
      runBacktestSimulation(
        universe,
        priceHistory,
        fundamentals,
        spyPrices,
        rebalanceDates,
        topN,
        capital,
        strategyClean,
        { ...tradingWeights },
        cashInflationMult,
        universeId,
        { ...simBaseOpts, preloadedEarningsMap, ...extra }
      );

    const sim1 = await runSim({ rlAgent: false, rlMode: 'off', rlRandomAgent: false, hedging: false });
    const sim2 = await runSim({ rlAgent: true, rlMode: 'eval', rlRandomAgent: false, hedging: false });
    const sim3 = await runSim({ rlAgent: false, rlMode: 'off', rlRandomAgent: false, hedging: true });
    const sim4 = await runSim({ rlAgent: true, rlMode: 'eval', rlRandomAgent: false, hedging: true });

    const rlDiagLabel = rlAgentTypeEffective() === 'dqn' ? 'DQN' : 'Q-learning';
    const configs = [
      buildHedgeImpactConfigRow('Rules only', false, false, sim1, capital),
      buildHedgeImpactConfigRow(`${rlDiagLabel} only`, false, true, sim2, capital),
      buildHedgeImpactConfigRow('Rules + Hedge', true, false, sim3, capital),
      buildHedgeImpactConfigRow(`${rlDiagLabel} + Hedge`, true, true, sim4, capital)
    ];

    const hedgeImpactPayload = {
      success: true,
      universeId,
      period,
      rlAgentKind: rlAgentTypeEffective(),
      configs
    };
    setApiResponseCache(hedgeImpactKey, hedgeImpactPayload);
    res.json(hedgeImpactPayload);
  } catch (error) {
    console.error('[diagnostics/hedge-impact]', error);
    res.status(500).json({ success: false, error: error.message || String(error) });
  } finally {
    clearBacktestRuntimeCaches();
  }
});

/**
 * GET /api/diagnostics/equity-curves/:universeId
 * Normalized daily equity (start=100): benchmark, rules, rules+hedge, RL eval (Q-learning or DQN when trained).
 * Cached 5 minutes per URL (universe + query); `fresh` or `_t` bypasses read.
 */
app.get('/api/diagnostics/equity-curves/:universeId', async (req, res) => {
  req.setTimeout(1800000);
  res.setTimeout(1800000);

  const universeId = String(req.params.universeId || '').trim();
  const period =
    req.query.period != null && String(req.query.period).trim() !== ''
      ? String(req.query.period).trim()
      : '3y';

  const periodDays = { '1y': 365, '2y': 730, '3y': 1095, '5y': 1825, '7y': 2555 };
  const days = periodDays[period];
  if (days == null) {
    return res.status(400).json({ success: false, error: `Unsupported period: ${period}` });
  }

  const equityCurvesKey = `equity-curves:${apiCacheUrlKey(req)}`;
  const skipEquityDiagCache =
    req.query.fresh === 'true' ||
    req.query.fresh === '1' ||
    skipApiResponseCacheRead(req);
  if (!skipEquityDiagCache) {
    const hit = getApiResponseCache(equityCurvesKey, API_CACHE_TTL_5M);
    if (hit) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.json({ ...hit, cached: true });
    }
  }

  const rebalanceFreq = 'bimonthly';
  const topN = 15;
  const capital = 10000;
  const strategyClean = 'full_composite';
  const tradingWeights = { ...DEFAULT_COMPOSITE_WEIGHTS };

  const simBaseOpts = {
    adaptiveMode: 'fixed',
    positionSizing: 'invVol',
    regimeEnabled: true,
    skipMlRankingAdjustments: true,
    correlationFilter: false
  };

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
  const lookbackStart = new Date(startDate.getTime() - 400 * 24 * 60 * 60 * 1000);
  const startDateStr = lookbackStart.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  const backtestStartDate = startDate.toISOString().split('T')[0];

  const emptySumm = { totalReturn: null, sharpe: null, maxDrawdown: null };

  try {
    const universe = UNIVERSE_TICKERS[universeId];
    if (!universe) {
      return res.status(400).json({ success: false, error: `Unknown universe: ${universeId}` });
    }

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
    if (!spyPrices?.length) {
      return res.status(500).json({ success: false, error: 'Could not fetch SPY benchmark data' });
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

    const preloadedEarningsMap = await fetchAllEarnings(universe);

    const runSim = (extra) =>
      runBacktestSimulation(
        universe,
        priceHistory,
        fundamentals,
        spyPrices,
        rebalanceDates,
        topN,
        capital,
        strategyClean,
        { ...tradingWeights },
        cashInflationMult,
        universeId,
        { ...simBaseOpts, preloadedEarningsMap, ...extra }
      );

    const simRules = await runSim({ rlAgent: false, rlMode: 'off', rlRandomAgent: false, hedging: false });
    const simRulesHedge = await runSim({ rlAgent: false, rlMode: 'off', rlRandomAgent: false, hedging: true });

    let simRlEval = null;
    if (trainedRlForEquityCurvesDiagnostics(universeId)) {
      const rlAgentForCurve =
        rlAgentTypeEffective() === 'dqn'
          ? TRAINED_RL_AGENT ?? loadRlAgentFromDisk('dqn')
          : getQlAgentForUniverse(universeId) ?? loadRlAgentFromDisk(undefined, universeId);
      simRlEval = await runSim({
        rlAgent: true,
        rlMode: 'eval',
        rlRandomAgent: false,
        hedging: false,
        rlQLearningAgent: rlAgentForCurve
      });
    }

    const dvRules = simRules.dailyValues;
    const payload = {
      universeId,
      period,
      rlAgentKind: rlAgentTypeEffective(),
      curves: {
        benchmark: buildNormalizedEquityPoints(dvRules, capital, 'benchmark'),
        rulesOnly: buildNormalizedEquityPoints(dvRules, capital, 'portfolio'),
        rulesHedged: buildNormalizedEquityPoints(simRulesHedge.dailyValues, capital, 'portfolio'),
        rlEval:
          simRlEval?.dailyValues?.length > 0
            ? buildNormalizedEquityPoints(simRlEval.dailyValues, capital, 'portfolio')
            : [],
        dqnHedged: []
      },
      summary: {
        benchmark: summarizeBenchmarkLegFromSim(simRules, capital),
        rulesOnly: summarizeEquityCurvePerf(simRules, capital),
        rulesHedged: summarizeEquityCurvePerf(simRulesHedge, capital),
        rlEval: simRlEval ? summarizeEquityCurvePerf(simRlEval, capital) : { ...emptySumm },
        dqnHedged: { ...emptySumm }
      }
    };

    setApiResponseCache(equityCurvesKey, payload);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(payload);
  } catch (error) {
    console.error('[diagnostics/equity-curves]', error);
    res.status(500).json({ success: false, error: error.message || String(error) });
  } finally {
    clearBacktestRuntimeCaches();
  }
});

/**
 * GET /api/diagnostics/earnings/:ticker
 * Returns parsed earnings history + epsTrend (or null if Yahoo has no trend data).
 */
app.get('/api/diagnostics/earnings/:ticker', async (req, res) => {
  const { ticker } = req.params;
  try {
    const data = await fetchEarningsHistory(ticker);
    res.json(data);
  } catch (error) {
    console.error('[diagnostics/earnings]', error);
    res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

app.get('/api/backtest/:universeId', async (req, res) => {
  req.setTimeout(300000);
  res.setTimeout(300000);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  const { universeId } = req.params;
  const {
    period = '3y',
    rebalanceFreq: rebalanceFreqRaw = 'monthly',
    topN = 10,
    strategy = 'momentum_value',
    initialCapital = 10000,
    optimize = 'false',
    adaptiveMode: adaptiveModeRaw = 'adaptive',
    positionSizing: positionSizingRaw,
    pillarOverride: pillarOverrideQuery,
    regimeEnabled: regimeEnabledQuery,
    usePaperWeights: usePaperWeightsQuery,
    mlRanking: mlRankingQuery,
    rlAgent: rlAgentQueryRaw,
    rlMode: rlModeQueryRaw,
    rlRandomAgent: rlRandomQueryRaw,
    correlationFilter: correlationFilterQuery,
    maxCorrelated: maxCorrelatedQuery,
    correlationLookbackDays: correlationLookbackDaysQuery
  } = req.query;

  const rebalanceFreq = String(rebalanceFreqRaw || 'monthly').toLowerCase().trim();
  const allowedFreq = ['monthly', 'quarterly', 'weekly', 'biweekly', 'bimonthly'];
  if (!allowedFreq.includes(rebalanceFreq)) {
    return res.status(400).json({ success: false, error: `Invalid rebalanceFreq (use ${allowedFreq.join(', ')})` });
  }

  const backtestApiCacheKey = `backtest:${apiCacheUrlKey(req)}`;
  if (!skipApiResponseCacheRead(req)) {
    const apiHit = getApiResponseCache(backtestApiCacheKey, API_CACHE_TTL_5M);
    if (apiHit) return res.json({ ...apiHit, cached: true });
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

  const trainedRlAvailable =
    rlAgentTypeEffective() === 'dqn' ? TRAINED_RL_AGENT != null : getQlAgentForUniverse(universeId) != null;
  const rlExplicitOff =
    rlAgentQueryRaw === 'false' || rlAgentQueryRaw === '0' || rlAgentQueryRaw === false;
  const rlExplicitOn =
    rlAgentQueryRaw === 'true' || rlAgentQueryRaw === true || rlAgentQueryRaw === '1';
  /** Default: rules-only unless RL_ENABLED=true; explicit rlAgent=true still uses agent if loaded. */
  const rlAgentBacktest = rlExplicitOff
    ? false
    : rlExplicitOn
      ? trainedRlAvailable
      : trainedRlAvailable && rlEvalEnvEnabled();
  const rlRandomAgentBacktest =
    rlRandomQueryRaw === 'true' || rlRandomQueryRaw === true || rlRandomQueryRaw === '1';
  const rlModeBacktestRaw =
    rlModeQueryRaw != null && String(rlModeQueryRaw).trim() !== ''
      ? String(rlModeQueryRaw).toLowerCase().trim()
      : 'eval';
  const rlModeBacktest = rlModeBacktestRaw === 'train' ? 'train' : 'eval';

  const correlationFilterBacktest =
    correlationFilterQuery === 'true' ||
    correlationFilterQuery === true ||
    correlationFilterQuery === '1' ||
    correlationFilterQuery === 1;
  const maxCorrelatedBacktestRaw = parseInt(String(maxCorrelatedQuery ?? ''), 10);
  const maxCorrelatedBacktest = Number.isFinite(maxCorrelatedBacktestRaw)
    ? Math.max(1, maxCorrelatedBacktestRaw)
    : 3;
  const correlationLbRaw = parseInt(String(correlationLookbackDaysQuery ?? ''), 10);
  const correlationLookbackBacktest = Number.isFinite(correlationLbRaw) ? Math.max(20, correlationLbRaw) : 60;

  const hedgingQuery = req.query.hedging;
  const hedgingBacktest =
    hedgingQuery === 'true' || hedgingQuery === true || hedgingQuery === '1';

  let tradingWeights = null;
  if (strategyClean === 'full_composite') {
    if (usePaperWeights) {
      const portfolio = loadPaperPortfolioForUniverse(universeId);
      if (portfolio && portfolio.config && portfolio.config.strategy === 'full_composite' && portfolio.config.weights) {
        tradingWeights = portfolio.config.weights;
      }
    }
  } else if (strategyClean === 'full_composite_aggressive') {
    if (usePaperWeights) {
      const portfolio = loadPaperPortfolioForUniverse(universeId);
      if (portfolio && portfolio.config && portfolio.config.strategy === 'full_composite_aggressive' && portfolio.config.weights) {
        tradingWeights = portfolio.config.weights;
      }
    }
    if (!tradingWeights) tradingWeights = { ...AGGRESSIVE_COMPOSITE_WEIGHTS };
  } else if (strategyClean === 'full_composite_turbo') {
    if (usePaperWeights) {
      const portfolio = loadPaperPortfolioForUniverse(universeId);
      if (portfolio && portfolio.config && portfolio.config.strategy === 'full_composite_turbo' && portfolio.config.weights) {
        tradingWeights = portfolio.config.weights;
      }
    }
    if (!tradingWeights) tradingWeights = { ...TURBO_COMPOSITE_WEIGHTS };
  }

  // A/B pillar weights via query (full_composite family). Merges onto paper or strategy defaults.
  // Example: &wM=0.4&wV=0.4&wQ=0.2&wE=0
  if (
    strategyClean === 'full_composite' ||
    strategyClean === 'full_composite_aggressive' ||
    strategyClean === 'full_composite_turbo'
  ) {
    const weightOverride = {};
    const take = (q, key) => {
      if (q == null || q === '') return;
      const x = parseFloat(String(q));
      if (Number.isFinite(x)) weightOverride[key] = x;
    };
    take(req.query.wM, 'momentum');
    take(req.query.wV, 'value');
    take(req.query.wQ, 'fundamental');
    take(req.query.wE, 'earningsMomentum');
    take(req.query.wD, 'dcf');
    take(req.query.wVal, 'valuation');
    if (Object.keys(weightOverride).length > 0) {
      const baseDefaults =
        strategyClean === 'full_composite_aggressive'
          ? AGGRESSIVE_COMPOSITE_WEIGHTS
          : strategyClean === 'full_composite_turbo'
            ? TURBO_COMPOSITE_WEIGHTS
            : DEFAULT_COMPOSITE_WEIGHTS;
      const base =
        tradingWeights && typeof tradingWeights === 'object' ? { ...tradingWeights } : { ...baseDefaults };
      tradingWeights = { ...base, ...weightOverride };
    }
  }

  const weightsKey = tradingWeights ? JSON.stringify(tradingWeights) : 'default';
  const cpiCacheTag = process.env.FRED_API_KEY && String(process.env.FRED_API_KEY).trim() ? 'fred' : 'const';
  const simCfgTag = backtestSimConfigCacheTag({
    adaptiveMode,
    positionSizing,
    pitPolicy: needsFundamentals ? 'pit' : 'none',
    regimeEnabled,
    pillarOverrideKey,
    skipMlRankingAdjustments: skipMlRankingAdjustmentsForBacktest,
    correlationFilter: correlationFilterBacktest,
    maxCorrelated: maxCorrelatedBacktest,
    correlationLookbackDays: correlationLookbackBacktest,
    hedging: hedgingBacktest
  });

  const rlAgentForResponse = rlAgentTypeEffective() === 'dqn' ? TRAINED_RL_AGENT : getQlAgentForUniverse(universeId);

  const rlCacheTag = rlAgentBacktest
    ? `rl1-${rlAgentTypeEffective()}-${rlModeBacktest}-${rlRandomAgentBacktest ? 'rnd1' : 'rnd0'}-u${(rlAgentTypeEffective() === 'dqn' ? TRAINED_RL_AGENT : getQlAgentForUniverse(universeId))?.totalUpdates ?? 0}`
    : 'rl0';
  const rlEvalTag = rlEvalEnvEnabled() ? 'RLe1' : 'RLe0';
  const cacheKey = `${BACKTEST_CACHE_VERSION}-${universeId}-${period}-${rebalanceFreq}-${topN}-${strategyClean}-${capital}-${weightsKey}-${cpiCacheTag}-${simCfgTag}-${adaptiveMode}-${positionSizing}-${pillarOverrideKey}-${regimeEnabled ? 're1' : 're0'}-${usePaperWeights ? 'pw1' : 'pw0'}-${rlEvalTag}-${rlCacheTag}`;
  /**
   * In-memory result cache is opt-in (`useResultCache=1`) so the UI never shows stale KPIs if `fresh`
   * is dropped by a proxy. Pass `fresh` / `skipCache` to force a miss even when useResultCache is set.
   */
  const useBacktestResultCacheRead =
    req.query.useResultCache === '1' || req.query.useResultCache === 'true';
  const skipBacktestResultCache =
    !useBacktestResultCacheRead ||
    req.query.fresh === 'true' ||
    req.query.fresh === '1' ||
    req.query.skipCache === '1' ||
    req.query.nocache === '1';
  const cached = !skipBacktestResultCache ? BACKTEST_CACHE.get(cacheKey) : null;
  if (cached && Date.now() - cached.timestamp < BACKTEST_CACHE_TTL) {
    const rlOverlay =
      rlAgentBacktest && rlAgentForResponse
        ? {
            rlAgentStats: {
              statesVisited: rlAgentForResponse.statesVisited,
              totalUpdates: rlAgentForResponse.totalUpdates,
              qTableSize: rlAgentPolicyParamSize(rlAgentForResponse),
              isLoaded: true
            },
            rlStatesVisited: rlAgentForResponse.statesVisited,
            rlTotalUpdates: rlAgentForResponse.totalUpdates
          }
        : {};
    return res.json({
      success: true,
      ...cached.data,
      ...rlOverlay,
      cached: true,
      computedAt: cached.data.computedAt || new Date(cached.timestamp).toISOString(),
      mlRankingEnabled: enableMlOnBacktest
    });
  }
  
  const universe = UNIVERSE_TICKERS[universeId];
  if (!universe) {
    return res.status(400).json({ success: false, error: 'Unknown universe' });
  }

  const periodDays = { '1y': 365, '2y': 730, '3y': 1095, '5y': 1825, '7y': 2555 };
  const days = periodDays[period] || 1095;
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
  const lookbackStart = new Date(startDate.getTime() - 400 * 24 * 60 * 60 * 1000);
  const startDateStr = lookbackStart.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  const backtestStartDate = startDate.toISOString().split('T')[0];
  
  try {
    clearBacktestRuntimeCaches();
    resetBtChartFetchStats();
    const tickersToFetch = [...new Set([...universe, 'SPY'])].filter(t => t && t.trim() !== '');
    const priceHistory = {};
    let benchmarkDataWarning = null;

    const priceRows = await mapWithConcurrency(tickersToFetch, YAHOO_CHART_CONCURRENCY, async (ticker) => {
      const data = await bt_fetchPriceHistory(ticker, startDateStr, endDateStr);
      if (String(ticker).toUpperCase() === 'SPY' && bt_fetchPriceHistory.lastStaleWarning) {
        benchmarkDataWarning = bt_fetchPriceHistory.lastStaleWarning;
      }
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
        skipMlRankingAdjustments: skipMlRankingAdjustmentsForBacktest,
        rlAgent: rlAgentBacktest,
        rlMode: rlAgentBacktest ? rlModeBacktest : 'off',
        rlRandomAgent: rlRandomAgentBacktest,
        rlQLearningAgent:
          rlAgentBacktest && rlModeBacktest === 'eval'
            ? rlAgentTypeEffective() === 'dqn'
              ? TRAINED_RL_AGENT ?? loadRlAgentFromDisk('dqn')
              : getQlAgentForUniverse(universeId) ?? loadRlAgentFromDisk(undefined, universeId)
            : undefined,
        correlationFilter: correlationFilterBacktest,
        maxCorrelated: maxCorrelatedBacktest,
        correlationLookbackDays: correlationLookbackBacktest,
        hedging: hedgingBacktest
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
      nameSwapCount,
      rlLog,
      hedgeStats
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
      const portfolio = loadPaperPortfolioForUniverse(universeId);
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

    const portfolioForStatus = loadPaperPortfolioForUniverse(universeId);
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

    const regimeSplit = computeRegimeSplitPerformance(dailyValues, spyPrices, universe, priceHistory);
    const regimeDiversification = buildRegimeDiversification(regimeSplit);

    const regimeForStopDate = (d) => {
      let best = null;
      for (const r of regimeLog) {
        if (r.date <= d && (!best || r.date >= best.date)) best = r;
      }
      return best?.regime ?? null;
    };

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
      hedging: hedgingBacktest,
      benchmarkDataWarning: benchmarkDataWarning || undefined,
      rlEvalGloballyEnabled: rlEvalEnvEnabled(),
      rlAgent: rlAgentBacktest,
      rlEnabled: rlAgentBacktest,
      rlAgentLoaded: trainedRlAvailable,
      rlUniverse: universeId,
      rlAgentKind: rlAgentForResponse ? rlAgentTypeEffective() : null,
      rlTotalUpdates: rlAgentForResponse?.totalUpdates ?? 0,
      rlStatesVisited: rlAgentForResponse ? countRlStatesVisited(rlAgentForResponse) : 0,
      rlAgentStats:
        rlAgentBacktest && rlAgentForResponse
          ? {
              statesVisited: rlAgentForResponse.statesVisited,
              totalUpdates: rlAgentForResponse.totalUpdates,
              qTableSize: rlAgentPolicyParamSize(rlAgentForResponse),
              isLoaded: true
            }
          : undefined,
      rlMode: rlAgentBacktest ? rlModeBacktest : 'off',
      rlRandomAgent: rlRandomAgentBacktest,
      rlLog: rlAgentBacktest && Array.isArray(rlLog) ? rlLog : undefined,
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
        stopsDetail:
          stops.length > 0
            ? stops.slice(0, 20).map((s) => {
                const lossPct = Number(((s.holdingReturn || 0) * 100).toFixed(2));
                return {
                  date: s.date,
                  ticker: s.ticker,
                  return: `${lossPct >= 0 ? "+" : ""}${lossPct.toFixed(1)}%`,
                  lossPct,
                  daysHeld: s.holdingDays ?? null,
                  regimeAtExit: regimeForStopDate(s.date)
                };
              })
            : []
      },

      regimeSplit,
      regimeDiversification,

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
        rebuyWithin60d,
        hedging: {
          enabled: !!(hedgeStats && hedgeStats.enabled),
          totalOpened: hedgeStats?.totalOpened ?? 0,
          netImpact: hedgeStats?.netHedgeImpact ?? 0,
          costDrag: hedgeStats?.costDrag ?? 0,
          protectionGain: hedgeStats?.protectionGain ?? 0
        }
      },

      equityCurve: dailyValues,
      monthlyReturns: monthlyWithReturns,
      monthlyEventsSummary,
      trades: tradeLog,
      rebalances: rebalanceLog,
      rebalanceLog,
      currentHoldings,
      ...(adaptiveWeightLog && adaptiveWeightLog.length ? { adaptiveWeightLog } : {}),

      dataQuality: getDataQualitySnapshot({
        benchmarkStaleWarning: benchmarkDataWarning || null
      }),

      /** ISO time when this simulation finished (stored with cache entry for traceability). */
      computedAt: new Date().toISOString()
    };

    BACKTEST_CACHE.set(cacheKey, { data: responseData, timestamp: Date.now() });

    const backtestPayload = { success: true, ...responseData, cached: false };
    setApiResponseCache(backtestApiCacheKey, backtestPayload);
    res.json(backtestPayload);
    
  } catch (error) {
    console.error('Backtest error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    clearBacktestRuntimeCaches();
  }
});

// =====================================================================
// Q-learning RL agent — policy, training, baseline vs RL compare
// =====================================================================

/** Upper bound for POST /api/rl/train `episodes` (also caps `trainUntilThresholds` loops). */
const RL_TRAIN_MAX_EPISODES = 50000;
const RL_TRAIN_COVERAGE_TARGET_PCT = 30;
const RL_TRAIN_MIN_Q_UPDATES = 10000;

function rlOverfitFlagFromRatio(ratio) {
  if (ratio == null || !Number.isFinite(ratio)) return 'caution';
  if (ratio > 2.5) return 'overfit';
  if (ratio < 1.5) return 'healthy';
  return 'caution';
}

/** { totalReturn, alpha, sharpe } for sweep tables (percent points, same as extractRlTrainEvalBlock). */
function rlSweepPerfTriple(sim, capital) {
  const b = extractRlTrainEvalBlock(sim, capital, '');
  if (!b) return { totalReturn: null, alpha: null, sharpe: null };
  return { totalReturn: b.totalReturn, alpha: b.alpha, sharpe: b.sharpe };
}

/** ε used for a completed training episode (tabular: linear schedule; DQN: episode schedule). */
function rlTrainEpsilonAtEpisode(agent, episodeOneBased) {
  if (!agent || episodeOneBased == null || !Number.isFinite(Number(episodeOneBased))) return null;
  const ep = Math.max(1, Number(episodeOneBased));
  if (typeof agent.getEpsilonForTrainingEpisode === 'function') {
    return agent.getEpsilonForTrainingEpisode(ep);
  }
  if (typeof agent.getEpsilonForEpisode === 'function') {
    return agent.getEpsilonForEpisode(ep);
  }
  return null;
}

/**
 * RL training episode loop (Q-learning or DQN). Caller applies agent hyperparams before calling.
 * @returns {{ episodesRun: number, episodeLog: Array|null, episodeRlRewards: number[], trainingStopReason: string, loopElapsedMs: number, convergenceDiagnostics: object }}
 */
async function rlRunTrainEpisodesCore({
  agent,
  universe,
  priceHistory,
  fundamentals,
  spyPrices,
  trainRebalancePool,
  topN,
  capital,
  strategyClean,
  tradingWeightsTrain,
  cashInflationMult,
  universeId,
  sharedTrainSimOptions,
  userEpisodes,
  trainUntilThresholds,
  rlRandomAgent,
  targetUpdateFreqEpisodes,
  collectEpisodeLog,
  dqnProgressLogEvery,
  checkpointEvery,
  savedBeta,
  logTag
}) {
  const tag = logTag || '[RL/train]';
  const maxLen0 = trainRebalancePool.length;
  let minWindow = Math.min(24, Math.max(10, Math.floor(maxLen0 * 0.35)));
  if (minWindow > maxLen0) {
    minWindow = Math.max(2, Math.floor(maxLen0 * 0.65));
    if (minWindow > maxLen0) minWindow = maxLen0;
  }
  const episodeLog = collectEpisodeLog ? [] : null;
  const episodeRlRewards = [];
  let trainingStopReason = trainUntilThresholds ? 'max_episodes' : 'episodes_completed';
  const trainEpisodeLoopStart = performance.now();

  const qSpreadHistory = [];
  let epsilonThresholdEpisode = null;
  let policyConvergenceEpisode = null;
  const CONVERGENCE_WINDOW = 3;
  const POLICY_STABILITY_THRESHOLD = 0.005;
  let stableCheckpointCount = 0;
  let lastPolicy = null;

  const skipEarnTrain =
    sharedTrainSimOptions?.rlTrainSkipEarningsFetch === true ||
    sharedTrainSimOptions?.rlTrainSkipEarningsFetch === 'true' ||
    sharedTrainSimOptions?.rlTrainSkipEarningsFetch === 1 ||
    String(sharedTrainSimOptions?.rlTrainSkipEarningsFetch || '').toLowerCase() === 'true';
  let preloadedEarningsMapForTrain = null;
  if (
    !skipEarnTrain &&
    (strategyClean === 'full_composite' ||
      strategyClean === 'full_composite_aggressive' ||
      strategyClean === 'full_composite_turbo')
  ) {
    preloadedEarningsMapForTrain = await fetchAllEarnings(universe);
  }

  if (savedBeta != null) agent.beta = savedBeta * 0.1;
  try {
    let epCount = 0;
    while (true) {
      if (!trainUntilThresholds && epCount >= userEpisodes) break;
      if (trainUntilThresholds && epCount >= RL_TRAIN_MAX_EPISODES) {
        trainingStopReason = 'max_episodes';
        break;
      }

      agent.currentTrainingEpisode = epCount + 1;

      const maxLen = trainRebalancePool.length;
      const len = minWindow + Math.floor(Math.random() * (maxLen - minWindow + 1));
      const startIx = Math.floor(Math.random() * (maxLen - len + 1));
      const windowDates = trainRebalancePool.slice(startIx, startIx + len);
      const updatesBefore = agent.totalUpdates;

      const sim = await runBacktestSimulation(
        universe,
        priceHistory,
        fundamentals,
        spyPrices,
        windowDates,
        topN,
        capital,
        strategyClean,
        tradingWeightsTrain,
        cashInflationMult,
        universeId,
        {
          ...sharedTrainSimOptions,
          ...(preloadedEarningsMapForTrain ? { preloadedEarningsMap: preloadedEarningsMapForTrain } : {}),
          rlAgent: true,
          rlMode: 'train',
          rlQLearningAgent: agent,
          rlRandomAgent: rlRandomAgent === true
        }
      );

      epCount++;
      const epsForCompletedEp = rlTrainEpsilonAtEpisode(agent, epCount);
      if (
        epsilonThresholdEpisode === null &&
        epsForCompletedEp != null &&
        Number.isFinite(epsForCompletedEp) &&
        epsForCompletedEp < 0.01
      ) {
        epsilonThresholdEpisode = epCount;
      }
      const du = agent.totalUpdates - updatesBefore;
      let epRlRewardSum = 0;
      for (const row of sim.rlLog || []) {
        if (row?.reward != null && Number.isFinite(row.reward)) epRlRewardSum += row.reward;
      }
      episodeRlRewards.push(epRlRewardSum);

      if (episodeLog) {
        const m = calculateBacktestMetrics(sim.dailyValues, sim.tradeLog, capital);
        episodeLog.push({
          episode: epCount,
          rebalanceSteps: windowDates.length,
          windowStart: windowDates[0],
          windowEnd: windowDates[windowDates.length - 1],
          qUpdatesThisEpisode: du,
          portfolioTotalReturn: m ? m.totalReturn : null,
          annualizedReturn: m ? m.annualizedReturn : null,
          alphaVsBench: m ? m.alpha : null,
          sharpe: m ? m.sharpe : null,
          tradeCount: sim.tradeLog?.length ?? 0,
          totalUpdatesAfter: agent.totalUpdates,
          rlRewardSum: epRlRewardSum
        });
      }

      const epLabel = trainUntilThresholds ? `${epCount}/${RL_TRAIN_MAX_EPISODES}` : `${epCount}/${userEpisodes}`;
      if (rlTrainProgressLogEnabled()) {
        const elapsedSec = ((performance.now() - trainEpisodeLoopStart) / 1000).toFixed(1);
        console.log(
          `${tag} episode ${epLabel} window=${windowDates[0]}..${windowDates[windowDates.length - 1]} ` +
            `qUpdates+${du} totalUpdates=${agent.totalUpdates} elapsed=${elapsedSec}s`
        );
      }

      if (isDqnAgentInstance(agent) && epCount % targetUpdateFreqEpisodes === 0) {
        agent.syncTargetFromOnline();
      }

      const progEvery = dqnProgressLogEvery | 0;
      if (isDqnAgentInstance(agent) && progEvery > 0 && epCount > 0 && epCount % progEvery === 0) {
        const slice = episodeRlRewards.slice(-progEvery);
        const avgR = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
        const eps = agent.getEpsilonForEpisode(epCount);
        const bufLen = agent.buffer.length;
        const lossV = Number.isFinite(agent.lastLoss) ? agent.lastLoss.toFixed(6) : 'n/a';
        console.log(
          `${tag}[DQN] ep=${epCount} avgReward(last${progEvery})=${avgR.toFixed(4)} epsilon=${eps.toFixed(4)} ` +
            `replaySize=${bufLen} loss=${lossV}`
        );
      }

      const ck = checkpointEvery | 0;
      if (epCount > 0 && ck > 0 && epCount % ck === 0) {
        if (isDqnAgentInstance(agent)) {
          writeRlAgentFileOnly(agent);
          console.log(`${tag} DQN checkpoint ep=${epCount}, states=${agent.statesVisited}, updates=${agent.totalUpdates}`);
        } else {
          writeRlAgentFileOnly(agent, universeId);
          console.log(`${tag} checkpoint ep=${epCount}, states=${agent.statesVisited}, updates=${agent.totalUpdates}`);
        }

        if (typeof agent.getQSpread === 'function' && typeof agent.getGreedyPolicy === 'function') {
          const currentSpread = agent.getQSpread();
          qSpreadHistory.push({
            episode: epCount,
            spread: parseFloat(Number(currentSpread).toFixed(4))
          });
          const currentPolicy = agent.getGreedyPolicy();
          if (lastPolicy !== null && typeof agent.policyDistance === 'function') {
            const dist = agent.policyDistance(lastPolicy);
            if (dist < POLICY_STABILITY_THRESHOLD) {
              stableCheckpointCount++;
              if (stableCheckpointCount >= CONVERGENCE_WINDOW && policyConvergenceEpisode === null) {
                policyConvergenceEpisode = epCount;
              }
            } else {
              stableCheckpointCount = 0;
            }
          } else {
            stableCheckpointCount = 0;
          }
          lastPolicy = currentPolicy;
        }
      }

      if (trainUntilThresholds) {
        const convQuick = computeConvergenceMetrics(agent);
        const cov = parseFloat(convQuick.coveragePercent);
        if (cov >= RL_TRAIN_COVERAGE_TARGET_PCT && agent.totalUpdates >= RL_TRAIN_MIN_Q_UPDATES) {
          trainingStopReason = 'thresholds_met';
          break;
        }
      }
    }
  } finally {
    if (savedBeta != null) agent.beta = savedBeta;
    agent.currentTrainingEpisode = 0;
  }

  if (isDqnAgentInstance(agent)) {
    agent.syncTargetFromOnline();
  }

  const episodesRun = episodeRlRewards.length;
  const loopElapsedMs = performance.now() - trainEpisodeLoopStart;
  return {
    episodesRun,
    episodeLog,
    episodeRlRewards,
    trainingStopReason,
    loopElapsedMs,
    convergenceDiagnostics: {
      qSpreadHistory,
      epsilonThresholdEpisode,
      policyConvergenceEpisode
    }
  };
}

app.get('/api/rl/test', async (req, res) => {
  try {
    const { runRlTestHarness } = await import('./rl-test-harness.js');
    const report = await runRlTestHarness({ writeFile: true, print: false });
    res.json(report);
  } catch (e) {
    console.error('RL test harness error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/rl/status', (req, res) => {
  try {
    const agentType = rlAgentTypeEffective();
    const agent = TRAINED_RL_AGENT;
    const loaded = agent != null;
    const statusPath = agentType === 'dqn' ? DQN_AGENT_JSON_PATH : RL_AGENT_JSON_PATH;
    let agentFileMtime = null;
    try {
      if (existsSync(statusPath)) {
        agentFileMtime = statSync(statusPath).mtime.toISOString();
      }
    } catch {
      agentFileMtime = null;
    }
    const totalStates = TOTAL_STATES;
    const totalActions = TOTAL_ACTIONS;
    const statesVisited = loaded ? agent.statesVisited : 0;
    const totalUpdates = loaded ? agent.totalUpdates : 0;
    const qTableSize = loaded ? rlAgentPolicyParamSize(agent) : 0;
    const coveragePct =
      totalStates > 0 ? parseFloat(((statesVisited / totalStates) * 100).toFixed(1)) : 0;
    const hiddenSize = loaded && isDqnAgentInstance(agent) ? agent.hiddenSize ?? null : null;
    const agentInferenceOk = loaded ? trainedRlAgentReadyForInference(agent) : false;

    const agents = {};
    for (const uid of ['sp500_top50', 'sp500_top150']) {
      const a = RL_AGENTS_BY_UNIVERSE[uid];
      const ok = a != null && trainedRlAgentReadyForInference(a);
      const fpUni = getRlAgentPathForUniverse(uid);
      let agentFileMtimeUni = null;
      try {
        if (existsSync(fpUni)) {
          agentFileMtimeUni = statSync(fpUni).mtime.toISOString();
        }
      } catch {
        agentFileMtimeUni = null;
      }
      agents[uid] = {
        loaded: ok,
        statesVisited: ok ? a.statesVisited : 0,
        totalUpdates: ok ? a.totalUpdates : 0,
        agentFile: path.basename(fpUni),
        agentFileMtime: agentFileMtimeUni
      };
    }

    const pf = loadPaperPortfolioForUniverse(resolvePaperUniverseFromRequest(req));
    let paperTrade = null;
    if (pf) {
      const sched = buildPaperTradeScheduleResponse(pf);
      const pAgent = getRlAgentForPaperPortfolio(pf);
      paperTrade = {
        universeId: paperTradingUniverseId(pf),
        rlEnabled: paperPortfolioRlEnabled(pf),
        rlAgentActive:
          paperPortfolioRlEnabled(pf) && trainedRlAgentReadyForInference(pAgent) && rlEvalEnvEnabled(),
        rlEvalGloballyEnabled: rlEvalEnvEnabled(),
        onlineLearning: pf.config?.rlOnlineLearning === true,
        weights: pf.config?.weights ?? null,
        lastRebalance: pf.lastRebalance ?? null,
        nextRebalance: sched.nextRebalance,
        rebalanceFreq: sched.rebalanceFreq,
        rlLastAction: pf._rlLastAction ?? null
      };
    }
    res.json({
      loaded,
      agentLoaded: agentInferenceOk,
      agentType,
      defaultAgentType: agentType,
      agents,
      hiddenSize,
      actionSpaceSize: TOTAL_ACTIONS,
      rlEvalGloballyEnabled: rlEvalEnvEnabled(),
      statesVisited,
      totalUpdates,
      qTableSize,
      agentFile: path.basename(statusPath),
      agentFileMtime,
      totalStates,
      totalActions,
      coveragePct,
      paperTrade
    });
  } catch (e) {
    console.error('RL status error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/rl/policy', (req, res) => {
  try {
    const u = req.query.universeId != null ? String(req.query.universeId).trim() : '';
    const kind = rlAgentTypeEffective();
    const agent =
      kind === 'dqn'
        ? loadRlAgentFromDisk('dqn')
        : u === 'sp500_top50' || u === 'sp500_top150'
          ? loadRlAgentFromDisk(undefined, u)
          : loadRlAgentFromDisk();
    const verbose = req.query.verbose === '1' || req.query.verbose === 'true';
    const policy = [];
    for (let s = 0; s < agent.nStates; s++) {
      if (!verbose && agent.visitCounts[s] === 0) continue;
      let bestA = 0;
      let bestQ = agent.getQ(s, 0);
      for (let a = 1; a < agent.nActions; a++) {
        const q = agent.getQ(s, a);
        if (q > bestQ) {
          bestQ = q;
          bestA = a;
        }
      }
      policy.push({
        stateIdx: s,
        visits: agent.visitCounts[s],
        action: decodeAction(bestA),
        qValue: bestQ
      });
    }
    res.json({
      success: true,
      convergence: computeConvergenceMetrics(agent),
      overPruning: detectOverPruning(agent),
      policy,
      policySize: policy.length,
      totalUpdates: agent.totalUpdates
    });
  } catch (e) {
    console.error('RL policy error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/rl/oracle
 *
 * Exhaustively evaluates all 48 constant policies (one fixed action every rebalance)
 * on the full backtest window, ranks by alpha, and compares the trained agent's greedy
 * tabular/DQN policy to the best single-action oracle.
 *
 * Query: period (default 3y), universeId (default sp500_top50), rebalanceFreq (default bimonthly), topN (default 15), initialCapital (default 10000).
 */
app.get('/api/rl/oracle', async (req, res) => {
  const universeIdResolved =
    req.query.universeId != null ? String(req.query.universeId).trim() : 'sp500_top50';
  try {
    clearBacktestRuntimeCaches();
    const period = req.query.period || '3y';
    const rebalanceFreq = String(req.query.rebalanceFreq || 'bimonthly').toLowerCase().trim();
    const allowedFreq = ['monthly', 'quarterly', 'weekly', 'biweekly', 'bimonthly'];
    if (!allowedFreq.includes(rebalanceFreq)) {
      return res.status(400).json({ success: false, error: 'Invalid rebalanceFreq' });
    }
    const topN = parseInt(String(req.query.topN ?? '15'), 10) || 15;
    const capital = parseFloat(String(req.query.initialCapital ?? '10000')) || 10000;
    const strategyClean = 'full_composite';

    const universe = UNIVERSE_TICKERS[universeIdResolved];
    if (!universe) return res.status(400).json({ success: false, error: 'Unknown universe' });

    /** Oracle sweep: fixed M40/V40/Q20 pillar mix (no earnings pillar). */
    const tradingWeights = {
      momentum: 0.4,
      value: 0.4,
      fundamental: 0.2,
      dcf: 0,
      valuation: 0,
      earningsMomentum: 0
    };

    const periodDays = { '1y': 365, '2y': 730, '3y': 1095, '5y': 1825, '7y': 2555 };
    const days = periodDays[period] || 1095;
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    const lookbackStart = new Date(startDate.getTime() - 400 * 24 * 60 * 60 * 1000);
    const startDateStr = lookbackStart.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    const backtestStartDate = startDate.toISOString().split('T')[0];

    const tickersToFetch = [...new Set([...universe, 'SPY'])].filter(Boolean);
    const priceHistory = {};
    const priceRows = await mapWithConcurrency(tickersToFetch, YAHOO_CHART_CONCURRENCY, async (ticker) => {
      const data = await bt_fetchPriceHistory(ticker, startDateStr, endDateStr);
      return { ticker, data };
    });
    for (const row of priceRows) {
      if (row?.data && !row.__error) priceHistory[row.ticker] = row.data;
    }

    const fundamentals = {};
    const fundRows = await mapWithConcurrency(
      tickersToFetch.filter((t) => t !== 'SPY'),
      FUNDAMENTALS_FETCH_CONCURRENCY,
      async (ticker) => {
        const fund = await fetchFundamentals(ticker);
        return { ticker, fund };
      }
    );
    for (const row of fundRows) {
      if (row?.fund && !row.__error) fundamentals[row.ticker] = row.fund;
    }

    const rebalanceDates = getRebalanceDates(backtestStartDate, endDateStr, rebalanceFreq);
    if (rebalanceDates.length < 2) {
      return res.status(400).json({ success: false, error: 'Insufficient rebalance dates' });
    }

    const spyPrices = priceHistory['SPY'];
    if (!spyPrices?.length) {
      return res.status(500).json({
        success: false,
        error:
          'Missing SPY data — Yahoo chart returned no usable daily bars for SPY. Retry after a short wait if rate-limited.'
      });
    }

    const simStart = rebalanceDates[0];
    const simEnd = rebalanceDates[rebalanceDates.length - 1];
    const cpiObsStart = subtractMonths(simStart, 60);
    const cpiObservations = await fetchFredCpiObservations(cpiObsStart, simEnd, process.env.FRED_API_KEY);
    const { multiplierFn: cashInflationMult } = buildCashInflationMultiplierFn(
      cpiObservations,
      simStart,
      INFLATION_BASELINE_ANNUAL
    );

    const sharedOracleSimOptions = {
      adaptiveMode: 'fixed',
      positionSizing: 'invVol',
      regimeEnabled: true,
      skipMlRankingAdjustments: true
    };

    const N_ACTIONS = TOTAL_ACTIONS;
    const actionResults = [];

    for (let actionIdx = 0; actionIdx < N_ACTIONS; actionIdx++) {
      const decoded = decodeAction(actionIdx);
      const sim = await runBacktestSimulation(
        universe,
        priceHistory,
        fundamentals,
        spyPrices,
        rebalanceDates,
        topN,
        capital,
        strategyClean,
        tradingWeights,
        cashInflationMult,
        universeIdResolved,
        {
          ...sharedOracleSimOptions,
          rlAgent: true,
          rlMode: 'eval',
          forceConstantAction: actionIdx,
          rlQLearningAgent: new QLearningTradingAgent(),
          rlRandomAgent: false
        }
      );
      const perf = extractDiagnosticPerformance(sim, capital);
      actionResults.push({
        actionIdx,
        exposure: decoded.exposure,
        positionCount: decoded.positionCount,
        sizingMethod: decoded.sizingMethod,
        rebalanceWait: decoded.rebalanceWait,
        totalReturn: parseFloat(perf?.totalReturn ?? '0'),
        alpha: parseFloat(perf?.alpha ?? '0'),
        sharpe: parseFloat(perf?.sharpe ?? '0')
      });
    }

    const sorted = [...actionResults].sort((a, b) => b.alpha - a.alpha);
    const oracleAction = sorted[0];
    const oracleActionIdx = oracleAction.actionIdx;

    let rlAgentData = null;
    let agentPolicyDistance = null;
    let agentVsOracleAlphaGap = null;

    try {
      const agent =
        rlAgentTypeEffective() === 'dqn'
          ? loadRlAgentFromDisk('dqn')
          : loadRlAgentFromDisk(undefined, universeIdResolved);
      const nStates = agent.nStates ?? TOTAL_STATES;
      const nActions = agent.nActions ?? TOTAL_ACTIONS;
      if (nActions !== N_ACTIONS) {
        rlAgentData = {
          error: `Agent action count (${nActions}) does not match oracle sweep (${N_ACTIONS})`,
          agentKind: rlAgentTypeEffective()
        };
      } else {
        const agentGreedyActions = [];
        for (let s = 0; s < nStates; s++) {
          let best = 0;
          let bestQ = agent.getQ(s, 0);
          for (let a = 1; a < nActions; a++) {
            const q = agent.getQ(s, a);
            if (q > bestQ) {
              bestQ = q;
              best = a;
            }
          }
          agentGreedyActions.push(best);
        }

        const statesDivergent = agentGreedyActions.filter((a) => a !== oracleActionIdx).length;
        agentPolicyDistance = statesDivergent / nStates;

        const counts = Object.create(null);
        for (const a of agentGreedyActions) counts[a] = (counts[a] || 0) + 1;
        let agentModalActionIdx = 0;
        let maxCt = -1;
        for (const [aStr, ct] of Object.entries(counts)) {
          if (ct > maxCt) {
            maxCt = ct;
            agentModalActionIdx = parseInt(aStr, 10);
          }
        }
        const agentModalResult = actionResults.find((r) => r.actionIdx === agentModalActionIdx) ?? actionResults[0];
        agentVsOracleAlphaGap = oracleAction.alpha - agentModalResult.alpha;

        /** Same window/weights as oracle sweep; matches GET backtest `rlAgent=true` eval (state-dependent greedy policy). Alpha as annualized fraction (e.g. -0.0026). */
        let fullPolicyAlpha = null;
        try {
          const simRlFull = await runBacktestSimulation(
            universe,
            priceHistory,
            fundamentals,
            spyPrices,
            rebalanceDates,
            topN,
            capital,
            strategyClean,
            tradingWeights,
            cashInflationMult,
            universeIdResolved,
            {
              ...sharedOracleSimOptions,
              rlAgent: true,
              rlMode: 'eval',
              rlQLearningAgent: agent,
              rlRandomAgent: false
            }
          );
          const perfRlFull = extractDiagnosticPerformance(simRlFull, capital);
          const alphaPp = parseFloat(String(perfRlFull?.alpha ?? ''));
          fullPolicyAlpha = Number.isFinite(alphaPp) ? alphaPp / 100 : null;
        } catch {
          fullPolicyAlpha = null;
        }

        rlAgentData = {
          modalAction: agentModalActionIdx,
          modalActionDecoded: decodeAction(agentModalActionIdx),
          modalActionAlpha: agentModalResult.alpha,
          policyDistanceFromOracle: parseFloat(agentPolicyDistance.toFixed(4)),
          alphaGapFromOracle: parseFloat(agentVsOracleAlphaGap.toFixed(4)),
          statesMatchingOracle: nStates - statesDivergent,
          statesDivergingFromOracle: statesDivergent,
          agentKind: rlAgentTypeEffective(),
          nStates,
          nActions,
          fullPolicyAlpha
        };
      }
    } catch (e) {
      rlAgentData = { error: 'Could not load or evaluate trained agent', detail: e.message };
    }

    const alphasSorted = actionResults.map((r) => r.alpha).sort((a, b) => a - b);
    const alphaDiffs = [];
    for (let i = 1; i < alphasSorted.length; i++) {
      const d = alphasSorted[i] - alphasSorted[i - 1];
      if (d > 0) alphaDiffs.push(d);
    }
    const noiseFloor =
      alphaDiffs.length > 0 ? parseFloat(Math.min(...alphaDiffs).toFixed(4)) : null;

    const top5 = sorted.slice(0, 5);
    const bottom5 = sorted.slice(-5).reverse();

    const oracleAlphaFrac = oracleAction.alpha / 100;
    const rlFullAlpha = rlAgentData?.fullPolicyAlpha ?? null;
    const interpretation =
      rlFullAlpha !== null
        ? rlFullAlpha > oracleAlphaFrac
          ? `RL agent (+${(rlFullAlpha * 100).toFixed(2)}% alpha) beats best constant policy (${(oracleAlphaFrac * 100).toFixed(2)}% alpha) by ${((rlFullAlpha - oracleAlphaFrac) * 100).toFixed(2)}pp — regime adaptation is the source of alpha.`
          : `RL agent (${(rlFullAlpha * 100).toFixed(2)}% alpha) trails best constant policy by ${((oracleAlphaFrac - rlFullAlpha) * 100).toFixed(2)}pp — agent underperforming.`
        : 'No trained agent to compare.';

    res.json({
      success: true,
      universeId: universeIdResolved,
      period,
      rebalanceFreq,
      topN,
      initialCapital: capital,
      oracle: {
        actionIdx: oracleActionIdx,
        decoded: decodeAction(oracleActionIdx),
        alpha: oracleAction.alpha,
        totalReturn: oracleAction.totalReturn,
        sharpe: oracleAction.sharpe
      },
      noiseFloor,
      rlAgent: rlAgentData,
      interpretation,
      top5Actions: top5,
      bottom5Actions: bottom5,
      allActions: actionResults
    });
  } catch (err) {
    console.error('Oracle error:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    clearBacktestRuntimeCaches();
  }
});

app.get('/api/rl/compare', async (req, res) => {
  const universeIdResolved = req.query.universeId || 'sp500_top50';
  try {
    clearBacktestRuntimeCaches();
    const period = req.query.period || '3y';
    const rebalanceFreq = String(req.query.rebalanceFreq || 'monthly').toLowerCase().trim();
    const allowedFreq = ['monthly', 'quarterly', 'weekly', 'biweekly', 'bimonthly'];
    if (!allowedFreq.includes(rebalanceFreq)) {
      return res.status(400).json({ success: false, error: `Invalid rebalanceFreq` });
    }
    /** Default topN must match GET /api/backtest/:universeId (query default 10, not 15). */
    const topN = parseInt(String(req.query.topN ?? '10'), 10) || 10;
    const capital = parseFloat(String(req.query.initialCapital || '10000')) || 10000;
    const strategyClean = String(req.query.strategy || 'full_composite').toLowerCase().trim();
    if (
      strategyClean !== 'full_composite' &&
      strategyClean !== 'full_composite_aggressive' &&
      strategyClean !== 'full_composite_turbo'
    ) {
      return res.status(400).json({ success: false, error: 'strategy must be a full_composite variant' });
    }

    /** Match GET /api/backtest/:universeId simOptions (defaults + query overrides). */
    const adaptiveModeRaw = String(req.query.adaptiveMode ?? 'fixed').toLowerCase().trim();
    const adaptiveMode =
      adaptiveModeRaw === 'adaptive' || adaptiveModeRaw === 'conservative' ? adaptiveModeRaw : 'fixed';
    const psQ =
      req.query.positionSizing != null && String(req.query.positionSizing).trim() !== ''
        ? String(req.query.positionSizing).toLowerCase().trim()
        : null;
    const positionSizing =
      psQ && ['equal', 'invVol', 'score', 'invVolBlend'].includes(psQ)
        ? psQ
        : strategyClean === 'full_composite' ||
            strategyClean === 'full_composite_aggressive' ||
            strategyClean === 'full_composite_turbo'
          ? 'invVol'
          : 'equal';
    const regimeEnabled = req.query.regimeEnabled !== 'false' && req.query.regimeEnabled !== false;
    const pillarOverrideNormalized = parsePillarOverrideQuery(req.query.pillarOverride);
    const usePaperWeights =
      req.query.usePaperWeights === 'true' ||
      req.query.usePaperWeights === true ||
      req.query.usePaperWeights === '1';
    const enableMlOnCompare =
      req.query.mlRanking === 'true' || req.query.mlRanking === true || req.query.mlRanking === '1';
    const skipMlRankingAdjustments = !enableMlOnCompare;

    let tradingWeights = null;
    if (strategyClean === 'full_composite') {
      if (usePaperWeights) {
        const portfolio = loadPaperPortfolioForUniverse(universeIdResolved);
        if (portfolio && portfolio.config && portfolio.config.strategy === 'full_composite' && portfolio.config.weights) {
          tradingWeights = portfolio.config.weights;
        }
      }
    } else if (strategyClean === 'full_composite_aggressive') {
      if (usePaperWeights) {
        const portfolio = loadPaperPortfolioForUniverse(universeIdResolved);
        if (portfolio && portfolio.config && portfolio.config.strategy === 'full_composite_aggressive' && portfolio.config.weights) {
          tradingWeights = portfolio.config.weights;
        }
      }
      if (!tradingWeights) tradingWeights = { ...AGGRESSIVE_COMPOSITE_WEIGHTS };
    } else if (strategyClean === 'full_composite_turbo') {
      if (usePaperWeights) {
        const portfolio = loadPaperPortfolioForUniverse(universeIdResolved);
        if (portfolio && portfolio.config && portfolio.config.strategy === 'full_composite_turbo' && portfolio.config.weights) {
          tradingWeights = portfolio.config.weights;
        }
      }
      if (!tradingWeights) tradingWeights = { ...TURBO_COMPOSITE_WEIGHTS };
    }

    const sharedSimOptions = {
      adaptiveMode,
      positionSizing,
      pillarOverride: pillarOverrideNormalized || undefined,
      regimeEnabled,
      skipMlRankingAdjustments
    };

    const universe = UNIVERSE_TICKERS[universeIdResolved];
    if (!universe) return res.status(400).json({ success: false, error: 'Unknown universe' });

    const periodDays = { '1y': 365, '2y': 730, '3y': 1095, '5y': 1825, '7y': 2555 };
    const days = periodDays[period] || 1095;
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    const lookbackStart = new Date(startDate.getTime() - 400 * 24 * 60 * 60 * 1000);
    const startDateStr = lookbackStart.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    const backtestStartDate = startDate.toISOString().split('T')[0];

    const tickersToFetch = [...new Set([...universe, 'SPY'])].filter(Boolean);
    const priceHistory = {};
    const priceRows = await mapWithConcurrency(tickersToFetch, YAHOO_CHART_CONCURRENCY, async (ticker) => {
      const data = await bt_fetchPriceHistory(ticker, startDateStr, endDateStr);
      return { ticker, data };
    });
    for (const row of priceRows) {
      if (row?.data && !row.__error) priceHistory[row.ticker] = row.data;
    }

    const fundamentals = {};
    const fundRows = await mapWithConcurrency(
      tickersToFetch.filter((t) => t !== 'SPY'),
      FUNDAMENTALS_FETCH_CONCURRENCY,
      async (ticker) => {
        const fund = await fetchFundamentals(ticker);
        return { ticker, fund };
      }
    );
    for (const row of fundRows) {
      if (row?.fund && !row.__error) fundamentals[row.ticker] = row.fund;
    }

    const rebalanceDates = getRebalanceDates(backtestStartDate, endDateStr, rebalanceFreq);
    if (rebalanceDates.length < 2) {
      return res.status(400).json({ success: false, error: 'Insufficient rebalance dates' });
    }

    const spyPrices = priceHistory['SPY'];
    if (!spyPrices?.length) {
      return res.status(500).json({
        success: false,
        error:
          'Missing SPY data — Yahoo chart returned no usable daily bars for SPY. Check server logs for "[Yahoo] chart failed SPY"; retry after 30–60s if rate-limited or the network glitched.'
      });
    }

    const simStart = rebalanceDates[0];
    const simEnd = rebalanceDates[rebalanceDates.length - 1];
    const cpiObsStart = subtractMonths(simStart, 60);
    const cpiObservations = await fetchFredCpiObservations(cpiObsStart, simEnd, process.env.FRED_API_KEY);
    const { multiplierFn: cashInflationMult } = buildCashInflationMultiplierFn(
      cpiObservations,
      simStart,
      INFLATION_BASELINE_ANNUAL
    );

    const simBase = await runBacktestSimulation(
      universe,
      priceHistory,
      fundamentals,
      spyPrices,
      rebalanceDates,
      topN,
      capital,
      strategyClean,
      tradingWeights,
      cashInflationMult,
      universeIdResolved,
      {
        ...sharedSimOptions,
        rlAgent: false,
        rlMode: 'off',
        rlRandomAgent: false
      }
    );

    const agentForCompare =
      rlAgentTypeEffective() === 'dqn'
        ? TRAINED_RL_AGENT ?? loadRlAgentFromDisk('dqn')
        : getQlAgentForUniverse(universeIdResolved) ?? loadRlAgentFromDisk(undefined, universeIdResolved);
    const simRl = await runBacktestSimulation(
      universe,
      priceHistory,
      fundamentals,
      spyPrices,
      rebalanceDates,
      topN,
      capital,
      strategyClean,
      tradingWeights,
      cashInflationMult,
      universeIdResolved,
      {
        ...sharedSimOptions,
        rlAgent: true,
        rlMode: 'eval',
        rlQLearningAgent: agentForCompare,
        rlRandomAgent: false
      }
    );

    const basePerf = extractDiagnosticPerformance(simBase, capital);
    const rlPerf = extractDiagnosticPerformance(simRl, capital);

    res.json({
      success: true,
      universe: universeIdResolved,
      period,
      rebalanceFreq,
      topN,
      strategy: strategyClean,
      rlAgentKind: rlAgentTypeEffective(),
      simConfig: {
        ...sharedSimOptions,
        usePaperWeights,
        mlRankingEnabled: enableMlOnCompare,
        note: 'Matches GET /api/backtest defaults: ML ranking off unless mlRanking=true'
      },
      baseline: basePerf,
      rlEval: rlPerf,
      rlRebalanceSteps: simRl.rlLog?.length ?? 0
    });
  } catch (e) {
    console.error('RL compare error:', e);
    res.status(500).json({ success: false, error: e.message });
  } finally {
    clearBacktestRuntimeCaches();
  }
});

app.post('/api/rl/train', async (req, res) => {
  const startTime = Date.now();
  try {
    clearBacktestRuntimeCaches();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const universeId = body.universeId || 'sp500_top50';
    const period = body.period || '3y';
    const gammaParsed = body.gamma != null ? Number(body.gamma) : NaN;
    const gamma = Number.isFinite(gammaParsed) ? gammaParsed : 3;
    const rebalanceFreq = String(body.rebalanceFreq || 'monthly').toLowerCase().trim();
    const allowedFreq = ['monthly', 'quarterly', 'weekly', 'biweekly', 'bimonthly'];
    if (!allowedFreq.includes(rebalanceFreq)) {
      return res.status(400).json({ success: false, error: `Invalid rebalanceFreq` });
    }
    const topN = parseInt(String(body.topN ?? '15'), 10) || 15;
    const capital = parseFloat(String(body.initialCapital ?? '10000')) || 10000;
    const DEFAULT_TRAINING_EPISODES = 500;
    const trainUntilThresholds =
      body.trainUntilThresholds === true ||
      body.trainUntilThresholds === 'true' ||
      body.trainUntilThresholds === '1';
    const userEpisodes = Math.min(
      RL_TRAIN_MAX_EPISODES,
      Math.max(1, parseInt(String(body.episodes ?? DEFAULT_TRAINING_EPISODES), 10) || DEFAULT_TRAINING_EPISODES)
    );
    const skipPostTrainEval =
      body.skipPostTrainEval === true ||
      body.skipPostTrainEval === 'true' ||
      body.skipPostTrainEval === '1';
    /** Default false — training should match eval scoring (earnings pillar). Set body.rlTrainSkipEarningsFetch true only to skip fetches and reduce Yahoo load. */
    const explicitSkip =
      body.rlTrainSkipEarningsFetch === false ||
      body.rlTrainSkipEarningsFetch === 'false' ||
      body.rlTrainSkipEarningsFetch === '0'
        ? false
        : body.rlTrainSkipEarningsFetch === true ||
            body.rlTrainSkipEarningsFetch === 'true' ||
            body.rlTrainSkipEarningsFetch === '1'
          ? true
          : null;
    /** Only skip when the client explicitly requests it — training defaults to full scoring (ignore env). */
    const rlTrainSkipEarningsFetch = explicitSkip === true;
    const rlSmokeTrain = skipPostTrainEval && userEpisodes <= 50;
    const strategyClean = String(body.strategy || 'full_composite').toLowerCase().trim();
    if (
      strategyClean !== 'full_composite' &&
      strategyClean !== 'full_composite_aggressive' &&
      strategyClean !== 'full_composite_turbo'
    ) {
      return res.status(400).json({ success: false, error: 'strategy must be a full_composite variant' });
    }

    const trainAgentTypeRaw = body.agentType != null ? String(body.agentType).toLowerCase().trim() : '';
    const trainAgentType =
      trainAgentTypeRaw === 'dqn'
        ? 'dqn'
        : trainAgentTypeRaw === '' ||
            trainAgentTypeRaw === 'qlearning' ||
            trainAgentTypeRaw === 'q-learning' ||
            trainAgentTypeRaw === 'q'
          ? 'qlearning'
          : null;
    if (trainAgentType == null) {
      return res.status(400).json({ success: false, error: 'agentType must be dqn or qlearning' });
    }

    /** Training always uses fixed pillar weights (stable score landscape); body adaptiveMode is ignored. */
    const adaptiveModeTrain = 'fixed';
    const psTrain =
      body.positionSizing != null && String(body.positionSizing).trim() !== ''
        ? String(body.positionSizing).toLowerCase().trim()
        : null;
    const positionSizingTrain =
      psTrain && ['equal', 'invVol', 'score', 'invVolBlend'].includes(psTrain)
        ? psTrain
        : strategyClean === 'full_composite' ||
            strategyClean === 'full_composite_aggressive' ||
            strategyClean === 'full_composite_turbo'
          ? 'invVol'
          : 'equal';
    const regimeEnabledTrain = body.regimeEnabled !== false;
    const pillarRaw = body.pillarOverride != null ? body.pillarOverride : body.weights;
    const pillarTrainNorm = pillarRaw != null ? normalizePillarOverride(pillarRaw) : null;
    const usePaperWeightsTrain =
      body.usePaperWeights === true || body.usePaperWeights === 'true' || body.usePaperWeights === '1';
    const enableMlTrain =
      body.mlRanking === true || body.mlRanking === 'true' || body.mlRanking === '1';
    const skipMlTrain = !enableMlTrain;

    const universe = UNIVERSE_TICKERS[universeId];
    if (!universe) return res.status(400).json({ success: false, error: 'Unknown universe' });

    const periodDays = { '1y': 365, '2y': 730, '3y': 1095, '5y': 1825, '7y': 2555 };
    const days = periodDays[period] || 1095;
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    const lookbackStart = new Date(startDate.getTime() - 400 * 24 * 60 * 60 * 1000);
    const startDateStr = lookbackStart.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    const backtestStartDate = startDate.toISOString().split('T')[0];

    const tickersToFetch = [...new Set([...universe, 'SPY'])].filter(Boolean);
    const priceHistory = {};
    const priceRows = await mapWithConcurrency(tickersToFetch, YAHOO_CHART_CONCURRENCY, async (ticker) => {
      const data = await bt_fetchPriceHistory(ticker, startDateStr, endDateStr);
      return { ticker, data };
    });
    for (const row of priceRows) {
      if (row?.data && !row.__error) priceHistory[row.ticker] = row.data;
    }

    const fundamentals = {};
    const fundRows = await mapWithConcurrency(
      tickersToFetch.filter((t) => t !== 'SPY'),
      FUNDAMENTALS_FETCH_CONCURRENCY,
      async (ticker) => {
        const fund = await fetchFundamentals(ticker);
        return { ticker, fund };
      }
    );
    for (const row of fundRows) {
      if (row?.fund && !row.__error) fundamentals[row.ticker] = row.fund;
    }

    const rebalanceDates = getRebalanceDates(backtestStartDate, endDateStr, rebalanceFreq);
    const minRebalanceDatesTrain = rlSmokeTrain ? 4 : 12;
    if (rebalanceDates.length < minRebalanceDatesTrain) {
      return res.status(400).json({
        success: false,
        error: rlSmokeTrain
          ? `Need at least ${minRebalanceDatesTrain} rebalance dates for smoke training (skipPostTrainEval and episodes<=50). Use a longer period, switch to monthly, or run a full train without skipPostTrainEval.`
          : 'Need at least 12 rebalance dates for RL training'
      });
    }

    const spyPrices = priceHistory['SPY'];
    if (!spyPrices?.length) {
      return res.status(500).json({
        success: false,
        error:
          'Missing SPY data — Yahoo chart returned no usable daily bars for SPY. Check server logs for "[Yahoo] chart failed SPY"; retry after 30–60s if rate-limited or the network glitched.'
      });
    }

    const simStart = rebalanceDates[0];
    const simEnd = rebalanceDates[rebalanceDates.length - 1];
    const cpiObsStart = subtractMonths(simStart, 60);
    const cpiObservations = await fetchFredCpiObservations(cpiObsStart, simEnd, process.env.FRED_API_KEY);
    const { multiplierFn: cashInflationMult } = buildCashInflationMultiplierFn(
      cpiObservations,
      simStart,
      INFLATION_BASELINE_ANNUAL
    );

    let tradingWeightsTrain = null;
    if (strategyClean === 'full_composite') {
      if (usePaperWeightsTrain) {
        const portfolio = loadPaperPortfolioForUniverse(universeId);
        if (portfolio && portfolio.config && portfolio.config.strategy === 'full_composite' && portfolio.config.weights) {
          tradingWeightsTrain = portfolio.config.weights;
        }
      }
    } else if (strategyClean === 'full_composite_aggressive') {
      if (usePaperWeightsTrain) {
        const portfolio = loadPaperPortfolioForUniverse(universeId);
        if (portfolio && portfolio.config && portfolio.config.strategy === 'full_composite_aggressive' && portfolio.config.weights) {
          tradingWeightsTrain = portfolio.config.weights;
        }
      }
      if (!tradingWeightsTrain) tradingWeightsTrain = { ...AGGRESSIVE_COMPOSITE_WEIGHTS };
    } else if (strategyClean === 'full_composite_turbo') {
      if (usePaperWeightsTrain) {
        const portfolio = loadPaperPortfolioForUniverse(universeId);
        if (portfolio && portfolio.config && portfolio.config.strategy === 'full_composite_turbo' && portfolio.config.weights) {
          tradingWeightsTrain = portfolio.config.weights;
        }
      }
      if (!tradingWeightsTrain) tradingWeightsTrain = { ...TURBO_COMPOSITE_WEIGHTS };
    }

    const correlationFilterTrain =
      body.correlationFilter === true ||
      body.correlationFilter === 'true' ||
      body.correlationFilter === 1 ||
      String(body.correlationFilter || '').toLowerCase() === 'true';

    let holdoutFraction = Number(body.holdoutFraction ?? 0.2);
    if (!Number.isFinite(holdoutFraction)) holdoutFraction = 0.2;
    holdoutFraction = Math.min(0.45, Math.max(0.05, holdoutFraction));
    const trainCutoffIdx = Math.floor(rebalanceDates.length * (1 - holdoutFraction));
    let trainRebalancePool = rebalanceDates.slice(0, trainCutoffIdx);
    let holdoutRebalanceDates = rebalanceDates.slice(trainCutoffIdx);
    if (rlSmokeTrain) {
      trainRebalancePool = rebalanceDates.slice();
      holdoutRebalanceDates = [];
    } else if (trainRebalancePool.length < 10 || holdoutRebalanceDates.length < 2) {
      return res.status(400).json({
        success: false,
        error:
          'holdoutFraction leaves too few rebalance dates for training or holdout; lower holdoutFraction or use a longer period'
      });
    }

    const sharedTrainSimOptions = {
      adaptiveMode: adaptiveModeTrain,
      positionSizing: positionSizingTrain,
      pillarOverride: pillarTrainNorm || undefined,
      regimeEnabled: regimeEnabledTrain,
      skipMlRankingAdjustments: skipMlTrain,
      correlationFilter: correlationFilterTrain,
      rlTrainSkipEarningsFetch,
      rlGamma: gamma
    };

    if (userEpisodes >= 50 && !skipPostTrainEval) {
      console.warn(
        `[RL/train] Long job: ${userEpisodes} episodes (${universeId}, ${period}) — ` +
          'the HTTP body is sent only after all episodes plus 3 full eval backtests. ' +
          'Use a much larger curl -m (e.g. 14400), fewer episodes, or skipPostTrainEval:true for smoke tests. ' +
          'Earnings are fetched by default during training; set rlTrainSkipEarningsFetch:true in the JSON body to reduce Yahoo calls.'
      );
    }

    const agent = loadRlAgentFromDisk(trainAgentType, universeId);
    const savedBeta = typeof agent.beta === 'number' ? agent.beta : null;

    const dqnBatchSize = Math.min(256, Math.max(8, parseInt(String(body.batchSize ?? '32'), 10) || 32));
    const dqnReplayCap = Math.min(
      500000,
      Math.max(1000, parseInt(String(body.replayBufferSize ?? '50000'), 10) || 50000)
    );
    const targetUpdateFreqEpisodes = Math.max(1, parseInt(String(body.targetUpdateFreq ?? '100'), 10) || 100);
    const dqnEpsStart = Math.min(1, Math.max(0.05, parseFloat(String(body.epsilonStart ?? '1')) || 1));
    const dqnEpsEnd = Math.min(dqnEpsStart, Math.max(0.01, parseFloat(String(body.epsilonEnd ?? '0.05')) || 0.05));
    const dqnEpsDecayEp = Math.max(100, parseInt(String(body.epsilonDecayEpisodes ?? '10000'), 10) || 10000);
    /** Tabular Q-learning: linear ε decay vs episode (used when currentTrainingEpisode > 0). Defaults: 1.0 → 0.05 over 25k episodes. */
    const qLearnEpsStart = Math.min(1, Math.max(0.05, parseFloat(String(body.epsilonStart ?? '1')) || 1));
    const qLearnEpsEnd = Math.min(qLearnEpsStart, Math.max(0.01, parseFloat(String(body.epsilonEnd ?? '0.05')) || 0.05));
    const qLearnEpsDecayEp = Math.max(1, parseInt(String(body.epsilonDecayEpisodes ?? '25000'), 10) || 25000);

    if (isDqnAgentInstance(agent)) {
      agent.batchSize = dqnBatchSize;
      if (dqnReplayCap !== agent.replayCapacity) {
        agent.replayCapacity = dqnReplayCap;
        if (agent.buffer.length > agent.replayCapacity) {
          agent.buffer = agent.buffer.slice(-agent.replayCapacity);
          agent.bufferWrite = agent.buffer.length;
        }
      }
      agent.epsilonStart = dqnEpsStart;
      agent.epsilonEnd = dqnEpsEnd;
      agent.epsilonDecayEpisodes = dqnEpsDecayEp;
    } else {
      agent.epsilonStart = qLearnEpsStart;
      agent.epsilonEnd = qLearnEpsEnd;
      agent.epsilonDecayEpisodes = qLearnEpsDecayEp;
    }

    const {
      episodesRun,
      episodeLog,
      episodeRlRewards,
      trainingStopReason,
      loopElapsedMs: trainingDurationMs,
      convergenceDiagnostics
    } = await rlRunTrainEpisodesCore({
      agent,
      universe,
      priceHistory,
      fundamentals,
      spyPrices,
      trainRebalancePool,
      topN,
      capital,
      strategyClean,
      tradingWeightsTrain,
      cashInflationMult,
      universeId,
      sharedTrainSimOptions,
      userEpisodes,
      trainUntilThresholds,
      rlRandomAgent: body.rlRandomAgent === true,
      targetUpdateFreqEpisodes,
      collectEpisodeLog: true,
      dqnProgressLogEvery: isDqnAgentInstance(agent) ? 1000 : 0,
      checkpointEvery: 5000,
      savedBeta,
      logTag: '[RL/train]'
    });
    const trainingDurationSec = parseFloat((trainingDurationMs / 1000).toFixed(2));
    const avgEpisodeMs = episodesRun > 0 ? trainingDurationMs / episodesRun : null;

    saveRlAgentToDisk(agent, isDqnAgentInstance(agent) ? null : universeId);
    console.log(
      `[RL/train] ✓ COMPLETE — episodes=${episodesRun}, statesVisited=${agent.statesVisited}, totalUpdates=${agent.totalUpdates}, duration=${((Date.now() - startTime) / 1000).toFixed(1)}s`
    );
    console.log(
      `[RL/train] Agent saved (${trainAgentType}) to ${isDqnAgentInstance(agent) ? DQN_AGENT_JSON_PATH : getRlAgentPathForUniverse(universeId)}`,
    );

    const conv = computeConvergenceMetrics(agent);
    const over = detectOverPruning(agent);
    const alphas = episodeLog.map((e) => e.alphaVsBench);
    const halfN = Math.floor(episodesRun / 2);
    const avgFinite = (arr) => {
      const x = arr.filter((v) => v != null && Number.isFinite(v));
      return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null;
    };
    const firstHalfAvgAlpha = avgFinite(alphas.slice(0, halfN));
    const secondHalfAvgAlpha = avgFinite(alphas.slice(halfN));
    const coveragePct = parseFloat(conv.coveragePercent);

    const lastK = episodeRlRewards.slice(-1000);
    const avgRewardLast1000 = lastK.length ? lastK.reduce((a, b) => a + b, 0) / lastK.length : null;
    const finalEpsilon = isDqnAgentInstance(agent)
      ? agent.getEpsilonForEpisode(episodesRun)
      : typeof agent.getEpsilonForTrainingEpisode === 'function'
        ? agent.getEpsilonForTrainingEpisode(episodesRun)
        : null;

    const evalSimBase = {
      ...sharedTrainSimOptions,
      rlRandomAgent: false,
      rlTrainSkipEarningsFetch: false
    };

    let evaluationBlock;
    if (skipPostTrainEval) {
      evaluationBlock = {
        skipped: true,
        reason:
          'skipPostTrainEval was true — in-sample / OOS / rules eval trio was not run (faster smoke test; agent still saved).'
      };
    } else {
      const inSampleSim = await runBacktestSimulation(
        universe,
        priceHistory,
        fundamentals,
        spyPrices,
        rebalanceDates,
        topN,
        capital,
        strategyClean,
        tradingWeightsTrain,
        cashInflationMult,
        universeId,
        {
          ...evalSimBase,
          rlAgent: true,
          rlMode: 'eval',
          rlQLearningAgent: agent
        }
      );
      const oosRlSim = await runBacktestSimulation(
        universe,
        priceHistory,
        fundamentals,
        spyPrices,
        holdoutRebalanceDates,
        topN,
        capital,
        strategyClean,
        tradingWeightsTrain,
        cashInflationMult,
        universeId,
        {
          ...evalSimBase,
          rlAgent: true,
          rlMode: 'eval',
          rlQLearningAgent: agent
        }
      );
      const oosRulesSim = await runBacktestSimulation(
        universe,
        priceHistory,
        fundamentals,
        spyPrices,
        holdoutRebalanceDates,
        topN,
        capital,
        strategyClean,
        tradingWeightsTrain,
        cashInflationMult,
        universeId,
        {
          ...evalSimBase,
          rlAgent: false,
          rlMode: 'off'
        }
      );

      const holdoutPctLabel = `${(holdoutFraction * 100).toFixed(0)}%`;
      const inSample = extractRlTrainEvalBlock(
        inSampleSim,
        capital,
        `${period} (training window)`
      );
      const outOfSample = extractRlTrainEvalBlock(
        oosRlSim,
        capital,
        `holdout (last ${holdoutPctLabel} of rebalance dates — agent never trained on this window)`
      );
      const rulesBasedOOS = extractRlTrainEvalBlock(
        oosRulesSim,
        capital,
        `same holdout as OOS, rules-based (no RL)`
      );

      const dqnLift = {
        returnDelta:
          outOfSample.totalReturn != null && rulesBasedOOS.totalReturn != null
            ? parseFloat((outOfSample.totalReturn - rulesBasedOOS.totalReturn).toFixed(2))
            : null,
        alphaDelta:
          outOfSample.alpha != null && rulesBasedOOS.alpha != null
            ? parseFloat((outOfSample.alpha - rulesBasedOOS.alpha).toFixed(2))
            : null,
        sharpeDelta:
          outOfSample.sharpe != null && rulesBasedOOS.sharpe != null
            ? parseFloat((outOfSample.sharpe - rulesBasedOOS.sharpe).toFixed(2))
            : null
      };

      let overfitRatio = null;
      if (
        inSample.sharpe != null &&
        outOfSample.sharpe != null &&
        Number.isFinite(inSample.sharpe) &&
        Number.isFinite(outOfSample.sharpe) &&
        Math.abs(outOfSample.sharpe) > 1e-6
      ) {
        overfitRatio = parseFloat((inSample.sharpe / outOfSample.sharpe).toFixed(3));
      }

      evaluationBlock = {
        inSample,
        outOfSample,
        rulesBasedOOS,
        dqnLift,
        overfitRatio
      };
    }

    const trainingBlock = {
      episodes: episodesRun,
      durationSec: trainingDurationSec,
      finalEpsilon,
      avgRewardLast1000: avgRewardLast1000 != null ? parseFloat(avgRewardLast1000.toFixed(4)) : null,
      holdoutFraction,
      smokeTrainFullWindow: rlSmokeTrain,
      trainRebalanceDates: trainRebalancePool.length,
      holdoutRebalanceDates: holdoutRebalanceDates.length,
      ...(isDqnAgentInstance(agent)
        ? {
            batchSize: dqnBatchSize,
            replayBufferSize: agent.replayCapacity,
            targetUpdateFreq: targetUpdateFreqEpisodes,
            targetUpdateFreqEpisodes,
            epsilonStart: dqnEpsStart,
            epsilonEnd: dqnEpsEnd,
            epsilonDecayEpisodes: dqnEpsDecayEp
          }
        : {
            epsilonStart: qLearnEpsStart,
            epsilonEnd: qLearnEpsEnd,
            epsilonDecayEpisodes: qLearnEpsDecayEp
          })
    };

    const cd = convergenceDiagnostics || {
      qSpreadHistory: [],
      epsilonThresholdEpisode: null,
      policyConvergenceEpisode: null
    };
    const epsTh = cd.epsilonThresholdEpisode ?? null;
    const polCv = cd.policyConvergenceEpisode ?? null;
    const finalQSpreadNum =
      typeof agent.getQSpread === 'function' ? Number(agent.getQSpread()) : 0;

    res.json({
      success: true,
      episodes: episodesRun,
      rlGamma: gamma,
      training: trainingBlock,
      evaluation: evaluationBlock,
      skipPostTrainEval,
      rlTrainSkipEarningsFetch,
      episodesRequested: trainUntilThresholds ? null : userEpisodes,
      trainingDurationMs: parseFloat(trainingDurationMs.toFixed(1)),
      trainingDurationSec,
      avgEpisodeMs: avgEpisodeMs != null ? parseFloat(avgEpisodeMs.toFixed(1)) : null,
      trainUntilThresholds,
      trainingStopReason,
      epsilonThresholdEpisode: epsTh,
      policyConvergenceEpisode: polCv,
      finalQSpread: parseFloat(finalQSpreadNum.toFixed(4)),
      qSpreadHistory: cd.qSpreadHistory ?? [],
      convergenceGapEpisodes:
        epsTh !== null && polCv !== null ? polCv - epsTh : null,
      thresholdsTarget: {
        coveragePercentMin: RL_TRAIN_COVERAGE_TARGET_PCT,
        totalQUpdatesMin: RL_TRAIN_MIN_Q_UPDATES,
        met:
          trainingStopReason === 'thresholds_met' ||
          (parseFloat(conv.coveragePercent) >= RL_TRAIN_COVERAGE_TARGET_PCT &&
            agent.totalUpdates >= RL_TRAIN_MIN_Q_UPDATES)
      },
      universeId,
      period,
      totalUpdates: agent.totalUpdates,
      statesVisited: countRlStatesVisited(agent),
      convergence: conv,
      overPruning: over,
      agentType: trainAgentType,
      savedPath: isDqnAgentInstance(agent) ? 'dqn-agent.json' : 'rl-agent.json',
      episodeLog,
      simConfig: {
        ...sharedTrainSimOptions,
        usePaperWeights: usePaperWeightsTrain,
        mlRankingEnabled: enableMlTrain,
        rlTrainSkipEarningsFetch
      },
      trainingTrend: {
        firstHalfAvgAlpha,
        secondHalfAvgAlpha,
        improving:
          firstHalfAvgAlpha != null &&
          secondHalfAvgAlpha != null &&
          secondHalfAvgAlpha > firstHalfAvgAlpha,
        statesVisitedPercent: conv.coveragePercent,
        targetCoverage: '> 30%',
        coverageMeetsTarget: Number.isFinite(coveragePct) && coveragePct >= 30,
        totalQUpdates: agent.totalUpdates,
        targetQUpdates: '> 10000',
        qUpdatesMeetsTarget: agent.totalUpdates >= 10000,
        highExposurePreferenceRatio: over.highExposurePreferenceRatio,
        targetHighExposureRatio: '> 20%',
        highExposureMeetsTarget: over.highExposurePreferenceRatio >= 0.2,
        overPruningLikely: over.overPruningLikely
      }
    });
  } catch (e) {
    console.error('RL train error:', e);
    res.status(500).json({ success: false, error: e.message });
  } finally {
    clearBacktestRuntimeCaches();
  }
});

app.post('/api/rl/hyperparameter-sweep', async (req, res) => {
  const startTime = Date.now();
  try {
    clearBacktestRuntimeCaches();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const configs = Array.isArray(body.configs) ? body.configs : null;
    if (!configs || configs.length === 0) {
      return res.status(400).json({ success: false, error: 'body.configs must be a non-empty array' });
    }

    const universeId = body.universeId || 'sp500_top150';
    const period = body.period || '5y';
    const rebalanceFreq = String(body.rebalanceFreq || 'bimonthly').toLowerCase().trim();
    const allowedFreq = ['monthly', 'quarterly', 'weekly', 'biweekly', 'bimonthly'];
    if (!allowedFreq.includes(rebalanceFreq)) {
      return res.status(400).json({ success: false, error: `Invalid rebalanceFreq` });
    }
    const topN = parseInt(String(body.topN ?? '15'), 10) || 15;
    const capital = parseFloat(String(body.initialCapital ?? '10000')) || 10000;
    const episodesPerConfig = Math.min(
      RL_TRAIN_MAX_EPISODES,
      Math.max(1, parseInt(String(body.episodesPerConfig ?? '20000'), 10) || 20000)
    );
    const strategyClean = 'full_composite';
    const regimeEnabledSweep = body.regimeEnabled !== false;
    const pillarRaw = body.weights != null ? body.weights : body.pillarOverride;
    const pillarNorm = pillarRaw != null ? normalizePillarOverride(pillarRaw) : null;
    const enableMlSweep =
      body.mlRanking === true || body.mlRanking === 'true' || body.mlRanking === '1';
    const skipMlSweep = !enableMlSweep;

    const correlationFilterSweep =
      body.correlationFilter === true ||
      body.correlationFilter === 'true' ||
      body.correlationFilter === 1 ||
      String(body.correlationFilter || '').toLowerCase() === 'true';

    let holdoutFraction = Number(body.holdoutFraction ?? 0.2);
    if (!Number.isFinite(holdoutFraction)) holdoutFraction = 0.2;
    holdoutFraction = Math.min(0.45, Math.max(0.05, holdoutFraction));

    const universe = UNIVERSE_TICKERS[universeId];
    if (!universe) return res.status(400).json({ success: false, error: 'Unknown universe' });

    const periodDays = { '1y': 365, '2y': 730, '3y': 1095, '5y': 1825, '7y': 2555 };
    const days = periodDays[period] || 1825;
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    const lookbackStart = new Date(startDate.getTime() - 400 * 24 * 60 * 60 * 1000);
    const startDateStr = lookbackStart.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    const backtestStartDate = startDate.toISOString().split('T')[0];

    const tickersToFetch = [...new Set([...universe, 'SPY'])].filter(Boolean);
    const priceHistory = {};
    const priceRows = await mapWithConcurrency(tickersToFetch, YAHOO_CHART_CONCURRENCY, async (ticker) => {
      const data = await bt_fetchPriceHistory(ticker, startDateStr, endDateStr);
      return { ticker, data };
    });
    for (const row of priceRows) {
      if (row?.data && !row.__error) priceHistory[row.ticker] = row.data;
    }

    const fundamentals = {};
    const fundRows = await mapWithConcurrency(
      tickersToFetch.filter((t) => t !== 'SPY'),
      FUNDAMENTALS_FETCH_CONCURRENCY,
      async (ticker) => {
        const fund = await fetchFundamentals(ticker);
        return { ticker, fund };
      }
    );
    for (const row of fundRows) {
      if (row?.fund && !row.__error) fundamentals[row.ticker] = row.fund;
    }

    const rebalanceDates = getRebalanceDates(backtestStartDate, endDateStr, rebalanceFreq);
    if (rebalanceDates.length < 12) {
      return res.status(400).json({ success: false, error: 'Need at least 12 rebalance dates for RL sweep' });
    }

    const spyPrices = priceHistory['SPY'];
    if (!spyPrices?.length) {
      return res.status(500).json({
        success: false,
        error:
          'Missing SPY data — Yahoo chart returned no usable daily bars for SPY. Check server logs for "[Yahoo] chart failed SPY"; retry after 30–60s if rate-limited or the network glitched.'
      });
    }

    const simStart = rebalanceDates[0];
    const simEnd = rebalanceDates[rebalanceDates.length - 1];
    const cpiObsStart = subtractMonths(simStart, 60);
    const cpiObservations = await fetchFredCpiObservations(cpiObsStart, simEnd, process.env.FRED_API_KEY);
    const { multiplierFn: cashInflationMult } = buildCashInflationMultiplierFn(
      cpiObservations,
      simStart,
      INFLATION_BASELINE_ANNUAL
    );

    const trainCutoffIdx = Math.floor(rebalanceDates.length * (1 - holdoutFraction));
    const trainRebalancePool = rebalanceDates.slice(0, trainCutoffIdx);
    const holdoutRebalanceDates = rebalanceDates.slice(trainCutoffIdx);
    if (trainRebalancePool.length < 10 || holdoutRebalanceDates.length < 2) {
      return res.status(400).json({
        success: false,
        error:
          'holdoutFraction leaves too few rebalance dates for training or holdout; lower holdoutFraction or use a longer period'
      });
    }

    const sharedSim = {
      adaptiveMode: 'fixed',
      positionSizing: 'invVol',
      pillarOverride: pillarNorm || undefined,
      regimeEnabled: regimeEnabledSweep,
      skipMlRankingAdjustments: skipMlSweep,
      correlationFilter: correlationFilterSweep
    };

    const tradingWeightsSweep = null;
    const evalSimBase = { ...sharedSim, rlRandomAgent: false };
    const targetUpdateFreqEpisodes = Math.max(1, parseInt(String(body.targetUpdateFreq ?? '100'), 10) || 100);

    const oosRulesSim = await runBacktestSimulation(
      universe,
      priceHistory,
      fundamentals,
      spyPrices,
      holdoutRebalanceDates,
      topN,
      capital,
      strategyClean,
      tradingWeightsSweep,
      cashInflationMult,
      universeId,
      {
        ...evalSimBase,
        rlAgent: false,
        rlMode: 'off'
      }
    );
    const rulesBasedOOS = rlSweepPerfTriple(oosRulesSim, capital);

    const configRows = [];
    const sweepAgentSnapshots = [];

    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i] || {};
      const lr = Math.min(0.1, Math.max(1e-6, parseFloat(String(cfg.lr ?? '0.001')) || 0.001));
      const gamma = Math.min(0.999, Math.max(0.5, parseFloat(String(cfg.gamma ?? '0.95')) || 0.95));
      const batchSize = Math.min(256, Math.max(8, parseInt(String(cfg.batchSize ?? '32'), 10) || 32));
      const hiddenSize = Math.min(512, Math.max(8, parseInt(String(cfg.hiddenSize ?? '64'), 10) || 64));
      const hyperparams = { lr, gamma, batchSize, hiddenSize };

      const agent = new DQNAgent({
        lr,
        gamma,
        batchSize,
        hiddenSize,
        replayCapacity: Math.min(500000, Math.max(1000, parseInt(String(body.replayBufferSize ?? '50000'), 10) || 50000)),
        targetSyncEvery: 100,
        epsilonStart: 1,
        epsilonEnd: 0.05,
        epsilonDecayEpisodes: 10000
      });

      await rlRunTrainEpisodesCore({
        agent,
        universe,
        priceHistory,
        fundamentals,
        spyPrices,
        trainRebalancePool,
        topN,
        capital,
        strategyClean,
        tradingWeightsSweep,
        cashInflationMult,
        universeId,
        sharedSim,
        userEpisodes: episodesPerConfig,
        trainUntilThresholds: false,
        rlRandomAgent: false,
        targetUpdateFreqEpisodes,
        collectEpisodeLog: false,
        dqnProgressLogEvery: 0,
        checkpointEvery: 0,
        savedBeta: null,
        logTag: '[HP/sweep]'
      });

      const inSampleSim = await runBacktestSimulation(
        universe,
        priceHistory,
        fundamentals,
        spyPrices,
        rebalanceDates,
        topN,
        capital,
        strategyClean,
        tradingWeightsSweep,
        cashInflationMult,
        universeId,
        {
          ...evalSimBase,
          rlAgent: true,
          rlMode: 'eval',
          rlQLearningAgent: agent
        }
      );
      const oosRlSim = await runBacktestSimulation(
        universe,
        priceHistory,
        fundamentals,
        spyPrices,
        holdoutRebalanceDates,
        topN,
        capital,
        strategyClean,
        tradingWeightsSweep,
        cashInflationMult,
        universeId,
        {
          ...evalSimBase,
          rlAgent: true,
          rlMode: 'eval',
          rlQLearningAgent: agent
        }
      );

      const inSample = rlSweepPerfTriple(inSampleSim, capital);
      const outOfSample = rlSweepPerfTriple(oosRlSim, capital);

      let overfitRatio = null;
      if (
        inSample.sharpe != null &&
        outOfSample.sharpe != null &&
        Number.isFinite(inSample.sharpe) &&
        Number.isFinite(outOfSample.sharpe) &&
        Math.abs(outOfSample.sharpe) > 1e-6
      ) {
        overfitRatio = parseFloat((inSample.sharpe / outOfSample.sharpe).toFixed(3));
      }

      const dqnLiftOOS =
        outOfSample.alpha != null && rulesBasedOOS.alpha != null
          ? parseFloat((outOfSample.alpha - rulesBasedOOS.alpha).toFixed(2))
          : null;

      const overfitFlag = rlOverfitFlagFromRatio(overfitRatio);

      configRows.push({
        hyperparams,
        inSample,
        outOfSample,
        overfitRatio,
        overfitFlag,
        dqnLiftOOS
      });
      sweepAgentSnapshots.push(agent.serialize());

      console.log(
        `HP sweep: config ${i + 1}/${configs.length} done (lr=${lr} gamma=${gamma} h=${hiddenSize}), ` +
          `OOS Sharpe=${outOfSample.sharpe ?? 'n/a'}, overfitRatio=${overfitRatio ?? 'n/a'}`
      );
    }

    const eligible = configRows.filter((r) => {
      if (r.overfitRatio != null && r.overfitRatio > 2.5) return false;
      if (r.dqnLiftOOS == null || r.dqnLiftOOS < 0) return false;
      if (r.outOfSample.sharpe == null || !Number.isFinite(r.outOfSample.sharpe)) return false;
      return true;
    });
    eligible.sort((a, b) => (b.outOfSample.sharpe || 0) - (a.outOfSample.sharpe || 0));

    const rankedByOOSSharpe = [...configRows].sort(
      (a, b) => (b.outOfSample.sharpe ?? -Infinity) - (a.outOfSample.sharpe ?? -Infinity)
    );

    let recommendation;
    let bestAgentSaved = null;
    if (eligible.length === 0) {
      recommendation = {
        hyperparams: null,
        oosSharpe: null,
        oosAlpha: null,
        overfitRatio: null,
        reason:
          'All configs excluded (overfitRatio > 2.5 or negative DQN lift vs rules on holdout). DQN is not adding value — use rules-based only.'
      };
    } else {
      const best = eligible[0];
      const winIdx = configRows.indexOf(best);
      writeFileSync(DQN_AGENT_BEST_JSON_PATH, JSON.stringify(sweepAgentSnapshots[winIdx], null, 2), 'utf8');
      bestAgentSaved = 'dqn-agent-best.json';
      recommendation = {
        hyperparams: best.hyperparams,
        oosSharpe: best.outOfSample.sharpe,
        oosAlpha: best.outOfSample.alpha,
        overfitRatio: best.overfitRatio,
        reason:
          'Best OOS Sharpe among configs with overfitRatio ≤ 2.5 and non-negative DQN lift vs rules on holdout (selection uses OOS only, not in-sample).'
      };
    }

    res.json({
      success: true,
      configs: configRows,
      rulesBasedOOS,
      rankedByOOSSharpe,
      recommendation,
      bestAgentSaved,
      universeId,
      period,
      rebalanceFreq,
      episodesPerConfig,
      holdoutFraction,
      durationSec: parseFloat(((Date.now() - startTime) / 1000).toFixed(2))
    });
  } catch (e) {
    console.error('RL hyperparameter-sweep error:', e);
    res.status(500).json({ success: false, error: e.message });
  } finally {
    clearBacktestRuntimeCaches();
  }
});

/**
 * GET /api/backtest/diagnostic/:universeId
 * Runs full_composite backtests for factor attribution.
 * - ablation=1 — regime/sizing grid (legacy Q60/M20/V20 baseline).
 * - weightsSweep=1 — momentum/quality blends + original six runs; optional includeRlEval=1 appends RL eval on Sharpe-best fixed blend.
 * Query rebalanceFreq (default bimonthly), topN, period, regimeEnabled.
 */
app.get('/api/backtest/diagnostic/:universeId', async (req, res) => {
  const { universeId } = req.params;
  const period = req.query.period || '3y';
  const topN = parseInt(String(req.query.topN || '15'), 10);
  const capital = parseFloat(String(req.query.initialCapital || '10000')) || 10000;
  const rebalanceFreqRaw = String(req.query.rebalanceFreq || 'bimonthly').toLowerCase().trim();
  const allowedDiagFreq = ['monthly', 'bimonthly', 'quarterly', 'weekly', 'biweekly'];
  const rebalanceFreq = allowedDiagFreq.includes(rebalanceFreqRaw) ? rebalanceFreqRaw : 'bimonthly';
  const strategyClean = 'full_composite';
  const regimeEnabledDefault = req.query.regimeEnabled !== 'false' && req.query.regimeEnabled !== false;
  const useAblation =
    req.query.ablation === '1' || req.query.ablation === 'true' || String(req.query.ablation || '').toLowerCase() === 'true';
  const weightsSweep =
    req.query.weightsSweep === '1' ||
    req.query.weightsSweep === 'true' ||
    String(req.query.weightsSweep || '').toLowerCase() === 'true';
  const includeRlEval =
    req.query.includeRlEval === '1' ||
    req.query.includeRlEval === 'true' ||
    String(req.query.includeRlEval || '').toLowerCase() === 'true';

  const universe = UNIVERSE_TICKERS[universeId];
  if (!universe) {
    return res.status(400).json({ success: false, error: 'Unknown universe' });
  }

  const periodDays = { '1y': 365, '2y': 730, '3y': 1095, '5y': 1825, '7y': 2555 };
  const days = periodDays[period] || 1095;
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
  const lookbackStart = new Date(startDate.getTime() - 400 * 24 * 60 * 60 * 1000);
  const startDateStr = lookbackStart.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  const backtestStartDate = startDate.toISOString().split('T')[0];

  /** Legacy anchor for ablation grid (pre–BRK-B recalibration reference). */
  const legacyQ60M20V20 = { fundamental: 0.6, dcf: 0, valuation: 0, momentum: 0.2, value: 0.2 };

  const expandedWeightsSweepDefs = [
    {
      name: 'Momentum 50%, Value 30%, Quality 20%',
      description: 'Recalibration candidate',
      adaptiveMode: 'fixed',
      pillarOverride: { fundamental: 0.2, dcf: 0, valuation: 0, momentum: 0.5, value: 0.3 }
    },
    {
      name: 'Momentum 40%, Quality 30%, Value 30%',
      description: 'Recalibration candidate',
      adaptiveMode: 'fixed',
      pillarOverride: { fundamental: 0.3, dcf: 0, valuation: 0, momentum: 0.4, value: 0.3 }
    },
    {
      name: 'Momentum 60%, Value 40%',
      description: 'Recalibration candidate',
      adaptiveMode: 'fixed',
      pillarOverride: { fundamental: 0, dcf: 0, valuation: 0, momentum: 0.6, value: 0.4 }
    },
    {
      name: 'Momentum 40%, Value 40%, Quality 20%',
      description: 'Recalibration candidate',
      adaptiveMode: 'fixed',
      pillarOverride: { fundamental: 0.2, dcf: 0, valuation: 0, momentum: 0.4, value: 0.4 }
    },
    {
      name: 'Value only',
      description: 'Recalibration candidate',
      adaptiveMode: 'fixed',
      pillarOverride: { fundamental: 0, dcf: 0, valuation: 0, momentum: 0, value: 1 }
    },
    {
      name: 'Momentum 70%, Quality 30%',
      description: 'Recalibration candidate',
      adaptiveMode: 'fixed',
      pillarOverride: { fundamental: 0.3, dcf: 0, valuation: 0, momentum: 0.7, value: 0 }
    },
    {
      name: 'Equal Mom+Val+Quality (33/33/34)',
      description: 'Recalibration candidate',
      adaptiveMode: 'fixed',
      pillarOverride: { fundamental: 0.333, dcf: 0, valuation: 0, momentum: 0.333, value: 0.334 }
    }
  ];

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
      description: 'Legacy Q60/M20/V20 fixed, regime on, inverse-vol sizing',
      adaptiveMode: 'fixed',
      pillarOverride: legacyQ60M20V20,
      regimeEnabled: true,
      positionSizing: 'invVol'
    },
    {
      name: 'No regime (100% exposure)',
      description: 'Same weights; regime overlay off (full exposure, no defensive top-N cut)',
      adaptiveMode: 'fixed',
      pillarOverride: legacyQ60M20V20,
      regimeEnabled: false,
      positionSizing: 'invVol'
    },
    {
      name: 'Equal weight sizing',
      description: 'Same weights; equal position sizes within top picks',
      adaptiveMode: 'fixed',
      pillarOverride: legacyQ60M20V20,
      regimeEnabled: true,
      positionSizing: 'equal'
    },
    {
      name: 'No regime + equal sizing',
      description: 'Regime off + equal weights',
      adaptiveMode: 'fixed',
      pillarOverride: legacyQ60M20V20,
      regimeEnabled: false,
      positionSizing: 'equal'
    },
    {
      name: 'InvVol + 40% equal blend',
      description: '60% inverse-vol / 40% equal blend per rebalance',
      adaptiveMode: 'fixed',
      pillarOverride: legacyQ60M20V20,
      regimeEnabled: true,
      positionSizing: 'invVolBlend'
    }
  ];

  const runDefs = useAblation
    ? ablationRunDefs
    : weightsSweep
      ? [...expandedWeightsSweepDefs, ...factorAttributionRunDefs]
      : factorAttributionRunDefs;

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

    const diagSimBase = {
      rlAgent: false,
      rlMode: 'off',
      skipMlRankingAdjustments: true
    };

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
          ...diagSimBase,
          adaptiveMode: def.adaptiveMode,
          positionSizing: runPositionSizing,
          pillarOverride: def.pillarOverride != null ? def.pillarOverride : undefined,
          regimeEnabled: runRegimeEnabled
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
          pillarOverride: def.pillarOverride != null ? normalizePillarOverride(def.pillarOverride) : null,
          rlAgent: false
        },
        performance
      });
    }

    let summary = null;
    if (weightsSweep && !useAblation) {
      const sharpeOf = (p) => (p && p.sharpe != null ? parseFloat(String(p.sharpe)) : NaN);
      const retOf = (p) => (p && p.totalReturn != null ? parseFloat(String(p.totalReturn)) : NaN);
      const alphaOf = (p) => (p && p.alpha != null ? parseFloat(String(p.alpha)) : NaN);
      let bestSharpe = { name: null, sharpe: -Infinity, pillarOverride: null, performance: null };
      let bestReturn = { name: null, totalReturn: -Infinity, performance: null };
      for (const r of runs) {
        const po = r.config?.pillarOverride;
        if (!po || r.config?.adaptiveMode !== 'fixed') continue;
        const sh = sharpeOf(r.performance);
        const tr = retOf(r.performance);
        if (Number.isFinite(sh) && sh > bestSharpe.sharpe) {
          bestSharpe = { name: r.name, sharpe: sh, pillarOverride: po, performance: r.performance };
        }
        if (Number.isFinite(tr) && tr > bestReturn.totalReturn) {
          bestReturn = { name: r.name, totalReturn: tr, performance: r.performance };
        }
      }
      summary = {
        bestBySharpe: bestSharpe.name
          ? {
              name: bestSharpe.name,
              sharpe: bestSharpe.sharpe,
              totalReturn: retOf(bestSharpe.performance),
              alpha: alphaOf(bestSharpe.performance),
              pillarOverride: bestSharpe.pillarOverride
            }
          : null,
        bestByTotalReturn: bestReturn.name
          ? {
              name: bestReturn.name,
              totalReturn: bestReturn.totalReturn,
              sharpe: sharpeOf(bestReturn.performance),
              alpha: alphaOf(bestReturn.performance)
            }
          : null,
        note: 'DEFAULT_COMPOSITE_WEIGHTS on server should match bestBySharpe.pillarOverride after you verify.'
      };

      if (includeRlEval && bestSharpe.pillarOverride && (TRAINED_RL_AGENT ?? loadRlAgentFromDisk())) {
        const simRl = await runBacktestSimulation(
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
            ...diagSimBase,
            adaptiveMode: 'fixed',
            positionSizing: 'invVol',
            pillarOverride: bestSharpe.pillarOverride,
            regimeEnabled: regimeEnabledDefault,
            rlAgent: true,
            rlMode: 'eval'
          }
        );
        const performanceRl = extractDiagnosticPerformance(simRl, capital);
        runs.push({
          name: `RL eval on Sharpe winner (${bestSharpe.name})`,
          description: 'Same pillar weights as bestBySharpe; Q-learning eval agent on',
          config: {
            adaptiveMode: 'fixed',
            rebalanceFreq,
            topN,
            strategy: strategyClean,
            positionSizing: 'invVol',
            regimeEnabled: regimeEnabledDefault,
            pillarOverride: bestSharpe.pillarOverride,
            rlAgent: true,
            rlMode: 'eval'
          },
          performance: performanceRl
        });
        if (summary.bestBySharpe) {
          summary.rlEvalVsWinnerSharpe = {
            rulesSharpe: summary.bestBySharpe.sharpe,
            rlSharpe: sharpeOf(performanceRl),
            rulesReturn: summary.bestBySharpe.totalReturn,
            rlReturn: retOf(performanceRl)
          };
        }
      } else if (includeRlEval) {
        summary.rlEvalSkipped = !bestSharpe.pillarOverride
          ? 'no_fixed_winner'
          : 'no_rl_agent_on_disk';
      }
    }

    res.json({
      success: true,
      diagnostic: true,
      ablation: useAblation,
      weightsSweep: weightsSweep && !useAblation,
      universe: universeId,
      period,
      rebalanceFreq,
      topN,
      initialCapital: capital,
      regimeEnabled: regimeEnabledDefault,
      runs,
      ...(summary ? { summary } : {})
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

function getPortfolioPathForUniverse(universeId) {
  const u = String(universeId || '').trim();
  if (u === 'sp500_top150') return PAPER_PORTFOLIO_TOP150_PATH;
  if (u === 'sp500_top50') return PAPER_PORTFOLIO_TOP50_PATH;
  return PAPER_PORTFOLIO_PATH;
}

/** Primary dual slot when no legacy file (default top 150). */
function resolvePaperUniverseFromRequest(req) {
  const q = req.query?.universe ?? req.query?.universeId;
  const b = req.body?.universeId ?? req.body?.universe;
  const raw = q != null && String(q).trim() !== '' ? q : b != null && String(b).trim() !== '' ? b : null;
  if (raw == null) return 'sp500_top150';
  const u = String(raw).trim();
  return UNIVERSE_TICKERS[u] ? u : 'sp500_top150';
}

function loadPortfolio(portfolioPath = PAPER_PORTFOLIO_PATH) {
  if (!existsSync(portfolioPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(portfolioPath, 'utf-8'));
    if (raw === null) return null;
    const p = normalizePaperPortfolio(raw);
    if (p) {
      p.__diskPath = portfolioPath;
      if (p.config && p.config.universeId == null && p.config.universe) {
        p.config.universeId = p.config.universe;
      }
    }
    return p;
  } catch {
    return null;
  }
}

function savePortfolio(portfolio, portfolioPath = null) {
  const fp = portfolioPath ?? portfolio?.__diskPath ?? PAPER_PORTFOLIO_PATH;
  if (portfolio === null) {
    writeFileSync(fp, 'null');
  } else {
    const out = { ...portfolio };
    delete out.__diskPath;
    writeFileSync(fp, JSON.stringify(out, null, 2));
  }
}

function loadPrimaryPaperPortfolioForBacktest() {
  return loadPortfolio(getPortfolioPathForUniverse('sp500_top150')) ?? loadPortfolio(PAPER_PORTFOLIO_PATH);
}

/** Load paper JSON for a universe; top150 also falls back to legacy `paper-portfolio.json` if the dual file is absent. */
function loadPaperPortfolioForUniverse(universeId) {
  const uid = String(universeId || '').trim() || 'sp500_top150';
  const fp = getPortfolioPathForUniverse(uid);
  let p = loadPortfolio(fp);
  if (!p && uid === 'sp500_top150') {
    p = loadPortfolio(PAPER_PORTFOLIO_PATH);
  }
  return p;
}

function paperTradingUniverseId(portfolio) {
  const c = portfolio?.config || {};
  return String(c.universeId ?? c.universe ?? 'sp500_top150').trim();
}

function getRlAgentForPaperPortfolio(portfolio) {
  if (rlAgentTypeEffective() === 'dqn') return TRAINED_RL_AGENT;
  return getQlAgentForUniverse(paperTradingUniverseId(portfolio));
}

function ensureDualPaperPortfoliosInitialized() {
  const DEFAULT_W = { momentum: 0.3, value: 0.3, fundamental: 0.1, earningsMomentum: 0.15, dcf: 0, valuation: 0 };
  const wSum = FACTOR_NAMES.reduce((a, f) => a + Math.max(0, Number(DEFAULT_W[f]) || 0), 0);
  const wNorm = {};
  for (const f of FACTOR_NAMES) wNorm[f] = wSum > 0 ? parseFloat(((Number(DEFAULT_W[f]) || 0) / wSum).toFixed(6)) : 0;
  for (const uid of ['sp500_top50', 'sp500_top150']) {
    const pp = getPortfolioPathForUniverse(uid);
    if (existsSync(pp)) continue;
    const portfolio = createEmptyPortfolio({
      initialCapital: 100000,
      strategy: 'full_composite',
      universe: uid,
      topN: 15,
      weights: { ...wNorm },
      adaptiveMode: 'adaptive',
      rebalanceFreq: 'monthly',
      rlAgent: true,
      rlOnlineLearning: true,
      positionSizing: 'invVol',
      regimeEnabled: true
    });
    portfolio.config.universeId = uid;
    savePortfolio(portfolio, pp);
    console.log('[PAPER] Initialized', path.basename(pp), 'for', uid);
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

/**
 * On-disk edits often use `positions` or leave `cash` null — align with createEmptyPortfolio shape.
 */
function normalizePaperPortfolio(p) {
  if (!p || typeof p !== 'object') return null;
  const out = { ...p };
  if (Array.isArray(out.positions) && !Array.isArray(out.holdings)) {
    console.warn('[paper-trade] Migrating legacy "positions" → "holdings" in paper-portfolio.json');
    out.holdings = out.positions;
    delete out.positions;
  }
  if (!Array.isArray(out.holdings)) out.holdings = [];
  const ic = Number.isFinite(Number(out.initialCapital)) ? Number(out.initialCapital) : 100000;
  out.initialCapital = ic;
  if (out.config && typeof out.config === 'object') {
    if (out.config.initialCapital == null || !Number.isFinite(Number(out.config.initialCapital))) {
      out.config.initialCapital = ic;
    }
  }
  let c = Number(out.cash);
  if (!Number.isFinite(c)) c = ic;
  out.cash = c;
  if (!Array.isArray(out.navHistory)) out.navHistory = [];
  if (!Array.isArray(out.rebalanceHistory)) out.rebalanceHistory = [];
  if (out.recentSells == null || typeof out.recentSells !== 'object' || Array.isArray(out.recentSells)) {
    out.recentSells = {};
  }
  if (out.createdAt == null || out.createdAt === '') {
    out.createdAt = new Date().toISOString().split('T')[0];
  }
  return out;
}

function resolvePaperAsOfDate(body) {
  const serverToday = new Date().toISOString().split('T')[0];
  const raw = body?.date ?? body?.asOfDate;
  if (raw == null || typeof raw !== 'string') return serverToday;
  const d = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return serverToday;
  return d > serverToday ? serverToday : d;
}

const PAPER_SCHEDULE_FREQ_ALLOWED = ['monthly', 'quarterly', 'weekly', 'biweekly', 'bimonthly'];

function normalizePaperRebalanceFreq(portfolio) {
  const raw = String(portfolio?.config?.rebalanceFreq || 'bimonthly').toLowerCase().trim();
  return PAPER_SCHEDULE_FREQ_ALLOWED.includes(raw) ? raw : 'bimonthly';
}

/** Next / missed scheduled anchors for paper (uses `config.rebalanceFreq`, default bimonthly). */
function buildPaperTradeScheduleResponse(portfolio) {
  const today = new Date().toISOString().split('T')[0];
  const rebalanceFreq = normalizePaperRebalanceFreq(portfolio);
  const anchor = (portfolio.createdAt && String(portfolio.createdAt).slice(0, 10)) || today;
  const lastRebalance = portfolio.lastRebalance || null;
  const histDates = new Set((portfolio.rebalanceHistory || []).map((r) => r.date).filter(Boolean));
  const endGen = isoAddDays(today, 800) || today;
  const scheduled = getRebalanceDates(anchor, endGen, rebalanceFreq);
  const nextRebalance = scheduled.find((d) => d >= today) || null;
  const daysUntilNext = nextRebalance != null ? daysBetween(today, nextRebalance) : null;
  const todayIsRebalanceDay = scheduled.includes(today);
  const missedRebalances = [];
  const lower = lastRebalance || '';
  for (const d of scheduled) {
    if (d <= lower) continue;
    if (d > today) break;
    if (!histDates.has(d)) missedRebalances.push(d);
  }
  return {
    lastRebalance,
    nextRebalance,
    daysUntilNext,
    todayIsRebalanceDay,
    missedRebalances,
    rebalanceFreq
  };
}

// =====================================================================
// DASHBOARD — market indices + summary (uses paper portfolios on disk)
// =====================================================================

let marketIndicesCache = { ts: 0, data: null };

/** Rough sector tags for portfolio composition (S&P-heavy names). */
const DASHBOARD_SECTOR_BY_TICKER = Object.freeze({
  AAPL: 'Technology',
  MSFT: 'Technology',
  AMZN: 'Consumer',
  NVDA: 'Technology',
  GOOGL: 'Technology',
  META: 'Technology',
  AVGO: 'Technology',
  TSLA: 'Consumer',
  NFLX: 'Communication',
  AMD: 'Technology',
  CRM: 'Technology',
  ADBE: 'Technology',
  ACN: 'Technology',
  CSCO: 'Technology',
  TXN: 'Technology',
  QCOM: 'Technology',
  ISRG: 'Healthcare',
  INTU: 'Technology',
  AMAT: 'Technology',
  NEE: 'Utilities',
  LIN: 'Materials',
  PM: 'Consumer',
  GE: 'Industrials',
  RTX: 'Industrials',
  HON: 'Industrials',
  CAT: 'Industrials',
  BRK: 'Financials',
  'BRK-B': 'Financials',
  JPM: 'Financials',
  BAC: 'Financials',
  WFC: 'Financials',
  V: 'Financials',
  MA: 'Financials',
  XOM: 'Energy',
  CVX: 'Energy',
  UNH: 'Healthcare',
  LLY: 'Healthcare',
  JNJ: 'Healthcare',
  ABBV: 'Healthcare',
  MRK: 'Healthcare',
  TMO: 'Healthcare',
  ABT: 'Healthcare',
  AMGN: 'Healthcare',
  PFE: 'Healthcare',
  VRTX: 'Healthcare',
  HD: 'Consumer',
  WMT: 'Consumer',
  PG: 'Consumer',
  KO: 'Consumer',
  PEP: 'Consumer',
  MCD: 'Consumer',
  COST: 'Consumer',
  LOW: 'Consumer',
  GS: 'Financials',
  SCHW: 'Financials',
  BLK: 'Financials',
  SPGI: 'Financials',
  DE: 'Industrials',
  UNP: 'Industrials',
  LMT: 'Industrials',
  BA: 'Industrials',
  UPS: 'Industrials',
  FDX: 'Industrials',
  SPY: 'ETF',
  QQQ: 'ETF',
  DIA: 'ETF',
  IWM: 'ETF'
});

function dashboardSectorForTicker(t) {
  const u = String(t || '').toUpperCase().trim();
  return DASHBOARD_SECTOR_BY_TICKER[u] || 'Other';
}

function dashboardRegimeBadge(regimeRaw) {
  const r = String(regimeRaw || '').toLowerCase().trim();
  const label =
    r === 'strong_bull'
      ? 'STRONG BULL'
      : r === 'normal'
        ? 'NORMAL'
        : r === 'pullback' || r === 'correction'
          ? 'PULLBACK'
          : r === 'caution'
            ? 'CAUTION'
            : r === 'bear'
              ? 'BEAR'
              : regimeRaw
                ? String(regimeRaw).replace(/_/g, ' ').toUpperCase()
                : 'UNKNOWN';
  let tone = 'neutral';
  if (r === 'strong_bull' || r === 'normal') tone = 'bull';
  else if (r === 'pullback' || r === 'correction') tone = 'pullback';
  else if (r === 'caution') tone = 'caution';
  else if (r === 'bear') tone = 'bear';
  return { label, tone, raw: regimeRaw || null };
}

function computeDashboardPortfolioCard(portfolio) {
  if (!portfolio) return null;
  const uid = paperTradingUniverseId(portfolio);
  const sched = buildPaperTradeScheduleResponse(portfolio);
  const initialCap = Number(portfolio.initialCapital) || 0;
  const sum = portfolio.summary;
  const navSorted = [...(portfolio.navHistory || [])].sort((a, b) =>
    String(a.date || '').localeCompare(String(b.date || ''))
  );
  const nav = navSorted.length ? navSorted[navSorted.length - 1] : null;

  let totalValue = null;
  if (sum && Number.isFinite(Number(sum.totalValue))) {
    totalValue = Number(sum.totalValue);
  }
  if (totalValue == null || !Number.isFinite(Number(totalValue))) {
    let tv = nav?.portfolioValue;
    if (tv == null || !Number.isFinite(Number(tv))) {
      const holdings = portfolio.holdings || [];
      tv =
        Number(portfolio.cash || 0) +
        holdings.reduce((s, h) => {
          const px =
            h.currentPrice != null && Number.isFinite(Number(h.currentPrice))
              ? Number(h.currentPrice)
              : Number(h.entryPrice) || 0;
          return s + h.shares * px;
        }, 0);
    }
    if (tv == null || !Number.isFinite(Number(tv))) {
      tv =
        Number(portfolio.cash || 0) +
        (portfolio.holdings || []).reduce((s, h) => s + h.shares * (h.entryPrice || 0), 0);
    }
    totalValue = Number(tv);
  }

  let retPct = 0;
  if (sum && Number.isFinite(Number(sum.totalReturn))) {
    retPct = Number(sum.totalReturn);
  } else if (initialCap > 0) {
    retPct = ((totalValue / initialCap) - 1) * 100;
  }
  const agent = getRlAgentForPaperPortfolio(portfolio);
  const rlActive =
    paperPortfolioRlEnabled(portfolio) && trainedRlAgentReadyForInference(agent) && rlEvalEnvEnabled();
  const lastRb =
    portfolio.rebalanceHistory?.length > 0
      ? portfolio.rebalanceHistory[portfolio.rebalanceHistory.length - 1]
      : null;
  return {
    universeId: uid,
    totalValue: parseFloat(totalValue.toFixed(2)),
    returnPct: parseFloat(retPct.toFixed(2)),
    positions: (portfolio.holdings || []).length,
    nextRebalance: sched.nextRebalance,
    lastRebalance: portfolio.lastRebalance || null,
    rebalanceFreq: sched.rebalanceFreq,
    rlActive,
    rlOnlineLearning: portfolio.config?.rlOnlineLearning === true,
    regime: lastRb?.regime ?? null,
    adaptiveWeights: portfolio.config?.weights || null
  };
}

function buildDashboardRecentSignals(portfolio, max = 3) {
  const rh = portfolio?.rebalanceHistory;
  if (!rh?.length) return [];
  const slice = rh.slice(-max).reverse();
  return slice.map((rb) => {
    const buys = (rb.buys || []).map((b) => b.ticker).filter(Boolean);
    const sells = (rb.sells || []).map((s) => s.ticker).filter(Boolean);
    const stopTickers = (rb.sells || []).filter((s) => s.reason === 'STOP').map((s) => s.ticker);
    return {
      date: rb.date,
      regime: rb.regime,
      buys,
      sells,
      stopTickers
    };
  });
}

/** Blend weights are stored as decimals (0.35) or occasionally as percent-style (35). */
function normalizeBlendWeightForPulse(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n / 100 : n;
}

function factorPulseFromPortfolio(portfolio) {
  const anchor = portfolio?.config?.weights || null;
  const rb =
    portfolio?.rebalanceHistory?.length > 0
      ? portfolio.rebalanceHistory[portfolio.rebalanceHistory.length - 1]
      : null;
  const wc = rb?.report?.weightChanges;
  if (!wc || !wc.new) return { factors: [], anchor };
  const prev = wc.previous || {};
  const neu = wc.new;
  const factors = FACTOR_NAMES.map((f) => {
    const w = normalizeBlendWeightForPulse(neu[f] ?? 0);
    const a = normalizeBlendWeightForPulse(anchor?.[f] ?? 1 / FACTOR_NAMES.length);
    const delta = w - a;
    const prevW = normalizeBlendWeightForPulse(prev[f] ?? w);
    const trend = w > prevW + 0.002 ? 'up' : w < prevW - 0.002 ? 'down' : 'flat';
    let label = 'STEADY';
    if (delta > 0.02) label = 'HOT';
    else if (delta > 0.005) label = 'WARMING';
    else if (delta < -0.02) label = 'COLD';
    else if (delta < -0.005) label = 'COOLING';
    else if (Math.abs(delta) <= 0.005) label = 'FLAT';
    return {
      key: f,
      label: FACTOR_LABELS[f] || f,
      weight: w,
      weightPct: parseFloat((w * 100).toFixed(1)),
      anchorPct: parseFloat((a * 100).toFixed(1)),
      trend,
      pulseLabel: label
    };
  });
  factors.sort((a, b) => b.weight - a.weight);
  return { factors, anchor };
}

function topMoversFromLastRanking(portfolio) {
  const rb =
    portfolio?.rebalanceHistory?.length > 0
      ? portfolio.rebalanceHistory[portfolio.rebalanceHistory.length - 1]
      : null;
  const all = rb?.allRankings;
  if (!all?.length) {
    return { gainers: [], losers: [], active: [] };
  }
  const sorted = [...all].sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));
  const gainers = sorted.slice(0, 5).map((r) => ({
    ticker: r.ticker,
    compositeScore: r.compositeScore
  }));
  const losers = sorted.slice(-5).reverse().map((r) => ({
    ticker: r.ticker,
    compositeScore: r.compositeScore
  }));
  const scores = all.map((r) => r.compositeScore || 0).sort((a, b) => a - b);
  const med = scores[Math.floor(scores.length / 2)] ?? 50;
  const active = [...all]
    .sort(
      (a, b) =>
        Math.abs((b.compositeScore || 0) - med) - Math.abs((a.compositeScore || 0) - med)
    )
    .slice(0, 5)
    .map((r) => ({ ticker: r.ticker, compositeScore: r.compositeScore }));
  return { gainers, losers, active };
}

function sectorBreakdownFromHoldings(portfolio) {
  const holdings = portfolio?.holdings || [];
  let total = 0;
  const bySec = {};
  for (const h of holdings) {
    const mv = h.shares * (h.entryPrice || 0);
    total += mv;
    const sec = dashboardSectorForTicker(h.ticker);
    bySec[sec] = (bySec[sec] || 0) + mv;
  }
  if (total <= 0) return [];
  return Object.entries(bySec)
    .map(([name, v]) => ({
      name,
      value: parseFloat(v.toFixed(2)),
      pct: parseFloat(((v / total) * 100).toFixed(1))
    }))
    .sort((a, b) => b.value - a.value);
}

/** Yahoo daily history for dashboard sparklines — ETF proxies track index charts reliably. */
const DASH_INDEX_SPARKLINE_SYMBOL = {
  '^GSPC': 'SPY',
  '^IXIC': 'QQQ',
  '^DJI': 'DIA',
  '^VIX': '^VIX'
};

async function fetchSparklineCloses(displaySymbol, startStr, endStr, targetPoints = 30) {
  const proxy = DASH_INDEX_SPARKLINE_SYMBOL[displaySymbol] || displaySymbol;
  const trySyms = proxy !== displaySymbol ? [proxy, displaySymbol] : [displaySymbol];
  let best = [];
  for (const sym of trySyms) {
    try {
      const rows = await bt_fetchPriceHistory(sym, startStr, endStr);
      if (!rows?.length) continue;
      const closes = rows.map((r) => Number(r.close)).filter((n) => Number.isFinite(n));
      if (closes.length > best.length) best = closes;
    } catch (e) {
      console.warn('[dashboard] sparkline', sym, e.message);
    }
  }
  if (best.length <= targetPoints) return best;
  return best.slice(-targetPoints);
}

async function buildMarketIndicesPayload() {
  const defs = [
    { symbol: '^GSPC', name: 'S&P 500', decimals: 2 },
    { symbol: '^IXIC', name: 'NASDAQ', decimals: 2 },
    { symbol: '^DJI', name: 'DOW', decimals: 2 },
    { symbol: '^VIX', name: 'VIX', decimals: 2 }
  ];
  const syms = defs.map((d) => d.symbol);
  const quoteMap = await fetchYahooQuotesBatch(syms);
  const end = new Date();
  const start = new Date(end.getTime() - 100 * 86400000);
  const startStr = start.toISOString().split('T')[0];
  const endStr = end.toISOString().split('T')[0];
  const indices = [];
  for (const def of defs) {
    const row =
      quoteMap.get(def.symbol.toUpperCase()) ||
      quoteMap.get(def.symbol) ||
      [...quoteMap.values()].find((q) => String(q?.symbol || '').toUpperCase() === def.symbol.toUpperCase());
    const price = row ? yfNum(row.regularMarketPrice) : null;
    const chg = row ? yfNum(row.regularMarketChangePercent) : null;
    let sparkline = [];
    try {
      sparkline = await fetchSparklineCloses(def.symbol, startStr, endStr, 30);
    } catch (e) {
      console.warn('[dashboard] sparkline', def.symbol, e.message);
    }
    const dec = def.decimals ?? 2;
    indices.push({
      symbol: def.symbol,
      name: def.name,
      price: price != null ? parseFloat(price.toFixed(dec)) : null,
      change: chg != null ? parseFloat(chg.toFixed(2)) : null,
      sparkline
    });
  }
  return {
    indices,
    updatedAt: new Date().toISOString(),
    staleWarning: bt_fetchPriceHistory.lastStaleWarning || null
  };
}

function assembleDashboardSummary() {
  const p50 = loadPaperPortfolioForUniverse('sp500_top50');
  const p150 = loadPaperPortfolioForUniverse('sp500_top150');
  const primary = p150 || p50;
  const regimeRaw = primary?.rebalanceHistory?.length
    ? primary.rebalanceHistory[primary.rebalanceHistory.length - 1].regime
    : null;
  const badge = dashboardRegimeBadge(regimeRaw);
  const sched = primary ? buildPaperTradeScheduleResponse(primary) : null;

  const agentType = rlAgentTypeEffective();
  const agentMain = TRAINED_RL_AGENT;
  const mainLoaded = trainedRlAgentReadyForInference(agentMain);
  const agents = {};
  for (const uid of ['sp500_top50', 'sp500_top150']) {
    const a = RL_AGENTS_BY_UNIVERSE[uid];
    agents[uid] = {
      loaded: a != null && trainedRlAgentReadyForInference(a)
    };
  }

  const portfolios = {
    sp500_top50: computeDashboardPortfolioCard(p50),
    sp500_top150: computeDashboardPortfolioCard(p150)
  };

  const systemLineParts = [];
  if (agentType === 'dqn' || mainLoaded) systemLineParts.push(`${agentType === 'dqn' ? 'DQN' : 'Q-learning'} active`);
  if (p150?.config?.rlOnlineLearning === true || p50?.config?.rlOnlineLearning === true) {
    systemLineParts.push('Online learning ON');
  }
  if (p50 && p150) systemLineParts.push('2 portfolios live');
  else if (p50 || p150) systemLineParts.push('1 portfolio live');

  return {
    success: true,
    updatedAt: new Date().toISOString(),
    regime: regimeRaw,
    regimeBadge: badge,
    systemStatus: {
      lines: systemLineParts,
      lastRebalance: sched?.lastRebalance ?? primary?.lastRebalance ?? null,
      nextRebalance: sched?.nextRebalance ?? null,
      adaptiveWeights: primary?.config?.weights || null
    },
    rl: {
      agentType,
      mainAgentReady: mainLoaded,
      agents
    },
    portfolios,
    recentSignals: buildDashboardRecentSignals(primary, 3),
    factorPulse: factorPulseFromPortfolio(primary),
    topMovers: topMoversFromLastRanking(primary),
    sectorBreakdown: sectorBreakdownFromHoldings(primary),
    primaryUniverse: primary ? paperTradingUniverseId(primary) : 'sp500_top150'
  };
}

app.get('/api/market/indices', async (req, res) => {
  try {
    const bypassSnap =
      (req.query._t !== undefined && String(req.query._t) !== '') || req.query.fresh === 'true';
    if (!bypassSnap && localUiSnapshotsReadEnabled()) {
      const snap = readLocalUiSnapshot('market-indices');
      if (snap && isSnapshotFresh(snap.ts)) {
        return res.json({
          ...snap.data,
          localSnapshot: true,
          snapshotAgeMs: Date.now() - snap.ts
        });
      }
    }
    const ttl = 90000;
    const now = Date.now();
    if (marketIndicesCache.data && now - marketIndicesCache.ts < ttl) {
      return res.json(marketIndicesCache.data);
    }
    const payload = await buildMarketIndicesPayload();
    marketIndicesCache = { ts: now, data: payload };
    if (!bypassSnap && localUiSnapshotWriteEnabled()) {
      writeLocalUiSnapshot('market-indices', payload);
    }
    res.json(payload);
  } catch (e) {
    console.error('[dashboard] market indices error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/dashboard/summary', (req, res) => {
  try {
    const bypassSnap =
      (req.query._t !== undefined && String(req.query._t) !== '') || req.query.fresh === 'true';
    if (!bypassSnap && localUiSnapshotsReadEnabled()) {
      const snap = readLocalUiSnapshot('dashboard-summary');
      if (snap && isSnapshotFresh(snap.ts)) {
        return res.json({
          ...snap.data,
          localSnapshot: true,
          snapshotAgeMs: Date.now() - snap.ts
        });
      }
    }
    const summary = assembleDashboardSummary();
    if (!bypassSnap && localUiSnapshotWriteEnabled()) {
      writeLocalUiSnapshot('dashboard-summary', summary);
    }
    res.json(summary);
  } catch (e) {
    console.error('[dashboard] summary error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// =====================================================================
// OPTIMIZATION — Reset / Freeze
// =====================================================================

app.post('/api/optimization/reset', (req, res) => {
  const universeId = resolvePaperUniverseFromRequest(req);
  const portfolio = loadPaperPortfolioForUniverse(universeId);
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
  const universeId = resolvePaperUniverseFromRequest(req);
  const portfolio = loadPaperPortfolioForUniverse(universeId);
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
  const universeId = resolvePaperUniverseFromRequest(req);
  const portfolio = loadPaperPortfolioForUniverse(universeId);
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
  const {
    initialCapital = 100000,
    strategy = 'full_composite',
    universe = 'sp500_top150',
    topN = 15,
    mlRankWeight: mlBody,
    adaptiveMode: initAdaptive,
    positionSizing: initPosSize,
    regimeEnabled: initRegimeEnabled,
    correlationFilter: initCorrelationFilter,
    maxCorrelated: initMaxCorrelated,
    correlationLookbackDays: initCorrelationLookback
  } = req.body || {};
  const targetUniverse = String(req.body?.universeId ?? universe ?? 'sp500_top150').trim();
  const pp = getPortfolioPathForUniverse(targetUniverse);
  if (loadPaperPortfolioForUniverse(targetUniverse)) {
    return res.status(409).json({
      success: false,
      error: 'Portfolio already exists for this universe. DELETE /api/paper-trade/reset?universe=' + encodeURIComponent(targetUniverse) + ' first.'
    });
  }
  let mlRankWeight = parseFloat(process.env.ML_RANK_WEIGHT || '0');
  if (!Number.isFinite(mlRankWeight)) mlRankWeight = 0;
  mlRankWeight = Math.max(0, Math.min(1, mlRankWeight));
  if (mlBody != null && mlBody !== '') {
    const v = parseFloat(mlBody);
    if (Number.isFinite(v)) mlRankWeight = Math.max(0, Math.min(1, v));
  }
  const amInitRaw = initAdaptive != null && initAdaptive !== '' ? String(initAdaptive).toLowerCase().trim() : '';
  const amInit = amInitRaw === 'fixed' ? 'fixed' : amInitRaw === 'conservative' ? 'conservative' : 'adaptive';
  const psInitRaw = initPosSize != null && String(initPosSize).trim() !== '' ? String(initPosSize).toLowerCase().trim() : null;
  const psInit =
    psInitRaw && ['equal', 'invVol', 'score', 'invVolBlend'].includes(psInitRaw)
      ? psInitRaw
      : strategy === 'full_composite' || strategy === 'full_composite_aggressive' || strategy === 'full_composite_turbo'
        ? 'invVol'
        : undefined;
  const regimeEnabledInit =
    initRegimeEnabled === false || initRegimeEnabled === 'false' ? false : true;
  const correlationFilterInit =
    initCorrelationFilter === true ||
    initCorrelationFilter === 'true' ||
    initCorrelationFilter === '1' ||
    initCorrelationFilter === 1;
  const initMxcRaw = parseInt(String(initMaxCorrelated ?? ''), 10);
  const maxCorrelatedInit = Number.isFinite(initMxcRaw) ? Math.max(1, initMxcRaw) : 3;
  const initClbRaw = parseInt(String(initCorrelationLookback ?? ''), 10);
  const correlationLookbackInit = Number.isFinite(initClbRaw) ? Math.max(20, initClbRaw) : 60;
  const bodyRl = req.body?.rlAgent;
  const rlInitOn =
    bodyRl === false || bodyRl === 'false' || bodyRl === '0'
      ? false
      : bodyRl === true || bodyRl === 'true' || bodyRl === '1'
        ? true
        : TRAINED_RL_AGENT != null && rlEvalEnvEnabled();
  const rlOnlineInit =
    req.body?.rlOnlineLearning === true ||
    req.body?.rlOnlineLearning === 'true' ||
    req.body?.rlOnlineLearning === '1';
  const freqRaw =
    req.body?.rebalanceFreq != null && req.body?.rebalanceFreq !== ''
      ? String(req.body.rebalanceFreq).toLowerCase().trim()
      : 'bimonthly';
  const rebalanceFreqInit = PAPER_SCHEDULE_FREQ_ALLOWED.includes(freqRaw) ? freqRaw : 'bimonthly';
  const config = {
    initialCapital: parseFloat(initialCapital),
    strategy,
    universe: targetUniverse,
    universeId: targetUniverse,
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
    rebalanceFreq: rebalanceFreqInit,
    ...(psInit ? { positionSizing: psInit } : {}),
    ...(strategy === 'full_composite' ||
    strategy === 'full_composite_aggressive' ||
    strategy === 'full_composite_turbo'
      ? {
          rlAgent: rlInitOn,
          rlOnlineLearning: rlOnlineInit,
          correlationFilter: correlationFilterInit,
          maxCorrelated: maxCorrelatedInit,
          correlationLookbackDays: correlationLookbackInit
        }
      : {})
  };
  const bw = req.body?.weights;
  if (
    bw != null &&
    typeof bw === 'object' &&
    !Array.isArray(bw) &&
    (strategy === 'full_composite' || strategy === 'full_composite_aggressive' || strategy === 'full_composite_turbo') &&
    config.weights
  ) {
    for (const f of FACTOR_NAMES) {
      if (!Object.prototype.hasOwnProperty.call(bw, f)) continue;
      const v = bw[f];
      if (v === null || v === undefined || v === '') continue;
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      if (Number.isFinite(n)) config.weights[f] = n;
    }
    const wSum = FACTOR_NAMES.reduce((a, f) => a + Math.max(0, Number(config.weights[f]) || 0), 0);
    if (wSum > 1e-9) {
      for (const f of FACTOR_NAMES) {
        config.weights[f] = parseFloat(((Number(config.weights[f]) || 0) / wSum).toFixed(6));
      }
    }
  }
  if (!UNIVERSE_TICKERS[config.universe]) {
    return res.status(400).json({ success: false, error: `Unknown universe: ${config.universe}` });
  }
  const portfolio = createEmptyPortfolio(config);
  savePortfolio(portfolio, pp);
  res.json({ success: true, portfolio });
});

app.delete('/api/paper-trade/reset', (req, res) => {
  const universeId = resolvePaperUniverseFromRequest(req);
  const fp = getPortfolioPathForUniverse(universeId);
  savePortfolio(null, fp);
  res.json({ success: true, message: 'Portfolio reset.', universeId });
});

/** Toggle RL / online learning without resetting the portfolio (composite strategies only). */
app.patch('/api/paper-trade/config', (req, res) => {
  try {
    const universeId = resolvePaperUniverseFromRequest(req);
    const portfolio = loadPaperPortfolioForUniverse(universeId);
    if (!portfolio) {
      return res.status(404).json({ success: false, error: 'No portfolio. POST /api/paper-trade/init first.' });
    }
    const body = req.body || {};
    const strat = portfolio.config?.strategy || '';
    const composite =
      strat === 'full_composite' || strat === 'full_composite_aggressive' || strat === 'full_composite_turbo';
    if (
      !composite &&
      (body.rlAgent !== undefined ||
        body.rlOnlineLearning !== undefined ||
        (body.weights != null && typeof body.weights === 'object'))
    ) {
      return res.status(400).json({
        success: false,
        error: 'RL and weight patches apply only to full composite strategies.',
      });
    }
    if (body.rlAgent !== undefined) {
      portfolio.config.rlAgent = body.rlAgent === true || body.rlAgent === 'true' || body.rlAgent === '1' || body.rlAgent === 1;
    }
    if (body.rlOnlineLearning !== undefined) {
      portfolio.config.rlOnlineLearning =
        body.rlOnlineLearning === true || body.rlOnlineLearning === 'true' || body.rlOnlineLearning === '1' || body.rlOnlineLearning === 1;
    }
    if (body.weights != null && typeof body.weights === 'object' && !Array.isArray(body.weights)) {
      const base = { ...(portfolio.config.weights || {}) };
      for (const [k, v] of Object.entries(body.weights)) {
        if (!FACTOR_NAMES.includes(k)) continue;
        if (v == null || v === '') continue;
        const n = typeof v === 'number' ? v : parseFloat(String(v));
        if (Number.isFinite(n)) base[k] = n;
      }
      const wSum = FACTOR_NAMES.reduce((a, f) => a + Math.max(0, Number(base[f]) || 0), 0);
      if (wSum > 1e-9) {
        for (const f of FACTOR_NAMES) {
          base[f] = parseFloat(((Number(base[f]) || 0) / wSum).toFixed(6));
        }
      }
      portfolio.config.weights = base;
    }
    if (body.adaptiveMode != null && body.adaptiveMode !== '') {
      const am = String(body.adaptiveMode).toLowerCase().trim();
      portfolio.config.adaptiveMode =
        am === 'adaptive' || am === 'conservative' ? am : 'fixed';
    }
    if (body.rebalanceFreq != null && body.rebalanceFreq !== '') {
      const fr = String(body.rebalanceFreq).toLowerCase().trim();
      if (PAPER_SCHEDULE_FREQ_ALLOWED.includes(fr)) portfolio.config.rebalanceFreq = fr;
    }
    const uniPatch = body.universeId ?? body.universe;
    if (uniPatch != null && uniPatch !== '') {
      const u = String(uniPatch).trim();
      if (!UNIVERSE_TICKERS[u]) {
        return res.status(400).json({ success: false, error: `Unknown universe: ${u}` });
      }
      const slotUid = paperTradingUniverseId(portfolio);
      if (u !== slotUid) {
        return res.status(400).json({
          success: false,
          error:
            'Changing the paper universe slot requires DELETE /api/paper-trade/reset for the current slot, then POST /api/paper-trade/init for the target universe.'
        });
      }
      portfolio.config.universe = u;
      portfolio.config.universeId = u;
    }
    if (body.topN != null && body.topN !== '') {
      const tn = parseInt(String(body.topN), 10);
      if (Number.isFinite(tn)) portfolio.config.topN = Math.max(1, Math.min(50, tn));
    }
    if (body.correlationFilter !== undefined) {
      portfolio.config.correlationFilter =
        body.correlationFilter === true ||
        body.correlationFilter === 'true' ||
        body.correlationFilter === '1' ||
        body.correlationFilter === 1;
    }
    if (body.maxCorrelated !== undefined && body.maxCorrelated !== null && body.maxCorrelated !== '') {
      const n = parseInt(String(body.maxCorrelated), 10);
      if (Number.isFinite(n)) portfolio.config.maxCorrelated = Math.max(1, n);
    }
    if (
      body.correlationLookbackDays !== undefined &&
      body.correlationLookbackDays !== null &&
      body.correlationLookbackDays !== ''
    ) {
      const n = parseInt(String(body.correlationLookbackDays), 10);
      if (Number.isFinite(n)) portfolio.config.correlationLookbackDays = Math.max(20, n);
    }
    savePortfolio(portfolio);
    res.json({
      success: true,
      config: {
        universe: portfolio.config.universe ?? null,
        topN: portfolio.config.topN ?? null,
        adaptiveMode: portfolio.config.adaptiveMode ?? 'adaptive',
        rlAgent: portfolio.config.rlAgent === true,
        rlOnlineLearning: portfolio.config.rlOnlineLearning === true,
        weights: portfolio.config.weights || null,
        rebalanceFreq: normalizePaperRebalanceFreq(portfolio),
        correlationFilter: portfolio.config.correlationFilter === true,
        maxCorrelated:
          portfolio.config.maxCorrelated != null && Number.isFinite(Number(portfolio.config.maxCorrelated))
            ? Math.max(1, Math.floor(Number(portfolio.config.maxCorrelated)))
            : 3,
        correlationLookbackDays:
          portfolio.config.correlationLookbackDays != null &&
          Number.isFinite(Number(portfolio.config.correlationLookbackDays))
            ? Math.max(20, Math.floor(Number(portfolio.config.correlationLookbackDays)))
            : 60
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// =====================================================================
// PAPER TRADE — Snapshot (record daily NAV)
// =====================================================================

async function takeNavSnapshot(portfolio, opts = {}) {
  const { skipSave = false, snapshotDate = null } = opts;
  const today =
    snapshotDate && typeof snapshotDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(snapshotDate.trim())
      ? snapshotDate.trim()
      : new Date().toISOString().split('T')[0];

  const tickers = [...new Set([
    ...portfolio.holdings.map(h => h.ticker),
    'SPY'
  ])].filter(Boolean);

  const prices = {};
  for (const ticker of tickers) {
    try {
      const quote = await fetchYahooOp(() => yahooFinance.quote(yahooApiSymbol(ticker)), 8000);
      prices[ticker] = quote?.regularMarketPrice || null;
    } catch (e) {
      console.warn(`[Yahoo] quote failed ${ticker}:`, e.message);
      prices[ticker] = null;
    }
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
  if (!skipSave) savePortfolio(portfolio);
  return portfolio;
}

app.post('/api/paper-trade/snapshot', async (req, res) => {
  try {
    const paperUid = resolvePaperUniverseFromRequest(req);
    let portfolio = loadPaperPortfolioForUniverse(paperUid);
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
    const paperUid = resolvePaperUniverseFromRequest(req);
    let portfolio = loadPaperPortfolioForUniverse(paperUid);
    if (!portfolio) return res.json({ success: true, portfolio: null });

    if (portfolio.holdings.length > 0) {
      portfolio = await takeNavSnapshot(portfolio);
    }

    const tickers = portfolio.holdings.map(h => h.ticker);
    const currentPrices = {};
    for (const ticker of tickers) {
      try {
        const quote = await fetchYahooOp(() => yahooFinance.quote(yahooApiSymbol(ticker)), 8000);
        currentPrices[ticker] = quote?.regularMarketPrice || null;
      } catch (e) {
        console.warn(`[Yahoo] quote failed ${ticker}:`, e.message);
        currentPrices[ticker] = null;
      }
      await sleep(50);
    }

    let totalValue = portfolio.cash;
    const enrichedHoldings = portfolio.holdings.map(h => {
      const currentPrice = currentPrices[h.ticker] || h.entryPrice;
      const marketValue = h.shares * currentPrice;
      totalValue += h.shares * currentPrice;
      const pnl = (currentPrice - h.entryPrice) * h.shares;
      const pnlPct = h.entryPrice > 0 ? ((currentPrice / h.entryPrice) - 1) * 100 : 0;
      const cs = getCongressScore(h.ticker);
      return {
        ...h, currentPrice, marketValue, pnl, pnlPct: parseFloat(pnlPct.toFixed(2)),
        congressScore: cs.score,
        congressSentiment: cs.sentiment,
        congressPoliticians: cs.politicians ?? [],
        congressNetBuys: cs.netBuys ?? 0,
      };
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

    const schedPaper = buildPaperTradeScheduleResponse(portfolio);
    const nextRebalance = schedPaper.nextRebalance;

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

    const cfg = portfolio.config || {};
    const paperRlAgent = getRlAgentForPaperPortfolio(portfolio);
    const rlPaperSummaryOn =
      paperPortfolioRlEnabled(portfolio) && trainedRlAgentReadyForInference(paperRlAgent) && rlEvalEnvEnabled();

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
          cashDragRough,
          rlEnabled: rlPaperSummaryOn,
          rlAgentUpdates: paperRlAgent?.totalUpdates ?? 0,
          rlLastAction: portfolio._rlLastAction ?? null,
          rlLastState: portfolio._rlLastStateFeatures ?? null,
          rlOnlineLearning: cfg.rlOnlineLearning === true || process.env.RL_ONLINE_LEARNING === '1'
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

/** Config-only: user wants RL overlay when an agent is available (does not require a file on disk). */
function paperPortfolioRlEnabled(portfolio) {
  const c = portfolio?.config || {};
  if (c.rlAgent === false || c.rlAgent === 'false' || c.rlAgent === '0') return false;
  if (c.rlAgent === true || c.rlAgent === 'true' || c.rlAgent === '1') return true;
  if (c.useRlAgent === false || c.useRlAgent === 'false') return false;
  return true;
}

function paperRlOnlineReward(portfolio, spySeries, asOfDate) {
  const nav = portfolio.navHistory;
  const volRaw = spySeries?.length ? spyRealizedVolAnnualized(spySeries, asOfDate) : 0.15;
  const vol = Number.isFinite(volRaw) && volRaw > 0 ? volRaw : 0.15;
  if (!nav || nav.length < 2) {
    return computeDqnReward(0, 0, vol, 0, portfolio?.config?.rlGamma ?? 3);
  }
  const prev = nav[nav.length - 2];
  const last = nav[nav.length - 1];
  const portRet = prev.portfolioValue > 0 ? last.portfolioValue / prev.portfolioValue - 1 : 0;
  const benchRet = prev.spyValue > 0 ? last.spyValue / prev.spyValue - 1 : 0;
  let peak = nav[0].portfolioValue;
  let maxDd = 0;
  for (const row of nav) {
    if (row.portfolioValue > peak) peak = row.portfolioValue;
    const dd = peak > 0 ? row.portfolioValue / peak - 1 : 0;
    if (dd < maxDd) maxDd = dd;
  }
  return computeDqnReward(portRet, benchRet, vol, maxDd, portfolio?.config?.rlGamma ?? 3);
}

/**
 * @param {object|null} weightContext - For composite: { weightsBeforeAdaptive, weightsAfterAdaptive, rlDecision } (backtest-style IC step applied before this rank).
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

  const rlDecisionEarly = weightContext?.rlDecision ?? null;

  if (isFirstRebalance) {
    return {
      periodReturn: 0, spyReturn: 0, alpha: 0,
      soldPerformance: [], missedOpportunities: [], factorPerformance: [],
      weightChanges: { previous: { ...currentWeights }, new: { ...currentWeights }, changes: [] },
      narrative: 'Initial rebalance — no prior data to analyze. Weights set to defaults.',
      ...(rlDecisionEarly ? { rlDecision: rlDecisionEarly } : {})
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

  const rlDecision = weightContext?.rlDecision ?? null;

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
    narrative,
    ...(rlDecision ? { rlDecision } : {})
  };
}

async function paperRebalanceExecute(portfolio, persist, execOpts = {}) {
    const { strategy, topN } = portfolio.config;
    const universeId = paperTradingUniverseId(portfolio);
    const universe = UNIVERSE_TICKERS[universeId];
    if (!universe) throw new Error('Unknown universe');

    const serverToday = new Date().toISOString().split('T')[0];
    let today =
      typeof execOpts.asOfDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(execOpts.asOfDate.trim())
        ? execOpts.asOfDate.trim()
        : serverToday;
    if (today > serverToday) today = serverToday;
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
    let positionSizingPaper =
      psPaperRaw && ['equal', 'invVol', 'score', 'invVolBlend'].includes(psPaperRaw)
        ? psPaperRaw
        : strategy === 'full_composite' || strategy === 'full_composite_aggressive' || strategy === 'full_composite_turbo'
          ? 'invVol'
          : 'equal';

    const correlationFilterPaper =
      portfolio.config.correlationFilter === true ||
      portfolio.config.correlationFilter === 'true' ||
      portfolio.config.correlationFilter === 1 ||
      String(portfolio.config.correlationFilter || '').toLowerCase() === 'true';
    const maxCorrelatedPeersPaperRaw = parseInt(String(portfolio.config.maxCorrelated ?? ''), 10);
    const maxCorrelatedPeersPaper = Number.isFinite(maxCorrelatedPeersPaperRaw)
      ? Math.max(1, maxCorrelatedPeersPaperRaw)
      : 3;
    const correlationLbPaperRaw = parseInt(String(portfolio.config.correlationLookbackDays ?? ''), 10);
    const correlationLookbackPaper = Number.isFinite(correlationLbPaperRaw)
      ? Math.max(20, correlationLbPaperRaw)
      : 60;

    const defaultWForAdaptive = strategy === 'full_composite_aggressive' ? AGGRESSIVE_COMPOSITE_WEIGHTS
      : strategy === 'full_composite_turbo' ? TURBO_COMPOSITE_WEIGHTS
        : DEFAULT_COMPOSITE_WEIGHTS;
    const weightsBeforeAdaptive = { ...(portfolio.config.weights || defaultWForAdaptive) };
    let weightsForRank = { ...weightsBeforeAdaptive };
    const compositePaper =
      strategy === 'full_composite' || strategy === 'full_composite_aggressive' || strategy === 'full_composite_turbo';
    const paperRlAgentExec = getRlAgentForPaperPortfolio(portfolio);
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
    // Do not persist weightsForRank to portfolio.config — adaptive/PIT paths renormalize; user/PATCH
    // weights must stay verbatim on disk.

    let earningsMapPaper = null;
    if (compositePaper && (weightsForRank?.earningsMomentum ?? 0) > 1e-9) {
      earningsMapPaper = await fetchAllEarnings(universe);
    }

    // Run ranking (PIT fundamentals when applicable; adaptive after 6+ prior rebalances)
    let rankings;
    if (strategy === 'full_composite') {
      rankings = bt_rankFullCompositeV2(universe, priceHistory, fundamentalsLive, today, weightsForRank, {
        earningsMap: earningsMapPaper
      });
    } else if (strategy === 'full_composite_aggressive') {
      rankings = bt_rankFullCompositeV2(universe, priceHistory, fundamentalsLive, today, weightsForRank, {
        momQThreshold: 10, fundamentalFloor: 15, maxVol: 1.0, strategyLabel: 'full_composite_aggressive',
        blendMomentumWithQuality: { raw: 0.7, quality: 0.3 },
        earningsMap: earningsMapPaper
      });
    } else if (strategy === 'full_composite_turbo') {
      rankings = bt_rankFullCompositeV2(universe, priceHistory, fundamentalsLive, today, weightsForRank, {
        momQThreshold: 0, fundamentalFloor: 0, maxVol: 1.2, strategyLabel: 'full_composite_turbo',
        skipConstraintPenalty: true,
        blendMomentumWithQuality: { raw: 0.55, quality: 0.20 },
        earningsMap: earningsMapPaper
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

    // ── Congress signal nudge (paper rebalance) ───────────────────────────
    for (const r of rankings) {
      const cs = getCongressScore(r.ticker);
      r.congressScore = cs.score;
      r.congressSentiment = cs.sentiment;
      if (cs.hasSignal) {
        const boost = parseFloat(((cs.score / 10) * 3).toFixed(2));
        r.compositeScore = (r.compositeScore ?? 0) + boost;
        r.congressBoosted = boost;
        r.congressPoliticians = cs.politicians;
      }
    }
    rankings.sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0));

    const regimeEnabledPaper = portfolio.config.regimeEnabled !== false;
    const regimeMetaPaper = regimeEnabledPaper
      ? calculateMarketRegime(spyPaper, today, universe, priceHistory)
      : { regime: 'disabled', breadthRatio: null };
    const isAggressiveStrategyPaper = strategy === 'full_composite_aggressive' || strategy === 'full_composite_turbo';
    const regimeNPaper = adjustedTopNForRegime(regimeMetaPaper.regime, topN);
    let adjustedTopNPaper = isAggressiveStrategyPaper
      ? Math.max(Math.ceil(topN * 0.7), regimeNPaper)
      : Math.max(3, regimeNPaper);

    /** Cash deployed into new buys = cash × weight × exposure. RL overrides exposure when enabled; otherwise regime-based (composite) or 100%. */
    let exposureForNewBuys = 1;
    if (compositePaper && regimeEnabledPaper) {
      exposureForNewBuys = getStrategyRegimeExposure(regimeMetaPaper.regime, strategy);
    }
    let rlPaperExposure = exposureForNewBuys;
    let rlPaperMeta = null;
    let rlPaperDecisionForReport = null;
    let rlPaperSkipRebalance = false;
    if (compositePaper && paperPortfolioRlEnabled(portfolio) && rlEvalEnvEnabled() && spyPaper?.length) {
      if (!trainedRlAgentReadyForInference(paperRlAgentExec)) {
        console.warn(
          '[RL-PAPER] RL enabled in config but no usable trained agent — using rules-based defaults (regime exposure, topN, invVol, standard rebalance).'
        );
      } else {
        try {
          const agent = paperRlAgentExec;
          let navPre = portfolio.cash;
          for (const h of portfolio.holdings) {
            const ph = priceHistory[h.ticker];
            const p = ph?.length ? ph[ph.length - 1].close : h.entryPrice;
            navPre += h.shares * p;
          }
          const prevRb =
            portfolio.rebalanceHistory && portfolio.rebalanceHistory.length > 0
              ? portfolio.rebalanceHistory[portfolio.rebalanceHistory.length - 1]
              : null;
          let recentAlpha = 0;
          if (prevRb?.date && prevRb.portfolioValue > 0) {
            const pSpy0 = getPrice(spyPaper, prevRb.date);
            const pSpy1 = getPrice(spyPaper, today);
            if (pSpy0 > 0 && pSpy1 > 0) {
              const spyRet = pSpy1 / pSpy0 - 1;
              const portRet = navPre / prevRb.portfolioValue - 1;
              recentAlpha = portRet - spyRet;
            }
          }
          const breadthRatio =
            typeof regimeMetaPaper.breadthRatio === 'number' && Number.isFinite(regimeMetaPaper.breadthRatio)
              ? regimeMetaPaper.breadthRatio
              : 0.5;
          const stateFeatures = {
            regimeBucket: regimeStringToBucket(regimeMetaPaper.regime),
            recentAlpha,
            breadthRatio,
            realizedVol: spyRealizedVolAnnualized(spyPaper, today),
            avgTopScore: avgTopNAvgComposite(rankings, 15)
          };
          const stateIdx = encodeState(stateFeatures);

          const onlineRlAllowed =
            process.env.RL_ONLINE_LEARNING === '1' || portfolio.config.rlOnlineLearning === true;
          if (
            onlineRlAllowed &&
            portfolio._rlPrevState != null &&
            portfolio._rlPrevAction != null &&
            portfolio.rebalanceHistory.length > 0
          ) {
            const r = paperRlOnlineReward(portfolio, spyPaper, today);
            agent.update(portfolio._rlPrevState, portfolio._rlPrevAction, r, stateIdx);
            const uidPaper = paperTradingUniverseId(portfolio);
            saveRlAgentToDisk(agent, isDqnAgentInstance(agent) ? null : uidPaper);
            console.log(
              `[RL-ONLINE] Updated agent for ${uidPaper}: reward=${Number(r).toFixed(4)}, states=${agent.statesVisited}`
            );
          }

          const sel = agent.selectAction(stateIdx, true, { randomAction: false });
          let actionIdxPaper = sel.actionIdx;
          let dec = decodeAction(actionIdxPaper);
          let bullFloorAppliedPaper = false;
          if (regimeMetaPaper.regime === 'strong_bull' && dec.exposure < 0.8) {
            const bullActionIdxs = [];
            for (let eIdx = 2; eIdx <= 3; eIdx++) {
              for (let pIdx = 0; pIdx <= 3; pIdx++) {
                for (let sIdx = 0; sIdx <= 2; sIdx++) {
                  bullActionIdxs.push(encodeAction(eIdx, pIdx, sIdx));
                }
              }
            }
            const bestBullAction = bullActionIdxs.reduce((best, aIdx) =>
              agent.getQ(stateIdx, aIdx) > agent.getQ(stateIdx, best) ? aIdx : best,
              bullActionIdxs[0]
            );
            const origExp = dec.exposure;
            actionIdxPaper = bestBullAction;
            const decBull = decodeAction(bestBullAction);
            dec = decBull;
            bullFloorAppliedPaper = true;
            console.log(`[RL-PAPER] strong_bull floor: overrode exp=${origExp} → ${decBull.exposure} on ${today}`);
          }
          rlPaperSkipRebalance = (dec.rebalanceWait ?? 'standard') === 'skip';
          portfolio._rlPrevState = stateIdx;
          portfolio._rlPrevAction = actionIdxPaper;
          portfolio._rlLastAction = {
            exposure: dec.exposure,
            positionCount: dec.positionCount,
            sizingMethod: dec.sizingMethod,
            rebalanceWait: dec.rebalanceWait ?? 'standard'
          };
          portfolio._rlLastStateFeatures = stateFeatures;

          rlPaperExposure = dec.exposure;
          adjustedTopNPaper = Math.max(3, Math.min(dec.positionCount, rankings.length));
          positionSizingPaper = dec.sizingMethod;
          rlPaperMeta = {
            stateIdx,
            actionIdx: actionIdxPaper,
            exposure: dec.exposure,
            positionCount: dec.positionCount,
            sizingMethod: dec.sizingMethod,
            rebalanceWait: dec.rebalanceWait ?? 'standard',
            fallback: sel.fallback,
            bullFloorApplied: bullFloorAppliedPaper
          };
          rlPaperDecisionForReport = {
            stateIdx,
            actionIdx: actionIdxPaper,
            exposure: dec.exposure,
            positionCount: dec.positionCount,
            sizingMethod: dec.sizingMethod,
            rebalanceWait: dec.rebalanceWait ?? 'standard',
            fallback: sel.fallback,
            bullFloorApplied: bullFloorAppliedPaper,
            stateFeatures: {
              regime: regimeMetaPaper.regime,
              regimeBucket: stateFeatures.regimeBucket,
              recentAlpha: parseFloat(Number(stateFeatures.recentAlpha).toFixed(4)),
              breadthRatio: parseFloat(Number(stateFeatures.breadthRatio).toFixed(3)),
              realizedVol: parseFloat(Number(stateFeatures.realizedVol).toFixed(4)),
              avgTopScore: parseFloat(Number(stateFeatures.avgTopScore).toFixed(1))
            },
            note: rlPaperSkipRebalance
              ? 'RL chose SKIP_REBALANCE — hold portfolio until next cycle'
              : `RL chose ${(dec.exposure * 100).toFixed(0)}% exposure, ${dec.positionCount} positions, ${dec.sizingMethod} sizing`
          };
          console.log(
            `[RL-PAPER] Rebalance: state=${stateIdx}, exposure=${dec.exposure}, topN=${adjustedTopNPaper}, sizing=${dec.sizingMethod}, wait=${dec.rebalanceWait ?? 'standard'}, fallback=${sel.fallback}, bullFloor=${bullFloorAppliedPaper}`
          );
        } catch (rlErr) {
          console.warn('[RL-PAPER] RL decision failed — using rules-based defaults:', rlErr?.message || rlErr);
        }
      }
    }

    {
      const hardMaxPaper = REGIME_MAX_POSITIONS[regimeMetaPaper.regime] ?? 13;
      if (
        compositePaper &&
        paperPortfolioRlEnabled(portfolio) &&
        rlEvalEnvEnabled() &&
        spyPaper?.length &&
        trainedRlAgentReadyForInference(paperRlAgentExec) &&
        rlPaperMeta
      ) {
        adjustedTopNPaper = Math.max(3, Math.min(adjustedTopNPaper, hardMaxPaper, rankings.length));
      } else {
        adjustedTopNPaper = Math.max(3, Math.min(adjustedTopNPaper, Math.min(topN, hardMaxPaper), rankings.length));
      }
    }

    const sectorCap = getMaxSectorConcentration(strategy);
    const usesFundamentalsPaper =
      strategy === 'full_composite' || strategy === 'full_composite_aggressive' || strategy === 'full_composite_turbo';
    let topPicks;
    if (compositePaper && correlationFilterPaper && rankings && rankings.length > 0) {
      const corrPoolSizePaper = Math.min(adjustedTopNPaper * 2, rankings.length);
      const corrPoolPaper =
        usesFundamentalsPaper && fundamentalsLive
          ? applySectorLimits(rankings, fundamentalsLive, corrPoolSizePaper, sectorCap)
          : rankings.slice(0, corrPoolSizePaper);
      const corrPoolRankedPaper = filterCompositePicksByRebalanceScoreFloor(corrPoolPaper);
      const corrMatPaper = computeCorrelationMatrix(
        corrPoolRankedPaper.map((p) => p.ticker),
        priceHistory,
        correlationLookbackPaper,
        today
      );
      const { selected } = applyCorrelationFilter(
        corrPoolRankedPaper,
        corrMatPaper,
        adjustedTopNPaper,
        maxCorrelatedPeersPaper
      );
      topPicks = selected;
    } else {
      topPicks =
        usesFundamentalsPaper && fundamentalsLive
          ? applySectorLimits(rankings, fundamentalsLive, adjustedTopNPaper, sectorCap)
          : rankings.slice(0, adjustedTopNPaper);
    }
    if (usesFundamentalsPaper) {
      topPicks = filterCompositePicksByRebalanceScoreFloor(topPicks);
    }
    const rebalanceSlotCapPaper = topPicks.length;
    const topTickers = new Set(topPicks.map(p => p.ticker));

    if (!portfolio.recentSells || typeof portfolio.recentSells !== 'object') portfolio.recentSells = {};

    const cooldownMapPaper = new Map(
      Object.keys(portfolio.recentSells)
        .filter((t) => daysBetween(portfolio.recentSells[t].exitDate, today) < REBUY_COOLDOWN_DAYS)
        .map((t) => [t, portfolio.recentSells[t]])
    );
    if (
      cooldownMapPaper.size > 0 ||
      process.env.BACKTEST_COOLDOWN_LOG === '1' ||
      String(process.env.BACKTEST_COOLDOWN_LOG || '').toLowerCase() === 'true'
    ) {
      console.log(`[Cooldown] ${today}: blocked tickers =`, [...cooldownMapPaper.keys()]);
    }

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

    const maxHoldingsPaper = rebalanceSlotCapPaper + HOLDINGS_OVERFLOW_SLOTS;

    const currentHoldingsCountPaper = portfolio.holdings.length;
    const rlCompositeActivePaper =
      compositePaper &&
      paperPortfolioRlEnabled(portfolio) &&
      rlEvalEnvEnabled() &&
      spyPaper?.length &&
      trainedRlAgentReadyForInference(paperRlAgentExec) &&
      rlPaperMeta;
    const lastRebalanceRegimePaper = portfolio.lastRebalanceRegime;
    const minHoldDaysForSell =
      rlCompositeActivePaper &&
      Math.abs(adjustedTopNPaper - currentHoldingsCountPaper) > 5 &&
      lastRebalanceRegimePaper !== regimeMetaPaper.regime
        ? 14
        : MIN_HOLD_DAYS_BEFORE_SELL;

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

    const holdingsForHealth = portfolio.holdings || [];
    let positionsLocked = 0;
    let positionsEligible = 0;
    let oldestPosition = null;
    let youngestPosition = null;
    let nextEligibleDate = null;
    for (const h of holdingsForHealth) {
      const dh = daysBetween(h.entryDate, today);
      if (dh < minHoldDaysForSell) {
        positionsLocked++;
        const clear = isoAddDays(h.entryDate, minHoldDaysForSell);
        if (clear && (!nextEligibleDate || clear < nextEligibleDate)) nextEligibleDate = clear;
      } else {
        positionsEligible++;
      }
      const row = { ticker: h.ticker, daysHeld: dh };
      if (!oldestPosition || dh > oldestPosition.daysHeld) oldestPosition = row;
      if (!youngestPosition || dh < youngestPosition.daysHeld) youngestPosition = row;
    }
    const rlWantsHealth = rlPaperMeta ? rlPaperMeta.positionCount : null;
    const health = {
      positionsLocked,
      positionsEligible,
      oldestPosition: holdingsForHealth.length ? oldestPosition : null,
      youngestPosition: holdingsForHealth.length ? youngestPosition : null,
      nextEligibleDate,
      rlPolicyMatch: !!(rlPaperMeta && holdingsForHealth.length === rlPaperMeta.positionCount),
      rlWants: rlWantsHealth,
      currentHoldings: holdingsForHealth.length
    };

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
      const holdingDaysRot = daysBetween(h.entryDate, today);
      const holdingReturnRot = h.entryPrice > 0 ? (sellPrice - h.entryPrice) / h.entryPrice : 0;
      sells.push({
        ticker: h.ticker,
        shares: h.shares,
        entryPrice: h.entryPrice,
        sellPrice,
        pnl: parseFloat(((sellPrice - h.entryPrice) * h.shares).toFixed(2)),
        pnlPct: parseFloat((((sellPrice / h.entryPrice) - 1) * 100).toFixed(2)),
        holdingReturn: holdingReturnRot,
        holdingDays: holdingDaysRot,
        reason: 'ROTATION'
      });
      remainingHoldings = remainingHoldings.filter((x) => x.ticker !== h.ticker);
    };

    const notInTop = remainingHoldings.filter((h) => !topTickers.has(h.ticker));
    const sortedExitPaper = [...notInTop].sort((a, b) => scorePaper(a.ticker) - scorePaper(b.ticker));

    const buys = [];
    if (!rlPaperSkipRebalance) {
      for (const h of sortedExitPaper) {
        if (!remainingHoldings.some((x) => x.ticker === h.ticker)) continue;
        if (topTickers.has(h.ticker)) continue;
        const sOld = scorePaper(h.ticker);
        if (!allowsSellPaper(sOld)) continue;
        const sellPrice = currentPrices[h.ticker] || h.entryPrice;
        const hDays = daysBetween(h.entryDate, today);
        if (hDays < minHoldDaysForSell) {
          if (turnoverDebugEnabled()) {
            console.log(`[HOLD] paper keep ${h.ticker} — ${hDays}d < min ${minHoldDaysForSell}d`);
          }
          continue;
        }
        pushRotationSell(h, sellPrice);
      }

      while (remainingHoldings.length > maxHoldingsPaper) {
        const pool = remainingHoldings.filter((h) => !topTickers.has(h.ticker));
        if (!pool.length) break;
        const eligiblePool = pool.filter((h) => daysBetween(h.entryDate, today) >= minHoldDaysForSell);
        if (!eligiblePool.length) break;
        eligiblePool.sort((a, b) => scorePaper(a.ticker) - scorePaper(b.ticker));
        const h = eligiblePool[0];
        if (!allowsSellPaper(scorePaper(h.ticker))) break;
        const sellPrice = currentPrices[h.ticker] || h.entryPrice;
        pushRotationSell(h, sellPrice);
      }

      // New buys: regime-sized topN, positionSizing for composite — matches backtest
      const heldTickers = new Set(remainingHoldings.map(h => h.ticker));
      const newPicks = topPicks.filter(p => !heldTickers.has(p.ticker));
      const totalSlots = rebalanceSlotCapPaper;
      const slotsUsed = remainingHoldings.length;
      const slotsAvailable = totalSlots - slotsUsed;

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
          const scPaper = p.compositeScore ?? p.combinedScore ?? 0;
          if (scPaper < SCORE_FLOOR) {
            continue;
          }
          const dtePaper = daysUntilEarnings(p.ticker, today, fundamentalsLive);
          if (dtePaper !== null && dtePaper >= 0 && dtePaper <= 10) {
            console.log(`[EarningsFilter] Skipping ${p.ticker} — earnings in ${dtePaper.toFixed(1)} days`);
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
          const dollars = cashForNewBuys * w * rlPaperExposure;
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
        weightsAfterAdaptive: weightsForRank,
        rlDecision: rlPaperDecisionForReport
      })
      : null;

    const allRankingsEntry = topPicks.map(p => ({
      ticker: p.ticker,
      compositeScore: p.compositeScore,
      fundamentalScore: p.fundamentalScore,
      momentumScore: p.momentumScore,
      valuationScore: p.valuationScore,
      valueScore: p.valueScore,
      dcfScore: p.dcfScore,
      earningsMomentum: p.earningsMomentumScore != null && Number.isFinite(p.earningsMomentumScore) ? p.earningsMomentumScore : null
    }));

    // Take NAV snapshot first to get live prices
    portfolio = await takeNavSnapshot(portfolio, { skipSave: true, snapshotDate: today });

    const livePortfolioValue = portfolio.navHistory.length > 0
      ? portfolio.navHistory[portfolio.navHistory.length - 1].portfolioValue
      : portfolio.cash + remainingHoldings.reduce((sum, h) => {
          return sum + h.shares * (currentPrices[h.ticker] || h.entryPrice);
        }, 0);

    const paperHedgeState = portfolio._spyPutHedgeActive || null;
    const hedgeRecommendation = evaluateHedgeNeed(regimeMetaPaper.regime, livePortfolioValue, paperHedgeState);
    if (hedgeRecommendation.action === 'OPEN_HEDGE') {
      portfolio._spyPutHedgeActive = {
        openDate: today,
        regime: hedgeRecommendation.regime,
        notionalHedge: hedgeRecommendation.notionalHedge,
        hedgePct: hedgeRecommendation.hedgePct,
        spyPxAtOpen: getPrice(spyPaper, today) || 0,
        lastPremiumAccrualDate: today
      };
    } else if (hedgeRecommendation.action === 'CLOSE_HEDGE') {
      portfolio._spyPutHedgeActive = null;
    }

    // Log rebalance
    const rebalanceEntry = {
      date: today,
      regime: regimeMetaPaper.regime,
      adjustedTopN: adjustedTopNPaper,
      effectiveTargetN: rebalanceSlotCapPaper,
      compositeScoreFloor: SCORE_FLOOR,
      hedgeRecommendation,
      ...(rlPaperSkipRebalance ? { rlAction: 'SKIP_REBALANCE' } : {}),
      ...(rlPaperMeta ? { rlAgent: rlPaperMeta, rlExposure: rlPaperExposure } : {}),
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
        narrative: report.narrative,
        ...(report.rlDecision ? { rlDecision: report.rlDecision } : {})
      };
    }
    portfolio.rebalanceHistory.push(rebalanceEntry);

    if (persist) {
      portfolio.lastRebalanceRegime = regimeMetaPaper.regime;
      savePortfolio(portfolio);
    }

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

    const rlDecisionHoisted = rlPaperMeta
      ? {
          exposure: rlPaperMeta.exposure,
          positionCount: rlPaperMeta.positionCount,
          sizingMethod: rlPaperMeta.sizingMethod,
          rebalanceWait: rlPaperMeta.rebalanceWait ?? 'standard',
          stateIdx: rlPaperMeta.stateIdx,
          bullFloorApplied: !!rlPaperMeta.bullFloorApplied
        }
      : null;
    const buysHoisted = buys.map((b) => ({
      ticker: b.ticker,
      score: b.scores?.composite ?? 0,
      shares: b.shares,
      price: b.buyPrice
    }));
    const sellsHoisted = sells.map((s) => ({
      ticker: s.ticker,
      holdingReturn: s.holdingReturn ?? (s.entryPrice > 0 ? (s.sellPrice - s.entryPrice) / s.entryPrice : 0),
      holdingDays: s.holdingDays ?? null
    }));
    const stopsHoisted = sells
      .filter((s) => s.reason === 'STOP')
      .map((s) => ({
        ticker: s.ticker,
        holdingReturn: s.holdingReturn ?? (s.entryPrice > 0 ? (s.sellPrice - s.entryPrice) / s.entryPrice : 0),
        holdingDays: s.holdingDays ?? null
      }));

    return {
      success: true,
      regime: regimeMetaPaper.regime,
      exposure: rlPaperExposure,
      adjustedTopN: adjustedTopNPaper,
      sizingMethod: positionSizingPaper,
      hedgeRecommendation,
      rlDecision: rlDecisionHoisted,
      health,
      buys: buysHoisted,
      sells: sellsHoisted,
      stops: stopsHoisted,
      portfolioValue: parseFloat(livePortfolioValue.toFixed(2)),
      cash: parseFloat(portfolio.cash.toFixed(2)),
      portfolio: {
        asOfDate: today,
        cash: parseFloat(portfolio.cash.toFixed(2)),
        totalValue: parseFloat(livePortfolioValue.toFixed(2)),
        initialCapital: portfolio.initialCapital,
        holdings: portfolio.holdings,
        positions: portfolio.holdings,
        holdingsCount: portfolio.holdings.length,
        config: portfolio.config
      },
      report: report || null,
      rebalance: {
        date: today,
        pointInTime: needsFundamentals ? pitPaperMeta.pointInTime : null,
        pitDetail: needsFundamentals ? pitPaperMeta.pitDetail : null,
        regime: regimeMetaPaper.regime,
        adjustedTopN: adjustedTopNPaper,
        adaptiveMode: adaptiveModeCfg,
        positionSizing: positionSizingPaper,
        exposureForBuys: rlPaperExposure,
        ...(rlPaperMeta ? { rlAgent: rlPaperMeta, rlExposure: rlPaperExposure } : {}),
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
          weightChanges: report.weightChanges,
          ...(report.rlDecision ? { rlDecision: report.rlDecision } : {})
        } : null,
        hedgeRecommendation
      }
    };
}

app.post('/api/paper-trade/rebalance', async (req, res) => {
  try {
    clearBacktestRuntimeCaches();
    const paperUid = resolvePaperUniverseFromRequest(req);
    const portfolio = loadPaperPortfolioForUniverse(paperUid);
    if (!portfolio) {
      return res.status(404).json({ success: false, error: 'No portfolio. POST /api/paper-trade/init first.' });
    }
    const asOf = resolvePaperAsOfDate(req.body || {});
    const out = await paperRebalanceExecute(portfolio, true, { asOfDate: asOf });
    res.json(out);
  } catch (e) {
    if (e && e.message === 'Unknown universe') {
      return res.status(400).json({ success: false, error: 'Unknown universe' });
    }
    console.error('Paper trade rebalance error:', e);
    res.status(500).json({ success: false, error: e.message });
  } finally {
    clearBacktestRuntimeCaches();
  }
});

app.get('/api/paper-trade/preview', async (req, res) => {
  try {
    clearBacktestRuntimeCaches();
    const paperUid = resolvePaperUniverseFromRequest(req);
    const p = loadPaperPortfolioForUniverse(paperUid);
    if (!p) {
      return res.status(404).json({ success: false, error: 'No portfolio. POST /api/paper-trade/init first.' });
    }
    const portfolio = structuredClone(p);
    const asOf = resolvePaperAsOfDate(req.query || {});
    const out = await paperRebalanceExecute(portfolio, false, { asOfDate: asOf });
    res.json({ ...out, preview: true });
  } catch (e) {
    if (e && e.message === 'Unknown universe') {
      return res.status(400).json({ success: false, error: 'Unknown universe' });
    }
    console.error('Paper trade preview error:', e);
    res.status(500).json({ success: false, error: e.message });
  } finally {
    clearBacktestRuntimeCaches();
  }
});

app.get('/api/paper-trade/schedule', (req, res) => {
  try {
    const paperUid = resolvePaperUniverseFromRequest(req);
    const portfolio = loadPaperPortfolioForUniverse(paperUid);
    if (!portfolio) {
      return res.status(404).json({ success: false, error: 'No portfolio. POST /api/paper-trade/init first.' });
    }
    res.json({ success: true, ...buildPaperTradeScheduleResponse(portfolio) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// =====================================================================
// PAPER TRADE — Auto-optimize (score-degradation check + conditional rebalance)
// =====================================================================

// Scans the current holdings for composite score degradation and triggers
// a rebalance when the portfolio has drifted materially off its optimal picks.
app.post('/api/paper-trade/auto-optimize', async (req, res) => {
  try {
    clearBacktestRuntimeCaches();
    const universeIds = ['sp500_top50', 'sp500_top150'];
    const results = {};

    for (const uid of universeIds) {
      const portfolio = loadPaperPortfolioForUniverse(uid);
      if (!portfolio) {
        results[uid] = { skipped: true, reason: 'no portfolio' };
        continue;
      }

      const holdings = portfolio.holdings || [];
      if (holdings.length === 0) {
        results[uid] = { skipped: true, reason: 'no holdings yet' };
        continue;
      }

      // Score degradation check: if > 30% of positions have composite score
      // below the DEGRADATION_FLOOR, or the portfolio hasn't been rebalanced
      // in > STALE_DAYS, trigger a rebalance.
      const DEGRADATION_FLOOR = 55;
      const STALE_DAYS = 20;
      const now = new Date();
      const lastRb = portfolio.lastRebalance ? new Date(portfolio.lastRebalance) : null;
      const daysSinceLast = lastRb ? Math.floor((now - lastRb) / 86400000) : Infinity;

      const degraded = holdings.filter((h) => {
        const score = Number(h.scores?.composite ?? h.compositeScore ?? h.score ?? 100);
        return score < DEGRADATION_FLOOR;
      });
      const degradedPct = degraded.length / holdings.length;

      const needsRebalance = degradedPct > 0.30 || daysSinceLast > STALE_DAYS;
      if (!needsRebalance) {
        results[uid] = {
          skipped: true,
          reason: `healthy (degraded ${(degradedPct * 100).toFixed(0)}% < 30%, last rebalanced ${daysSinceLast}d ago)`
        };
        continue;
      }

      // Trigger rebalance
      const triggerReason = degradedPct > 0.30
        ? `${(degradedPct * 100).toFixed(0)}% of positions below score floor ${DEGRADATION_FLOOR}`
        : `stale — ${daysSinceLast} days since last rebalance`;

      try {
        const asOf = resolvePaperAsOfDate(req.body || {});
        const out = await paperRebalanceExecute(portfolio, true, { asOfDate: asOf });
        results[uid] = {
          rebalanced: true,
          triggerReason,
          degradedCount: degraded.length,
          daysSinceLast,
          summary: { buys: out.buys?.length ?? 0, sells: out.sells?.length ?? 0 }
        };
      } catch (e) {
        results[uid] = { error: e.message || String(e), triggerReason };
      }
    }

    res.json({ success: true, results, ranAt: new Date().toISOString() });
  } catch (e) {
    console.error('[paper-trade/auto-optimize]', e);
    res.status(500).json({ success: false, error: e.message });
  } finally {
    clearBacktestRuntimeCaches();
  }
});

// =====================================================================
// PAPER TRADE — History
// =====================================================================

app.get('/api/paper-trade/history', (req, res) => {
  const paperUid = resolvePaperUniverseFromRequest(req);
  const portfolio = loadPaperPortfolioForUniverse(paperUid);
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
  const paperUid = resolvePaperUniverseFromRequest(req);
  const portfolio = loadPaperPortfolioForUniverse(paperUid);
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
// OPTIONS SCANNER & PAPER OPTIONS PORTFOLIO
// =====================================================================

async function computeOptionsScan(universeIdRaw) {
  const universeId = String(universeIdRaw || 'sp500_top50').trim();
  const universe = UNIVERSE_TICKERS[universeId];
  if (!universe) {
    const err = new Error('Unknown universe');
    err.statusCode = 400;
    throw err;
  }

  const today = new Date().toISOString().split('T')[0];
  const lookbackStart = new Date(Date.now() - 500 * 86400000).toISOString().split('T')[0];
  const tickersToFetch = [...new Set([...universe, 'SPY', 'QQQ'])].filter(Boolean);

  const priceHistory = {};
  const priceRows = await mapWithConcurrency(tickersToFetch, YAHOO_CHART_CONCURRENCY, async (ticker) => {
    const data = await bt_fetchPriceHistory(ticker, lookbackStart, today);
    return { ticker, data };
  });
  for (const row of priceRows) {
    if (row?.data && !row.__error) priceHistory[row.ticker] = row.data;
  }

  const pit = await loadPitFundamentalsForUniverse(universe, today, priceHistory);
  const fundamentalsLive = pit.map;

  const scanWeights = { ...DEFAULT_COMPOSITE_WEIGHTS };
  let earningsMapScan = null;
  if ((scanWeights.earningsMomentum ?? 0) > 1e-9) {
    try {
      earningsMapScan = await fetchAllEarnings(universe);
    } catch (e) {
      console.warn('[OPTIONS SCAN] fetchAllEarnings failed:', e.message);
    }
  }
  const rankings = bt_rankFullCompositeV2(universe, priceHistory, fundamentalsLive, today, scanWeights, {
    earningsMap: earningsMapScan
  });

  const spySeries = priceHistory['SPY'];
  const regimeMeta =
    spySeries && spySeries.length >= 200
      ? calculateMarketRegime(spySeries, today, universe, priceHistory)
      : { regime: 'normal', breadthRatio: null };

  // ── Three-paper signal pre-computation ────────────────────────────────────
  // Pre-compute IVOL for cross-sectional ranking (Cao & Han 2013).
  // Done before the async chain-fetching loop to avoid blocking per-ticker.
  const bkRegimeBoost = getBKVolRegimeBoost(today);
  const ivolRawMap = new Map(); // ticker -> raw annualised IVOL (decimal)
  const fullUniverse = rankings.slice(0, 30);
  for (const stock of fullUniverse) {
    const iv = computeIVOL(stock.ticker, today);
    if (iv) ivolRawMap.set(stock.ticker, iv.ivol);
  }
  // Also add SPY/QQQ for REGIME_HEDGE (low IVOL is expected)
  for (const etf of ['SPY', 'QQQ']) {
    const iv = computeIVOL(etf, today);
    if (iv) ivolRawMap.set(etf, iv.ivol);
  }
  const ivolValues = [...ivolRawMap.values()].filter(Number.isFinite).sort((a, b) => a - b);
  // Returns IVOL percentile rank within the current scan universe [0,1]
  const getIvolPct = (ticker) => {
    if (!ivolRawMap.has(ticker) || ivolValues.length < 2) return 0.5;
    const val = ivolRawMap.get(ticker);
    const rank = ivolValues.findIndex((v) => v >= val);
    return rank < 0 ? 1.0 : rank / (ivolValues.length - 1);
  };

  const opportunities = [];
  const slice = rankings.slice(0, 30);
  let scanEvaluated = 0;
  let scanPassedCcScore = 0;
  let scanPassedCcIvr = 0;
  let scanPassedCspScore = 0;

  for (const stock of slice) {
    const { ticker, compositeScore, price } = stock;
    if (!ticker || price == null || !Number.isFinite(Number(price))) continue;
    scanEvaluated++;

    const ivRank = await getIvRank(ticker);
    const chain = await getOptionsChain(ticker, Number(price), null, { liveChainMode: 'single' });

    if (compositeScore >= 52 && compositeScore <= 78 && ivRank >= 40) {
      scanPassedCcScore++;
      const ccCandidates = chain
        .filter(
          (o) =>
            o.type === 'call' &&
            o.dte >= 25 &&
            o.dte <= 50 &&
            o.delta >= 0.2 &&
            o.delta <= 0.35
        )
        .sort((a, b) => b.mid - a.mid);
      if (ccCandidates.length > 0) {
        scanPassedCcIvr++;
        const cc = ccCandidates[0];
        const ccBid = Number(cc.bid) || 0;
        const ccAsk = Number(cc.ask) || 0;
        const ccMid =
          ccBid > 0 && ccAsk > 0
            ? parseFloat(((ccBid + ccAsk) / 2).toFixed(2))
            : ccAsk > 0
              ? parseFloat(ccAsk.toFixed(2))
              : ccBid > 0
                ? parseFloat(ccBid.toFixed(2))
                : Number(cc.mid) || 0;
        const annualizedYield = (ccMid / Number(price)) * (365 / cc.dte) * 100;
        const ccDeltaAbs = Math.abs(Number(cc.delta) || 0.25);
        const ccProbITM = ccDeltaAbs;
        const ccProbOTM = 1 - ccProbITM;
        const ccPrem = ccMid;
        const ccStrike = Number(cc.strike) || 0;
        const ccCp = Number(price) || ccStrike;
        const ccEv =
          ccPrem > 0
            ? (ccProbOTM * (ccPrem * 100)) -
              (ccProbITM * (Math.max(0, ccCp - ccStrike) * 100))
            : null;
        const ccHv30 = getRollingHV(ticker, today, 30) ?? bt_volatilityFromPrices((priceHistory[ticker] || []).slice(-31));
        const ccIvNum = cc.iv != null && Number.isFinite(Number(cc.iv)) ? Number(cc.iv) : null;
        const ccIvProxy = (ccHv30 ?? 0.25) * (1 + ((ivRank ?? 50) - 50) / 100);
        const ccIvEst = ccIvNum ?? ccIvProxy;
        const ccVrpr = ccHv30 && ccIvNum ? ccIvNum / ccHv30 : ccHv30 ? ccIvProxy / ccHv30 : null;
        const ccVrpEdge = ccVrpr != null ? ccVrpr > 1.05 : (ivRank ?? 0) > 50;
        // Three-paper academic signals
        const ccGs  = ccIvEst ? computeGSSignal(ticker, today, ccIvEst)       : null;
        const ccVrpI = ccIvEst ? computeVRPIntensity(ticker, today, ccIvEst)  : null;
        const ccIvolPct = getIvolPct(ticker);
        const ccIvolData = ivolRawMap.has(ticker) ? { ivol: ivolRawMap.get(ticker) } : null;
        const { sellScore: ccSellScore, signalCount: ccSignalCount, academicSellEdge: ccAcademic } =
          buildSellScore(ccGs, ccIvolPct, ccVrpI, bkRegimeBoost, ivRank ?? 0);
        opportunities.push({
          strategy: 'COVERED_CALL',
          ticker,
          compositeScore,
          ivRank,
          currentPrice: Number(price),
          hv30: ccHv30 != null ? parseFloat((ccHv30 * 100).toFixed(1)) : null,
          ivProxy: ccHv30 != null ? parseFloat((ccIvProxy * 100).toFixed(1)) : null,
          impliedVol: ccIvNum,
          vrpRatio: ccVrpr != null ? parseFloat(ccVrpr.toFixed(2)) : null,
          vrpEdge: ccVrpEdge,
          // Goyal & Saretto (2007)
          gsSignal:         ccGs?.gsSignal         ?? null,
          gsNorm:           ccGs?.gsNorm           ?? null,
          rv252:            ccGs?.rv252            ?? null,
          overpricingRatio: ccGs?.overpricingRatio ?? null,
          gsInterpretation: ccGs?.interpretation   ?? null,
          gsSellEdge:       ccGs?.sellEdge         ?? null,
          // Bakshi & Kapadia (2003)
          vrpIntensity:     ccVrpI?.vrpIntensity   ?? null,
          ivPremium:        ccVrpI?.ivPremium       ?? null,
          regimeBoost:      ccVrpI?.regimeBoost     ?? bkRegimeBoost,
          vrpNorm:          ccVrpI?.vrpNorm         ?? null,
          // Cao & Han (2013)
          ivol:             ccIvolData?.ivol        ?? null,
          ivolPct:          parseFloat((ccIvolPct * 100).toFixed(1)), // pct rank in scan universe
          ivolRaw:          ccIvolData?.ivol != null ? parseFloat((ccIvolData.ivol * 100).toFixed(2)) : null,
          // Composite
          sellScore:        ccSellScore,
          signalCount:      ccSignalCount,
          academicSellEdge: ccAcademic,
          bkRegimeBoost,
          strike: cc.strike,
          expiration: cc.expiration,
          optionType: 'call',
          dte: cc.dte,
          premium: ccMid,
          bid: ccBid,
          ask: ccAsk,
          mid: ccMid || null,
          delta: cc.delta,
          theta: cc.theta,
          iv: cc.iv,
          optionSymbol: buildOsiSymbol({
            ticker,
            expiration: cc.expiration,
            optionType: 'call',
            strike: cc.strike
          }),
          ev: ccEv != null ? parseFloat(ccEv.toFixed(2)) : null,
          annualizedYield: parseFloat(annualizedYield.toFixed(2)),
          maxProfit: parseFloat((cc.mid + Math.max(0, cc.strike - Number(price))).toFixed(2)),
          maxLoss: parseFloat((Number(price) - cc.mid).toFixed(2)),
          breakeven: parseFloat((Number(price) - cc.mid).toFixed(2)),
          rationale: `IV rank ${ivRank} — selling premium. ${annualizedYield.toFixed(1)}% annualized yield. Protected to $${(Number(price) - cc.mid).toFixed(2)}.`,
          osiSymbol: buildOsiSymbol({
            ticker,
            expiration: cc.expiration,
            optionType: 'call',
            strike: cc.strike
          })
        });
      }
    }

    if (compositeScore >= 68 && ivRank >= 35) {
      scanPassedCspScore++;
      const cspCandidates = chain
        .filter(
          (o) =>
            o.type === 'put' &&
            o.dte >= 20 &&
            o.dte <= 45 &&
            o.delta >= -0.3 &&
            o.delta <= -0.15
        )
        .sort((a, b) => b.mid - a.mid);
      if (cspCandidates.length > 0) {
        const csp = cspCandidates[0];
        const cspBid = Number(csp.bid) || 0;
        const cspAsk = Number(csp.ask) || 0;
        const cspMid =
          cspBid > 0 && cspAsk > 0
            ? parseFloat(((cspBid + cspAsk) / 2).toFixed(2))
            : cspAsk > 0
              ? parseFloat(cspAsk.toFixed(2))
              : cspBid > 0
                ? parseFloat(cspBid.toFixed(2))
                : Number(csp.mid) || 0;
        const effectiveCost = csp.strike - cspMid;
        const discount = ((Number(price) - effectiveCost) / Number(price)) * 100;
        const cspDeltaAbs = Math.abs(Number(csp.delta) || 0.25);
        const cspProbITM = cspDeltaAbs;
        const cspProbOTM = 1 - cspProbITM;
        const cspPrem = cspMid;
        const cspStrike = Number(csp.strike) || 0;
        const cspEv =
          cspPrem > 0
            ? (cspProbOTM * (cspPrem * 100)) -
              (cspProbITM * (Math.max(0, cspStrike - cspPrem) * 100))
            : null;
        const cspHv30 = getRollingHV(ticker, today, 30) ?? bt_volatilityFromPrices((priceHistory[ticker] || []).slice(-31));
        const cspIvNum = csp.iv != null && Number.isFinite(Number(csp.iv)) ? Number(csp.iv) : null;
        const cspIvProxy = (cspHv30 ?? 0.25) * (1 + ((ivRank ?? 50) - 50) / 100);
        const cspIvEst = cspIvNum ?? cspIvProxy;
        const cspVrpr = cspHv30 && cspIvNum ? cspIvNum / cspHv30 : cspHv30 ? cspIvProxy / cspHv30 : null;
        const cspVrpEdge = cspVrpr != null ? cspVrpr > 1.05 : (ivRank ?? 0) > 50;
        // Three-paper academic signals (reuse IVOL from map — same ticker, same day)
        const cspGs   = cspIvEst ? computeGSSignal(ticker, today, cspIvEst)       : null;
        const cspVrpI = cspIvEst ? computeVRPIntensity(ticker, today, cspIvEst)  : null;
        const cspIvolPct = getIvolPct(ticker);
        const cspIvolData = ivolRawMap.has(ticker) ? { ivol: ivolRawMap.get(ticker) } : null;
        const { sellScore: cspSellScore, signalCount: cspSignalCount, academicSellEdge: cspAcademic } =
          buildSellScore(cspGs, cspIvolPct, cspVrpI, bkRegimeBoost, ivRank ?? 0);
        opportunities.push({
          strategy: 'CASH_SECURED_PUT',
          ticker,
          compositeScore,
          ivRank,
          currentPrice: Number(price),
          hv30: cspHv30 != null ? parseFloat((cspHv30 * 100).toFixed(1)) : null,
          ivProxy: cspHv30 != null ? parseFloat((cspIvProxy * 100).toFixed(1)) : null,
          impliedVol: cspIvNum,
          vrpRatio: cspVrpr != null ? parseFloat(cspVrpr.toFixed(2)) : null,
          vrpEdge: cspVrpEdge,
          // Goyal & Saretto (2007)
          gsSignal:         cspGs?.gsSignal         ?? null,
          gsNorm:           cspGs?.gsNorm           ?? null,
          rv252:            cspGs?.rv252            ?? null,
          overpricingRatio: cspGs?.overpricingRatio ?? null,
          gsInterpretation: cspGs?.interpretation   ?? null,
          gsSellEdge:       cspGs?.sellEdge         ?? null,
          // Bakshi & Kapadia (2003)
          vrpIntensity:     cspVrpI?.vrpIntensity   ?? null,
          ivPremium:        cspVrpI?.ivPremium       ?? null,
          regimeBoost:      cspVrpI?.regimeBoost     ?? bkRegimeBoost,
          vrpNorm:          cspVrpI?.vrpNorm         ?? null,
          // Cao & Han (2013)
          ivol:             cspIvolData?.ivol        ?? null,
          ivolPct:          parseFloat((cspIvolPct * 100).toFixed(1)),
          ivolRaw:          cspIvolData?.ivol != null ? parseFloat((cspIvolData.ivol * 100).toFixed(2)) : null,
          // Composite
          sellScore:        cspSellScore,
          signalCount:      cspSignalCount,
          academicSellEdge: cspAcademic,
          bkRegimeBoost,
          strike: csp.strike,
          expiration: csp.expiration,
          optionType: 'put',
          dte: csp.dte,
          premium: cspMid,
          bid: cspBid,
          ask: cspAsk,
          mid: cspMid || null,
          delta: csp.delta,
          theta: csp.theta,
          iv: csp.iv,
          optionSymbol: buildOsiSymbol({
            ticker,
            expiration: csp.expiration,
            optionType: 'put',
            strike: csp.strike
          }),
          ev: cspEv != null ? parseFloat(cspEv.toFixed(2)) : null,
          annualizedYield: parseFloat(
            ((csp.mid / csp.strike) * (365 / csp.dte) * 100).toFixed(2)
          ),
          effectiveCost,
          discount: parseFloat(discount.toFixed(2)),
          maxProfit: parseFloat(csp.mid.toFixed(2)),
          maxLoss: parseFloat((csp.strike - csp.mid).toFixed(2)),
          breakeven: parseFloat(effectiveCost.toFixed(2)),
          rationale: `High score (${compositeScore.toFixed(0)}) — want to own at discount. Effective cost $${effectiveCost.toFixed(2)} (${discount.toFixed(1)}% below current).`,
          osiSymbol: buildOsiSymbol({
            ticker,
            expiration: csp.expiration,
            optionType: 'put',
            strike: csp.strike
          })
        });
      }
    }
  }

  if (regimeMeta.regime === 'caution' || regimeMeta.regime === 'bear') {
    for (const etf of ['SPY', 'QQQ']) {
      const ph = priceHistory[etf];
      const px = ph ? getPrice(ph, today) : null;
      if (px == null || !Number.isFinite(px)) continue;
      const ivRank = await getIvRank(etf);
      const chain = await getOptionsChain(etf, Number(px), null, { liveChainMode: 'single' });
      const hedgeCandidates = chain
        .filter(
          (o) =>
            o.type === 'put' &&
            o.dte >= 20 &&
            o.dte <= 45 &&
            o.delta >= -0.35 &&
            o.delta <= -0.2
        )
        .sort((a, b) => a.mid - b.mid);
      if (hedgeCandidates.length > 0) {
        const hedge = hedgeCandidates[0];
        const hedgeBid = Number(hedge.bid) || 0;
        const hedgeAsk = Number(hedge.ask) || 0;
        const hedgeMid =
          hedgeBid > 0 && hedgeAsk > 0
            ? parseFloat(((hedgeBid + hedgeAsk) / 2).toFixed(2))
            : hedgeAsk > 0
              ? parseFloat(hedgeAsk.toFixed(2))
              : hedgeBid > 0
                ? parseFloat(hedgeBid.toFixed(2))
                : Number(hedge.mid) || 0;
        const hedgeDeltaAbs = Math.abs(Number(hedge.delta) || 0.25);
        const hedgeProbITM = hedgeDeltaAbs;
        const hedgeProbOTM = 1 - hedgeProbITM;
        const hedgePrem = hedgeMid;
        const hedgeStrike = Number(hedge.strike) || 0;
        const hedgeCp = Number(px) || hedgeStrike;
        const hedgeEv =
          hedgePrem > 0
            ? (hedgeProbITM * (Math.max(0, hedgeStrike - hedgeCp) * 100)) -
              (hedgeProbOTM * (hedgePrem * 100))
            : null;
        const hedgeHv30 = getRollingHV(etf, today, 30) ?? bt_volatilityFromPrices((priceHistory[etf] || []).slice(-31));
        const hedgeIvNum = hedge.iv != null && Number.isFinite(Number(hedge.iv)) ? Number(hedge.iv) : null;
        const hedgeIvProxy = (hedgeHv30 ?? 0.25) * (1 + ((ivRank ?? 50) - 50) / 100);
        const hedgeIvEst = hedgeIvNum ?? hedgeIvProxy;
        const hedgeVrpr = hedgeHv30 && hedgeIvNum ? hedgeIvNum / hedgeHv30 : hedgeHv30 ? hedgeIvProxy / hedgeHv30 : null;
        opportunities.push({
          strategy: 'REGIME_HEDGE',
          ticker: etf,
          compositeScore: null,
          ivRank,
          currentPrice: Number(px),
          hv30: hedgeHv30 != null ? parseFloat((hedgeHv30 * 100).toFixed(1)) : null,
          ivProxy: hedgeHv30 != null ? parseFloat((hedgeIvProxy * 100).toFixed(1)) : null,
          impliedVol: hedgeIvNum,
          vrpRatio: hedgeVrpr != null ? parseFloat(hedgeVrpr.toFixed(2)) : null,
          vrpEdge: null,
          // Academic signals (regime hedge context: using for market vol regime info only)
          gsSignal:         null,
          gsNorm:           null,
          rv252:            null,
          overpricingRatio: null,
          gsInterpretation: null,
          gsSellEdge:       null,
          vrpIntensity:     hedgeIvEst ? computeVRPIntensity(etf, today, hedgeIvEst)?.vrpIntensity ?? null : null,
          ivPremium:        null,
          regimeBoost:      bkRegimeBoost,
          vrpNorm:          null,
          ivol:             null,
          ivolPct:          parseFloat((getIvolPct(etf) * 100).toFixed(1)),
          ivolRaw:          null,
          sellScore:        null,
          signalCount:      null,
          academicSellEdge: null,
          bkRegimeBoost,
          strike: hedge.strike,
          expiration: hedge.expiration,
          optionType: 'put',
          dte: hedge.dte,
          premium: hedgeMid,
          bid: hedgeBid,
          ask: hedgeAsk,
          mid: hedgeMid || null,
          delta: hedge.delta,
          theta: hedge.theta,
          iv: hedge.iv,
          optionSymbol: buildOsiSymbol({
            ticker: etf,
            expiration: hedge.expiration,
            optionType: 'put',
            strike: hedge.strike
          }),
          ev: hedgeEv != null ? parseFloat(hedgeEv.toFixed(2)) : null,
          regime: regimeMeta.regime,
          annualizedYield: null,
          rationale: `${String(regimeMeta.regime).toUpperCase()} regime detected. Buying puts for portfolio protection. Targets -${((1 - hedge.strike / Number(px)) * 100).toFixed(1)}% downside.`,
          osiSymbol: buildOsiSymbol({
            ticker: etf,
            expiration: hedge.expiration,
            optionType: 'put',
            strike: hedge.strike
          })
        });
      }
    }
  }

  console.log(
    `[OPTIONS SCAN] universe=${universeId} tickersEvaluated=${scanEvaluated} CC_band=${scanPassedCcScore} CC_withChain=${scanPassedCcIvr} CSP_prefilter=${scanPassedCspScore} opportunities=${opportunities.length}`
  );

  opportunities.sort((a, b) => {
    if (a.strategy === 'REGIME_HEDGE' && b.strategy !== 'REGIME_HEDGE') return -1;
    if (b.strategy === 'REGIME_HEDGE' && a.strategy !== 'REGIME_HEDGE') return 1;
    // Blend sellScore (academic rank) with annualizedYield for final ordering
    // sellScore 0-1 is scaled to approximate yield range for commensurability
    const aScore = (a.sellScore ?? 0.3) * 40 + (a.annualizedYield ?? 0);
    const bScore = (b.sellScore ?? 0.3) * 40 + (b.annualizedYield ?? 0);
    return bScore - aScore;
  });

  return {
    universeId,
    scanDate: today,
    regime: regimeMeta.regime,
    mockMode: OPTIONS_USE_MOCK,
    opportunities
  };
}

app.get('/api/options/scan', async (req, res) => {
  try {
    const r = await computeOptionsScan(req.query.universeId || 'sp500_top50');
    res.json({ success: true, ...r, count: r.opportunities.length });
  } catch (err) {
    console.error('[Options/scan]', err);
    res.status(err.statusCode || 500).json({ success: false, error: err.message || String(err) });
  }
});

app.get('/api/options/chain/:ticker', async (req, res) => {
  try {
    const ticker = String(req.params.ticker || '')
      .trim()
      .toUpperCase();
    const price = parseFloat(req.query.price) || 100;
    const exp = req.query.expiration ? String(req.query.expiration).trim() : null;
    const chain = await getOptionsChain(ticker, price, exp, { liveChainMode: exp ? 'single' : 'multi' });
    const grouped = {};
    for (const o of chain) {
      if (!grouped[o.expiration]) grouped[o.expiration] = { calls: [], puts: [] };
      grouped[o.expiration][o.type === 'call' ? 'calls' : 'puts'].push(o);
    }
    res.json({
      success: true,
      ticker,
      currentPrice: price,
      mockMode: OPTIONS_USE_MOCK,
      expirations: grouped
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

/**
 * GET /api/options/backtest
 *
 * Simplified historical simulation of selling covered calls (CC) and cash-secured puts (CSP)
 * on top-scored names. Uses cached equity price history (no IV surface).
 *
 * Query params:
 * - period   (default "3y")
 * - universe (default "sp500_top50")
 * - topN     (default 5)
 */
app.get('/api/options/backtest', async (req, res) => {
  try {
    req.setTimeout(300000);
    res.setTimeout(300000);

    const period = String(req.query.period ?? '3y').trim();
    const universeId = String(req.query.universe ?? 'sp500_top50').trim();
    const topN = Math.max(1, parseInt(String(req.query.topN ?? '5'), 10) || 5);

    const universe = UNIVERSE_TICKERS[universeId];
    if (!universe) return res.status(400).json({ success: false, error: 'Unknown universe' });

    const periodDays = { '1y': 365, '2y': 730, '3y': 1095, '5y': 1825, '7y': 2555 };
    const days = periodDays[period] || periodDays['3y'];
    const endDate = new Date();
    const endDateStr = endDate.toISOString().split('T')[0];
    const start = new Date(endDate.getTime() - days * 86400000 - 400 * 86400000);
    const startDateStr = start.toISOString().split('T')[0];

    const rebalanceDates = getRebalanceDates(
      new Date(endDate.getTime() - days * 86400000).toISOString().split('T')[0],
      endDateStr,
      'monthly'
    );
    if (rebalanceDates.length < 2) {
      return res.status(400).json({ success: false, error: 'Insufficient rebalance dates' });
    }

    clearBacktestRuntimeCaches();

    const tickersToFetch = [...new Set([...universe, 'SPY'])].filter(Boolean);
    const priceHistory = {};
    const priceRows = await mapWithConcurrency(tickersToFetch, YAHOO_CHART_CONCURRENCY, async (ticker) => {
      const data = await bt_fetchPriceHistory(ticker, startDateStr, endDateStr);
      return { ticker, data };
    });
    for (const row of priceRows) {
      if (row?.data && !row.__error) priceHistory[row.ticker] = row.data;
    }

    const spyPrices = priceHistory['SPY'];
    if (!spyPrices?.length) {
      return res.status(500).json({ success: false, error: 'Could not fetch SPY history' });
    }

    const pit = await loadPitFundamentalsForUniverse(universe, endDateStr, priceHistory);
    const fundamentalsLive = pit.map;

    const weights = { ...DEFAULT_COMPOSITE_WEIGHTS };
    const monthlyPnl = [];
    let cumulative = 0;
    let totalPremium = 0;
    let assignmentCount = 0;
    let assignmentPnl = 0;

    for (let i = 0; i < rebalanceDates.length - 1; i++) {
      const date = rebalanceDates[i];
      const nextDate = rebalanceDates[i + 1];

      const regimeMeta = calculateMarketRegime(spyPrices, date, universe, priceHistory);
      const regime = regimeMeta?.regime ?? 'normal';

      if (regime === 'bear') {
        monthlyPnl.push({
          date,
          regime,
          ccPremium: 0,
          cspPremium: 0,
          assignments: 0,
          totalPnl: 0,
          cumulative: parseFloat(cumulative.toFixed(2)),
          vrpSkipped: 0,
          note: 'bear regime — no new options'
        });
        continue;
      }

      const rankings = bt_rankFullCompositeV2(universe, priceHistory, fundamentalsLive, date, weights, {});
      const picks = (rankings || []).slice(0, Math.max(2 * topN, topN));
      const holdings = picks.slice(0, topN);
      const nonHoldings = picks.slice(topN, 2 * topN);

      let ccPrem = 0;
      let cspPrem = 0;
      let assigns = 0;
      let assignPnlLocal = 0;
      let vrpSkippedCount = 0;

      const dte = 30;
      const sqrtT = Math.sqrt(dte / 365);

      // B&K regime boost for this month (scales premium edge with vol level)
      const bkBoost = getBKVolRegimeBoost(date);

      // Covered calls: allowed in non-bear regimes
      for (const row of holdings) {
        const ticker = row?.ticker;
        const prices = ticker ? priceHistory[ticker] : null;
        const px = prices ? getPrice(prices, date) : Number(row?.price);
        const nextPx = prices ? getPrice(prices, nextDate) : null;
        if (!ticker || px == null || !Number.isFinite(px) || px <= 0) continue;

        // Earnings avoidance: skip if earnings fall within the DTE window
        const dteToEarnings = daysUntilEarnings(ticker, date, fundamentalsLive);
        if (dteToEarnings != null && dteToEarnings >= 0 && dteToEarnings <= dte) continue;

        // 30-day HV from cache (no look-ahead: only uses data up to `date`)
        const hv30 = getRollingHV(ticker, date, 30) ?? 0.25;
        // 252-day HV for G&S mispricing signal
        const hv252 = getRollingHV(ticker, date, 252) ?? hv30;

        // G&S (2007): skip when RV > IV (options are cheap, selling is wrong side)
        // In backtest we approximate IV as hv30 × (1 + vol-risk-premium constant 0.08)
        // Consistent with B&K (2003): options carry ~8% avg IV premium over HV
        const impliedVol = hv30 * (1 + 0.08 * bkBoost);
        if (impliedVol < hv252) {
          // RV(1Y) > IV → G&S says options are cheap → skip
          vrpSkippedCount++;
          continue;
        }

        const strike = px * 1.05; // ~5% OTM call
        const deltaApprox = 0.25;
        const premEst = px * impliedVol * sqrtT * deltaApprox * bkBoost;

        ccPrem += premEst * 100;
        const assigned = nextPx != null && Number.isFinite(nextPx) ? nextPx > strike : false;
        if (assigned) assigns += 1;
      }

      // CSPs: only in strong_bull/normal
      if (regime === 'strong_bull' || regime === 'normal') {
        for (const row of nonHoldings) {
          const ticker = row?.ticker;
          const prices = ticker ? priceHistory[ticker] : null;
          const px = prices ? getPrice(prices, date) : Number(row?.price);
          const nextPx = prices ? getPrice(prices, nextDate) : null;
          if (!ticker || px == null || !Number.isFinite(px) || px <= 0) continue;

          // Earnings avoidance: skip if earnings fall within the DTE window
          const dteToEarnings = daysUntilEarnings(ticker, date, fundamentalsLive);
          if (dteToEarnings != null && dteToEarnings >= 0 && dteToEarnings <= dte) continue;

          const hv30 = getRollingHV(ticker, date, 30) ?? 0.25;
          const hv252 = getRollingHV(ticker, date, 252) ?? hv30;
          const impliedVol = hv30 * (1 + 0.08 * bkBoost);

          // G&S: skip when options are cheap
          if (impliedVol < hv252) {
            vrpSkippedCount++;
            continue;
          }

          const strike = px * 0.95; // ~5% OTM put
          const deltaApprox = 0.2;
          const premEst = px * impliedVol * sqrtT * deltaApprox * bkBoost;

          cspPrem += premEst * 100;
          const assigned = nextPx != null && Number.isFinite(nextPx) ? nextPx < strike : false;
          if (assigned) {
            assigns += 1;
            const pnl = premEst * 100 - Math.max(0, strike - nextPx) * 100;
            assignPnlLocal += pnl;
          }
        }
      }

      const total = ccPrem + cspPrem;
      cumulative += total;
      totalPremium += total;
      assignmentCount += assigns;
      assignmentPnl += assignPnlLocal;

      monthlyPnl.push({
        date,
        regime,
        ccPremium: parseFloat(ccPrem.toFixed(2)),
        cspPremium: parseFloat(cspPrem.toFixed(2)),
        assignments: assigns,
        totalPnl: parseFloat(total.toFixed(2)),
        cumulative: parseFloat(cumulative.toFixed(2)),
        vrpSkipped: vrpSkippedCount,
        bkRegimeBoost: bkBoost
      });
    }

    const midpoint = Math.floor(monthlyPnl.length / 2);
    const firstHalf = monthlyPnl.slice(0, midpoint);
    const secondHalf = monthlyPnl.slice(midpoint);
    const halfStats = (arr) => {
      const total = arr.reduce((s, m) => s + (Number(m.totalPnl) || 0), 0);
      const vrpSkipped = arr.reduce((s, m) => s + (Number(m.vrpSkipped) || 0), 0);
      return {
        months: arr.length,
        totalPremium: parseFloat(total.toFixed(0)),
        avgMonthly: arr.length ? parseFloat((total / arr.length).toFixed(0)) : 0,
        bearMonths: arr.filter((m) => m.regime === 'bear').length,
        vrpSkipped
      };
    };

    // Compare to equity-only backtest using the same cached data
    const equityStart = new Date(endDate.getTime() - days * 86400000).toISOString().split('T')[0];
    const equityDates = getRebalanceDates(equityStart, endDateStr, 'monthly');
    const simOptions = {
      adaptiveMode: 'fixed',
      positionSizing: 'invVol',
      regimeEnabled: true,
      rlAgent: false,
      rlMode: 'off',
      skipMlRankingAdjustments: true
    };
    const equitySim = await runBacktestSimulation(
      universe,
      priceHistory,
      fundamentalsLive,
      spyPrices,
      equityDates,
      15,
      100000,
      'full_composite',
      weights,
      null,
      universeId,
      simOptions
    );
    const equityOnlyTotalReturnPct = parseFloat(equitySim?.performance?.totalReturn ?? 0);

    const years = days / 365;
    const annualizedPremiumYieldPct = years > 0 ? (totalPremium / 100000 / years) * 100 : 0;
    const enhancedReturnPct = equityOnlyTotalReturnPct + (totalPremium / 100000) * 100;

    res.json({
      success: true,
      period,
      universe: universeId,
      topN,
      performance: {
        equityOnlyReturnPct: parseFloat(equityOnlyTotalReturnPct.toFixed(2)),
        totalPremiumCollected: parseFloat(totalPremium.toFixed(2)),
        annualizedPremiumYieldPct: parseFloat(annualizedPremiumYieldPct.toFixed(2)),
        enhancedReturnPct: parseFloat(enhancedReturnPct.toFixed(2)),
        liftFromOptionsPct: parseFloat((enhancedReturnPct - equityOnlyTotalReturnPct).toFixed(2)),
        assignmentCount,
        assignmentPnl: parseFloat(assignmentPnl.toFixed(2))
      },
      monthlyPnl,
      walkForward: {
        firstHalf: halfStats(firstHalf),
        secondHalf: halfStats(secondHalf),
        note: 'Second half is a better estimate of forward returns — less in-sample bias'
      },
      interpretation: {
        whatThisMeans:
          `Simplified wheel-style premium simulation using equity price history only (no IV surface).`,
        caveats: [
          'Premium is a rough estimate from realized vol; no bid/ask, slippage, or fees modeled.',
          'Assignment is approximated using next-rebalance price vs strike (path-dependent in reality).',
          'This is a directional sanity check, not a brokerage-grade options backtest.'
        ]
      }
    });
  } catch (err) {
    console.error('[options/backtest]', err);
    res.status(500).json({ success: false, error: err.message || String(err) });
  } finally {
    clearBacktestRuntimeCaches();
  }
});

// ── Options Auto Trader (Tradier sandbox simulation) ─────────────────────────

// ── Wheel Portfolio (equity + options overlay) ───────────────────────────────

async function paperPortfolioSnapshot(universeId) {
  const paperUid = String(universeId || 'sp500_top50').trim();
  let portfolio = loadPaperPortfolioForUniverse(paperUid);
  if (!portfolio) return { portfolio: null, holdings: [], totalValue: 0, totalReturnPct: 0, regime: null };

  portfolio = normalizePaperPortfolio(portfolio);
  if (portfolio.holdings.length > 0) {
    portfolio = await takeNavSnapshot(portfolio);
  }

  const tickers = portfolio.holdings.map((h) => h.ticker);
  const currentPrices = {};
  await mapWithConcurrency(tickers, 10, async (ticker) => {
    try {
      const quote = await fetchYahooOp(() => yahooFinance.quote(yahooApiSymbol(ticker)), 8000);
      currentPrices[ticker] = quote?.regularMarketPrice || null;
    } catch {
      currentPrices[ticker] = null;
    }
  });

  let totalValue = Number(portfolio.cash) || 0;
  const enrichedHoldings = portfolio.holdings.map((h) => {
    const currentPrice = currentPrices[h.ticker] || h.entryPrice;
    const marketValue = h.shares * currentPrice;
    totalValue += marketValue;
    return { ...h, currentPrice, marketValue };
  });

  const totalReturnPct =
    portfolio.initialCapital > 0 ? ((totalValue / portfolio.initialCapital) - 1) * 100 : 0;
  const lastRb =
    portfolio.rebalanceHistory && portfolio.rebalanceHistory.length > 0
      ? portfolio.rebalanceHistory[portfolio.rebalanceHistory.length - 1]
      : null;
  const regime = lastRb?.regime ?? portfolio?.summary?.currentRegime ?? null;

  return { portfolio, holdings: enrichedHoldings, totalValue, totalReturnPct, regime };
}

/**
 * Live SPY-based regime + B&K sizing boost for wheel / Options UI when paper book has no regime stored yet.
 */
async function wheelLiveAcademicContext() {
  const today = new Date().toISOString().split('T')[0];
  const bkRegimeBoost = getBKVolRegimeBoost(today);
  let marketRegime = 'normal';
  try {
    const start = new Date(Date.now() - 550 * 86400000).toISOString().split('T')[0];
    const spyPrices = await bt_fetchPriceHistory('SPY', start, today);
    if (spyPrices?.length >= 200) {
      const meta = calculateMarketRegime(spyPrices, today, null, null);
      marketRegime = meta?.regime ?? 'normal';
    }
  } catch {
    marketRegime = 'normal';
  }
  return { asOf: today, bkRegimeBoost, marketRegime };
}

app.get('/api/wheel/status', async (req, res) => {
  try {
    const universeId = String(req.query.universeId ?? 'sp500_top50').trim();
    const wheel = loadWheelPortfolio();
    const [snap, liveCtx] = await Promise.all([paperPortfolioSnapshot(universeId), wheelLiveAcademicContext()]);
    const effectiveRegime = snap.regime ?? liveCtx.marketRegime ?? 'normal';
    const summary = getWheelSummary(
      { equityTotalValue: snap.totalValue, equityTotalReturnPct: snap.totalReturnPct, regime: effectiveRegime },
      wheel
    );
    res.json({
      success: true,
      universeId,
      config: WHEEL_CONFIG,
      equity: {
        holdingsCount: snap.holdings.length,
        totalValue: parseFloat(Number(snap.totalValue || 0).toFixed(2)),
        totalReturnPct: parseFloat(Number(snap.totalReturnPct || 0).toFixed(2)),
        regime: effectiveRegime,
        regimeSource: snap.regime ? 'paper_rebalance' : 'spy_live'
      },
      academicContext: liveCtx,
      summary,
      optionsLegs: wheel.optionsLegs || [],
      closedLegs: (wheel.closedLegs || []).slice(-10),
      lastRun: wheel.lastRun ?? null,
      lastOptimized: wheel.lastOptimized ?? null
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

app.post('/api/wheel/run', async (req, res) => {
  try {
    const universeId = String(req.body?.universeId ?? req.query?.universeId ?? 'sp500_top50').trim();
    const wheel = loadWheelPortfolio();
    const snap = await paperPortfolioSnapshot(universeId);
    const regime = String(req.body?.regime ?? snap.regime ?? 'normal').toLowerCase();

    // ── Phase 1: manage existing legs ─────────────────────────────────────
    if (WHEEL_CONFIG.regimeClosesAll.includes(regime)) {
      // still let manageOptionLegsOnce handle closing logic (bear override included)
    }
    const mgmt = await manageOptionLegsOnce(wheel.optionsLegs || [], regime);
    const remaining = mgmt.positions || [];
    const closed = mgmt.actions?.closed || [];
    wheel.optionsLegs = remaining;

    for (const c of closed) {
      const pnl = Number(c.pnl) || 0;
      wheel.closedLegs.push({
        symbol: c.symbol,
        ticker: c.ticker,
        closedAt: c.closedAt,
        closeReason: c.reason,
        realizedPnL: pnl
      });
      wheel.stats.totalOptionsPnl += pnl;
      wheel.stats.totalLegs += 1;
      if (pnl >= 0) wheel.stats.wins += 1;
      else wheel.stats.losses += 1;
    }

    // ── Phase 2: open new legs from scanner targets ───────────────────────
    const scan = await computeOptionsScan(universeId);
    const targets = selectWheelTargets(snap.holdings || [], scan.opportunities || [], wheel.optionsLegs || [], regime);

    const opened = [];
    const errors = [];

    for (const t of targets) {
      try {
        const opp = t.opp;
        const prem = Number(opp.premium ?? opp.mid ?? opp.bid ?? 0) || 0;
        const limit = Math.max(0.01, parseFloat((prem - 0.02).toFixed(2)));
        if (limit < 0.1) continue;

        const resp = await openShortOptionLeg({
          ticker: t.ticker,
          optionSymbol: opp.optionSymbol,
          quantity: 1,
          limitPrice: limit
        });

        wheel.optionsLegs.push({
          ticker: t.ticker,
          strategy: opp.strategy,
          optionSymbol: opp.optionSymbol,
          strike: opp.strike,
          expiration: opp.expiration,
          quantity: 1,
          entryCredit: limit,
          entryDate: new Date().toISOString(),
          entryOrderId: resp?.order?.id ?? 'DRY_RUN',
          ev: opp.ev,
          delta: opp.delta,
          dte: opp.dte,
          ivRank: opp.ivRank,
          currentPrice: opp.currentPrice,
          compositeScore: opp.compositeScore,
          reason: t.reason,
          // Three-paper academic signal snapshot at entry
          sellScore:        opp.sellScore        ?? null,
          signalCount:      opp.signalCount      ?? null,
          academicSellEdge: opp.academicSellEdge ?? null,
          gsSignal:         opp.gsSignal         ?? null,
          gsSellEdge:       opp.gsSellEdge       ?? null,
          gsInterpretation: opp.gsInterpretation ?? null,
          vrpIntensity:     opp.vrpIntensity      ?? null,
          ivPremium:        opp.ivPremium         ?? null,
          regimeBoost:      opp.regimeBoost       ?? null,
          ivolPct:          opp.ivolPct           ?? null,
          ivolRaw:          opp.ivolRaw           ?? null,
          bkRegimeBoost:    opp.bkRegimeBoost     ?? null
        });
        wheel.stats.premiumCollected += limit * 100;
        opened.push({ ticker: t.ticker, strategy: opp.strategy, symbol: opp.optionSymbol, credit: limit, orderId: resp?.order?.id ?? 'DRY_RUN' });
      } catch (e) {
        errors.push({ ticker: t.ticker, error: e.message || String(e) });
      }
    }

    wheel.lastRun = new Date().toISOString();
    saveWheelPortfolio(wheel);

    const summary = getWheelSummary(
      { equityTotalValue: snap.totalValue, equityTotalReturnPct: snap.totalReturnPct, regime },
      wheel
    );

    res.json({
      success: true,
      universeId,
      regime,
      mode: mgmt.mode,
      summary,
      actions: {
        closed,
        opened,
        errors
      },
      optionsLegs: wheel.optionsLegs
    });
  } catch (err) {
    console.error('[wheel/run]', err);
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});


// ── Wheel Optimizer ─────────────────────────────────────────────────────────
// Smarter than /run: beyond standard profit/DTE closes, also identifies legs
// that are significantly outclassed by a fresh scan opportunity (EV ratio ≥ 2×)
// and replaces them. Runs on the same universe-aware snapshot used by /run.
app.post('/api/wheel/optimize', async (req, res) => {
  try {
    const universeId = String(req.body?.universeId ?? req.query?.universeId ?? 'sp500_top50').trim();
    const wheel = loadWheelPortfolio();
    const snap = await paperPortfolioSnapshot(universeId);
    const regime = String(req.body?.regime ?? snap.regime ?? 'normal').toLowerCase();

    const nowIso = new Date().toISOString();
    const actions = { closed: [], replaced: [], opened: [], errors: [] };

    // ── Phase 1: standard management (profit target / DTE / bear) ─────────
    const mgmt = await manageOptionLegsOnce(wheel.optionsLegs || [], regime);
    let remaining = mgmt.positions || [];
    for (const c of (mgmt.actions?.closed || [])) {
      const pnl = Number(c.pnl) || 0;
      wheel.closedLegs.push({ symbol: c.symbol, ticker: c.ticker, closedAt: c.closedAt, closeReason: c.reason, realizedPnL: pnl });
      wheel.stats.totalOptionsPnl += pnl;
      wheel.stats.totalLegs += 1;
      if (pnl >= 0) wheel.stats.wins += 1; else wheel.stats.losses += 1;
      actions.closed.push(c);
    }
    wheel.optionsLegs = remaining;

    // ── Phase 2: fresh scan ────────────────────────────────────────────────
    const scan = await computeOptionsScan(universeId);
    const scanOpps = scan.opportunities || [];

    // Build a quick lookup: best-EV scan opportunity per ticker
    const bestScanByTicker = {};
    for (const opp of scanOpps) {
      const t = String(opp.ticker || '').toUpperCase();
      if (!t || !opp.optionSymbol) continue;
      if ((Number(opp.ev) || 0) <= 0) continue;
      if (!bestScanByTicker[t] || (Number(opp.ev) || 0) > (Number(bestScanByTicker[t].ev) || 0)) {
        bestScanByTicker[t] = opp;
      }
    }

    // ── Phase 3: replace underperforming legs when a 2× better opp exists ─
    const EV_REPLACE_RATIO = 2.0;
    const LOSS_PCT_THRESHOLD = -0.10; // only consider replacing legs already down >10%
    const newRemaining = [];
    for (const leg of remaining) {
      const pnlPct = Number(leg.currentPnLPct) || 0;
      const legEv = Number(leg.ev) || 0;
      const ticker = String(leg.ticker || '').toUpperCase();
      const bestAlt = Object.values(bestScanByTicker).find(
        (o) => String(o.ticker || '').toUpperCase() !== ticker &&
               (Number(o.ev) || 0) >= legEv * EV_REPLACE_RATIO &&
               !remaining.some((r) => String(r.ticker).toUpperCase() === String(o.ticker).toUpperCase()) &&
               !newRemaining.some((r) => String(r.ticker).toUpperCase() === String(o.ticker).toUpperCase())
      );

      if (pnlPct < LOSS_PCT_THRESHOLD && bestAlt) {
        // Close the underperformer
        try {
          const prem = Number(leg.currentMark ?? leg.entryCredit) || 0;
          const closeLimit = Math.max(0.01, prem + 0.05);
          const closeResp = await openShortOptionLeg({
            ticker: leg.ticker,
            optionSymbol: leg.optionSymbol,
            quantity: leg.quantity ?? 1,
            limitPrice: closeLimit,
            side: 'buy'
          }).catch(() => null);
          const pnl = (Number(leg.entryCredit) - prem) * 100 * (leg.quantity ?? 1);
          wheel.closedLegs.push({ symbol: leg.optionSymbol, ticker: leg.ticker, closedAt: nowIso, closeReason: `replaced: better opp ${bestAlt.ticker} (EV ${Number(bestAlt.ev).toFixed(0)} vs ${legEv.toFixed(0)})`, realizedPnL: pnl });
          wheel.stats.totalOptionsPnl += pnl;
          wheel.stats.totalLegs += 1;
          if (pnl >= 0) wheel.stats.wins += 1; else wheel.stats.losses += 1;
          actions.replaced.push({ closedTicker: leg.ticker, closedSymbol: leg.optionSymbol, replacedBy: bestAlt.ticker, replacedByEv: Number(bestAlt.ev) });
          // Open the replacement
          const newPrem = Number(bestAlt.premium ?? bestAlt.mid ?? bestAlt.bid ?? 0) || 0;
          const newLimit = Math.max(0.01, parseFloat((newPrem - 0.02).toFixed(2)));
          if (newLimit >= 0.1) {
            const openResp = await openShortOptionLeg({ ticker: bestAlt.ticker, optionSymbol: bestAlt.optionSymbol, quantity: 1, limitPrice: newLimit });
            const newLeg = {
              ticker: String(bestAlt.ticker).toUpperCase(),
              strategy: bestAlt.strategy,
              optionSymbol: bestAlt.optionSymbol,
              strike: bestAlt.strike,
              expiration: bestAlt.expiration,
              quantity: 1,
              entryCredit: newLimit,
              entryDate: nowIso,
              entryOrderId: openResp?.order?.id ?? 'DRY_RUN',
              ev: Number(bestAlt.ev) || 0,
              delta: bestAlt.delta,
              dte: bestAlt.dte,
              ivRank: bestAlt.ivRank,
              currentPrice: bestAlt.currentPrice,
              compositeScore: bestAlt.compositeScore,
              reason: `optimizer replacement for ${leg.ticker}`,
              sellScore:        bestAlt.sellScore        ?? null,
              signalCount:      bestAlt.signalCount      ?? null,
              academicSellEdge: bestAlt.academicSellEdge ?? null,
              gsSignal:         bestAlt.gsSignal         ?? null,
              gsSellEdge:       bestAlt.gsSellEdge       ?? null,
              gsInterpretation: bestAlt.gsInterpretation ?? null,
              vrpIntensity:     bestAlt.vrpIntensity      ?? null,
              ivPremium:        bestAlt.ivPremium         ?? null,
              regimeBoost:      bestAlt.regimeBoost       ?? null,
              ivolPct:          bestAlt.ivolPct           ?? null,
              ivolRaw:          bestAlt.ivolRaw           ?? null,
              bkRegimeBoost:    bestAlt.bkRegimeBoost     ?? null
            };
            newRemaining.push(newLeg);
            wheel.stats.premiumCollected += newLimit * 100;
            actions.opened.push({ ticker: bestAlt.ticker, symbol: bestAlt.optionSymbol, credit: newLimit, reason: 'optimizer_replacement' });
          }
        } catch (e) {
          newRemaining.push(leg);
          actions.errors.push({ ticker: leg.ticker, error: e.message || String(e) });
        }
      } else {
        newRemaining.push(leg);
      }
    }
    wheel.optionsLegs = newRemaining;

    // ── Phase 4: fill remaining slots from scored fresh scan ──────────────
    // Score = EV × log(1 + ivRank) — rewards both premium size and IV edge
    const scoredOpps = scanOpps
      .filter((o) => {
        if (!o?.optionSymbol) return false;
        if ((Number(o.ev) || 0) <= 0) return false;
        if ((Number(o.ivRank) || 0) < 40) return false;
        const vrpOk = o.vrpEdge != null ? !!o.vrpEdge : (Number(o.ivRank) || 0) > 50;
        if (!vrpOk) return false;
        const t = String(o.ticker || '').toUpperCase();
        if (wheel.optionsLegs.some((l) => String(l.ticker).toUpperCase() === t)) return false;
        // Regime gate
        const allowedCC = WHEEL_CONFIG.regimeAllowsCC.includes(regime);
        const allowedCSP = WHEEL_CONFIG.regimeAllowsCSP.includes(regime);
        if (o.strategy === 'COVERED_CALL' && !allowedCC) return false;
        if (o.strategy === 'CASH_SECURED_PUT' && !allowedCSP) return false;
        // G&S gate: never sell when realized vol > implied vol
        if (WHEEL_CONFIG.blockCheapOptions && o.gsSellEdge === false) return false;
        // Composite sell score minimum
        if (WHEEL_CONFIG.minSellScore > 0 && o.sellScore != null && o.sellScore < WHEEL_CONFIG.minSellScore) return false;
        // Signal count minimum
        if (WHEEL_CONFIG.minSignalCount > 1 && o.signalCount != null && o.signalCount < WHEEL_CONFIG.minSignalCount) return false;
        return true;
      })
      // Blend academic sellScore with EV×log(IVR) for optimizer ranking
      .map((o) => ({
        ...o,
        _optimizerScore:
          (o.sellScore != null
            ? (o.sellScore * 500) * 0.5 + (Number(o.ev) || 0) * Math.log(1 + (Number(o.ivRank) || 0)) * 0.5
            : (Number(o.ev) || 0) * Math.log(1 + (Number(o.ivRank) || 0)))
      }))
      .sort((a, b) => b._optimizerScore - a._optimizerScore);

    const openSlots = Math.max(0, WHEEL_CONFIG.maxWheelPositions - wheel.optionsLegs.length);
    const toOpen = scoredOpps.slice(0, openSlots);
    for (const opp of toOpen) {
      try {
        const prem = Number(opp.premium ?? opp.mid ?? opp.bid ?? 0) || 0;
        const limit = Math.max(0.01, parseFloat((prem - 0.02).toFixed(2)));
        if (limit < 0.1) continue;
        const resp = await openShortOptionLeg({ ticker: opp.ticker, optionSymbol: opp.optionSymbol, quantity: 1, limitPrice: limit });
        const newLeg = {
          ticker: String(opp.ticker).toUpperCase(),
          strategy: opp.strategy,
          optionSymbol: opp.optionSymbol,
          strike: opp.strike,
          expiration: opp.expiration,
          quantity: 1,
          entryCredit: limit,
          entryDate: nowIso,
          entryOrderId: resp?.order?.id ?? 'DRY_RUN',
          ev: Number(opp.ev) || 0,
          delta: opp.delta,
          dte: opp.dte,
          ivRank: opp.ivRank,
          currentPrice: opp.currentPrice,
          compositeScore: opp.compositeScore,
          reason: `optimizer: score ${(opp._optimizerScore || 0).toFixed(1)}${opp.sellScore != null ? ` · academic ${(opp.sellScore * 100).toFixed(0)}/100` : ''}`,
          sellScore:        opp.sellScore        ?? null,
          signalCount:      opp.signalCount      ?? null,
          academicSellEdge: opp.academicSellEdge ?? null,
          gsSignal:         opp.gsSignal         ?? null,
          gsSellEdge:       opp.gsSellEdge       ?? null,
          gsInterpretation: opp.gsInterpretation ?? null,
          vrpIntensity:     opp.vrpIntensity      ?? null,
          ivPremium:        opp.ivPremium         ?? null,
          regimeBoost:      opp.regimeBoost       ?? null,
          ivolPct:          opp.ivolPct           ?? null,
          ivolRaw:          opp.ivolRaw           ?? null,
          bkRegimeBoost:    opp.bkRegimeBoost     ?? null
        };
        wheel.optionsLegs.push(newLeg);
        wheel.stats.premiumCollected += limit * 100;
        actions.opened.push({ ticker: opp.ticker, symbol: opp.optionSymbol, credit: limit, ev: Number(opp.ev), ivRank: Number(opp.ivRank), reason: 'optimizer_fill' });
      } catch (e) {
        actions.errors.push({ ticker: opp.ticker, error: e.message || String(e) });
      }
    }

    wheel.lastRun = nowIso;
    wheel.lastOptimized = nowIso;
    saveWheelPortfolio(wheel);

    const summary = getWheelSummary({ equityTotalValue: snap.totalValue, equityTotalReturnPct: snap.totalReturnPct, regime }, wheel);
    res.json({
      success: true,
      universeId,
      regime,
      actions,
      summary,
      optionsLegs: wheel.optionsLegs
    });
  } catch (err) {
    console.error('[wheel/optimize]', err);
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

function closePaperOptionsPosition(portfolio, positionId, closePremium, reason) {
  const pos = portfolio.positions.find((p) => p.id === positionId);
  if (!pos) return { ok: false, error: 'Position not found' };
  const cp = parseFloat(closePremium);
  if (!Number.isFinite(cp)) return { ok: false, error: 'Invalid close premium' };

  const isSeller = pos.strategy !== 'REGIME_HEDGE';
  const mult = pos.quantity * 100;
  const pnl = isSeller ? (pos.openPremium - cp) * mult : (cp - pos.openPremium) * mult;
  const pnlPct = isSeller ? (pos.openPremium - cp) / pos.openPremium : (cp - pos.openPremium) / pos.openPremium;

  const closed = {
    ...pos,
    closePremium: cp,
    closeDate: new Date().toISOString().split('T')[0],
    pnl,
    pnlPct,
    closeReason: reason ?? 'manual',
    status: 'closed'
  };

  portfolio.positions = portfolio.positions.filter((p) => p.id !== positionId);
  portfolio.closedPositions.push(closed);
  return { ok: true, closed };
}

function markPaperOptionsPosition(pos) {
  const dteRemaining = Math.max(
    0,
    Math.round((new Date(pos.expiration) - new Date()) / (1000 * 60 * 60 * 24))
  );
  pos.dteRemaining = dteRemaining;

  const daysSinceOpen = Math.max(
    0,
    Math.round((new Date() - new Date(pos.openDate)) / (1000 * 60 * 60 * 24))
  );

  let currentPremium = pos.currentPremium ?? pos.openPremium;
  if (OPTIONS_USE_MOCK && pos.theta != null && Number.isFinite(pos.theta)) {
    const decay = pos.theta * daysSinceOpen;
    const randomWalk = (mix01(pos.id, pos.ticker, 'mk') - 0.5) * pos.openPremium * 0.1;
    currentPremium = Math.max(0.01, pos.openPremium + decay + randomWalk);
  } else if (!OPTIONS_USE_MOCK) {
    // Live mark plumbing can be added later; for now preserve last seen mark.
    currentPremium = pos.currentPremium ?? pos.openPremium;
  }
  pos.currentPremium = currentPremium;

  const isSeller = pos.strategy !== 'REGIME_HEDGE';
  const mult = pos.quantity * 100;
  pos.pnl = isSeller ? (pos.openPremium - currentPremium) * mult : (currentPremium - pos.openPremium) * mult;
  pos.pnlPct = pos.openPremium * mult !== 0 ? pos.pnl / (pos.openPremium * mult) : 0;

  return pos;
}

function autoManageManualOptionsPortfolio(regime) {
  const raw = loadOptionsPortfolio();
  if (!raw) return { ok: false, error: 'No options portfolio' };
  const portfolio = normalizeOptionsPortfolio(raw);

  const actions = { closed: [], skipped: [], errors: [] };
  const regimeStr = String(regime || '').toLowerCase();
  const bearish = regimeStr === 'bear' || regimeStr === 'caution';

  for (const pos of [...portfolio.positions]) {
    try {
      markPaperOptionsPosition(pos);
      const dte = Number(pos.dteRemaining) || 0;
      const cp = Number(pos.currentPremium);
      if (!Number.isFinite(cp) || cp <= 0) {
        actions.skipped.push({ id: pos.id, ticker: pos.ticker, reason: 'no_mark' });
        continue;
      }

      const isSeller = pos.strategy !== 'REGIME_HEDGE';
      const profitPct = isSeller
        ? (pos.openPremium - cp) / pos.openPremium
        : (cp - pos.openPremium) / pos.openPremium;

      let shouldClose = false;
      let closeReason = null;

      // Rule 1: profit target (default 50% for sellers)
      if (pos.profitTarget != null && Number.isFinite(Number(pos.profitTarget)) && profitPct >= Number(pos.profitTarget)) {
        shouldClose = true;
        closeReason = `profit_target_${Math.round(Number(pos.profitTarget) * 100)}pct`;
      }

      // Rule 2: close/roll threshold (default rollAt=21)
      if (pos.rollAt != null && Number.isFinite(Number(pos.rollAt)) && dte <= Number(pos.rollAt)) {
        shouldClose = true;
        closeReason = closeReason || `dte_${dte}`;
      }

      // Rule 3: regime override (close short premium positions in bear/caution)
      if (bearish && isSeller) {
        shouldClose = true;
        closeReason = closeReason || `regime_${regimeStr}`;
      }

      if (!shouldClose) {
        actions.skipped.push({ id: pos.id, ticker: pos.ticker, reason: 'hold' });
        continue;
      }

      const result = closePaperOptionsPosition(portfolio, pos.id, cp, closeReason);
      if (!result.ok) {
        actions.errors.push({ id: pos.id, ticker: pos.ticker, error: result.error });
        continue;
      }
      actions.closed.push({ id: pos.id, ticker: pos.ticker, reason: closeReason, pnl: result.closed.pnl });
    } catch (e) {
      actions.errors.push({ id: pos.id, ticker: pos.ticker, error: e.message || String(e) });
    }
  }

  saveOptionsPortfolio(portfolio);
  return { ok: true, actions };
}

app.post('/api/options/auto-trader/run', async (req, res) => {
  try {
    const universeId = req.body?.universeId ?? req.query?.universeId ?? 'sp500_top50';
    const scan = await computeOptionsScan(universeId);
    const regime = req.body?.regime ?? scan.regime ?? 'normal';
    const result = await runAutoTrader(scan.opportunities || [], regime);
    const includeManual = req.body?.includeManual !== false;
    const manual = includeManual ? autoManageManualOptionsPortfolio(regime) : null;
    res.json({ ...result, manual, scanMeta: { universeId: scan.universeId, scanDate: scan.scanDate } });
  } catch (err) {
    console.error('[Options/auto-trader/run]', err);
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

app.get('/api/options/auto-trader/portfolio', (req, res) => {
  try {
    res.json({ success: true, portfolio: getAutoPortfolio() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

app.post('/api/options/paper/open', async (req, res) => {
  try {
    let portfolio = loadOptionsPortfolio();
    if (!portfolio) portfolio = emptyOptionsPortfolio();
    else portfolio = normalizeOptionsPortfolio(portfolio);

    const {
      strategy,
      ticker,
      strike,
      expiration,
      optionType,
      quantity,
      contracts,
      premium,
      currentPrice,
      rationale,
      osiSymbol,
      dte,
      delta,
      theta,
      iv,
      ivRank
    } = req.body || {};

    const qtyRaw = quantity != null ? quantity : contracts;
    if (!ticker || strike == null || !expiration || !optionType || qtyRaw == null || premium == null) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    const strat = String(strategy || '').trim();
    if (!strat || !['COVERED_CALL', 'CASH_SECURED_PUT', 'REGIME_HEDGE'].includes(strat)) {
      return res.status(400).json({ success: false, error: 'Invalid strategy' });
    }

    const q = Math.max(1, parseInt(String(qtyRaw), 10) || 1);
    const prem = parseFloat(String(premium));
    const strikeN = Number(strike);
    if (!Number.isFinite(prem) || !Number.isFinite(strikeN)) {
      return res.status(400).json({ success: false, error: 'Invalid premium or strike' });
    }
    const osi =
      osiSymbol ||
      buildOsiSymbol({
        ticker: String(ticker).toUpperCase(),
        expiration: String(expiration),
        optionType: String(optionType).toLowerCase() === 'call' ? 'call' : 'put',
        strike: strikeN
      });

    const order = await submitPaperOrder({
      ticker: String(ticker).toUpperCase(),
      strike: strikeN,
      expiration: String(expiration),
      optionType: String(optionType).toLowerCase() === 'call' ? 'call' : 'put',
      action: strat === 'REGIME_HEDGE' ? 'buy_to_open' : 'sell_to_open',
      quantity: q,
      price: prem,
      osiSymbol: osi
    });

    const orderId =
      order?.id != null
        ? String(order.id)
        : order?.order?.id != null
          ? String(order.order.id)
          : `MOCK-${Date.now()}`;

    const position = {
      id: orderId,
      strategy: strat,
      ticker: String(ticker).toUpperCase(),
      strike: strikeN,
      expiration: String(expiration),
      optionType: String(optionType).toLowerCase() === 'call' ? 'call' : 'put',
      quantity: q,
      openPremium: prem,
      currentPremium: prem,
      currentPrice: currentPrice != null ? Number(currentPrice) : null,
      openDate: new Date().toISOString().split('T')[0],
      dte: dte != null ? Number(dte) : null,
      dteAtOpen: dte != null ? Number(dte) : null,
      delta: delta != null ? Number(delta) : null,
      theta: theta != null ? Number(theta) : null,
      iv: iv != null ? Number(iv) : null,
      ivRank: ivRank != null ? Number(ivRank) : null,
      osiSymbol: osi,
      rationale: rationale || '',
      status: 'open',
      pnl: 0,
      pnlPct: 0,
      profitTarget: strat === 'REGIME_HEDGE' ? null : 0.5,
      stopLoss: strat === 'REGIME_HEDGE' ? -1.0 : null,
      rollAt: 21
    };

    portfolio.positions.push(position);
    saveOptionsPortfolio(portfolio);

    res.json({ success: true, position, order });
  } catch (err) {
    console.error('[options/paper/open]', err);
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

app.post('/api/options/paper/close', async (req, res) => {
  try {
    const portfolio = loadOptionsPortfolio();
    if (!portfolio) return res.status(404).json({ success: false, error: 'No options portfolio' });

    const { positionId, closePremium, reason } = req.body || {};
    const result = closePaperOptionsPosition(portfolio, positionId, closePremium, reason);
    if (!result.ok) {
      const code = result.error === 'Position not found' ? 404 : 400;
      return res.status(code).json({ success: false, error: result.error });
    }
    saveOptionsPortfolio(portfolio);
    res.json({ success: true, closed: result.closed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

/** Remove an open position without recording a close (paper cleanup). */
app.post('/api/options/paper/delete', async (req, res) => {
  try {
    const portfolio = loadOptionsPortfolio();
    if (!portfolio) return res.status(404).json({ success: false, error: 'No options portfolio' });

    const { positionId } = req.body || {};
    if (!positionId) {
      return res.status(400).json({ success: false, error: 'Missing positionId' });
    }

    const before = portfolio.positions.length;
    portfolio.positions = portfolio.positions.filter((p) => p.id !== positionId);
    if (portfolio.positions.length === before) {
      return res.status(404).json({ success: false, error: 'Position not found' });
    }

    saveOptionsPortfolio(portfolio);
    res.json({ success: true, deletedId: positionId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

app.get('/api/options/paper/portfolio', async (req, res) => {
  try {
    let raw = loadOptionsPortfolio();
    if (!raw) raw = emptyOptionsPortfolio();

    const portfolio = JSON.parse(JSON.stringify(normalizeOptionsPortfolio(raw)));
    let totalPnl = 0;
    let totalTheta = 0;

    for (const pos of portfolio.positions) {
      markPaperOptionsPosition(pos);
      const dteRemaining = Number(pos.dteRemaining) || 0;
      const currentPremium = Number(pos.currentPremium);
      const isSeller = pos.strategy !== 'REGIME_HEDGE';

      pos.alerts = [];
      if (pos.profitTarget != null && pos.pnlPct >= pos.profitTarget) {
        pos.alerts.push({
          type: 'PROFIT_TARGET',
          message: '50% profit target reached — consider closing'
        });
      }
      if (pos.rollAt != null && dteRemaining <= pos.rollAt) {
        pos.alerts.push({
          type: 'ROLL_ALERT',
          message: `${dteRemaining} DTE — consider rolling or closing`
        });
      }
      if (dteRemaining === 0) {
        pos.alerts.push({ type: 'EXPIRATION', message: 'Expiring today — action required' });
      }

      totalPnl += pos.pnl;
      if (pos.theta != null && Number.isFinite(pos.theta)) {
        const thSigned = isSeller ? -pos.theta : pos.theta;
        totalTheta += thSigned * pos.quantity * 100;
      }
    }

    const closedPnl = portfolio.closedPositions.reduce((sum, p) => sum + (Number(p.pnl) || 0), 0);
    const winRate =
      portfolio.closedPositions.length > 0
        ? portfolio.closedPositions.filter((p) => Number(p.pnl) > 0).length /
          portfolio.closedPositions.length
        : null;

    res.json({
      success: true,
      portfolio: {
        ...portfolio,
        summary: {
          openPositions: portfolio.positions.length,
          closedPositions: portfolio.closedPositions.length,
          openPnl: parseFloat(totalPnl.toFixed(2)),
          closedPnl: parseFloat(closedPnl.toFixed(2)),
          totalPnl: parseFloat((totalPnl + closedPnl).toFixed(2)),
          dailyTheta: parseFloat(totalTheta.toFixed(2)),
          winRate: winRate !== null ? parseFloat((winRate * 100).toFixed(1)) : null,
          alerts: portfolio.positions.flatMap((p) =>
            (p.alerts || []).map((a) => ({ ...a, ticker: p.ticker }))
          ),
          mockMode: OPTIONS_USE_MOCK
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

/** Cartesian grid for POST /api/diagnostics/weight-sweep when `configs` is empty. */
function generateDefaultWeightSweepConfigs() {
  const momOpts = [0.25, 0.3, 0.35, 0.4];
  const valOpts = [0.2, 0.25, 0.3, 0.35, 0.4];
  const fundOpts = [0, 0.05, 0.1, 0.15];
  const earnOpts = [0, 0.1, 0.15, 0.2, 0.25];
  const tol = 0.01;
  const out = [];
  for (const m of momOpts) {
    for (const v of valOpts) {
      for (const f of fundOpts) {
        for (const e of earnOpts) {
          if (Math.abs(m + v + f + e - 1) <= tol) {
            out.push({
              momentum: m,
              value: v,
              fundamental: f,
              earningsMomentum: e,
              dcf: 0,
              valuation: 0
            });
          }
        }
      }
    }
  }
  return out;
}

function normalizeWeightSweepWeights(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = {};
  for (const f of FACTOR_NAMES) {
    const x = raw[f];
    o[f] = typeof x === 'number' && Number.isFinite(x) ? x : 0;
  }
  const s = FACTOR_NAMES.reduce((a, f) => a + o[f], 0);
  if (s <= 0) return null;
  for (const f of FACTOR_NAMES) o[f] = parseFloat((o[f] / s).toFixed(6));
  return o;
}

function weightSweepPerfRow(sim, capital) {
  const perf = extractDiagnosticPerformance(sim, capital);
  if (!perf) {
    return { totalReturn: 0, alpha: 0, sharpe: 0, maxDrawdown: 0, winRate: 0 };
  }
  return {
    totalReturn: parseFloat(perf.totalReturn),
    alpha: parseFloat(perf.alpha),
    sharpe: parseFloat(perf.sharpe),
    maxDrawdown: parseFloat(perf.maxDrawdown),
    winRate: parseFloat(perf.winRate)
  };
}

function weightSweepOverfitRatio(isSharpe, oosSharpe) {
  if (oosSharpe == null || !Number.isFinite(oosSharpe) || oosSharpe <= 0) return null;
  if (isSharpe == null || !Number.isFinite(isSharpe)) return null;
  return parseFloat((isSharpe / oosSharpe).toFixed(4));
}

function weightSweepOverfitFlag(ratio) {
  if (ratio == null || !Number.isFinite(ratio)) return 'overfit';
  if (ratio < 1.5) return 'healthy';
  if (ratio <= 2) return 'caution';
  return 'overfit';
}

function weightSweepShortLabel(w) {
  const pct = (x) => Math.round((Number(x) || 0) * 100);
  return `M${pct(w.momentum)}/V${pct(w.value)}/Q${pct(w.fundamental)}/E${pct(w.earningsMomentum)}`;
}

/**
 * POST /api/diagnostics/forward-confidence
 * Sub-period backtests + regime split; forward score (0–1) and estimated annual alpha.
 */
app.post('/api/diagnostics/forward-confidence', async (req, res) => {
  req.setTimeout(600000);
  res.setTimeout(600000);
  const fwdConfKey = `diag/forward-confidence:${apiCacheBodyDigest(req.body)}:${apiCacheUrlKey(req)}`;
  if (!skipApiResponseCacheRead(req)) {
    const hit = getApiResponseCache(fwdConfKey, API_CACHE_TTL_5M);
    if (hit) return res.json({ ...hit, cached: true });
  }
  try {
    clearBacktestRuntimeCaches();
    const body = req.body || {};
    const universeId = String(body.universeId || '').trim();
    const period = String(body.period || '3y').trim();
    const weights = normalizeWeightSweepWeights(body.weights);
    const topN = Math.max(1, parseInt(String(body.topN ?? '15'), 10) || 15);
    const capital = parseFloat(String(body.initialCapital ?? '10000')) || 10000;
    if (!weights) {
      return res.status(400).json({ success: false, error: 'Invalid weights (expect pillar weights summing to ~1)' });
    }
    const universe = UNIVERSE_TICKERS[universeId];
    if (!universe) {
      return res.status(400).json({ success: false, error: 'Unknown universeId' });
    }
    const periodDays = { '1y': 365, '2y': 730, '3y': 1095, '5y': 1825, '7y': 2555 };
    const mainDays = periodDays[period] || 1095;
    const endDate = new Date();
    const endDateStr = endDate.toISOString().split('T')[0];
    const fetchDays = Math.max(mainDays, 1825) + 400;
    const dataStart = new Date(endDate.getTime() - fetchDays * 86400000);
    const startDateStr = dataStart.toISOString().split('T')[0];
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
    const spyPrices = priceHistory['SPY'];
    if (!spyPrices?.length) {
      return res.status(500).json({ success: false, error: 'Could not fetch SPY' });
    }
    const simOptionsBase = {
      adaptiveMode: 'fixed',
      positionSizing: 'invVol',
      regimeEnabled: true,
      rlAgent: false,
      rlMode: 'off',
      skipMlRankingAdjustments: true,
      correlationFilter: false,
      maxCorrelated: 3,
      correlationLookbackDays: 60
    };
    const runWindow = async (daysWindow) => {
      const start = new Date(endDate.getTime() - daysWindow * 86400000).toISOString().split('T')[0];
      const rebalanceDates = getRebalanceDates(start, endDateStr, 'bimonthly');
      if (rebalanceDates.length < 2) return null;
      const simStart = rebalanceDates[0];
      const simEnd = rebalanceDates[rebalanceDates.length - 1];
      const cpiObsStart = subtractMonths(simStart, 60);
      const cpiObservations = await fetchFredCpiObservations(cpiObsStart, simEnd, process.env.FRED_API_KEY);
      const { multiplierFn: cashInflationMult } = buildCashInflationMultiplierFn(
        cpiObservations,
        simStart,
        INFLATION_BASELINE_ANNUAL
      );
      return runBacktestSimulation(
        universe,
        priceHistory,
        fundamentals,
        spyPrices,
        rebalanceDates,
        topN,
        capital,
        'full_composite',
        weights,
        cashInflationMult,
        universeId,
        { ...simOptionsBase }
      );
    };
    const primarySim = await runWindow(mainDays);
    if (!primarySim?.dailyValues?.length) {
      return res.status(500).json({ success: false, error: 'Primary simulation failed' });
    }
    const primaryPerf = extractDiagnosticPerformance(primarySim, capital);
    const primaryAlphaPct = primaryPerf ? parseFloat(primaryPerf.alpha) : 0;
    const regimeSplit = computeRegimeSplitPerformance(
      primarySim.dailyValues,
      spyPrices,
      universe,
      priceHistory
    );
    const regimeDiversification = buildRegimeDiversification(regimeSplit);
    const subperiodAnalysis = {};
    const subAlphas = [];
    for (const sk of ['1y', '2y', '3y', '5y']) {
      const d = periodDays[sk];
      if (mainDays < d) continue;
      const sim = await runWindow(d);
      const perf = sim ? extractDiagnosticPerformance(sim, capital) : null;
      if (perf) {
        subperiodAnalysis[sk] = {
          totalReturn: parseFloat(perf.totalReturn),
          alpha: parseFloat(perf.alpha),
          sharpe: parseFloat(perf.sharpe),
          maxDrawdown: parseFloat(perf.maxDrawdown)
        };
        subAlphas.push(parseFloat(perf.alpha));
      }
    }
    console.log('[FORWARD] subperiod alphas:', {
      '1y': subperiodAnalysis['1y']?.alpha,
      '2y': subperiodAnalysis['2y']?.alpha,
      '3y': subperiodAnalysis['3y']?.alpha
    });
    const deep = mergeDeepForwardScores(subAlphas, regimeDiversification, weights, primaryAlphaPct);
    const interpretation = buildForwardInterpretationLine(
      deep.scores,
      regimeDiversification,
      {
        stableSignal: deep.scores.stability >= 0.55,
        regimeRobust: (regimeDiversification?.positiveAlphaRegimes ?? 0) >= 2,
        recencyWarning: deep.scores.recencyDiscount < 0.45
      }
    );
    const fwdPayload = {
      success: true,
      universeId,
      period,
      weights,
      subperiodAnalysis,
      regimeSplit,
      regimeDiversification,
      scores: deep.scores,
      forwardEstimate: deep.forwardEstimate,
      interpretation
    };
    setApiResponseCache(fwdConfKey, fwdPayload);
    res.json(fwdPayload);
  } catch (error) {
    console.error('[diagnostics/forward-confidence]', error);
    res.status(500).json({ success: false, error: error.message || String(error) });
  } finally {
    clearBacktestRuntimeCaches();
  }
});

/**
 * POST /api/diagnostics/forward-weight-recommendation
 * Reuses weight-sweep grid; ranks by forward confidence (not OOS Sharpe).
 */
app.post('/api/diagnostics/forward-weight-recommendation', async (req, res) => {
  req.setTimeout(21600000);
  res.setTimeout(21600000);
  const body = req.body || {};
  const universeId = String(body.universeId || '').trim();
  const trainPeriod = String(body.period || body.trainPeriod || '3y').trim();
  const testPeriod = String(body.testPeriod || '1y').trim();
  const topN = Math.max(1, parseInt(String(body.topN ?? '15'), 10) || 15);
  const capital = parseFloat(String(body.initialCapital ?? '10000')) || 10000;
  const universe = UNIVERSE_TICKERS[universeId];
  if (!universe) {
    return res.status(400).json({ success: false, error: 'Unknown universeId' });
  }
  let weightConfigs = Array.isArray(body.configs) ? body.configs : [];
  if (weightConfigs.length === 0) {
    weightConfigs = generateDefaultWeightSweepConfigs();
  } else {
    weightConfigs = weightConfigs.map((c) => normalizeWeightSweepWeights(c)).filter(Boolean);
  }
  if (weightConfigs.length === 0) {
    return res.status(400).json({ success: false, error: 'No valid weight configs' });
  }
  const periodDays = { '1y': 365, '2y': 730, '3y': 1095, '5y': 1825, '7y': 2555 };
  const trainDays = periodDays[trainPeriod] || periodDays['3y'];
  const testDays = periodDays[testPeriod] || periodDays['1y'];
  const fetchDays = Math.max(trainDays, testDays, periodDays['3y']);
  const endDate = new Date();
  const endDateStr = endDate.toISOString().split('T')[0];
  const dataStart = new Date(endDate.getTime() - fetchDays * 86400000 - 400 * 86400000);
  const startDateStr = dataStart.toISOString().split('T')[0];
  const simOptionsBase = {
    adaptiveMode: 'fixed',
    positionSizing: 'invVol',
    regimeEnabled: true,
    rlAgent: false,
    rlMode: 'off',
    skipMlRankingAdjustments: true,
    correlationFilter:
      body.correlationFilter === true ||
      body.correlationFilter === 'true' ||
      String(body.correlationFilter || '').toLowerCase() === 'true',
    maxCorrelated:
      body.maxCorrelated != null && Number.isFinite(Number(body.maxCorrelated))
        ? Math.max(1, Math.floor(Number(body.maxCorrelated)))
        : 3,
    correlationLookbackDays:
      body.correlationLookbackDays != null && Number.isFinite(Number(body.correlationLookbackDays))
        ? Math.max(20, Math.floor(Number(body.correlationLookbackDays)))
        : 60
  };
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
    const spyPrices = priceHistory['SPY'];
    if (!spyPrices?.length) {
      return res.status(500).json({ success: false, error: 'Could not fetch SPY' });
    }
    const backtestStartTrain = new Date(endDate.getTime() - trainDays * 86400000).toISOString().split('T')[0];
    const backtestStartOos = new Date(endDate.getTime() - testDays * 86400000).toISOString().split('T')[0];
    const rebalanceDatesTrain = getRebalanceDates(backtestStartTrain, endDateStr, 'bimonthly');
    const rebalanceDatesOos = getRebalanceDates(backtestStartOos, endDateStr, 'bimonthly');
    if (rebalanceDatesTrain.length < 2 || rebalanceDatesOos.length < 2) {
      return res.status(400).json({ success: false, error: 'Insufficient rebalance dates' });
    }
    const simEnd = rebalanceDatesTrain[rebalanceDatesTrain.length - 1];
    const cpiObsStart = subtractMonths(rebalanceDatesTrain[0], 60);
    const cpiObservations = await fetchFredCpiObservations(cpiObsStart, simEnd, process.env.FRED_API_KEY);
    const runOnePeriod = async (weights, rebalanceDates) => {
      const simStart = rebalanceDates[0];
      const { multiplierFn: cashInflationMult } = buildCashInflationMultiplierFn(
        cpiObservations,
        simStart,
        INFLATION_BASELINE_ANNUAL
      );
      return runBacktestSimulation(
        universe,
        priceHistory,
        fundamentals,
        spyPrices,
        rebalanceDates,
        topN,
        capital,
        'full_composite',
        weights,
        cashInflationMult,
        universeId,
        { ...simOptionsBase }
      );
    };
    const ranked = [];
    let bestOos = null;
    for (let i = 0; i < weightConfigs.length; i++) {
      const wts = weightConfigs[i];
      const simTrain = await runOnePeriod(wts, rebalanceDatesTrain);
      const simOos = await runOnePeriod(wts, rebalanceDatesOos);
      const inSample = weightSweepPerfRow(simTrain, capital);
      const outOfSample = weightSweepPerfRow(simOos, capital);
      const monthly = buildMonthlyReturnsFromDailyValues(simTrain.dailyValues || []);
      const rs = computeRegimeSplitPerformance(
        simTrain.dailyValues || [],
        spyPrices,
        universe,
        priceHistory
      );
      const rd = buildRegimeDiversification(rs);
      const fl = buildForwardScoresAndEstimate({
        monthlyWithReturns: monthly,
        regimeDiversification: rd,
        weights: wts,
        historicalAnnualAlphaPct: inSample.alpha
      });
      if (
        outOfSample.alpha > 0 &&
        (!bestOos || outOfSample.sharpe > bestOos.oosSharpe)
      ) {
        bestOos = {
          weights: { ...wts },
          oosSharpe: outOfSample.sharpe,
          oosAlpha: outOfSample.alpha,
          forwardConfidence: fl.scores.forwardConfidence
        };
      }
      ranked.push({
        weights: wts,
        forwardConfidence: fl.scores.forwardConfidence,
        estimatedAnnualAlpha: fl.forwardEstimate.estimatedAnnualAlpha,
        oosSharpe: outOfSample.sharpe,
        oosAlpha: outOfSample.alpha,
        inSampleSharpe: inSample.sharpe,
        stability: `${Math.round(fl.scores.stability * 100)}% stability score`,
        robustness: `${rd.positiveAlphaRegimes}/${rd.totalRegimesObserved || 0} regimes α>0`,
        simplicity: `${FACTOR_NAMES.filter((f) => Math.abs(wts[f] || 0) > 1e-6).length} active factors`,
        scores: fl.scores
      });
    }
    ranked.sort((a, b) => b.forwardConfidence - a.forwardConfidence);
    const top5 = ranked.slice(0, 5);
    const simplestAmongTop = [...top5].sort(
      (a, b) => FACTOR_NAMES.filter((f) => Math.abs(a.weights[f] || 0) > 1e-6).length -
        FACTOR_NAMES.filter((f) => Math.abs(b.weights[f] || 0) > 1e-6).length
    )[0];
    const recommendation = top5.length
      ? {
          weights: simplestAmongTop?.weights || top5[0].weights,
          reason: 'Highest forward confidence with simplest weight structure among top tier'
        }
      : null;
    const survivors = ranked.filter((r) => r.oosAlpha > 0);
    survivors.sort((a, b) => b.oosSharpe - a.oosSharpe);
    const oldPick = survivors[0];
    res.json({
      success: true,
      swept: weightConfigs.length,
      rankedByForwardConfidence: ranked.slice(0, Math.min(5, ranked.length)),
      recommendation,
      previousRecommendation: oldPick
        ? {
            weights: oldPick.weights,
            oosSharpe: oldPick.oosSharpe,
            forwardConfidence: oldPick.forwardConfidence,
            whyItIsWorse:
              oldPick.forwardConfidence < (top5[0]?.forwardConfidence ?? 0)
                ? 'Peak OOS Sharpe can be noisy; this config scores lower on stability / regime robustness / simplicity.'
                : 'Shown for comparison with legacy OOS-Sharpe-only ranking.',
            whyDifferent:
              'Legacy rank used out-of-sample Sharpe only; forward score penalizes unstable / regime-concentrated / complex configs.'
          }
        : null
    });
  } catch (error) {
    console.error('[diagnostics/forward-weight-recommendation]', error);
    res.status(500).json({ success: false, error: error.message || String(error) });
  } finally {
    clearBacktestRuntimeCaches();
  }
});

/**
 * POST /api/diagnostics/weight-sweep
 * Walk-forward style screen: 3y in-sample proxy + 1y OOS per weight vector; rank by OOS Sharpe.
 */
app.post('/api/diagnostics/weight-sweep', async (req, res) => {
  req.setTimeout(21600000);
  res.setTimeout(21600000);
  const body = req.body || {};
  const universeId = String(body.universeId || '').trim();
  const topN = Math.max(1, parseInt(String(body.topN ?? '15'), 10) || 15);
  const capital = parseFloat(String(body.initialCapital ?? '10000')) || 10000;
  const correlationFilter =
    body.correlationFilter === true ||
    body.correlationFilter === 'true' ||
    body.correlationFilter === 1 ||
    String(body.correlationFilter || '').toLowerCase() === 'true';
  const trainPeriod = String(body.trainPeriod || '3y').trim();
  const testPeriod = String(body.testPeriod || '1y').trim();
  const rebalanceFreq = 'bimonthly';

  const universe = UNIVERSE_TICKERS[universeId];
  if (!universe) {
    return res.status(400).json({ success: false, error: 'Unknown universeId' });
  }

  let weightConfigs = Array.isArray(body.configs) ? body.configs : [];
  if (weightConfigs.length === 0) {
    weightConfigs = generateDefaultWeightSweepConfigs();
  } else {
    weightConfigs = weightConfigs
      .map((c) => normalizeWeightSweepWeights(c))
      .filter(Boolean);
  }
  if (weightConfigs.length === 0) {
    return res.status(400).json({ success: false, error: 'No valid weight configs (sum pillars to 1.0)' });
  }

  const periodDays = { '1y': 365, '2y': 730, '3y': 1095, '5y': 1825, '7y': 2555 };
  const trainDays = periodDays[trainPeriod] || periodDays['3y'];
  const testDays = periodDays[testPeriod] || periodDays['1y'];
  const fetchDays = Math.max(trainDays, testDays, periodDays['3y']);
  const endDate = new Date();
  const endDateStr = endDate.toISOString().split('T')[0];
  const oosStartDate = new Date(endDate.getTime() - testDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const trainStartApprox = new Date(endDate.getTime() - trainDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const trainWindow = `${trainPeriod} (approx ${trainStartApprox} to ${endDateStr}; overlaps final ${testPeriod} calendar — OOS is separate ${testPeriod} run)`;
  const testWindow = `${testPeriod} (approx ${oosStartDate} to ${endDateStr})`;

  const simOptionsBase = {
    adaptiveMode: 'fixed',
    positionSizing: 'invVol',
    regimeEnabled: true,
    rlAgent: false,
    rlMode: 'off',
    skipMlRankingAdjustments: true,
    correlationFilter,
    maxCorrelated:
      body.maxCorrelated != null && Number.isFinite(Number(body.maxCorrelated))
        ? Math.max(1, Math.floor(Number(body.maxCorrelated)))
        : 3,
    correlationLookbackDays:
      body.correlationLookbackDays != null && Number.isFinite(Number(body.correlationLookbackDays))
        ? Math.max(20, Math.floor(Number(body.correlationLookbackDays)))
        : 60
  };

  const note = `Ranked by out-of-sample Sharpe. Configs with negative OOS alpha excluded from top list. In-sample is ${trainPeriod} (calendar through as-of); OOS is ${testPeriod} only.`;

  try {
    clearBacktestRuntimeCaches();
    const dataStart = new Date(endDate.getTime() - fetchDays * 24 * 60 * 60 * 1000 - 400 * 24 * 60 * 60 * 1000);
    const startDateStr = dataStart.toISOString().split('T')[0];
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

    const spyPrices = priceHistory['SPY'];
    if (!spyPrices || !spyPrices.length) {
      return res.status(500).json({ success: false, error: 'Could not fetch SPY benchmark data' });
    }

    const backtestStartTrain = new Date(endDate.getTime() - trainDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    const backtestStartOos = new Date(endDate.getTime() - testDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    const rebalanceDatesTrain = getRebalanceDates(backtestStartTrain, endDateStr, rebalanceFreq);
    const rebalanceDatesOos = getRebalanceDates(backtestStartOos, endDateStr, rebalanceFreq);
    if (rebalanceDatesTrain.length < 2 || rebalanceDatesOos.length < 2) {
      return res.status(400).json({ success: false, error: 'Insufficient rebalance dates for sweep' });
    }

    const simEnd = rebalanceDatesTrain[rebalanceDatesTrain.length - 1];
    const cpiObsStart = subtractMonths(rebalanceDatesTrain[0], 60);
    const fredKey = process.env.FRED_API_KEY;
    const cpiObservations = await fetchFredCpiObservations(cpiObsStart, simEnd, fredKey);

    const runOnePeriod = async (weights, rebalanceDates) => {
      const simStart = rebalanceDates[0];
      const { multiplierFn: cashInflationMult } = buildCashInflationMultiplierFn(
        cpiObservations,
        simStart,
        INFLATION_BASELINE_ANNUAL
      );
      return runBacktestSimulation(
        universe,
        priceHistory,
        fundamentals,
        spyPrices,
        rebalanceDates,
        topN,
        capital,
        'full_composite',
        weights,
        cashInflationMult,
        universeId,
        { ...simOptionsBase }
      );
    };

    const rows = [];
    let oosNegativeAlpha = 0;
    let bestOosSharpeSoFar = -Infinity;
    let bestLabelSoFar = '';

    for (let i = 0; i < weightConfigs.length; i++) {
      const weights = normalizeWeightSweepWeights(weightConfigs[i]);
      if (!weights) {
        throw new Error(`Invalid weights at config index ${i}`);
      }
      const simTrain = await runOnePeriod(weights, rebalanceDatesTrain);
      const simOos = await runOnePeriod(weights, rebalanceDatesOos);
      const inSample = weightSweepPerfRow(simTrain, capital);
      const outOfSample = weightSweepPerfRow(simOos, capital);
      if (!(outOfSample.alpha > 0)) oosNegativeAlpha++;

      const overfitRatio = weightSweepOverfitRatio(inSample.sharpe, outOfSample.sharpe);
      const overfitFlag = weightSweepOverfitFlag(overfitRatio);
      const label = weightSweepShortLabel(weights);
      if (outOfSample.sharpe > bestOosSharpeSoFar) {
        bestOosSharpeSoFar = outOfSample.sharpe;
        bestLabelSoFar = label;
      }
      if ((i + 1) % 10 === 0 || i + 1 === weightConfigs.length) {
        const b =
          bestOosSharpeSoFar > -Infinity && Number.isFinite(bestOosSharpeSoFar)
            ? bestOosSharpeSoFar.toFixed(2)
            : 'n/a';
        console.log(
          `Weight sweep: ${i + 1}/${weightConfigs.length} complete, best OOS Sharpe so far: ${b} (${bestLabelSoFar || 'n/a'})`
        );
      }
      rows.push({
        weights,
        inSample,
        outOfSample,
        overfitRatio,
        overfitFlag
      });
    }

    const survivors = rows.filter((r) => r.outOfSample.alpha > 0);
    survivors.sort((a, b) => b.outOfSample.sharpe - a.outOfSample.sharpe);
    const topByOOSSharpe = survivors.map((r) => ({
      weights: r.weights,
      inSample: r.inSample,
      outOfSample: r.outOfSample,
      overfitRatio: r.overfitRatio,
      overfitFlag: r.overfitFlag
    }));

    const recommendPool = survivors.filter((r) => r.overfitFlag === 'healthy' || r.overfitFlag === 'caution');
    let recommendation = null;
    if (recommendPool.length > 0) {
      recommendPool.sort((a, b) => b.outOfSample.sharpe - a.outOfSample.sharpe);
      const pick = recommendPool[0];
      recommendation = {
        weights: pick.weights,
        oosSharpe: pick.outOfSample.sharpe,
        oosAlpha: pick.outOfSample.alpha,
        overfitRatio: pick.overfitRatio,
        reason: 'Highest OOS Sharpe among healthy/caution configs (OOS alpha > 0)'
      };
    } else if (survivors.length > 0) {
      recommendation = {
        weights: null,
        oosSharpe: null,
        oosAlpha: null,
        overfitRatio: null,
        reason: 'No healthy/caution config among OOS-alpha-positive runs; all remaining are overfit-flagged'
      };
    } else {
      recommendation = {
        weights: null,
        oosSharpe: null,
        oosAlpha: null,
        overfitRatio: null,
        reason: 'No config with positive OOS alpha'
      };
    }

    res.json({
      success: true,
      swept: weightConfigs.length,
      trainWindow,
      testWindow,
      note,
      topByOOSSharpe,
      oosNegativeAlpha,
      recommendation
    });
  } catch (error) {
    console.error('[diagnostics/weight-sweep]', error);
    res.status(500).json({ success: false, error: error.message || String(error) });
  } finally {
    clearBacktestRuntimeCaches();
  }
});

function mix01(...parts) {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return (h >>> 0) / 4294967296;
}

// =====================================================================

// ── GET /api/congress/signal ──────────────────────────────────────────────────
// Returns cached congressional trade signal. ?ticker=AAPL for single lookup.
// ?ticker=AAPL&refresh=true triggers an on-demand single-ticker fetch from FMP.
app.get('/api/congress/signal', async (req, res) => {
  try {
    const { ticker, refresh } = req.query;
    if (ticker) {
      const t = String(ticker).toUpperCase();
      if (refresh === 'true') {
        const trades = await fetchCongressTrades(t);
        const result = { ...computeCongressScore(trades), ticker: t, refreshedAt: new Date().toISOString() };
        congressSignalCache[t] = result;
        return res.json({ [t]: result });
      }
      return res.json({ [t]: getCongressScore(t) });
    }
    return res.json({
      updatedAt: Object.values(congressSignalCache)[0]?.refreshedAt ?? null,
      tickerCount: Object.keys(congressSignalCache).length,
      hasApiKey: !!fmpApiKey(),
      tickers: congressSignalCache,
    });
  } catch (e) {
    console.error('[Congress] /api/congress/signal error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Health check — Railway / load balancer ────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV ?? 'development',
    dataDir: process.env.DATA_DIR ?? 'local'
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CRON SCHEDULES
// ─────────────────────────────────────────────────────────────────────────────

const SERVER_STARTED_AT = Date.now();
function isTradingDay(date = new Date()) {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  const mmdd = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const holidays = ['01-01', '07-04', '12-25'];
  return !holidays.includes(mmdd);
}

function cronWarmupDone(minMs = 3 * 60 * 1000) {
  return Date.now() - SERVER_STARTED_AT >= minMs;
}

// Paper portfolio rebalance — 1st and 15th of each month at 9:45 AM ET
cron.schedule(
  '45 9 1,15 * *',
  async () => {
    if (!cronWarmupDone()) return;
    if (!isTradingDay()) {
      console.log('[CRON] Skipping rebalance — not a trading day');
      return;
    }
    try {
      const today = new Date().toISOString().split('T')[0];
      const base = `http://localhost:${PORT}`;
      await fetch(`${base}/api/paper-trade/rebalance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: today })
      });
      console.log(`[CRON] Paper rebalance executed ${today}`);
    } catch (e) {
      console.error('[CRON] Paper rebalance failed:', e?.message || e);
    }
  },
  { timezone: 'America/New_York' }
);

// Auto trader + wheel optimizer — every trading day at 9:35 AM ET (open)
cron.schedule(
  '35 9 * * 1-5',
  async () => {
    if (!cronWarmupDone()) return;
    if (!isTradingDay()) {
      console.log('[CRON] Skipping — not a trading day');
      return;
    }
    try {
      const base = `http://localhost:${PORT}`;
      await fetch(`${base}/api/options/auto-trader/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      // Use optimize (smarter replacement) for wheel morning pass
      await fetch(`${base}/api/wheel/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universeId: 'sp500_top50' })
      });
      await fetch(`${base}/api/wheel/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universeId: 'sp500_top150' })
      });
      console.log('[CRON] Auto trader + wheel optimize (morning) complete');
    } catch (e) {
      console.error('[CRON] Auto trader + wheel failed:', e?.message || e);
    }
  },
  { timezone: 'America/New_York' }
);

// Wheel re-optimize mid-day — every trading day at 2:45 PM ET
// Catches intraday IV shifts and fills any slots freed by profit targets hit during the session.
cron.schedule(
  '45 14 * * 1-5',
  async () => {
    if (!cronWarmupDone()) return;
    if (!isTradingDay()) return;
    try {
      const base = `http://localhost:${PORT}`;
      await fetch(`${base}/api/wheel/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universeId: 'sp500_top50' })
      });
      await fetch(`${base}/api/wheel/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universeId: 'sp500_top150' })
      });
      console.log('[CRON] Wheel mid-day re-optimize complete');
    } catch (e) {
      console.error('[CRON] Wheel mid-day re-optimize failed:', e?.message || e);
    }
  },
  { timezone: 'America/New_York' }
);

// Paper trade score-degradation auto-optimizer — Mon, Wed, Fri at 9:50 AM ET
cron.schedule(
  '50 9 * * 1,3,5',
  async () => {
    if (!cronWarmupDone()) return;
    if (!isTradingDay()) return;
    try {
      const base = `http://localhost:${PORT}`;
      const r = await fetch(`${base}/api/paper-trade/auto-optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const j = await r.json().catch(() => ({}));
      console.log('[CRON] Paper auto-optimize:', JSON.stringify(j.results ?? {}));
    } catch (e) {
      console.error('[CRON] Paper auto-optimize failed:', e?.message || e);
    }
  },
  { timezone: 'America/New_York' }
);

// Congress signal weekly refresh — Sunday 6 AM ET
cron.schedule('0 6 * * 0', async () => {
  if (!fmpApiKey()) return;
  console.log('[Congress] Weekly refresh starting...');
  try {
    const tickers = [
      ...(UNIVERSE_TICKERS['sp500_top50'] ?? []),
      ...(UNIVERSE_TICKERS['sp500_top150'] ?? []),
    ].filter((t, i, a) => t && a.indexOf(t) === i);
    if (!tickers.length) return;
    const results = await refreshCongressSignal(tickers);
    congressSignalCache = results;
    console.log(`[Congress] Weekly refresh complete. ${Object.keys(results).length} tickers cached.`);
  } catch (e) {
    console.error('[Congress] Weekly refresh failed:', e?.message || e);
  }
}, { timezone: 'America/New_York' });


// Express 5 wires the listen() callback to `server.once('error', done)` as well as
// success — so a single (err?) => ... cb can run on EADDRINUSE and falsely log "running".
// Use explicit `listening` / `error` handlers instead of passing a callback to listen().
const server = app.listen(PORT, '0.0.0.0');
server.once('listening', () => {
  ensureDualPaperPortfoliosInitialized();

  // ── Congress signal: load cache from disk ────────────────────────────────
  fsReadFile(CONGRESS_SIGNAL_PATH, 'utf8')
    .then(raw => {
      const parsed = JSON.parse(raw);
      congressSignalCache = parsed.tickers ?? {};
      console.log(`[Congress] Loaded cache (${Object.keys(congressSignalCache).length} tickers, updated ${parsed.updatedAt})`);
    })
    .catch(() => console.log('[Congress] No congress-signal.json — will populate on first cron run or manual ?refresh=true'));

  console.log(
    `[Yahoo] throttle: chartConcurrency=${YAHOO_CHART_CONCURRENCY} fundamentalsConcurrency=${FUNDAMENTALS_FETCH_CONCURRENCY} chartDelayMs=${YAHOO_CHART_DELAY_MS} (env: YAHOO_CHART_CONCURRENCY, YAHOO_FUNDAMENTALS_CONCURRENCY, YAHOO_CHART_DELAY_MS)`
  );
  console.log(`Server running on http://localhost:${PORT}`);
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use. Run \`npm run server:free\` then \`npm run server\`, or use \`npm run dev:all\` (frees the port first). Or set PORT=3002 in .env.`,
    );
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});
