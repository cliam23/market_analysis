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
/** Top-15 avg composite score on 0–100 scale (edges ≈ p25/p50/p75 combined top50+top150 3y sample; recalibrated Apr 2026). */
export const SIGNAL_BINS = [-Infinity, 84, 85.5, 88, Infinity];

export const N_REGIME = 5;
export const N_ALPHA = 6;
export const N_BREADTH = 4;
export const N_VOL = 4;
export const N_SIGNAL = 4;

export const TOTAL_STATES = N_REGIME * N_ALPHA * N_BREADTH * N_VOL * N_SIGNAL;

/** Monthly rebalances per quarterly episode (coupled Q-learning). */
export const N_SUBPERIODS = 3;

export const ACTION_SPACE = {
  exposure: { levels: [0.5, 0.65, 0.8, 1.0], n: 4 },
  positionCount: { levels: [7, 10, 13, 15], n: 4 },
  sizingMethod: { levels: ['equal', 'invVol', 'score'], n: 3 },
  rebalanceWait: { levels: ['standard', 'skip'], n: 2 }
};

/** 4 × 4 × 3 × 2 — rebalanceWait slowest so indices 0..47 match legacy (standard only). */
export const TOTAL_ACTIONS = 4 * 4 * 3 * 2;

export const Q_VALUE_CLIP = 2;
export const MIN_VISITS_FOR_EXPLOIT = 10;

/** Default: full exposure, 15 names, invVol, standard rebalance → same numeric index as legacy 48-action space */
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
  let x = Math.floor(idx / 3);
  const posCountIdx = x % 4;
  x = Math.floor(x / 4);
  const exposureIdx = x % 4;
  const waitIdx = Math.floor(x / 4);
  return {
    exposure: ACTION_SPACE.exposure.levels[exposureIdx],
    positionCount: ACTION_SPACE.positionCount.levels[posCountIdx],
    sizingMethod: ACTION_SPACE.sizingMethod.levels[sizingIdx],
    rebalanceWait: ACTION_SPACE.rebalanceWait.levels[waitIdx] ?? 'standard',
    exposureIdx,
    posCountIdx,
    sizingIdx,
    waitIdx
  };
}

export function encodeAction(exposureIdx, posCountIdx, sizingIdx, waitIdx = 0) {
  const w = Math.max(0, Math.min(1, waitIdx | 0));
  return (sizingIdx + 3 * (posCountIdx + 4 * (exposureIdx + 4 * w))) | 0;
}

/** Policy default matching `DEFAULT_ACTION_IDX` (full exposure, 15 names, invVol, rebalance as usual). */
export const DEFAULT_ACTION = {
  exposure: 1.0,
  positionCount: 15,
  sizingMethod: 'invVol',
  rebalanceWait: 'standard'
};

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
    /** Set by server during `/api/rl/train` episodes; drives linear ε below. Cleared after training. */
    this.currentTrainingEpisode = 0;
    /** Linear ε schedule (training only): episode 1 → epsilonStart, episode epsilonDecayEpisodes → epsilonEnd, then epsilonEnd. */
    this.epsilonStart = config.epsilonStart ?? 1;
    this.epsilonEnd = config.epsilonEnd ?? 0.05;
    this.epsilonDecayEpisodes = config.epsilonDecayEpisodes ?? 25000;
    this.Q = new Float64Array(this.nStates * this.nActions);
    this.visitCounts = new Uint32Array(this.nStates);
    this.totalUpdates = 0;
    this.statesVisited = 0;
    this._initializeQ();

    // ── Coupled Q-learning (AI planning) ────────────────────────────────────────
    // When coupledMode:true, three separate Q-tables are maintained — one per
    // subperiod within a quarterly episode — and updates bootstrap across them
    // via backward induction (Dou 2026, slides 20-21).
    // When coupledMode:false (default) the agent behaves exactly as before.
    this.coupledMode = config?.coupledMode ?? false;
    if (this.coupledMode) {
      // Q_h[h] is a flat Float64Array of length nStates * nActions, same layout as this.Q
      // h=0: first monthly rebalance, h=1: second, h=2: third (terminal — wraps to next episode)
      this.Q_h = Array.from({ length: N_SUBPERIODS }, () => {
        const arr = new Float64Array(this.nStates * this.nActions);
        const initValue = 0.15;
        for (let i = 0; i < arr.length; i++) {
          arr[i] = initValue + (Math.random() - 0.5) * 0.03;
        }
        return arr;
      });
    }
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

  /** Linear decay from epsilonStart to epsilonEnd over episodes 1..epsilonDecayEpisodes (inclusive). */
  getEpsilonForTrainingEpisode(episode) {
    const start = this.epsilonStart ?? 1;
    const end = this.epsilonEnd ?? 0.05;
    const span = Math.max(1, this.epsilonDecayEpisodes | 0);
    const ep = Math.max(1, episode | 0);
    if (span <= 1) return end;
    if (ep >= span) return end;
    const t = (ep - 1) / (span - 1);
    return start + t * (end - start);
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

    const trainEp = this.currentTrainingEpisode | 0;
    if (!forceExploit && trainEp > 0) {
      const epsilon = this.getEpsilonForTrainingEpisode(trainEp);
      if (Math.random() < epsilon) {
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

  // Coupled Q-learning update (AI planning).
  // Call instead of update() when coupledMode:true.
  //
  // Args:
  //   subperiod   {number}  0 | 1 | 2 — which rebalance within the episode
  //   stateIdx    {number}  encoded state index (same encoding as reactive agent)
  //   actionIdx   {number}  action taken
  //   reward      {number}  realized reward for this subperiod (0 for h<2, full reward at h=2)
  //   nextStateIdx{number}  encoded state at next subperiod (or next episode h=0 if terminal)
  //   episode     {number}  episode counter (used to decay epsilon)
  //
  // Update rule (mirrors slide 20):
  //   For h = 0, 1:  Q_h[s,a] ← α[r + max_a' Q_{h+1}[s',a']] + (1-α)Q_h[s,a]
  //   For h = 2:     Q_h[s,a] ← α[r + ρ·max_a' Q_0[s',a']]   + (1-α)Q_h[s,a]
  coupledUpdate(subperiod, stateIdx, actionIdx, reward, nextStateIdx, _episode) {
    if (!this.coupledMode) throw new Error('coupledUpdate called on reactive agent');

    const idx = stateIdx * this.nActions + actionIdx;
    const isTerminal = subperiod === N_SUBPERIODS - 1;

    // Bootstrap from next subperiod's Q-table (or episode-discounted Q_0 if terminal)
    const nextTable = isTerminal ? this.Q_h[0] : this.Q_h[subperiod + 1];
    const discount = isTerminal ? this.rho : 1.0; // only apply ρ at episode boundary

    let maxNextQ = -Infinity;
    for (let a = 0; a < this.nActions; a++) {
      const q = nextTable[nextStateIdx * this.nActions + a];
      if (q > maxNextQ) maxNextQ = q;
    }

    const target = reward + discount * maxNextQ;
    const current = this.Q_h[subperiod][idx];
    const updated = this.alpha * target + (1 - this.alpha) * current;

    // Clip Q-values (same guard as reactive agent)
    this.Q_h[subperiod][idx] = Math.max(
      -Q_VALUE_CLIP,
      Math.min(Q_VALUE_CLIP, updated)
    );

    this.visitCounts[stateIdx]++;
    this.totalUpdates++;
  }

  // Coupled-mode action selection. Uses the subperiod-specific Q-table.
  // Drop-in replacement for selectAction() when coupledMode:true (epsilon uses episode).
  coupledChooseAction(subperiod, stateIdx, episode) {
    if (!this.coupledMode) throw new Error('coupledChooseAction called on reactive agent');

    const epUse = this.currentTrainingEpisode > 0 ? this.currentTrainingEpisode : episode;
    const epsilon =
      epUse > 0
        ? this.getEpsilonForTrainingEpisode(epUse)
        : Math.max(0.01, Math.exp(-this.beta * episode));
    if (Math.random() < epsilon) {
      return Math.floor(Math.random() * this.nActions); // explore
    }
    // Exploit: argmax over subperiod's Q-table
    const table = this.Q_h[subperiod];
    let bestAction = 0;
    let bestQ = -Infinity;
    for (let a = 0; a < this.nActions; a++) {
      const q = table[stateIdx * this.nActions + a];
      if (q > bestQ) {
        bestQ = q;
        bestAction = a;
      }
    }
    return bestAction;
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
      epsilonStart: this.epsilonStart,
      epsilonEnd: this.epsilonEnd,
      epsilonDecayEpisodes: this.epsilonDecayEpisodes,
      nStates: this.nStates,
      nActions: this.nActions,
      Q: Array.from(this.Q),
      coupledMode: this.coupledMode,
      ...(this.coupledMode && this.Q_h
        ? { Q_h: this.Q_h.map((t) => Array.from(t)) }
        : {}),
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
      nActions: data.nActions,
      epsilonStart: data.epsilonStart,
      epsilonEnd: data.epsilonEnd,
      epsilonDecayEpisodes: data.epsilonDecayEpisodes
    });
    if (Array.isArray(data.visitCounts) && data.visitCounts.length === agent.visitCounts.length) {
      agent.visitCounts = new Uint32Array(data.visitCounts);
    }
    agent.totalUpdates = data.totalUpdates ?? 0;
    if (Array.isArray(data.Q) && data.Q.length === agent.Q.length) {
      agent.Q = new Float64Array(data.Q);
      agent.recomputeStatesVisitedFromQ();
    }
    agent.coupledMode = false;
    if (
      data.coupledMode === true &&
      Array.isArray(data.Q_h) &&
      data.Q_h.length === N_SUBPERIODS &&
      data.Q_h.every(
        (row) => Array.isArray(row) && row.length === agent.nStates * agent.nActions
      )
    ) {
      agent.coupledMode = true;
      agent.Q_h = data.Q_h.map((row) => new Float64Array(row));
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
