import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeState,
  decodeState,
  encodeAction,
  decodeAction,
  regimeStringToBucket,
  TOTAL_STATES,
  TOTAL_ACTIONS
} from '../q-learning-agent.js';

test('regimeStringToBucket covers all known regimes', () => {
  for (const regime of ['strong_bull', 'normal', 'pullback', 'caution', 'bear']) {
    const bucket = regimeStringToBucket(regime);
    assert.ok(Number.isInteger(bucket) && bucket >= 0 && bucket < 5, `${regime} -> ${bucket}`);
  }
});

test('encodeState / decodeState round-trip stays within TOTAL_STATES', () => {
  const stateIdx = encodeState({
    regimeBucket: regimeStringToBucket('strong_bull'),
    recentAlpha: 0.03,
    breadthRatio: 0.6,
    realizedVol: 0.18,
    avgTopScore: 88
  });
  assert.ok(stateIdx >= 0 && stateIdx < TOTAL_STATES);

  const decoded = decodeState(stateIdx);
  assert.equal(decoded.regimeBucket, regimeStringToBucket('strong_bull'));
});

test('encodeAction / decodeAction round-trip', () => {
  const actionIdx = encodeAction(2, 1, 0);
  assert.ok(actionIdx >= 0 && actionIdx < TOTAL_ACTIONS);

  const decoded = decodeAction(actionIdx);
  assert.equal(decoded.exposureIdx, 2);
  assert.equal(decoded.posCountIdx, 1);
  assert.equal(decoded.sizingIdx, 0);
  assert.ok(decoded.exposure > 0 && decoded.exposure <= 1);
  assert.ok(decoded.positionCount > 0);
  assert.ok(['equal', 'invVol', 'score'].includes(decoded.sizingMethod));
});
