#!/usr/bin/env node
// Boots the real server.js on a scratch port, hits its own production
// endpoints (live composite scan + dashboard summary — same code path the
// UI uses), and writes public/data/scores-snapshot.json plus a read-only
// mirror of a handful of other GET routes (public/data/mirror/*.json) that
// the api/ Vercel functions replay verbatim. This is a static copy of what
// the app looked like at generation time, not a live backend — POST/PATCH
// routes (rebalance, create portfolio, RL training, …) still need
// server.js running somewhere. Run on a schedule by
// .github/workflows/scheduled-pipeline.yml.
//
//   node scripts/generate-scores-snapshot.mjs [--universe sp500_top50] [--top 15]

import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshotPayload, MIRRORED_UNIVERSES } from './lib/build-snapshot.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');

function parseArgs() {
  const a = process.argv.slice(2);
  let universe = 'sp500_top50';
  let topN = 15;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--universe' && a[i + 1]) universe = a[++i];
    else if (a[i] === '--top' && a[i + 1]) topN = parseInt(a[++i], 10) || 15;
  }
  return { universe, topN };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(base, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await sleep(500);
  }
  throw new Error(`server did not become healthy within ${timeoutMs}ms`);
}

async function main() {
  const { universe, topN } = parseArgs();
  const port = process.env.SNAPSHOT_SERVER_PORT || '3099';
  const base = `http://localhost:${port}`;

  const server = spawn(process.execPath, ['server.js'], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: port, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', (d) => process.stderr.write(d));

  const shutdown = () => {
    if (!server.killed) server.kill('SIGTERM');
  };
  process.on('exit', shutdown);

  try {
    await waitForHealth(base);

    const [scanRes, summaryRes, rlStatusRes] = await Promise.all([
      fetch(`${base}/api/scan/${universe}?strategy=full_composite&fresh=true`),
      fetch(`${base}/api/dashboard/summary`),
      fetch(`${base}/api/rl/status?universe=${universe}`)
    ]);
    if (!scanRes.ok) throw new Error(`GET /api/scan/${universe} -> ${scanRes.status}`);
    if (!summaryRes.ok) throw new Error(`GET /api/dashboard/summary -> ${summaryRes.status}`);
    if (!rlStatusRes.ok) throw new Error(`GET /api/rl/status -> ${rlStatusRes.status}`);

    const scan = await scanRes.json();
    const summary = await summaryRes.json();
    const rlStatus = await rlStatusRes.json();
    const snapshot = buildSnapshotPayload(scan, summary, { universeId: universe, topN, rlStatus });

    const outDir = path.join(REPO_ROOT, 'public/data');
    await mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, 'scores-snapshot.json');
    await writeFile(outPath, JSON.stringify(snapshot, null, 2));

    console.log(
      `Wrote ${outPath}: ${snapshot.topScores.length} tickers, regime=${snapshot.regime}, generatedAt=${snapshot.generatedAt}`
    );

    await mirrorEndpoints(base, outDir);
  } finally {
    shutdown();
  }
}

async function fetchJsonOrNull(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`mirror: ${url} -> ${res.status}, skipping`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn(`mirror: ${url} failed (${e.message}), skipping`);
    return null;
  }
}

// Captures a handful of read-only GET routes verbatim so the Vercel-only
// deploy's api/ functions can replay them without a live server. Mutating
// routes are intentionally not mirrored — see file header.
async function mirrorEndpoints(base, outDir) {
  const mirrorDir = path.join(outDir, 'mirror');
  await mkdir(mirrorDir, { recursive: true });

  // Fixed config for the headline backtest comparison card — deliberately
  // NOT mirrored at /api/rl/compare itself, since AlphaLabTab/RLTab call
  // that path with user-chosen periods; a static file there would silently
  // serve the wrong period's numbers. This lives at /api/backtest/compare
  // instead, a new path with no interactive counterpart to collide with.
  const compareParams = 'universeId=sp500_top50&period=1y&rebalanceFreq=bimonthly&topN=15&strategy=full_composite';

  const jobs = [
    ['dashboard-summary.json', `${base}/api/dashboard/summary`],
    ['market-indices.json', `${base}/api/market/indices`],
    ...MIRRORED_UNIVERSES.map((u) => [`paper-trade-portfolio-${u}.json`, `${base}/api/paper-trade/portfolio?universe=${u}`]),
    ...MIRRORED_UNIVERSES.map((u) => [`paper-trade-history-${u}.json`, `${base}/api/paper-trade/history?universe=${u}`]),
    ...MIRRORED_UNIVERSES.map((u) => [`rl-status-${u}.json`, `${base}/api/rl/status?universe=${u}`]),
    ['backtest-compare.json', `${base}/api/rl/compare?${compareParams}`]
  ];

  for (const [filename, url] of jobs) {
    const data = await fetchJsonOrNull(url);
    if (data == null) continue;
    // Wrapped the same way scripts/snapshot-ui.mjs wraps its local-dev
    // snapshots, so api/*.js can report a consistent mirroredAt/age.
    const wrapped = { _snapshotTs: Date.now(), _snapshotData: data };
    await writeFile(path.join(mirrorDir, filename), JSON.stringify(wrapped, null, 2));
    console.log(`Wrote ${path.join(mirrorDir, filename)}`);
  }
}

main().catch((e) => {
  console.error('Snapshot generation failed:', e);
  process.exit(1);
});
