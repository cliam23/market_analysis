/**
 * RL Q-learning test harness — run: node rl-test-harness.js
 * Writes rl-test-report.json alongside this file.
 */
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  QLearningTradingAgent,
  encodeState,
  decodeState,
  decodeAction,
  encodeAction,
  discretize,
  computeRlReward,
  ACTION_SPACE,
  TOTAL_STATES,
  TOTAL_ACTIONS,
  N_REGIME,
  N_ALPHA,
  N_BREADTH,
  N_VOL,
  N_SIGNAL,
  ALPHA_BINS,
  BREADTH_BINS,
  VOL_BINS,
  SIGNAL_BINS,
  REGIME_BUCKET_MAP,
  regimeStringToBucket,
  Q_VALUE_CLIP,
  MIN_VISITS_FOR_EXPLOIT,
  DEFAULT_ACTION_IDX,
  detectOverPruning
} from './q-learning-agent.js';

const computeReward = computeRlReward;

/** Schema snapshot for reports (not exported from q-learning-agent.js). */
const STATE_FEATURES = {
  regimeBucket: { dims: N_REGIME, note: 'from REGIME_BUCKET_MAP / regimeStringToBucket' },
  recentAlpha: { bins: ALPHA_BINS },
  breadthRatio: { bins: BREADTH_BINS },
  realizedVol: { bins: VOL_BINS },
  avgTopScore: { bins: SIGNAL_BINS }
};

/** Canonical values per bin so decodeState → encodeState round-trips. */
const ALPHA_REP = [-0.06, -0.035, -0.01, 0.01, 0.035, 0.06];
const BREADTH_REP = [0.2, 0.4, 0.6, 0.85];
const VOL_REP = [0.08, 0.125, 0.2, 0.35];
const SIGNAL_REP = [45, 60, 70, 80];

function decodedBinsToEncodeFeatures(d) {
  return {
    regimeBucket: d.regimeBucket,
    recentAlpha: ALPHA_REP[d.alphaBin] ?? 0,
    breadthRatio: BREADTH_REP[d.breadthBin] ?? 0.5,
    realizedVol: VOL_REP[d.volBin] ?? 0.15,
    avgTopScore: SIGNAL_REP[d.signalBin] ?? 60
  };
}

async function runTest(name, fn) {
  try {
    return await Promise.resolve(fn());
  } catch (e) {
    return { name, pass: false, error: e?.message || String(e) };
  }
}

function testStateRoundtrip() {
  const failures = [];
  for (let idx = 0; idx < TOTAL_STATES; idx++) {
    const d = decodeState(idx);
    const enc = encodeState(decodedBinsToEncodeFeatures(d));
    if (enc !== idx) failures.push(idx);
    if (failures.length > 10) break;
  }
  const pass = failures.length === 0;
  return {
    name: 'state_roundtrip',
    pass,
    totalStates: TOTAL_STATES,
    failures: failures.slice(0, 10)
  };
}

function testActionRoundtrip() {
  const failures = [];
  for (let idx = 0; idx < TOTAL_ACTIONS; idx++) {
    const dec = decodeAction(idx);
    const re =
      dec.exposureIdx * ACTION_SPACE.positionCount.n * ACTION_SPACE.sizingMethod.n +
      dec.posCountIdx * ACTION_SPACE.sizingMethod.n +
      dec.sizingIdx;
    const enc = encodeAction(dec.exposureIdx, dec.posCountIdx, dec.sizingIdx);
    if (re !== idx || enc !== idx) failures.push(idx);
    if (failures.length > 10) break;
  }
  return {
    name: 'action_roundtrip',
    pass: failures.length === 0,
    totalActions: TOTAL_ACTIONS,
    failures: failures.slice(0, 10)
  };
}

function testQConvergence() {
  const agent = new QLearningTradingAgent({ alpha: 0.1, rho: 0.9 });
  for (let i = 0; i < 2000; i++) {
    agent.update(0, 0, 1.0, 0);
  }
  const actual = agent.getQ(0, 0);
  const expected = 10.0;
  const error = Math.abs(actual - expected);
  const theoreticalFixedPoint = expected;
  return {
    name: 'q_convergence',
    pass: error < 0.5,
    expected: theoreticalFixedPoint,
    actual,
    error,
    converged: error < 0.5,
    note:
      'Bellman fixed point for r=1, rho=0.9 is 1/(1-rho)=10, but setQ clips to ±Q_VALUE_CLIP so Q(0,0) caps at 2 — pass=false reflects spec vs implementation.'
  };
}

function testQClipping() {
  const agent = new QLearningTradingAgent({ alpha: 0.5, rho: 0 });
  const extremeReward = 1000;
  agent.update(0, 0, extremeReward, 0);
  const resultingQ = agent.getQ(0, 0);
  const clipBound = Q_VALUE_CLIP;
  const clipped = Math.abs(resultingQ) <= clipBound + 1e-9;
  return {
    name: 'q_clipping',
    pass: clipped,
    extremeReward,
    resultingQ,
    clipBound,
    clipped
  };
}

function testExplorationDecay() {
  const agent = new QLearningTradingAgent({ beta: 5e-6 });
  const scenarios = [];

  const runScenario = (visits, expectedLow, expectedHigh, label) => {
    const s = 42;
    agent.visitCounts[s] = visits;
    const first = agent.selectAction(s, false, {});
    const actualEpsilon = first.epsilon;
    let exploreCount = 0;
    for (let i = 0; i < 1000; i++) {
      const r = agent.selectAction(s, false, {});
      if (r.explored) exploreCount++;
    }
    const empiricalExploreRate = exploreCount / 1000;
    let inRange;
    if (label === 'fresh') {
      inRange = actualEpsilon > 0.99;
    } else if (label === 'moderate') {
      inRange = actualEpsilon > 0.3 && actualEpsilon < 0.9;
    } else {
      inRange = actualEpsilon < 0.01;
    }
    scenarios.push({
      label,
      visits,
      expectedEpsilonRange:
        label === 'fresh'
          ? '> 0.99'
          : label === 'moderate'
            ? '(0.3, 0.9)'
            : '< 0.01',
      actualEpsilon,
      empiricalExploreRate,
      matchesSpec: inRange
    });
  };

  runScenario(0, null, null, 'fresh');
  runScenario(100000, null, null, 'moderate');
  runScenario(1000000, null, null, 'heavy');

  const pass = scenarios.every((x) => x.matchesSpec);
  return {
    name: 'exploration_decay',
    pass,
    scenarios,
    note:
      'Spec expects high ε at visits=0; this agent uses min-visits fallback (ε=0) before ε-decay path — scenario "fresh" often fails by design.'
  };
}

function testExploitation() {
  const agent = new QLearningTradingAgent();
  const s = 5;
  const targetA = 3;
  for (let a = 0; a < agent.nActions; a++) {
    agent.Q[s * agent.nActions + a] = 0;
  }
  agent.Q[s * agent.nActions + targetA] = 99;
  agent.visitCounts[s] = MIN_VISITS_FOR_EXPLOIT + 5;

  let action3Count = 0;
  let otherCount = 0;
  for (let i = 0; i < 100; i++) {
    const r = agent.selectAction(s, true);
    if (r.actionIdx === targetA) action3Count++;
    else otherCount++;
  }
  return {
    name: 'exploitation',
    pass: otherCount === 0,
    expectedAction: targetA,
    results: { action3Count, otherCount }
  };
}

function testMinVisitsFallback() {
  const agent = new QLearningTradingAgent();
  const s = 7;
  agent.visitCounts[s] = 0;
  const rExploit = agent.selectAction(s, true);
  const rExplore = agent.selectAction(s, false);

  const fallbackImplemented = true;
  let behavior;
  if (!rExploit.fallback && rExploit.actionIdx !== DEFAULT_ACTION_IDX) {
    behavior =
      'forceExploit=true skips min-visits guard; returns argmax Q (not DEFAULT_ACTION_IDX). forceExploit=false with visits<MIN uses fallback default action.';
  } else {
    behavior = 'see exploit/fallback flags on rExploit / rExplore';
  }

  const pass =
    rExplore.fallback === true &&
    rExplore.actionIdx === DEFAULT_ACTION_IDX &&
    rExplore.epsilon === 0;

  return {
    name: 'min_visits_fallback',
    pass,
    fallbackImplemented,
    behavior,
    forceExploitResult: {
      actionIdx: rExploit.actionIdx,
      fallback: rExploit.fallback,
      explored: rExploit.explored
    },
    exploreModeResult: {
      actionIdx: rExplore.actionIdx,
      fallback: rExplore.fallback,
      explored: rExplore.explored
    }
  };
}

function testRewardSigns() {
  const cases = [
    {
      label: 'A',
      inputs: { portfolioReturn: 0.05, benchmarkReturn: 0.02, vol: 0.12, maxDD: -0.03 },
      expectedSign: 'positive'
    },
    {
      label: 'B',
      inputs: { portfolioReturn: -0.03, benchmarkReturn: 0.02, vol: 0.12, maxDD: -0.05 },
      expectedSign: 'negative'
    },
    {
      label: 'C',
      inputs: { portfolioReturn: 0.03, benchmarkReturn: 0.03, vol: 0.15, maxDD: -0.05 },
      expectedSign: 'nearZero'
    },
    {
      label: 'D',
      inputs: { portfolioReturn: 0.05, benchmarkReturn: 0.02, vol: 0.12, maxDD: -0.05 },
      expectedSign: 'positive',
      storeAs: 'r1'
    },
    {
      label: 'E',
      inputs: { portfolioReturn: 0.05, benchmarkReturn: 0.02, vol: 0.12, maxDD: -0.2 },
      expectedSign: 'r2_lt_r1',
      storeAs: 'r2',
      compareLessThan: 'r1'
    },
    {
      label: 'F',
      inputs: { portfolioReturn: 0.05, benchmarkReturn: 0.02, vol: 0.08, maxDD: -0.03 },
      expectedSign: 'positive',
      storeAs: 'r3'
    },
    {
      label: 'G',
      inputs: { portfolioReturn: 0.05, benchmarkReturn: 0.02, vol: 0.25, maxDD: -0.03 },
      expectedSign: 'positive',
      storeAs: 'r4',
      compareLessThan: 'r3'
    }
  ];

  const stored = {};
  const out = [];
  let pass = true;

  for (const c of cases) {
    const { portfolioReturn, benchmarkReturn, vol, maxDD } = c.inputs;
    const reward = computeReward(portfolioReturn, benchmarkReturn, vol, maxDD);
    let correct = false;
    if (c.expectedSign === 'positive') correct = reward > 0;
    else if (c.expectedSign === 'negative') correct = reward < 0;
    else if (c.expectedSign === 'nearZero') correct = Math.abs(reward) < 0.3;
    else if (c.expectedSign === 'r2_lt_r1') correct = true;
    else correct = Math.abs(reward) < 0.3;

    if (c.storeAs) stored[c.storeAs] = reward;
    if (c.compareLessThan) {
      const other = stored[c.compareLessThan];
      if (other == null || !(reward < other)) correct = false;
    }

    if (!correct) pass = false;
    out.push({
      label: c.label,
      inputs: c.inputs,
      reward,
      expectedSign: c.expectedSign,
      correct
    });
  }

  return { name: 'reward_signs', pass, cases: out };
}

function testSerialization() {
  const agent = new QLearningTradingAgent({ alpha: 0.02, rho: 0.95 });
  for (let i = 0; i < 100; i++) {
    const s = Math.floor(Math.random() * agent.nStates);
    const a = Math.floor(Math.random() * agent.nActions);
    const r = (Math.random() - 0.5) * 0.2;
    const s2 = Math.floor(Math.random() * agent.nStates);
    agent.update(s, a, r, s2);
  }

  const before = QLearningTradingAgent.deserialize(agent.serialize());
  let qMatch = true;
  for (let i = 0; i < agent.Q.length; i++) {
    if (Math.abs(agent.Q[i] - before.Q[i]) > 1e-10) {
      qMatch = false;
      break;
    }
  }
  let visitsMatch = true;
  for (let i = 0; i < agent.visitCounts.length; i++) {
    if (agent.visitCounts[i] !== before.visitCounts[i]) {
      visitsMatch = false;
      break;
    }
  }
  const updatesMatch = agent.totalUpdates === before.totalUpdates;

  const mismatchedStates = [];
  let policyMatch = true;
  for (let k = 0; k < 10; k++) {
    const s = Math.floor(Math.random() * agent.nStates);
    before.visitCounts[s] = Math.max(before.visitCounts[s], MIN_VISITS_FOR_EXPLOIT + 1);
    agent.visitCounts[s] = Math.max(agent.visitCounts[s], MIN_VISITS_FOR_EXPLOIT + 1);
    const a1 = agent.selectAction(s, true).actionIdx;
    const a2 = before.selectAction(s, true).actionIdx;
    if (a1 !== a2) {
      policyMatch = false;
      mismatchedStates.push({ s, a1, a2 });
    }
  }

  return {
    name: 'serialization',
    pass: qMatch && visitsMatch && updatesMatch && policyMatch,
    qMatch,
    visitsMatch,
    updatesMatch,
    policyMatch,
    mismatchedStates
  };
}

function testStateSpace() {
  let rangeValid = true;
  const seen = new Set();
  let invalidDecodes = 0;

  for (let idx = 0; idx < TOTAL_STATES; idx++) {
    if (encodeState(decodedBinsToEncodeFeatures(decodeState(idx))) !== idx) rangeValid = false;
    const d = decodeState(idx);
    if (
      d.regimeBucket < 0 ||
      d.regimeBucket >= N_REGIME ||
      d.alphaBin < 0 ||
      d.alphaBin >= N_ALPHA ||
      d.breadthBin < 0 ||
      d.breadthBin >= N_BREADTH ||
      d.volBin < 0 ||
      d.volBin >= N_VOL ||
      d.signalBin < 0 ||
      d.signalBin >= N_SIGNAL
    ) {
      invalidDecodes++;
    }
    seen.add(idx);
  }

  const encSet = new Set();
  let collisions = 0;
  for (let i = 0; i < 500; i++) {
    const f = {
      regimeBucket: Math.floor(Math.random() * N_REGIME),
      recentAlpha: (Math.random() - 0.5) * 0.2,
      breadthRatio: Math.random(),
      realizedVol: 0.05 + Math.random() * 0.35,
      avgTopScore: 40 + Math.random() * 50
    };
    const e = encodeState(f);
    if (e < 0 || e >= TOTAL_STATES) rangeValid = false;
    if (encSet.has(e)) collisions++;
    encSet.add(e);
  }

  return {
    name: 'state_space',
    pass: rangeValid && invalidDecodes === 0 && seen.size === TOTAL_STATES,
    totalStates: TOTAL_STATES,
    rangeValid,
    collisions,
    invalidDecodes,
    note: 'collisions counts duplicate encodes among 500 random samples (not full Cartesian product).'
  };
}

function testActionSpace() {
  const invalidActions = [];
  for (let a = 0; a < TOTAL_ACTIONS; a++) {
    const d = decodeAction(a);
    if (!ACTION_SPACE.exposure.levels.includes(d.exposure)) invalidActions.push({ a, field: 'exposure', v: d.exposure });
    if (!ACTION_SPACE.positionCount.levels.includes(d.positionCount)) {
      invalidActions.push({ a, field: 'positionCount', v: d.positionCount });
    }
    if (!ACTION_SPACE.sizingMethod.levels.includes(d.sizingMethod)) {
      invalidActions.push({ a, field: 'sizingMethod', v: d.sizingMethod });
    }
  }
  return {
    name: 'action_space',
    pass: invalidActions.length === 0,
    totalActions: TOTAL_ACTIONS,
    invalidActions: invalidActions.slice(0, 20)
  };
}

function testLearningDirection() {
  const agent = new QLearningTradingAgent({ alpha: 0.15, rho: 0.9 });
  for (let ep = 0; ep < 200; ep++) {
    agent.update(0, 0, 1.0, 0);
    agent.update(0, 1, -1.0, 0);
  }
  const q00 = agent.getQ(0, 0);
  const q01 = agent.getQ(0, 1);

  for (let ep = 0; ep < 200; ep++) {
    agent.update(1, 0, -1.0, 1);
    agent.update(1, 1, 1.0, 1);
  }
  const q10 = agent.getQ(1, 0);
  const q11 = agent.getQ(1, 1);

  return {
    name: 'learning_direction',
    pass: q00 > q01 && q11 > q10,
    state0: { q_action0: q00, q_action1: q01, prefersCorrect: q00 > q01 },
    state1: { q_action0: q10, q_action1: q11, prefersCorrect: q11 > q10 }
  };
}

function testOverPruningDetection() {
  const conservative = new QLearningTradingAgent();
  for (let s = 0; s < conservative.nStates; s++) {
    conservative.visitCounts[s] = 1;
    for (let a = 0; a < conservative.nActions; a++) {
      conservative.Q[s * conservative.nActions + a] = a === 0 ? 5 : 0;
    }
  }
  const consRes = detectOverPruning(conservative);

  const balanced = new QLearningTradingAgent();
  const highExpAction = encodeAction(3, 0, 0);
  for (let s = 0; s < balanced.nStates; s++) {
    balanced.visitCounts[s] = 1;
    for (let a = 0; a < balanced.nActions; a++) {
      balanced.Q[s * balanced.nActions + a] = 0;
    }
    const best = s % 2 === 0 ? highExpAction : 0;
    balanced.Q[s * balanced.nActions + best] = 10;
  }
  const balRes = detectOverPruning(balanced);

  const pass =
    consRes.overPruningLikely === true &&
    balRes.overPruningLikely === false;

  return {
    name: 'over_pruning_detection',
    pass,
    conservativeAgent: {
      flagged: consRes.overPruningLikely,
      ratio: consRes.highExposurePreferenceRatio
    },
    balancedAgent: {
      flagged: balRes.overPruningLikely,
      ratio: balRes.highExposurePreferenceRatio
    }
  };
}

function testRegimeMapping() {
  const regimes = [
    'strong_bull',
    'normal',
    'pullback',
    'correction',
    'caution',
    'bear',
    'disabled'
  ];
  const expectedBins = [0, 1, 2, 3, 3, 4, 1];
  const mappings = [];
  let pass = true;

  for (let i = 0; i < regimes.length; i++) {
    const regime = regimes[i];
    const bin = regimeStringToBucket(regime);
    const okBin = bin === expectedBins[i];
    let stateIdx;
    let valid = false;
    try {
      stateIdx = encodeState({
        regimeBucket: bin,
        recentAlpha: 0,
        breadthRatio: 0.5,
        realizedVol: 0.15,
        avgTopScore: 60
      });
      valid = Number.isInteger(stateIdx) && stateIdx >= 0 && stateIdx < TOTAL_STATES;
    } catch {
      valid = false;
    }
    if (!okBin || !valid) pass = false;
    mappings.push({
      regime,
      bin,
      expectedBin: expectedBins[i],
      stateIdx,
      valid: okBin && valid
    });
  }

  return { name: 'regime_mapping', pass, mappings };
}

async function testIntegrationSmoke() {
  return {
    name: 'integration_smoke',
    pass: false,
    skipped: true,
    reason:
      'runBacktestSimulation is not exported from server.js; importing server.js would execute the Express app. Wire a thin export or call GET /api/rl/compare manually when the server is running.',
    rulesBased: null,
    rlRandom: null,
    resultsAreDifferent: null,
    rlIsWorse: null
  };
}

/**
 * @param {{ writeFile?: boolean, print?: boolean }} [options]
 * @returns {Promise<object>} Full JSON report object
 */
export async function runRlTestHarness(options = {}) {
  const { writeFile: doWrite = true, print: doPrint = true } = options;
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const timestamp = new Date().toISOString();

  const specs = [
    { name: 'state_roundtrip', run: testStateRoundtrip },
    { name: 'action_roundtrip', run: testActionRoundtrip },
    { name: 'q_convergence', run: testQConvergence },
    { name: 'q_clipping', run: testQClipping },
    { name: 'exploration_decay', run: testExplorationDecay },
    { name: 'exploitation', run: testExploitation },
    { name: 'min_visits_fallback', run: testMinVisitsFallback },
    { name: 'reward_signs', run: testRewardSigns },
    { name: 'serialization', run: testSerialization },
    { name: 'state_space', run: testStateSpace },
    { name: 'action_space', run: testActionSpace },
    { name: 'learning_direction', run: testLearningDirection },
    { name: 'over_pruning_detection', run: testOverPruningDetection },
    { name: 'regime_mapping', run: testRegimeMapping },
    { name: 'integration_smoke', run: testIntegrationSmoke }
  ];

  const tests = [];
  for (const { name, run } of specs) {
    tests.push(await runTest(name, () => run()));
  }

  const passed = tests.filter((t) => t.pass && !t.skipped).length;
  const skipped = tests.filter((t) => t.skipped).length;
  const failedTests = tests.filter((t) => !t.pass && !t.skipped).map((t) => t.name);
  const failed = failedTests.length;
  const allPassed = failed === 0;

  const report = {
    harness: 'rl-test-harness',
    timestamp,
    agent_config: {
      TOTAL_STATES,
      TOTAL_ACTIONS,
      state_features: STATE_FEATURES,
      regime_bucket_map: REGIME_BUCKET_MAP,
      action_space: ACTION_SPACE,
      default_hyperparameters: { alpha: 0.015, beta: 5e-6, rho: 0.9 },
      imports: {
        rewardFn: 'computeRlReward (aliased as computeReward in harness)',
        note: 'STATE_FEATURES is synthesized here from bin exports; not a separate module export.'
      }
    },
    tests,
    summary: {
      total: tests.length,
      passed,
      failed,
      skipped,
      all_passed: allPassed,
      failed_tests: failedTests
    }
  };

  const json = JSON.stringify(report, null, 2);
  if (doPrint) console.log(json);
  if (doWrite) writeFileSync(path.join(__dirname, 'rl-test-report.json'), json, 'utf8');
  return report;
}

const isCliMain = path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);

if (isCliMain) {
  runRlTestHarness({ writeFile: true, print: true }).catch((e) => {
    const errReport = {
      harness: 'rl-test-harness',
      timestamp: new Date().toISOString(),
      fatal: e?.message || String(e),
      tests: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0, all_passed: false, failed_tests: [] }
    };
    console.log(JSON.stringify(errReport, null, 2));
    process.exit(1);
  });
}
