#!/usr/bin/env node
/**
 * Train tabular Q-learning agent for sp500_top50 and sp500_top150 (sequential).
 * Requires a running API: npm run server (or dev:all). Override episodes via EPISODES=500.
 */
const BASE = process.env.API_BASE || 'http://127.0.0.1:3001';
const episodes = Math.max(1, parseInt(process.env.EPISODES || '500', 10) || 500);
const skipPost = process.env.SKIP_POST_EVAL !== '0';

async function train(universeId) {
  const res = await fetch(`${BASE}/api/rl/train`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      universeId,
      period: '3y',
      rebalanceFreq: 'bimonthly',
      strategy: 'full_composite',
      agentType: 'qlearning',
      adaptiveMode: 'adaptive',
      episodes,
      skipPostTrainEval: skipPost,
      rlTrainSkipEarningsFetch: false
    })
  });
  const text = await res.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    console.error(universeId, res.status, text.slice(0, 500));
    return;
  }
  console.log(universeId, res.status, j.success === false ? j.error : 'ok', j.agentType || '');
}

await train('sp500_top50');
await train('sp500_top150');
