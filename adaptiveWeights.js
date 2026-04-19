/**
 * Rolling IC + ridge (optional) + IC-aware regime fusion + high-momentum value cap.
 * Used by backtest / paper rebalance; pairs with analysis-engine regime + RSI helpers.
 */

import {
  regimePillarMultipliers,
  classifySpyMomentumRegime,
  spyAbove200dma
} from './analysis-engine.js';

export const ADAPTIVE_FACTOR_NAMES = ['fundamental', 'dcf', 'valuation', 'momentum', 'value', 'earningsMomentum'];

/** Aligned with server DEFAULT_COMPOSITE_WEIGHTS (normalized to sum 1; DCF/valuation off). */
export const ADAPTIVE_DEFAULT_WEIGHTS = {
  momentum: 0.30 / 0.85,
  value: 0.30 / 0.85,
  fundamental: 0.10 / 0.85,
  earningsMomentum: 0.15 / 0.85,
  dcf: 0,
  valuation: 0
};

/** Minimum pillar weight after floors / renorm (adaptive compose). */
export const ADAPTIVE_MIN_PILLAR_FLOOR = 0.05;
/** Default IC → softmax temperature in compose (matches factor-attribution scale). */
export const ADAPTIVE_IC_SOFTMAX_SCALE = 3;
/** Rolling periods below this use 80% baseline / 20% IC target blend. */
export const ADAPTIVE_SHORT_HISTORY_PERIODS = 8;
/** Pull composed weights toward strategy anchor each step (before drift caps). */
export const ADAPTIVE_MEAN_REVERSION_RATE = 0.3;
/** Max absolute deviation of any pillar from anchor after all steps (fraction, e.g. 0.15 = 15pp). */
export const ADAPTIVE_MAX_CUMULATIVE_DRIFT = 0.15;
/** Hard cap on any single pillar weight after composition (fraction). */
export const ADAPTIVE_MAX_SINGLE_PILLAR = 0.5;

/** Match server.js normalizePrevRankedForAdaptive */
export function normalizePrevRankedForAdaptive(row) {
  if (!row || !row.ticker) return null;
  return {
    ticker: row.ticker,
    fundamental: row.fundamental != null ? row.fundamental : row.fundamentalScore,
    dcf: row.dcf != null ? row.dcf : row.dcfScore,
    valuation: row.valuation != null ? row.valuation : row.valuationScore,
    momentum: row.momentum != null ? row.momentum : row.momentumScore,
    value: row.value != null ? row.value : row.valueScore,
    earningsMomentum:
      row.earningsMomentum != null ? row.earningsMomentum : (row.earningsMomentumScore ?? 50)
  };
}

export function getPriceForAdaptive(priceData, date) {
  if (!priceData || priceData.length === 0) return null;
  const target = typeof date === 'string' ? date : date.toISOString().split('T')[0];
  for (let i = 0; i < priceData.length; i++) {
    if (priceData[i].date >= target) {
      return priceData[i].close;
    }
  }
  return priceData[priceData.length - 1]?.close || null;
}

function spearmanCorrelation(xs, ys) {
  const n = xs.length;
  if (n !== ys.length || n < 3) return 0;
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

/**
 * One rebalance period: Spearman IC per pillar vs realized return (prevDate -> asOfDate).
 */
export function computePeriodIc(prevRankedRows, prevDateStr, asOfDateStr, priceHistory, getPrice = getPriceForAdaptive) {
  const out = {};
  for (const f of ADAPTIVE_FACTOR_NAMES) out[f] = 0;
  if (!prevRankedRows || !Array.isArray(prevRankedRows) || prevRankedRows.length < 6 || !prevDateStr || !asOfDateStr) {
    return { icByFactor: out, withReturns: [], ok: false };
  }
  const withReturns = [];
  for (const raw of prevRankedRows) {
    const ranked = normalizePrevRankedForAdaptive(raw);
    if (!ranked || ranked.ticker == null) continue;
    const ph = priceHistory[ranked.ticker];
    if (!ph) continue;
    const prevPrice = getPrice(ph, prevDateStr);
    const curPrice = getPrice(ph, asOfDateStr);
    if (prevPrice && curPrice && prevPrice > 0) {
      withReturns.push({ ...ranked, realized: (curPrice - prevPrice) / prevPrice });
    }
  }
  if (withReturns.length < 6) return { icByFactor: out, withReturns: [], ok: false };

  const returns = withReturns.map((r) => r.realized);
  const factorKeys = {
    fundamental: 'fundamental',
    dcf: 'dcf',
    valuation: 'valuation',
    momentum: 'momentum',
    value: 'value',
    earningsMomentum: 'earningsMomentum'
  };
  const icByFactor = { ...out };
  for (const [factor, key] of Object.entries(factorKeys)) {
    const scores = withReturns.map((r) => r[key] ?? 0);
    const ic = spearmanCorrelation(scores, returns);
    icByFactor[factor] = Number.isFinite(ic) ? ic : 0;
  }
  return { icByFactor, withReturns, ok: true };
}

/** Z-score columns within each panel, then stack rows for ridge. */
function stackPanelsCrossSectionalZ(panels) {
  const rows = [];
  for (const panel of panels) {
    if (!panel || panel.length < 4) continue;
    const keys = ADAPTIVE_FACTOR_NAMES;
    const means = {};
    const stds = {};
    for (const k of keys) {
      const vals = panel.map((r) => r[k] ?? 0);
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      let v = 0;
      for (const x of vals) v += (x - m) ** 2;
      const sd = Math.sqrt(v / Math.max(1, vals.length - 1)) || 1;
      means[k] = m;
      stds[k] = sd;
    }
    for (const r of panel) {
      const x = keys.map((k) => ((r[k] ?? 0) - means[k]) / stds[k]);
      rows.push({ x, y: r.y });
    }
  }
  return rows;
}

/** Gauss–Jordan elimination; A is n×n, b length n. Returns solution or null if singular. */
function solveLinearSystem(A, b) {
  const n = A.length;
  if (!n || b.length !== n) return null;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    [M[col], M[piv]] = [M[piv], M[col]];
    const diag = M[col][col];
    if (Math.abs(diag) < 1e-14) return null;
    for (let c = col; c <= n; c++) M[col][c] /= diag;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

/**
 * Ridge regression on stacked standardized factor rows -> softmax positive weights.
 */
export function ridgeFactorWeightsFromPanels(panels, lambda = 1.0) {
  const stacked = stackPanelsCrossSectionalZ(panels);
  const keys = ADAPTIVE_FACTOR_NAMES;
  const p = keys.length;
  if (stacked.length < p + 3) return null;
  const n = stacked.length;
  const ym = stacked.reduce((s, r) => s + r.y, 0) / n;
  const yc = stacked.map((r) => r.y - ym);
  const G = Array.from({ length: p }, () => Array(p).fill(0));
  const bvec = Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const xi = stacked[i].x;
    for (let a = 0; a < p; a++) {
      bvec[a] += xi[a] * yc[i];
      for (let b = 0; b < p; b++) G[a][b] += xi[a] * xi[b];
    }
  }
  for (let a = 0; a < p; a++) G[a][a] += lambda;
  const beta = solveLinearSystem(G, bvec);
  if (!beta) return null;
  const raw = {};
  let s = 0;
  for (const k of keys) raw[k] = 0;
  for (let j = 0; j < p; j++) {
    raw[keys[j]] = Math.exp(Math.max(-3, Math.min(3, beta[j] * 0.35)));
    s += raw[keys[j]];
  }
  const w = {};
  for (const k of keys) w[k] = s > 0 ? raw[k] / s : 1 / p;
  return w;
}

/** Rebuild rolling IC/panel state from stored rebalance snapshots (paper trade history). */
export function rebuildRollingStateFromRebalanceHistory(history, priceHistory, getPrice = getPriceForAdaptive, maxPeriods = 12) {
  const st = new RollingAdaptiveState(maxPeriods);
  if (!history || history.length < 2) return st;
  for (let i = 0; i < history.length - 1; i++) {
    const snap = history[i];
    const nextDate = history[i + 1]?.date;
    if (!snap?.allRankings || !nextDate || snap.allRankings.length < 6) continue;
    const { icByFactor, withReturns, ok } = computePeriodIc(
      snap.allRankings,
      snap.date,
      nextDate,
      priceHistory,
      getPrice
    );
    if (!ok) continue;
    const panelRows = withReturns.map((r) => ({
      fundamental: r.fundamental ?? 0,
      dcf: r.dcf ?? 0,
      valuation: r.valuation ?? 0,
      momentum: r.momentum ?? 0,
      value: r.value ?? 0,
      earningsMomentum: r.earningsMomentum ?? 0,
      y: r.realized
    }));
    st.pushPeriod(icByFactor, panelRows);
  }
  return st;
}

export class RollingAdaptiveState {
  constructor(maxPeriods = 12) {
    this.maxPeriods = maxPeriods;
    /** @type {{ fundamental:number, dcf:number, valuation:number, momentum:number, value:number }[]} */
    this.icHistory = [];
    /** @type {Array<Array<{ fundamental:number, dcf:number, valuation:number, momentum:number, value:number, y:number }>>} */
    this.panelHistory = [];
  }

  pushPeriod(icByFactor, panelRows) {
    this.icHistory.push({ ...icByFactor });
    if (this.icHistory.length > this.maxPeriods) this.icHistory.shift();
    if (panelRows && panelRows.length >= 4) {
      this.panelHistory.push(panelRows);
      if (this.panelHistory.length > this.maxPeriods) this.panelHistory.shift();
    }
  }

  meanIcByFactor() {
    if (this.icHistory.length === 0) return null;
    const acc = {};
    for (const f of ADAPTIVE_FACTOR_NAMES) acc[f] = 0;
    for (const row of this.icHistory) {
      for (const f of ADAPTIVE_FACTOR_NAMES) acc[f] += row[f] ?? 0;
    }
    const n = this.icHistory.length;
    for (const f of ADAPTIVE_FACTOR_NAMES) acc[f] /= n;
    return acc;
  }
}

function softmaxIcWeights(meanIc, scale = ADAPTIVE_IC_SOFTMAX_SCALE) {
  const transformed = {};
  let tSum = 0;
  for (const f of ADAPTIVE_FACTOR_NAMES) {
    transformed[f] = Math.exp((meanIc[f] ?? 0) * scale);
    tSum += transformed[f];
  }
  const w = {};
  for (const f of ADAPTIVE_FACTOR_NAMES) w[f] = transformed[f] / tSum;
  return w;
}

function applyMinFloorRenorm(w, floor = ADAPTIVE_MIN_PILLAR_FLOOR) {
  const out = { ...w };
  for (const f of ADAPTIVE_FACTOR_NAMES) out[f] = Math.max(out[f] ?? 0, floor);
  let s = ADAPTIVE_FACTOR_NAMES.reduce((a, f) => a + out[f], 0);
  for (const f of ADAPTIVE_FACTOR_NAMES) out[f] = s > 0 ? out[f] / s : 1 / ADAPTIVE_FACTOR_NAMES.length;
  return out;
}

/** 95% CI for mean IC across rolling periods; false if interval straddles zero. */
function icMeanSignificant(icHistory, factor) {
  if (!icHistory || icHistory.length < 2) return false;
  const xs = icHistory.map((h) => h[factor] ?? 0);
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  let v = 0;
  for (const x of xs) v += (x - mean) ** 2;
  const sd = Math.sqrt(v / Math.max(1, n - 1));
  const se = sd / Math.sqrt(n);
  const lo = mean - 1.96 * se;
  const hi = mean + 1.96 * se;
  if (lo <= 0 && hi >= 0) return false;
  return true;
}

function adaptiveClampDebugEnabled() {
  const clamp = process.env.ADAPTIVE_CLAMP_DEBUG;
  const wlog = process.env.ADAPTIVE_WEIGHT_LOG;
  return (
    clamp === '1' ||
    String(clamp || '').toLowerCase() === 'true' ||
    wlog === '1' ||
    String(wlog || '').toLowerCase() === 'true'
  );
}

/** Renormalize pillar weights to sum 1. */
function normalizePillarWeights(w) {
  const o = { ...w };
  let s = ADAPTIVE_FACTOR_NAMES.reduce((a, f) => a + (o[f] ?? 0), 0);
  if (s <= 1e-12) {
    const u = 1 / ADAPTIVE_FACTOR_NAMES.length;
    for (const f of ADAPTIVE_FACTOR_NAMES) o[f] = u;
    return o;
  }
  for (const f of ADAPTIVE_FACTOR_NAMES) o[f] = (o[f] ?? 0) / s;
  return o;
}

/** DCF pillar is off in this product; redistribute its mass to other pillars. */
export function zeroDcfAndRenorm(w) {
  const o = { ...w };
  const freed = o.dcf ?? 0;
  o.dcf = 0;
  const others = ADAPTIVE_FACTOR_NAMES.filter((k) => k !== 'dcf');
  const sumOthers = others.reduce((a, k) => a + (o[k] ?? 0), 0);
  if (freed > 0 && sumOthers > 1e-12) {
    for (const k of others) o[k] = (o[k] ?? 0) + freed * ((o[k] ?? 0) / sumOthers);
  }
  return normalizePillarWeights(o);
}

function applySinglePillarCap(w, cap = ADAPTIVE_MAX_SINGLE_PILLAR) {
  const o = { ...w };
  let excess = 0;
  for (const f of ADAPTIVE_FACTOR_NAMES) {
    const x = o[f] ?? 0;
    if (x > cap) {
      excess += x - cap;
      o[f] = cap;
    }
  }
  if (excess <= 1e-14) return normalizePillarWeights(o);
  const flexible = ADAPTIVE_FACTOR_NAMES.filter((f) => (o[f] ?? 0) < cap - 1e-12);
  const pool = flexible.reduce((a, f) => a + (o[f] ?? 0), 0);
  if (pool <= 1e-12) return normalizePillarWeights(o);
  for (const f of flexible) o[f] = (o[f] ?? 0) + excess * ((o[f] ?? 0) / pool);
  return normalizePillarWeights(o);
}

/** Per-step ±maxDelta vs prior rebalance only (no floor — caller applies floor after cumulative cap). */
function clampDeltaVsPrevious(out, previousStepWeights, maxDelta) {
  if (!previousStepWeights || maxDelta <= 0 || !Number.isFinite(maxDelta)) return { ...out };
  const o = { ...out };
  for (const f of ADAPTIVE_FACTOR_NAMES) {
    const prev = previousStepWeights[f];
    if (prev == null || !Number.isFinite(prev)) continue;
    const diff = (o[f] ?? 0) - prev;
    if (Math.abs(diff) > maxDelta) {
      o[f] = prev + maxDelta * Math.sign(diff);
    }
  }
  return o;
}

/**
 * Clip each pillar to [anchor[f] - maxDrift, anchor[f] + maxDrift], then renormalize to sum 1.
 */
export function applyCumulativeAnchorClamp(w, anchorWeights, maxDrift = ADAPTIVE_MAX_CUMULATIVE_DRIFT) {
  if (!anchorWeights || maxDrift <= 0 || !Number.isFinite(maxDrift)) return normalizePillarWeights(w);
  const o = { ...w };
  for (const f of ADAPTIVE_FACTOR_NAMES) {
    const a = anchorWeights[f] ?? 0;
    const x = o[f] ?? 0;
    o[f] = Math.max(a - maxDrift, Math.min(a + maxDrift, x));
  }
  return normalizePillarWeights(o);
}

function warnLargeFloorRenorm(pre, post, tag) {
  if (!adaptiveClampDebugEnabled()) {
    return;
  }
  for (const f of ADAPTIVE_FACTOR_NAMES) {
    const d = Math.abs((post[f] ?? 0) - (pre[f] ?? 0));
    if (d > 0.01) {
      console.warn(`[ADAPTIVE] floor/renorm shifted ${f} by ${(d * 100).toFixed(1)}pp (${tag})`);
    }
  }
}

/**
 * IC-aware regime: do not increase pillar weight when rolling mean IC for that pillar is negative.
 */
export function applyRegimeWithIcClamp(weights, spyAbove200, meanIcByFactor) {
  const mult = regimePillarMultipliers(spyAbove200);
  const out = { ...weights };
  for (const f of ADAPTIVE_FACTOR_NAMES) {
    let m = mult[f] ?? 1;
    const mic = meanIcByFactor?.[f] ?? 0;
    if (mic < 0 && m > 1) m = 1;
    out[f] *= m;
  }
  let s = ADAPTIVE_FACTOR_NAMES.reduce((a, k) => a + out[k], 0);
  for (const f of ADAPTIVE_FACTOR_NAMES) out[f] = parseFloat((out[f] / s).toFixed(4));
  return out;
}

/** Cap value pillar; shift freed mass to momentum (70%) and valuation (30%). */
export function applyMomentumEscapeValve(weights, momentumRegime, valueCap = 0.1) {
  if (momentumRegime?.tag !== 'high_momentum') return { ...weights };
  const out = { ...weights };
  const v = out.value ?? 0;
  if (v <= valueCap) return out;
  const freed = v - valueCap;
  out.value = valueCap;
  out.momentum = (out.momentum ?? 0) + freed * 0.7;
  out.valuation = (out.valuation ?? 0) + freed * 0.3;
  let s = ADAPTIVE_FACTOR_NAMES.reduce((a, k) => a + out[k], 0);
  for (const f of ADAPTIVE_FACTOR_NAMES) out[f] = parseFloat((out[f] / s).toFixed(4));
  return out;
}

function logAdaptiveClampDebug({ rebalanceIndex, anchorWeights, previousStepWeights, composed, tag }) {
  if (!adaptiveClampDebugEnabled()) {
    return;
  }
  const snap = (o) =>
    o
      ? ADAPTIVE_FACTOR_NAMES.map((f) => `${f}=${((o[f] ?? 0) * 100).toFixed(1)}%`).join(' ')
      : '—';
  console.log(
    `[ADAPTIVE] clamp ${tag} idx=${rebalanceIndex ?? '—'} anchor=[${snap(anchorWeights)}] prev=[${snap(previousStepWeights)}] out=[${snap(composed)}]`,
  );
}

/**
 * Full adaptive step for one rebalance date. Returns new weights object.
 * @param {object} params
 * @param {object} params.weights — current rolling pillar weights (IC blend base)
 * @param {object} params.anchorWeights — strategy-default pillar mix (mean reversion + cumulative ±15pp cap)
 * @param {object|null} params.prevRankedRows — prior snapshot allRanked
 * @param {string} params.prevDateStr
 * @param {string} params.asOfDateStr
 * @param {object} params.priceHistory
 * @param {object} params.spySeries
 * @param {RollingAdaptiveState} params.rollingState
 * @param {function} [params.getPrice]
 * @param {number} [params.rebalanceIndex] — optional index for [ADAPTIVE] debug logs
 */
export function composeAdaptiveWeightsForRebalance(params) {
  const {
    weights,
    anchorWeights: anchorWeightsIn,
    prevRankedRows,
    prevDateStr,
    asOfDateStr,
    priceHistory,
    spySeries,
    rollingState,
    getPrice = getPriceForAdaptive,
    maxDeltaPerFactor = 0.05,
    icSoftmaxScale = ADAPTIVE_IC_SOFTMAX_SCALE,
    useRidge = false,
    ridgeLambda = 1.0,
    momentumRegimeOpts = {},
    previousStepWeights = null,
    icObservationCount = null,
    icMinObservations = null,
    rebalanceIndex
  } = params;

  const base = ADAPTIVE_FACTOR_NAMES.reduce((o, f) => {
    o[f] = weights[f] != null && Number.isFinite(weights[f]) ? weights[f] : ADAPTIVE_DEFAULT_WEIGHTS[f];
    return o;
  }, {});
  const anchorWeights = ADAPTIVE_FACTOR_NAMES.reduce((o, f) => {
    const a =
      anchorWeightsIn && anchorWeightsIn[f] != null && Number.isFinite(anchorWeightsIn[f])
        ? anchorWeightsIn[f]
        : ADAPTIVE_DEFAULT_WEIGHTS[f];
    o[f] = a;
    return o;
  }, {});

  let meanIc = rollingState.meanIcByFactor();
  const { icByFactor, withReturns, ok } = computePeriodIc(
    prevRankedRows,
    prevDateStr,
    asOfDateStr,
    priceHistory,
    getPrice
  );
  if (ok) {
    const panelRows = withReturns.map((r) => ({
      fundamental: r.fundamental ?? 0,
      dcf: r.dcf ?? 0,
      valuation: r.valuation ?? 0,
      momentum: r.momentum ?? 0,
      value: r.value ?? 0,
      earningsMomentum: r.earningsMomentum ?? 0,
      y: r.realized
    }));
    rollingState.pushPeriod(icByFactor, panelRows);
    meanIc = rollingState.meanIcByFactor();
  }

  if (!meanIc) {
    meanIc = {};
    for (const f of ADAPTIVE_FACTOR_NAMES) meanIc[f] = 0;
  }

  let icTarget = softmaxIcWeights(meanIc, icSoftmaxScale);

  const obsTooSmall =
    icMinObservations != null &&
    icObservationCount != null &&
    icObservationCount < icMinObservations;

  if (obsTooSmall) {
    icTarget = applyMinFloorRenorm(
      ADAPTIVE_FACTOR_NAMES.reduce((o, f) => {
        o[f] = base[f];
        return o;
      }, {}),
      ADAPTIVE_MIN_PILLAR_FLOOR
    );
  } else {
    for (const f of ADAPTIVE_FACTOR_NAMES) {
      if (!icMeanSignificant(rollingState.icHistory, f)) {
        icTarget[f] = base[f];
      }
    }
    icTarget = applyMinFloorRenorm(icTarget, ADAPTIVE_MIN_PILLAR_FLOOR);
  }

  if (!obsTooSmall && useRidge && rollingState.panelHistory.length >= 2) {
    const rw = ridgeFactorWeightsFromPanels(rollingState.panelHistory, ridgeLambda);
    if (rw) {
      for (const f of ADAPTIVE_FACTOR_NAMES) {
        icTarget[f] = 0.7 * rw[f] + 0.3 * icTarget[f];
      }
      let s = ADAPTIVE_FACTOR_NAMES.reduce((a, f) => a + icTarget[f], 0);
      for (const f of ADAPTIVE_FACTOR_NAMES) icTarget[f] /= s;
    }
  }

  const histLen = rollingState.icHistory.length;
  const baseBlend = histLen < ADAPTIVE_SHORT_HISTORY_PERIODS ? 0.8 : 0.6;
  const icBlend = 1 - baseBlend;

  let blended = {};
  for (const f of ADAPTIVE_FACTOR_NAMES) {
    blended[f] = base[f] * baseBlend + icTarget[f] * icBlend;
  }

  const spyUp = spyAbove200dma(spySeries, asOfDateStr);
  const momRegime = classifySpyMomentumRegime(spySeries, asOfDateStr, momentumRegimeOpts);

  const runPipeline = (raw) => {
    let w = { ...raw };
    for (const f of ADAPTIVE_FACTOR_NAMES) {
      const a = anchorWeights[f] ?? 0;
      w[f] = (1 - ADAPTIVE_MEAN_REVERSION_RATE) * (w[f] ?? 0) + ADAPTIVE_MEAN_REVERSION_RATE * a;
    }
    w = normalizePillarWeights(w);
    w = clampDeltaVsPrevious(w, previousStepWeights, maxDeltaPerFactor);
    w = normalizePillarWeights(w);
    w = applyCumulativeAnchorClamp(w, anchorWeights, ADAPTIVE_MAX_CUMULATIVE_DRIFT);
    const preFloor1 = { ...w };
    w = applyMinFloorRenorm(w, ADAPTIVE_MIN_PILLAR_FLOOR);
    w = zeroDcfAndRenorm(w);
    warnLargeFloorRenorm(preFloor1, w, 'after-first-floor');
    w = applyRegimeWithIcClamp(w, spyUp, meanIc);
    w = applyMomentumEscapeValve(w, momRegime, 0.1);
    w = applyCumulativeAnchorClamp(w, anchorWeights, ADAPTIVE_MAX_CUMULATIVE_DRIFT);
    const preFloor2 = { ...w };
    w = applyMinFloorRenorm(w, ADAPTIVE_MIN_PILLAR_FLOOR);
    w = zeroDcfAndRenorm(w);
    warnLargeFloorRenorm(preFloor2, w, 'after-final-floor');
    w = applySinglePillarCap(w, ADAPTIVE_MAX_SINGLE_PILLAR);
    return w;
  };

  const out = runPipeline(blended);
  logAdaptiveClampDebug({
    rebalanceIndex,
    anchorWeights,
    previousStepWeights,
    composed: out,
    tag: 'compose',
  });

  return {
    weights: out,
    meanIcByFactor: meanIc,
    momentumRegime: momRegime,
    periodIc: ok ? icByFactor : null
  };
}
