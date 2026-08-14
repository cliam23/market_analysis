// Fixed matrix of full interactive backtests mirrored for the Vercel-only
// deploy: S&P Top 50 / Top 150 × 3y / 5y × RL on/off, all Full Composite.
// Matches the Backtest tab's own defaults for everything except universe/
// period/strategy (rebalanceFreq "quarterly", topN 15, adaptiveMode
// "fixed", positionSizing "invVol", initialCapital 10000) so picking those
// three from the dropdowns — with nothing else touched — always works.
//
// See scripts/generate-scores-snapshot.mjs (captures these) and
// api/backtest/[universeId].js (serves them, matching real params).

export const BACKTEST_MIRROR_UNIVERSES = ['sp500_top50', 'sp500_top150'];
export const BACKTEST_MIRROR_PERIODS = ['3y', '5y'];
export const BACKTEST_MIRROR_STRATEGY = 'full_composite';
export const BACKTEST_MIRROR_REBALANCE_FREQ = 'quarterly';
export const BACKTEST_MIRROR_TOP_N = '15';

export function backtestMirrorConfigs() {
  const configs = [];
  for (const universeId of BACKTEST_MIRROR_UNIVERSES) {
    for (const period of BACKTEST_MIRROR_PERIODS) {
      for (const rlAgent of [true, false]) {
        configs.push({
          universeId,
          period,
          rebalanceFreq: BACKTEST_MIRROR_REBALANCE_FREQ,
          topN: BACKTEST_MIRROR_TOP_N,
          strategy: BACKTEST_MIRROR_STRATEGY,
          rlAgent
        });
      }
    }
  }
  return configs;
}

export function backtestMirrorFilename({ universeId, period, rlAgent }) {
  return `backtest-${universeId}-${period}-rl${rlAgent ? 'on' : 'off'}.json`;
}

export function backtestMirrorQuery({ period, rebalanceFreq, topN, strategy, rlAgent }) {
  const params = new URLSearchParams({
    period,
    rebalanceFreq,
    topN,
    strategy,
    fresh: 'true',
    rlAgent: rlAgent ? 'true' : 'false',
    rlMode: rlAgent ? 'eval' : 'off'
  });
  return params;
}

/**
 * Matches an incoming request (universeId from the path, query params from
 * the URL) against the fixed matrix. Ignores fresh/_t (cache-busters) and
 * any param that isn't part of the matrix — those fall through to "not
 * mirrored" rather than a false match. Absent rebalanceFreq/topN/strategy
 * are NOT defaulted here: the real frontend (buildBacktestQuery in
 * BacktestTab.jsx) always sends all three explicitly, so an absent value
 * means a request this mirror was never meant to intercept.
 */
export function matchBacktestMirrorConfig(universeId, query) {
  const period = query.period;
  const rebalanceFreq = query.rebalanceFreq;
  const topN = query.topN;
  const strategy = query.strategy;
  const rlAgentRaw = query.rlAgent;
  if (!period || !rebalanceFreq || !topN || !strategy) return null;
  if (!BACKTEST_MIRROR_UNIVERSES.includes(universeId)) return null;
  if (!BACKTEST_MIRROR_PERIODS.includes(period)) return null;
  if (rebalanceFreq !== BACKTEST_MIRROR_REBALANCE_FREQ) return null;
  if (String(topN) !== BACKTEST_MIRROR_TOP_N) return null;
  if (strategy !== BACKTEST_MIRROR_STRATEGY) return null;
  // adaptiveMode/positionSizing/initialCapital are only present when
  // changed from defaults (see buildBacktestQuery) — any of them present
  // means a config outside the mirrored matrix.
  if (query.adaptiveMode || query.positionSizing || query.initialCapital) return null;
  const rlAgent = rlAgentRaw === 'true' || rlAgentRaw === true;
  if (rlAgentRaw !== 'true' && rlAgentRaw !== 'false' && rlAgentRaw !== true && rlAgentRaw !== false) return null;
  return { universeId, period, rebalanceFreq, topN: BACKTEST_MIRROR_TOP_N, strategy, rlAgent };
}
