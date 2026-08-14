import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  backtestMirrorConfigs,
  backtestMirrorFilename,
  backtestMirrorQuery,
  matchBacktestMirrorConfig
} from '../scripts/lib/backtest-mirror.mjs';

test('backtestMirrorConfigs produces the full 2x2x2 matrix', () => {
  const configs = backtestMirrorConfigs();
  assert.equal(configs.length, 8);
  const universes = new Set(configs.map((c) => c.universeId));
  const periods = new Set(configs.map((c) => c.period));
  assert.deepEqual([...universes].sort(), ['sp500_top150', 'sp500_top50']);
  assert.deepEqual([...periods].sort(), ['3y', '5y']);
  assert.ok(configs.every((c) => c.strategy === 'full_composite'));
  assert.ok(configs.every((c) => c.rebalanceFreq === 'quarterly'));
});

test('matchBacktestMirrorConfig matches a request shaped like buildBacktestQuery for a mirrored combo', () => {
  const query = Object.fromEntries(
    backtestMirrorQuery({ period: '3y', rebalanceFreq: 'quarterly', topN: '15', strategy: 'full_composite', rlAgent: true })
  );
  const match = matchBacktestMirrorConfig('sp500_top50', query);
  assert.ok(match);
  assert.equal(match.rlAgent, true);
  assert.equal(backtestMirrorFilename(match), 'backtest-sp500_top50-3y-rlon.json');
});

test('matchBacktestMirrorConfig rejects a period outside the matrix', () => {
  const query = Object.fromEntries(
    backtestMirrorQuery({ period: '1y', rebalanceFreq: 'quarterly', topN: '15', strategy: 'full_composite', rlAgent: true })
  );
  assert.equal(matchBacktestMirrorConfig('sp500_top50', query), null);
});

test('matchBacktestMirrorConfig rejects a non-mirrored universe', () => {
  const query = Object.fromEntries(
    backtestMirrorQuery({ period: '3y', rebalanceFreq: 'quarterly', topN: '15', strategy: 'full_composite', rlAgent: true })
  );
  assert.equal(matchBacktestMirrorConfig('mag7', query), null);
});

test('matchBacktestMirrorConfig rejects a strategy outside the matrix', () => {
  const query = Object.fromEntries(
    backtestMirrorQuery({ period: '3y', rebalanceFreq: 'quarterly', topN: '15', strategy: 'full_composite_quality', rlAgent: true })
  );
  assert.equal(matchBacktestMirrorConfig('sp500_top50', query), null);
});

test('matchBacktestMirrorConfig rejects when Advanced settings were changed from defaults', () => {
  const query = Object.fromEntries(
    backtestMirrorQuery({ period: '3y', rebalanceFreq: 'quarterly', topN: '15', strategy: 'full_composite', rlAgent: true })
  );
  query.positionSizing = 'equal';
  assert.equal(matchBacktestMirrorConfig('sp500_top50', query), null);
});

test('matchBacktestMirrorConfig ignores cache-busting params', () => {
  const query = Object.fromEntries(
    backtestMirrorQuery({ period: '5y', rebalanceFreq: 'quarterly', topN: '15', strategy: 'full_composite', rlAgent: false })
  );
  query._t = String(Date.now());
  const match = matchBacktestMirrorConfig('sp500_top150', query);
  assert.ok(match);
  assert.equal(match.rlAgent, false);
});
