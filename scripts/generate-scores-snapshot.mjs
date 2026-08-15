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
import { backtestMirrorConfigs, backtestMirrorFilename, backtestMirrorQuery } from './lib/backtest-mirror.mjs';
import { UNIVERSE_TICKERS } from '../server/config/universes.js';
import { analysisMirrorFilename, dcfMirrorFilename, compsMirrorFilename } from './lib/analysis-mirror.mjs';
import {
  DIAG_MIRROR_UNIVERSES,
  DIAG_MIRROR_PERIOD,
  RL_COMPARE_PARAMS,
  factorsFilename,
  hedgeImpactFilename,
  equityCurvesFilename,
  forwardConfidenceFilename,
  rlCompareFilename,
  rlPolicyFilename,
  PAPER_TRADE_PREVIEW_FILENAME,
  UNIVERSE_COMPARE_FILENAME
} from './lib/diagnostics-mirror.mjs';

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
    await mirrorBacktests(base, outDir);
    await mirrorAnalysis(base, outDir);
    await mirrorDiagnostics(base, outDir);
    await mirrorTickerExtras(base, outDir);
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

  const jobs = [
    ['dashboard-summary.json', `${base}/api/dashboard/summary`],
    ['market-indices.json', `${base}/api/market/indices`],
    ...MIRRORED_UNIVERSES.map((u) => [`paper-trade-portfolio-${u}.json`, `${base}/api/paper-trade/portfolio?universe=${u}`]),
    ...MIRRORED_UNIVERSES.map((u) => [`paper-trade-history-${u}.json`, `${base}/api/paper-trade/history?universe=${u}`]),
    ...MIRRORED_UNIVERSES.map((u) => [`rl-status-${u}.json`, `${base}/api/rl/status?universe=${u}`])
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

// Runs the fixed matrix of full interactive backtests (see
// scripts/lib/backtest-mirror.mjs) sequentially — not in parallel, to stay
// polite to Yahoo's rate limits on a transient boot with a cold cache.
// Slow (8 full runs over years of data across 50-150 tickers); expect this
// step alone to take a while.
async function mirrorBacktests(base, outDir) {
  const mirrorDir = path.join(outDir, 'mirror');
  await mkdir(mirrorDir, { recursive: true });

  const configs = backtestMirrorConfigs();
  for (const [i, config] of configs.entries()) {
    const query = backtestMirrorQuery(config);
    const url = `${base}/api/backtest/${config.universeId}?${query.toString()}`;
    const label = `[${i + 1}/${configs.length}] ${config.universeId} ${config.period} rl${config.rlAgent ? 'on' : 'off'}`;
    console.log(`${label}: fetching…`);
    const start = Date.now();
    const data = await fetchJsonOrNull(url);
    if (data == null) {
      console.warn(`${label}: failed, skipping`);
      continue;
    }
    const filename = backtestMirrorFilename(config);
    const wrapped = { _snapshotTs: Date.now(), _snapshotData: data };
    await writeFile(path.join(mirrorDir, filename), JSON.stringify(wrapped, null, 2));
    console.log(`${label}: wrote ${filename} (${Math.round((Date.now() - start) / 1000)}s)`);
  }
}

// Mirrors GET /api/analysis/:ticker for every ticker in sp500_top150 (a
// superset of sp500_top50), so Search actually works for real tickers
// instead of just showing "not available" — see
// scripts/lib/analysis-mirror.mjs. ~150 sequential requests; server.js's
// own Yahoo cache (warmed by the earlier scan/backtest steps) keeps most
// of these fast, but this step still takes a few minutes.
async function mirrorAnalysis(base, outDir) {
  const mirrorDir = path.join(outDir, 'mirror');
  await mkdir(mirrorDir, { recursive: true });

  const tickers = UNIVERSE_TICKERS.sp500_top150 || [];
  let ok = 0;
  for (const [i, ticker] of tickers.entries()) {
    const data = await fetchJsonOrNull(`${base}/api/analysis/${ticker}`);
    if (data == null) {
      console.warn(`[analysis ${i + 1}/${tickers.length}] ${ticker}: failed, skipping`);
      continue;
    }
    const wrapped = { _snapshotTs: Date.now(), _snapshotData: data };
    await writeFile(path.join(mirrorDir, analysisMirrorFilename(ticker)), JSON.stringify(wrapped, null, 2));
    ok++;
    await sleep(120);
  }
  console.log(`Mirrored analysis for ${ok}/${tickers.length} tickers`);
}

async function fetchJsonPostOrNull(url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      console.warn(`mirror: POST ${url} -> ${res.status}, skipping`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn(`mirror: POST ${url} failed (${e.message}), skipping`);
    return null;
  }
}

async function writeMirrorFile(mirrorDir, filename, data) {
  const wrapped = { _snapshotTs: Date.now(), _snapshotData: data };
  await writeFile(path.join(mirrorDir, filename), JSON.stringify(wrapped, null, 2));
  console.log(`Wrote ${filename}`);
}

// Mirrors the "moderate cost" Alpha Lab / RL Agent diagnostics — see
// scripts/lib/diagnostics-mirror.mjs for exactly which combo of each
// matches the real components' defaults. Each of these is roughly one
// backtest-equivalent of compute (some run two internally), so this step
// takes several minutes; forward-weight-recommendation and weight-sweep
// are deliberately excluded (multi-hour, not mirrored).
async function mirrorDiagnostics(base, outDir) {
  const mirrorDir = path.join(outDir, 'mirror');
  await mkdir(mirrorDir, { recursive: true });

  console.log('[diagnostics] universe-compare: fetching (can take several minutes)…');
  const uc = await fetchJsonOrNull(`${base}/api/diagnostics/universe-compare`);
  if (uc != null) await writeMirrorFile(mirrorDir, UNIVERSE_COMPARE_FILENAME, uc);

  const paperTradePreview = await fetchJsonOrNull(`${base}/api/paper-trade/preview`);
  if (paperTradePreview != null) await writeMirrorFile(mirrorDir, PAPER_TRADE_PREVIEW_FILENAME, paperTradePreview);

  for (const universeId of DIAG_MIRROR_UNIVERSES) {
    console.log(`[diagnostics] ${universeId}: factors…`);
    const factors = await fetchJsonOrNull(
      `${base}/api/diagnostics/factors/${universeId}?period=${DIAG_MIRROR_PERIOD}&subperiods=true`
    );
    if (factors != null) await writeMirrorFile(mirrorDir, factorsFilename(universeId), factors);

    console.log(`[diagnostics] ${universeId}: hedge-impact…`);
    const hedge = await fetchJsonOrNull(
      `${base}/api/diagnostics/hedge-impact?universeId=${universeId}&period=${DIAG_MIRROR_PERIOD}`
    );
    if (hedge != null) await writeMirrorFile(mirrorDir, hedgeImpactFilename(universeId), hedge);

    console.log(`[diagnostics] ${universeId}: equity-curves…`);
    const curves = await fetchJsonOrNull(
      `${base}/api/diagnostics/equity-curves/${universeId}?period=${DIAG_MIRROR_PERIOD}&fresh=true`
    );
    if (curves != null) await writeMirrorFile(mirrorDir, equityCurvesFilename(universeId), curves);

    console.log(`[diagnostics] ${universeId}: rl/compare…`);
    const compareParams = new URLSearchParams({ universeId, ...RL_COMPARE_PARAMS, fresh: 'true' });
    const compare = await fetchJsonOrNull(`${base}/api/rl/compare?${compareParams}`);
    if (compare != null) await writeMirrorFile(mirrorDir, rlCompareFilename(universeId), compare);

    console.log(`[diagnostics] ${universeId}: rl/policy…`);
    const policy = await fetchJsonOrNull(`${base}/api/rl/policy?universeId=${universeId}`);
    if (policy != null) await writeMirrorFile(mirrorDir, rlPolicyFilename(universeId), policy);

    console.log(`[diagnostics] ${universeId}: forward-confidence (using the portfolio's real weights)…`);
    const portfolioRes = await fetchJsonOrNull(`${base}/api/paper-trade/portfolio?universe=${universeId}`);
    const weights = portfolioRes?.portfolio?.config?.weights;
    if (weights) {
      const fc = await fetchJsonPostOrNull(`${base}/api/diagnostics/forward-confidence`, {
        universeId,
        period: DIAG_MIRROR_PERIOD,
        weights,
        topN: 15
      });
      if (fc != null) await writeMirrorFile(mirrorDir, forwardConfidenceFilename(universeId), fc);
    } else {
      console.warn(`[diagnostics] ${universeId}: no portfolio weights available, skipping forward-confidence`);
    }
  }
}

// Mirrors GET /api/dcf/:ticker and /api/comps/:ticker for the same
// sp500_top150 ticker set as mirrorAnalysis — completes the Search
// experience (Overview/DCF/Comps sub-tabs) for every mirrored ticker.
async function mirrorTickerExtras(base, outDir) {
  const mirrorDir = path.join(outDir, 'mirror');
  await mkdir(mirrorDir, { recursive: true });

  const tickers = UNIVERSE_TICKERS.sp500_top150 || [];
  let dcfOk = 0;
  let compsOk = 0;
  for (const [i, ticker] of tickers.entries()) {
    const dcf = await fetchJsonOrNull(`${base}/api/dcf/${ticker}`);
    if (dcf != null) {
      await writeFile(
        path.join(mirrorDir, dcfMirrorFilename(ticker)),
        JSON.stringify({ _snapshotTs: Date.now(), _snapshotData: dcf }, null, 2)
      );
      dcfOk++;
    }
    const comps = await fetchJsonOrNull(`${base}/api/comps/${ticker}`);
    if (comps != null) {
      await writeFile(
        path.join(mirrorDir, compsMirrorFilename(ticker)),
        JSON.stringify({ _snapshotTs: Date.now(), _snapshotData: comps }, null, 2)
      );
      compsOk++;
    }
    if ((i + 1) % 25 === 0) console.log(`[dcf+comps] ${i + 1}/${tickers.length} tickers processed`);
    await sleep(120);
  }
  console.log(`Mirrored DCF for ${dcfOk}/${tickers.length}, Comps for ${compsOk}/${tickers.length} tickers`);
}

main().catch((e) => {
  console.error('Snapshot generation failed:', e);
  process.exit(1);
});
