#!/usr/bin/env node
// Boots the real server.js on a scratch port, hits its own production
// endpoints (live composite scan + dashboard summary — same code path the
// UI uses), and writes public/data/scores-snapshot.json. Run on a schedule
// by .github/workflows/scheduled-pipeline.yml; api/scores.js serves the
// resulting file as a public API without needing a live server on Vercel.
//
//   node scripts/generate-scores-snapshot.mjs [--universe sp500_top50] [--top 15]

import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshotPayload } from './lib/build-snapshot.mjs';

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
  } finally {
    shutdown();
  }
}

main().catch((e) => {
  console.error('Snapshot generation failed:', e);
  process.exit(1);
});
