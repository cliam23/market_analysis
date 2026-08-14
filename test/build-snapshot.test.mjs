import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshotPayload } from '../scripts/lib/build-snapshot.mjs';

const fixtureScan = {
  universeId: 'sp500_top50',
  summary: { totalAssets: 2, avgMomentum: '10.0', percentUptrend: '50', medianVolatility: '0.2', avgStrategyScore: 70 },
  results: [
    { rank: 1, ticker: 'AAA', name: 'Alpha Corp', sector: 'Technology', currentPrice: 100, strategyScore: 80, strategyGrade: 'A' },
    { rank: 2, ticker: 'BBB', name: 'Beta Inc', sector: 'Healthcare', currentPrice: 50, strategyScore: 60, strategyGrade: 'B' }
  ]
};

const fixtureSummary = {
  regime: 'normal',
  rl: { agentType: 'qlearning', mainAgentReady: true, agents: {} },
  systemStatus: { lines: ['Q-learning active'], lastRebalance: '2026-06-01', nextRebalance: '2026-07-01', adaptiveWeights: null }
};

test('buildSnapshotPayload maps scan results into ranked topScores', () => {
  const snapshot = buildSnapshotPayload(fixtureScan, fixtureSummary, { universeId: 'sp500_top50', topN: 15 });

  assert.equal(snapshot.universeId, 'sp500_top50');
  assert.equal(snapshot.regime, 'normal');
  assert.equal(snapshot.topScores.length, 2);
  assert.deepEqual(snapshot.topScores[0], {
    rank: 1,
    ticker: 'AAA',
    name: 'Alpha Corp',
    sector: 'Technology',
    price: 100,
    compositeScore: 80,
    grade: 'A'
  });
  assert.ok(new Date(snapshot.generatedAt).toString() !== 'Invalid Date');
});

test('buildSnapshotPayload truncates to topN', () => {
  const scan = {
    ...fixtureScan,
    results: Array.from({ length: 20 }, (_, i) => ({
      rank: i + 1,
      ticker: `T${i}`,
      name: `Ticker ${i}`,
      sector: 'Technology',
      currentPrice: 10,
      strategyScore: 100 - i,
      strategyGrade: 'A'
    }))
  };
  const snapshot = buildSnapshotPayload(scan, fixtureSummary, { topN: 5 });
  assert.equal(snapshot.topScores.length, 5);
  assert.equal(snapshot.topScores[4].ticker, 'T4');
});

test('buildSnapshotPayload throws without scan results', () => {
  assert.throws(() => buildSnapshotPayload({}, fixtureSummary, {}), /scan\.results missing/);
});

test('buildSnapshotPayload throws without summary', () => {
  assert.throws(() => buildSnapshotPayload(fixtureScan, null, {}), /summary missing/);
});
