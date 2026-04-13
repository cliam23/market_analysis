/**
 * Q-learning portfolio policy agent (Dou, Goldstein & Ji 2025–style).
 * Portfolio-level actions: exposure, position count, sizing. No server imports.
 */

export const REGIME_BUCKET_MAP = {
  strong_bull: 0,
  normal: 1,
  pullback: 2,
  correction: 3,
  caution: 3,
  bear: 4,
  disabled: 1
};

export const ALPHA_BINS = [-Infinity, -0.05, -0.02, 0, 0.02, 0.05, Infinity];
export const BREADTH_BINS = [-Infinity, 0.3, 0.5, 0.7, Infinity];
export const VOL_BINS = [-Infinity, 0.1, 0.15, 0.25, Infinity];
/** Top-15 avg composite score on 0–100 scale (edges ≈ p25/p50/p75 from 5y bimonthly full_composite backtest sample, Apr 2026). */
export const SIGNAL_BINS = [-Infinity, 84, 89, 91, Infinity];

export const N_REGIME = 5;
export const N_ALPHA = 6;
export const N_BREADTH = 4;
export const N_VOL = 4;
export const N_SIGNAL = 4;

export const TOTAL_STATES = N_REGIME * N_ALPHA * N_BREADTH * N_VOL * N_SIGNAL;

export const ACTION_SPACE = {
  exposure: { levels: [0.5, 0.65, 0.8, 1.0], n: 4 },
  positionCount: { levels: [7, 10, 13, 15], n: 4 },
  sizingMethod: { levels: ['equal', 'invVol', 'score'], n: 3 }
};

export const TOTAL_ACTIONS = 4 * 4 * 3;

export const Q_VALUE_CLIP = 2;
export const MIN_VISITS_FOR_EXPLOIT = 10;

/** Default: full exposure, 15 names, invVol → exposureIdx 3, posIdx 3, sizingIdx 1 */
export const DEFAULT_ACTION_IDX = (3 * 4 + 3) * 3 + 1;

export function discretize(value, bins) {
  for (let i = 1; i < bins.length; i++) {
    if (value < bins[i]) return i - 1;
  }
  return bins.length - 2;
}

export function regimeStringToBucket(regime) {
  if (regime == null || regime === '') return 1;
  const b = REGIME_BUCKET_MAP[regime];
  return b !== undefined ? b : 1;
}

/**
 * @param {{ regimeBucket: number, recentAlpha: number, breadthRatio: number, realizedVol: number, avgTopScore: number }} f
 */
export function encodeState(f) {
  const r = Math.max(0, Math.min(N_REGIME - 1, f.regimeBucket | 0));
  const a = discretize(f.recentAlpha, ALPHA_BINS);
  const b = discretize(f.breadthRatio, BREADTH_BINS);
  const v = discretize(f.realizedVol, VOL_BINS);
  const s = discretize(f.avgTopScore, SIGNAL_BINS);
  return ((((r * N_ALPHA + a) * N_BREADTH + b) * N_VOL + v) * N_SIGNAL + s) | 0;
}

export function decodeState(stateIdx) {
  let x = stateIdx | 0;
  const s = x % N_SIGNAL;
  x = Math.floor(x / N_SIGNAL);
  const v = x % N_VOL;
  x = Math.floor(x / N_VOL);
  const b = x % N_BREADTH;
  x = Math.floor(x / N_BREADTH);
  const a = x % N_ALPHA;
  const r = Math.floor(x / N_ALPHA);
  return { regimeBucket: r, alphaBin: a, breadthBin: b, volBin: v, signalBin: s };
}

export function decodeAction(actionIdx) {
  const idx = Math.max(0, Math.min(TOTAL_ACTIONS - 1, actionIdx | 0));
  const sizingIdx = idx % 3;
  const rem = Math.floor(idx / 3);
  const posCountIdx = rem % 4;
  const exposureIdx = Math.floor(rem / 4);
  return {
    exposure: ACTION_SPACE.exposure.levels[exposureIdx],
    positionCount: ACTION_SPACE.positionCount.levels[posCountIdx],
    sizingMethod: ACTION_SPACE.sizingMethod.levels[sizingIdx],
    exposureIdx,
    posCountIdx,
    sizingIdx
  };
}

export function encodeAction(exposureIdx, posCountIdx, sizingIdx) {
  return ((exposureIdx * 4 + posCountIdx) * 3 + sizingIdx) | 0;
}

export function computeRlReward(portfolioReturn, benchmarkReturn, portfolioVol, maxDrawdown) {
  const alpha = portfolioReturn - benchmarkReturn;
  const vol = portfolioVol > 0 ? portfolioVol : 0.15;
  const sharpeAlpha = alpha / vol;
  const ddPenalty = maxDrawdown < -0.15 ? (maxDrawdown + 0.15) * 1.0 : 0;
  return (sharpeAlpha * 0.7 + ddPenalty) * 3.0;
}

export class QLearningTradingAgent {
  constructor(config = {}) {
    this.alpha = config.alpha ?? 0.05;
    this.beta = config.beta ?? 1e-5;
    this.rho = config.rho ?? 0.9;
    this.nStates = config.nStates ?? TOTAL_STATES;
    this.nActions = config.nActions ?? TOTAL_ACTIONS;
    this.Q = new Float64Array(this.nStates * this.nActions);
    this.visitCounts = new Uint32Array(this.nStates);
    this.totalUpdates = 0;
    this.statesVisited = 0;
    this._initializeQ();
  }

  _initializeQ() {
    const initValue = 0.15;
    for (let i = 0; i < this.Q.length; i++) {
      this.Q[i] = initValue + (Math.random() - 0.5) * 0.03;
    }
  }

  getQ(stateIdx, actionIdx) {
    return this.Q[stateIdx * this.nActions + actionIdx];
  }

  setQ(stateIdx, actionIdx, value) {
    this.Q[stateIdx * this.nActions + actionIdx] = Math.max(-Q_VALUE_CLIP, Math.min(Q_VALUE_CLIP, value));
  }

  selectAction(stateIdx, forceExploit = false, options = {}) {
    const { randomAction = false, minVisitsFallback = MIN_VISITS_FOR_EXPLOIT } = options;
    const visits = this.visitCounts[stateIdx] | 0;

    if (randomAction) {
      return {
        actionIdx: Math.floor(Math.random() * this.nActions),
        explored: true,
        epsilon: 1,
        fallback: false
      };
    }

    if (!forceExploit && visits < minVisitsFallback) {
      return {
        actionIdx: DEFAULT_ACTION_IDX,
        explored: false,
        epsilon: 0,
        fallback: true
      };
    }

    const epsilon = forceExploit ? 0 : Math.exp(-this.beta * visits);
    if (!forceExploit && Math.random() < epsilon) {
      return {
        actionIdx: Math.floor(Math.random() * this.nActions),
        explored: true,
        epsilon,
        fallback: false
      };
    }

    let bestAction = 0;
    let bestQ = this.getQ(stateIdx, 0);
    for (let a = 1; a < this.nActions; a++) {
      const q = this.getQ(stateIdx, a);
      if (q > bestQ) {
        bestQ = q;
        bestAction = a;
      }
    }
    return { actionIdx: bestAction, explored: false, epsilon, fallback: false };
  }

  update(stateIdx, actionIdx, reward, nextStateIdx) {
    const currentQ = this.getQ(stateIdx, actionIdx);
    let maxNextQ = -Infinity;
    for (let a = 0; a < this.nActions; a++) {
      maxNextQ = Math.max(maxNextQ, this.getQ(nextStateIdx, a));
    }
    const target = reward + this.rho * maxNextQ;
    const newQ = (1 - this.alpha) * currentQ + this.alpha * target;
    this.setQ(stateIdx, actionIdx, newQ);
    this.visitCounts[stateIdx]++;
    this.totalUpdates++;
  }

  getPolicy() {
    const policy = new Map();
    for (let s = 0; s < this.nStates; s++) {
      let bestA = 0;
      let bestQ = this.getQ(s, 0);
      for (let a = 1; a < this.nActions; a++) {
        const q = this.getQ(s, a);
        if (q > bestQ) {
          bestQ = q;
          bestA = a;
        }
      }
      policy.set(s, { actionIdx: bestA, qValue: bestQ });
    }
    return policy;
  }

  /** Unique state indices with at least one Q entry !== 0 (used after load from disk). */
  recomputeStatesVisitedFromQ() {
    const visitedSet = new Set();
    for (let i = 0; i < this.Q.length; i++) {
      if (this.Q[i] !== 0) visitedSet.add(Math.floor(i / this.nActions));
    }
    this.statesVisited = visitedSet.size;
    return this.statesVisited;
  }

  serialize() {
    this.recomputeStatesVisitedFromQ();
    return {
      version: 1,
      alpha: this.alpha,
      beta: this.beta,
      rho: this.rho,
      nStates: this.nStates,
      nActions: this.nActions,
      Q: Array.from(this.Q),
      visitCounts: Array.from(this.visitCounts),
      totalUpdates: this.totalUpdates,
      statesVisited: this.statesVisited
    };
  }

  static deserialize(data) {
    const agent = new QLearningTradingAgent({
      alpha: data.alpha,
      beta: data.beta,
      rho: data.rho,
      nStates: data.nStates,
      nActions: data.nActions
    });
    if (Array.isArray(data.visitCounts) && data.visitCounts.length === agent.visitCounts.length) {
      agent.visitCounts = new Uint32Array(data.visitCounts);
    }
    agent.totalUpdates = data.totalUpdates ?? 0;
    if (Array.isArray(data.Q) && data.Q.length === agent.Q.length) {
      agent.Q = new Float64Array(data.Q);
      agent.recomputeStatesVisitedFromQ();
    }
    return agent;
  }
}

export function computeConvergenceMetrics(agent) {
  let totalGap = 0;
  let minGap = Infinity;
  let statesVisited = 0;
  for (let s = 0; s < agent.nStates; s++) {
    if (agent.visitCounts[s] === 0) continue;
    statesVisited++;
    const qValues = [];
    for (let a = 0; a < agent.nActions; a++) {
      qValues.push(agent.getQ(s, a));
    }
    qValues.sort((a, b) => b - a);
    if (qValues.length >= 2) {
      const gap = qValues[0] - qValues[1];
      totalGap += gap;
      minGap = Math.min(minGap, gap);
    }
  }
  return {
    statesVisited,
    totalStates: agent.nStates,
    coveragePercent: statesVisited > 0 ? ((statesVisited / agent.nStates) * 100).toFixed(1) : '0',
    avgQGap: statesVisited > 0 ? (totalGap / statesVisited).toFixed(4) : '0',
    minQGap: minGap === Infinity ? '0' : minGap.toFixed(4),
    totalUpdates: agent.totalUpdates
  };
}

export function detectOverPruning(agent) {
  const highExposureActions = [];
  for (let a = 0; a < TOTAL_ACTIONS; a++) {
    const dec = decodeAction(a);
    if (dec.exposure >= 1) highExposureActions.push(a);
  }
  let statesPreferringHighExposure = 0;
  let totalVisited = 0;
  for (let s = 0; s < agent.nStates; s++) {
    if (agent.visitCounts[s] === 0) continue;
    totalVisited++;
    let bestA = 0;
    let bestQ = agent.getQ(s, 0);
    for (let a = 1; a < agent.nActions; a++) {
      const q = agent.getQ(s, a);
      if (q > bestQ) {
        bestQ = q;
        bestA = a;
      }
    }
    if (highExposureActions.includes(bestA)) statesPreferringHighExposure++;
  }
  const ratio = totalVisited > 0 ? statesPreferringHighExposure / totalVisited : 0;
  return {
    overPruningLikely: ratio < 0.1,
    highExposurePreferenceRatio: ratio,
    warning:
      ratio < 0.1
        ? 'Agent may be over-pruning aggressive strategies (paper Section 5.1). Consider increasing exploration or reducing alpha.'
        : null
  };
}
