#!/usr/bin/env node
/**
 * Writes data/local-snapshots/{market-indices,dashboard-summary}.json
 * by calling a running API (same shape the server expects for LOCAL_UI_SNAPSHOTS).
 *
 *   BACKTEST_GOLDEN_BASE=http://127.0.0.1:3001 node scripts/snapshot-ui.mjs
 */
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LOCAL_UI_SNAPSHOTS_DIR } from '../server/config/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const base = (process.env.BACKTEST_GOLDEN_BASE || process.env.API_BASE || 'http://127.0.0.1:3001').replace(
  /\/$/,
  ''
);

async function fetchJson(pathname) {
  const url = `${base}${pathname}`;
  const res = await fetch(url);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${data.error || ''}`);
  return data;
}

function wrapSnapshot(data) {
  return JSON.stringify(
    {
      _snapshotTs: Date.now(),
      _snapshotData: data
    },
    null,
    2
  );
}

async function main() {
  mkdirSync(LOCAL_UI_SNAPSHOTS_DIR, { recursive: true });
  const indices = await fetchJson('/api/market/indices');
  const summary = await fetchJson('/api/dashboard/summary');
  writeFileSync(path.join(LOCAL_UI_SNAPSHOTS_DIR, 'market-indices.json'), wrapSnapshot(indices), 'utf-8');
  writeFileSync(path.join(LOCAL_UI_SNAPSHOTS_DIR, 'dashboard-summary.json'), wrapSnapshot(summary), 'utf-8');
  console.log('Wrote', path.join(LOCAL_UI_SNAPSHOTS_DIR, 'market-indices.json'));
  console.log('Wrote', path.join(LOCAL_UI_SNAPSHOTS_DIR, 'dashboard-summary.json'));
  console.log('Start server with LOCAL_UI_SNAPSHOTS=1 to serve these until stale (see LOCAL_UI_SNAPSHOT_MAX_AGE_MS).');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
