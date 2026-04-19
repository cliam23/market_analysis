/**
 * Deep Q-Network portfolio policy (same action space as q-learning-agent.js: 96 discrete actions).
 *
 * Prefers `@tensorflow/tfjs-node` (native libtensorflow) when installed — see
 * https://github.com/tensorflow/tfjs-node . Falls back to `@tensorflow/tfjs` CPU.
 * Native install needs a supported Node LTS (e.g. 20/22); very new Node, or a project
 * path containing spaces, can prevent the addon from building (optional npm install).
 *
 * `encodeState(obs)` returns a **5-dimensional** normalized vector for the DQN.
 * For the legacy discrete index used by `server.js` today, use `encodeDiscreteStateIndex(obs)`.
 *
 * Serialized agents use `kind: 'dqn'` (not the Q-table `Q` array). Point `rl-agent.json` /
 * loaders at this format when migrating off `q-learning-agent.js`.
 *
 * Zero imports from server.js.
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const tf = (() => {
  try {
    return require('@tensorflow/tfjs-node');
  } catch {
    console.warn(
      '[DQN] @tensorflow/tfjs-node not loaded — using @tensorflow/tfjs (CPU). For native speed: npm install (optional) with Node 20/22 LTS and a project path without spaces. https://github.com/tensorflow/tfjs-node'
    );
    return require('@tensorflow/tfjs');
  }
})();

// ── Shared constants (match q-learning-agent.js) ───────────────────────────

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
export const SIGNAL_BINS = [-Infinity, 84, 85.5, 88, Infinity];

export const N_REGIME = 5;
export const N_ALPHA = 6;
export const N_BREADTH = 4;
export const N_VOL = 4;
export const N_SIGNAL = 4;

export const TOTAL_STATES = N_REGIME * N_ALPHA * N_BREADTH * N_VOL * N_SIGNAL;

export const N_SUBPERIODS = 3;

export const ACTION_SPACE = {
  exposure: { levels: [0.5, 0.65, 0.8, 1.0], n: 4 },
  positionCount: { levels: [7, 10, 13, 15], n: 4 },
  sizingMethod: { levels: ['equal', 'invVol', 'score'], n: 3 },
  rebalanceWait: { levels: ['standard', 'skip'], n: 2 }
};

export const TOTAL_ACTIONS = 4 * 4 * 3 * 2;

export const Q_VALUE_CLIP = 2;
export const MIN_VISITS_FOR_EXPLOIT = 10;

export const DEFAULT_ACTION_IDX = (3 * 4 + 3) * 3 + 1;

export const DEFAULT_ACTION = {
  exposure: 1.0,
  positionCount: 15,
  sizingMethod: 'invVol',
  rebalanceWait: 'standard'
};

/** Representative values inside each discrete bin (for stateIdx → continuous). */
const ALPHA_REP = [-0.06, -0.035, -0.01, 0.01, 0.035, 0.06];
const BREADTH_REP = [0.2, 0.4, 0.6, 0.85];
const VOL_REP = [0.08, 0.125, 0.2, 0.35];
const SIGNAL_REP = [82.5, 84.75, 86.75, 90];

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

/** Discrete state index 0..TOTAL_STATES-1 (legacy Q-table encoding). */
export function encodeDiscreteStateIndex(f) {
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

export function computeRlReward(portfolioReturn, benchmarkReturn, portfolioVol, maxDrawdown) {
  const alpha = portfolioReturn - benchmarkReturn;
  const vol = portfolioVol > 0 ? portfolioVol : 0.15;
  const sharpeAlpha = alpha / vol;
  const ddPenalty = maxDrawdown < -0.15 ? (maxDrawdown + 0.15) * 1.0 : 0;
  return (sharpeAlpha * 0.7 + ddPenalty) * 3.0;
}

/** Continuous 5-vector in [0,1] for the DQN (not the legacy discrete index). */
export function encodeState(obs) {
  const rb = Math.max(0, Math.min(4, Number(obs?.regimeBucket) || 0)) / 4;
  const ra = Math.max(-0.3, Math.min(0.3, Number(obs?.recentAlpha) || 0));
  const raN = (ra + 0.3) / 0.6;
  const br = Math.max(0, Math.min(1, Number(obs?.breadthRatio) ?? 0.5));
  const rv = Math.max(0.05, Math.min(0.5, Number(obs?.realizedVol) ?? 0.15));
  const rvN = (rv - 0.05) / 0.45;
  const ats = Math.max(55, Math.min(100, Number(obs?.avgTopScore) ?? 70));
  const atsN = (ats - 55) / 45;
  return Float32Array.from([rb, raN, br, rvN, atsN]);
}

function discreteIdxToObs(stateIdx) {
  const { regimeBucket, alphaBin, breadthBin, volBin, signalBin } = decodeState(stateIdx);
  return {
    regimeBucket,
    recentAlpha: ALPHA_REP[Math.max(0, Math.min(N_ALPHA - 1, alphaBin))] ?? 0,
    breadthRatio: BREADTH_REP[Math.max(0, Math.min(N_BREADTH - 1, breadthBin))] ?? 0.5,
    realizedVol: VOL_REP[Math.max(0, Math.min(N_VOL - 1, volBin))] ?? 0.15,
    avgTopScore: SIGNAL_REP[Math.max(0, Math.min(N_SIGNAL - 1, signalBin))] ?? 70
  };
}

function discreteIdxToVec(stateIdx) {
  return encodeState(discreteIdxToObs(stateIdx));
}

function bullActionIdxList() {
  const ids = [];
  for (let eIdx = 2; eIdx <= 3; eIdx++) {
    for (let pIdx = 0; pIdx <= 3; pIdx++) {
      for (let sIdx = 0; sIdx <= 2; sIdx++) {
        ids.push(encodeAction(eIdx, pIdx, sIdx));
      }
    }
  }
  return ids;
}

const BULL_ACTION_IDXS = bullActionIdxList();

// ── DQN ───────────────────────────────────────────────────────────────────────

const REPLAY_CAPACITY = 50000;
const BATCH_SIZE = 32;
const MIN_BUFFER_TRAIN = 500;
const TARGET_SYNC_EVERY = 100;
const GAMMA = 0.95;

function buildQNetwork(hiddenSize = 64) {
  const h = Math.max(8, Math.min(512, Math.floor(Number(hiddenSize)) || 64));
  const input = tf.input({ shape: [5] });
  const h1 = tf.layers.dense({ units: h, activation: 'relu', kernelInitializer: 'glorotUniform' }).apply(input);
  const h2 = tf.layers.dense({ units: h, activation: 'relu', kernelInitializer: 'glorotUniform' }).apply(h1);
  const out = tf.layers
    .dense({ units: TOTAL_ACTIONS, activation: 'linear', kernelInitializer: 'glorotUniform' })
    .apply(h2);
  return tf.model({ inputs: input, outputs: out });
}

export class DQNAgent {
  constructor(config = {}) {
    /** Kept for parity with Q-learning train harness (DQN ignores it). */
    this.beta = config.beta ?? 1e-5;
    this.gamma = config.gamma ?? GAMMA;
    this.replayCapacity = config.replayCapacity ?? REPLAY_CAPACITY;
    this.batchSize = config.batchSize ?? BATCH_SIZE;
    this.minBufferTrain = config.minBufferTrain ?? MIN_BUFFER_TRAIN;
    /** Gradient steps between hard target syncs (episode-based sync is done from server). */
    this.targetSyncEvery = config.targetSyncEvery ?? TARGET_SYNC_EVERY;
    this.lr = config.lr ?? 0.001;
    this.hiddenSize = Math.max(8, Math.min(512, Math.floor(Number(config.hiddenSize)) || 64));

    this.epsilonStart = config.epsilonStart ?? 1.0;
    this.epsilonEnd = config.epsilonEnd ?? 0.05;
    this.epsilonDecayEpisodes = Math.max(1, config.epsilonDecayEpisodes ?? 10000);
    /** Set by training loop before each episode (1-based). */
    this.currentTrainingEpisode = config.currentTrainingEpisode ?? 0;

    this.coupledMode = config.coupledMode ?? false;
    if (this.coupledMode) {
      throw new Error('DQNAgent does not support coupledMode; use q-learning-agent.js');
    }

    this.online = buildQNetwork(this.hiddenSize);
    this.target = buildQNetwork(this.hiddenSize);
    this.target.setWeights(this.online.getWeights().map((w) => tf.clone(w)));
    this.optimizer = tf.train.adam(this.lr);

    this.buffer = [];
    this.bufferWrite = 0;
    this.trainSteps = 0;
    this.selectCallsTrain = 0;
    this.visitCounts = new Uint32Array(TOTAL_STATES);
    this.totalUpdates = 0;
    this.statesVisited = 0;
    /** Huber loss from the last replay gradient step (NaN if none yet). */
    this.lastLoss = NaN;

    this._qCacheState = -1;
    this._qCacheVec = null;
  }

  get nStates() {
    return TOTAL_STATES;
  }

  get nActions() {
    return TOTAL_ACTIONS;
  }

  encodeState(obs) {
    return encodeState(obs);
  }

  /** @returns {Float32Array} Q(s,·) length TOTAL_ACTIONS */
  _predictQVec(vec) {
    return tf.tidy(() => {
      const t = tf.tensor2d([Array.from(vec)], [1, 5]);
      const q = this.online.predict(t);
      return Float32Array.from(q.dataSync());
    });
  }

  getQ(stateIdx, actionIdx) {
    const v = discreteIdxToVec(stateIdx);
    if (this._qCacheState !== stateIdx || !this._qCacheVec) {
      this._qCacheVec = this._predictQVec(v);
      this._qCacheState = stateIdx;
    }
    const a = Math.max(0, Math.min(TOTAL_ACTIONS - 1, actionIdx | 0));
    return this._qCacheVec[a];
  }

  setQ(_stateIdx, _actionIdx, _value) {
    /* no-op: online network is authoritative */
  }

  getAction(obs, regime = 'normal') {
    const vec = encodeState(obs);
    const qArr = this._predictQVec(vec);
    let idx = 0;
    let best = -Infinity;
    for (let a = 0; a < TOTAL_ACTIONS; a++) {
      if (qArr[a] > best) {
        best = qArr[a];
        idx = a;
      }
    }
    const dec = decodeAction(idx);
    if (regime === 'strong_bull' && dec.exposure < 0.8) {
      let bestBull = BULL_ACTION_IDXS[0];
      let bestQB = -Infinity;
      for (const a of BULL_ACTION_IDXS) {
        if (qArr[a] > bestQB) {
          bestQB = qArr[a];
          bestBull = a;
        }
      }
      idx = bestBull;
    }
    return idx;
  }

  selectAction(stateIdx, forceExploit = false, options = {}) {
    const { randomAction = false } = options;
    const vec = discreteIdxToVec(stateIdx);
    this._qCacheState = stateIdx;
    this._qCacheVec = this._predictQVec(vec);

    if (this.buffer.length < this.minBufferTrain) {
      return {
        actionIdx: DEFAULT_ACTION_IDX,
        explored: false,
        epsilon: 0,
        fallback: true
      };
    }

    if (randomAction) {
      return {
        actionIdx: Math.floor(Math.random() * TOTAL_ACTIONS),
        explored: true,
        epsilon: 1,
        fallback: false
      };
    }

    let epsilon = 0;
    if (!forceExploit) {
      this.selectCallsTrain++;
      const ep = Math.max(0, Number(this.currentTrainingEpisode) || 0);
      const cap = this.epsilonDecayEpisodes;
      const t = Math.min(ep, cap);
      epsilon = this.epsilonEnd + (this.epsilonStart - this.epsilonEnd) * (1 - t / cap);
      epsilon = Math.max(this.epsilonEnd, Math.min(this.epsilonStart, epsilon));
    }

    if (!forceExploit && Math.random() < epsilon) {
      return {
        actionIdx: Math.floor(Math.random() * TOTAL_ACTIONS),
        explored: true,
        epsilon,
        fallback: false
      };
    }

    let bestA = 0;
    let bestQ = this._qCacheVec[0];
    for (let a = 1; a < TOTAL_ACTIONS; a++) {
      if (this._qCacheVec[a] > bestQ) {
        bestQ = this._qCacheVec[a];
        bestA = a;
      }
    }
    return { actionIdx: bestA, explored: false, epsilon, fallback: false };
  }

  decodeAction(actionIdx) {
    return decodeAction(actionIdx);
  }

  /**
   * @param {number|object} state — discrete index (server) or observation object (continuous)
   * @param {number} action — action index
   */
  update(state, action, reward, nextState, done = false) {
    const doneFlag = done === true || done === 1;
    const sVec =
      typeof state === 'number'
        ? discreteIdxToVec(state)
        : Float32Array.from(encodeState(state));
    const s2Vec =
      typeof nextState === 'number'
        ? discreteIdxToVec(nextState)
        : Float32Array.from(encodeState(nextState));
    const a = Math.max(0, Math.min(TOTAL_ACTIONS - 1, action | 0));

    if (typeof state === 'number') {
      this.visitCounts[state | 0]++;
      this._recomputeStatesVisited();
    }

    const tr = {
      state: Float32Array.from(sVec),
      actionIdx: a,
      reward: Number(reward) || 0,
      nextState: Float32Array.from(s2Vec),
      done: doneFlag
    };
    if (this.buffer.length < this.replayCapacity) {
      this.buffer.push(tr);
    } else {
      this.buffer[this.bufferWrite % this.replayCapacity] = tr;
      this.bufferWrite++;
    }

    this.totalUpdates++;
    if (this.buffer.length >= this.minBufferTrain) {
      this._trainStep();
    }
  }

  /** Copy online weights → target (call between episodes for episode-based target sync). */
  syncTargetFromOnline() {
    this.target.setWeights(this.online.getWeights().map((w) => tf.clone(w)));
    this._qCacheState = -1;
    this._qCacheVec = null;
  }

  getEpsilonForEpisode(episodeOneBased = null) {
    const ep = episodeOneBased != null ? Number(episodeOneBased) : Number(this.currentTrainingEpisode) || 0;
    const cap = this.epsilonDecayEpisodes;
    const t = Math.min(Math.max(0, ep), cap);
    const e = this.epsilonEnd + (this.epsilonStart - this.epsilonEnd) * (1 - t / cap);
    return Math.max(this.epsilonEnd, Math.min(this.epsilonStart, e));
  }

  _recomputeStatesVisited() {
    let n = 0;
    for (let i = 0; i < this.visitCounts.length; i++) {
      if (this.visitCounts[i] > 0) n++;
    }
    this.statesVisited = n;
  }

  recomputeStatesVisitedFromQ() {
    this._recomputeStatesVisited();
    return this.statesVisited;
  }

  _sampleBatch(n) {
    const out = [];
    const len = this.buffer.length;
    for (let i = 0; i < n; i++) {
      out.push(this.buffer[Math.floor(Math.random() * len)]);
    }
    return out;
  }

  _trainStep() {
    const batch = this._sampleBatch(this.batchSize);
    const states = batch.map((b) => [...b.state]);
    const nextStates = batch.map((b) => [...b.nextState]);
    const rewards = batch.map((b) => b.reward);
    const actions = batch.map((b) => b.actionIdx);
    const dones = batch.map((b) => (b.done ? 1 : 0));

    const cost = this.optimizer.minimize(
      () =>
        tf.tidy(() => {
          const s = tf.tensor2d(states, [this.batchSize, 5]);
          const s2 = tf.tensor2d(nextStates, [this.batchSize, 5]);
          const r = tf.tensor2d(rewards.map((x) => [x]), [this.batchSize, 1]);
          const d = tf.tensor2d(dones.map((x) => [x]), [this.batchSize, 1]);
          const aIdx = tf.tensor1d(actions, 'int32');

          const qOnline = this.online.predict(s);
          const qTarget = this.target.predict(s2);
          const maxNext = tf.max(qTarget, 1, true);
          const oneMinusD = tf.sub(1, d);
          const discounted = tf.mul(tf.mul(maxNext, tf.scalar(this.gamma)), oneMinusD);
          const y = tf.add(r, discounted);

          const oneHot = tf.oneHot(aIdx, TOTAL_ACTIONS);
          const qTaken = tf.sum(tf.mul(qOnline, oneHot), 1, true);
          return tf.losses.huberLoss(y, qTaken, undefined, tf.Reduction.MEAN);
        }),
      true
    );
    if (typeof cost === 'number' && Number.isFinite(cost)) {
      this.lastLoss = cost;
    } else if (cost && typeof cost.dataSync === 'function') {
      const v = cost.dataSync()[0];
      cost.dispose();
      this.lastLoss = v;
    }

    this.trainSteps++;
    if (this.trainSteps % this.targetSyncEvery === 0) {
      this.target.setWeights(this.online.getWeights().map((w) => tf.clone(w)));
    }
    this._qCacheState = -1;
    this._qCacheVec = null;
  }

  getPolicy() {
    const policy = new Map();
    for (let s = 0; s < TOTAL_STATES; s++) {
      const v = discreteIdxToVec(s);
      const qv = this._predictQVec(v);
      let bestA = 0;
      let bestQ = qv[0];
      for (let a = 1; a < TOTAL_ACTIONS; a++) {
        if (qv[a] > bestQ) {
          bestQ = qv[a];
          bestA = a;
        }
      }
      policy.set(s, { actionIdx: bestA, qValue: bestQ });
    }
    return policy;
  }

  coupledUpdate() {
    throw new Error('DQNAgent does not support coupledUpdate');
  }

  coupledChooseAction() {
    throw new Error('DQNAgent does not support coupledChooseAction');
  }

  serialize() {
    this.recomputeStatesVisitedFromQ();
    const packWeights = (m) =>
      m.getWeights().map((t) => ({
        shape: t.shape,
        data: Array.from(t.dataSync())
      }));
    return {
      version: 2,
      kind: 'dqn',
      beta: this.beta,
      gamma: this.gamma,
      lr: this.lr,
      replayCapacity: this.replayCapacity,
      batchSize: this.batchSize,
      minBufferTrain: this.minBufferTrain,
      targetSyncEvery: this.targetSyncEvery,
      epsilonStart: this.epsilonStart,
      epsilonEnd: this.epsilonEnd,
      epsilonDecayEpisodes: this.epsilonDecayEpisodes,
      hiddenSize: this.hiddenSize,
      weightsOnline: packWeights(this.online),
      weightsTarget: packWeights(this.target),
      visitCounts: Array.from(this.visitCounts),
      totalUpdates: this.totalUpdates,
      statesVisited: this.statesVisited,
      trainSteps: this.trainSteps,
      selectCallsTrain: this.selectCallsTrain,
      lastLoss: Number.isFinite(this.lastLoss) ? this.lastLoss : null,
      bufferLength: this.buffer.length,
      bufferWrite: this.bufferWrite
    };
  }

  deserialize(data) {
    if (!data || data.kind !== 'dqn' || !Array.isArray(data.weightsOnline)) {
      throw new Error('deserialize: expected DQN payload (kind: dqn, weightsOnline)');
    }
    this.beta = data.beta ?? 1e-5;
    this.gamma = data.gamma ?? GAMMA;
    this.lr = data.lr ?? 0.001;
    this.optimizer = tf.train.adam(this.lr);

    const loadedHidden = Math.max(8, Math.min(512, Math.floor(Number(data.hiddenSize)) || 64));
    if (loadedHidden !== this.hiddenSize) {
      this.hiddenSize = loadedHidden;
      this.online.dispose();
      this.target.dispose();
      this.online = buildQNetwork(this.hiddenSize);
      this.target = buildQNetwork(this.hiddenSize);
    }

    const load = (model, arr) => {
      const tensors = arr.map(({ shape, data }) => tf.tensor(data, shape));
      model.setWeights(tensors);
      tensors.forEach((t) => t.dispose());
    };
    load(this.online, data.weightsOnline);
    load(this.target, data.weightsTarget || data.weightsOnline);

    if (Array.isArray(data.visitCounts) && data.visitCounts.length === this.visitCounts.length) {
      this.visitCounts = new Uint32Array(data.visitCounts);
    }
    this.totalUpdates = data.totalUpdates ?? 0;
    this.trainSteps = data.trainSteps ?? 0;
    this.selectCallsTrain = data.selectCallsTrain ?? 0;
    this.epsilonStart = data.epsilonStart ?? 1.0;
    this.epsilonEnd = data.epsilonEnd ?? 0.05;
    this.epsilonDecayEpisodes = Math.max(1, data.epsilonDecayEpisodes ?? 10000);
    this.lastLoss = Number.isFinite(data.lastLoss) ? data.lastLoss : NaN;
    this.buffer = [];
    this.bufferWrite = data.bufferWrite ?? 0;
    this._recomputeStatesVisited();
    this._qCacheState = -1;
    this._qCacheVec = null;
    return this;
  }

  static deserialize(data) {
    const agent = new DQNAgent({
      gamma: data.gamma,
      lr: data.lr,
      replayCapacity: data.replayCapacity,
      batchSize: data.batchSize,
      minBufferTrain: data.minBufferTrain,
      targetSyncEvery: data.targetSyncEvery,
      epsilonStart: data.epsilonStart,
      epsilonEnd: data.epsilonEnd,
      epsilonDecayEpisodes: data.epsilonDecayEpisodes,
      hiddenSize: data.hiddenSize
    });
    agent.deserialize(data);
    return agent;
  }
}

/** Alias for migrating imports from q-learning-agent.js (class API only). */
export { DQNAgent as QLearningTradingAgent };

export function computeConvergenceMetrics(agent) {
  let totalGap = 0;
  let minGap = Infinity;
  let statesVisited = 0;
  for (let s = 0; s < TOTAL_STATES; s++) {
    if (!agent.visitCounts || agent.visitCounts[s] === 0) continue;
    statesVisited++;
    const qValues = [];
    for (let a = 0; a < TOTAL_ACTIONS; a++) {
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
    totalStates: TOTAL_STATES,
    coveragePercent: statesVisited > 0 ? ((statesVisited / TOTAL_STATES) * 100).toFixed(1) : '0',
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
  for (let s = 0; s < TOTAL_STATES; s++) {
    if (!agent.visitCounts || agent.visitCounts[s] === 0) continue;
    totalVisited++;
    let bestA = 0;
    let bestQ = agent.getQ(s, 0);
    for (let a = 1; a < TOTAL_ACTIONS; a++) {
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
