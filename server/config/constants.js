import { YAHOO_DISK_CACHE_DIR, EARNINGS_DISK_CACHE_DIR } from './paths.js';
import { parseYahooEnvInt } from '../utils/yahoo-env.js';

/** Yahoo often returns fields that fail strict schemas (e.g. null currency); skip result validation and coerce in our parsers. */
export const YAHOO_QUOTE_SUMMARY_MODULE_OPTS = { validateResult: false };

export const MOMENTUM_CACHE = new Map();
export const NETWORK_INPUT_CACHE = new Map();
export const COMPS_CACHE = new Map();
export const QUOTE_CACHE = new Map();
export const BACKTEST_CACHE = new Map();
export const CACHE_TTL = 15 * 60 * 1000;
export const COMPS_CACHE_TTL = 30 * 60 * 1000;
/** Yahoo quote/full-summary bundle — memory + disk (see .cache/yahoo/) */
export const QUOTE_CACHE_TTL = 4 * 60 * 60 * 1000;
export const BACKTEST_CACHE_TTL = 60 * 60 * 1000; // 1 hour
/** Bump when backtest sim inputs/outputs change (cache invalidation). */
export const BACKTEST_CACHE_VERSION = 'v59';

/** Only treat financials as knowable this many days after quarter-end (SEC filing lag heuristic). */
export const FILING_LAG_DAYS = 45;
/** PIT fallback: if snapshot older than this vs rebalance date, halve fundamental pillar weights. */
export const STALENESS_PENALTY_DAYS = 120;
/** Weakest name in new top-N must score >= held * (1 + this) to displace a holding (when challengers exist). */
export const TURNOVER_SCORE_IMPROVEMENT_THRESHOLD = 0.25;
/** Min calendar days in position before a rebalance SELL (not STOP) may exit. */
export const MIN_HOLD_DAYS_BEFORE_SELL = 45;
/** Extra names above adjustedTopN allowed before forced trim bypasses min-hold. */
export const HOLDINGS_OVERFLOW_SLOTS = 3;
/** Min composite score (0–100) for new rebalance targets and buys; RL cannot force below this. */
export const SCORE_FLOOR = 55;

/** Regime-based hard cap on position count (RL / regime cannot exceed this). */
export const REGIME_MAX_POSITIONS = {
  strong_bull: 15,
  normal: 13,
  pullback: 11,
  correction: 11,
  caution: 11,
  bear: 7,
  disabled: 13
};

/** After a voluntary SELL, block re-opening the same ticker for this many days. */
export const REBUY_COOLDOWN_DAYS = 60;
/** Min days after STOP before re-entry is considered. */
export const RE_ENTRY_MIN_WAIT_DAYS = 45;
/** Skip STOP re-entry if next scheduled rebalance is sooner than this (days). */
export const RE_ENTRY_MIN_DAYS_TO_NEXT_REBALANCE = 10;

/** Max portfolio weight per name after sizing (composite backtest / paper). */
export const MAX_POSITION_WEIGHT_BACKTEST = 0.1;
/** Trailing stop: peak must be this much above entry before giveback rule can fire. */
export const TRAILING_STOP_MIN_PEAK_GAIN = 0.25;
/** Trailing stop: giveback floor vs entry = entry * (1 + this) once min peak gain is met. */
export const TRAILING_STOP_FLOOR = 0.1;
/** Skip trailing giveback until position is at least this many calendar days old. */
export const TRAILING_STOP_MIN_HOLD_DAYS = 60;

export { YAHOO_DISK_CACHE_DIR, EARNINGS_DISK_CACHE_DIR };

export const QUOTE_BATCH_CHUNK = 50;

export const YAHOO_CHART_CONCURRENCY = parseYahooEnvInt('YAHOO_CHART_CONCURRENCY', 8, 1, 32);
export const FUNDAMENTALS_FETCH_CONCURRENCY = parseYahooEnvInt('YAHOO_FUNDAMENTALS_CONCURRENCY', 8, 1, 32);
/** After each chart HTTP attempt path (success or fallback), pause to throttle bursts (0 = off). */
export const YAHOO_CHART_DELAY_MS = parseYahooEnvInt('YAHOO_CHART_DELAY_MS', 80, 0, 5000);

const EARNINGS_DISK_CACHE_DAYS = 7;
export const EARNINGS_DISK_CACHE_TTL_MS = EARNINGS_DISK_CACHE_DAYS * 24 * 60 * 60 * 1000;
