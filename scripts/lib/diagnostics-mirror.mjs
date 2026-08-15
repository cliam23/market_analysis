// Fixed config for the "moderate cost" diagnostics mirrored on the lite
// deploy — Alpha Lab's factor strength / hedging impact / equity curves /
// universe comparison / forward confidence, and RL Agent's policy /
// compare / rebalance preview. All match the real components' own default
// selections (see AlphaLabTab.jsx, AlphaLabEquityCurves.jsx, RLTab.jsx), so
// picking the default view on either tab "just works" without the user
// needing to configure anything.
//
// Explicitly NOT mirrored — genuinely expensive (multi-hour, weight-sweep
// shaped) rather than a single backtest-equivalent call:
//   - POST /api/diagnostics/forward-weight-recommendation
//   - POST /api/diagnostics/weight-sweep
//   - POST /api/rl/train

export const DIAG_MIRROR_UNIVERSES = ['sp500_top50', 'sp500_top150'];
export const DIAG_MIRROR_PERIOD = '3y';

export const RL_COMPARE_PARAMS = {
  period: '3y',
  topN: '15',
  strategy: 'full_composite',
  rebalanceFreq: 'bimonthly'
};

export function factorsFilename(universeId) {
  return `diag-factors-${universeId}.json`;
}

export function hedgeImpactFilename(universeId) {
  return `diag-hedge-impact-${universeId}.json`;
}

export function equityCurvesFilename(universeId) {
  return `diag-equity-curves-${universeId}.json`;
}

export function forwardConfidenceFilename(universeId) {
  return `diag-forward-confidence-${universeId}.json`;
}

export function rlCompareFilename(universeId) {
  return `rl-compare-${universeId}.json`;
}

export function rlPolicyFilename(universeId) {
  return `rl-policy-${universeId}.json`;
}

export const PAPER_TRADE_PREVIEW_FILENAME = 'paper-trade-preview.json';
export const UNIVERSE_COMPARE_FILENAME = 'diag-universe-compare.json';

/**
 * Matches an incoming GET /api/rl/compare request's query against the one
 * mirrored combo per universe. Mirrors matchBacktestMirrorConfig's shape
 * (scripts/lib/backtest-mirror.mjs) — ignores cache-busting fresh/_t.
 */
export function matchRlCompareUniverse(query) {
  const universeId = query.universeId;
  if (!DIAG_MIRROR_UNIVERSES.includes(universeId)) return null;
  if (query.period !== RL_COMPARE_PARAMS.period) return null;
  if (String(query.topN) !== RL_COMPARE_PARAMS.topN) return null;
  if (query.strategy !== RL_COMPARE_PARAMS.strategy) return null;
  if (query.rebalanceFreq !== RL_COMPARE_PARAMS.rebalanceFreq) return null;
  return universeId;
}

export function matchDiagUniverse(query, { periodRequired = true } = {}) {
  const universeId = query.universeId;
  if (!DIAG_MIRROR_UNIVERSES.includes(universeId)) return null;
  if (periodRequired && query.period !== DIAG_MIRROR_PERIOD) return null;
  return universeId;
}
