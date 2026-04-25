/**
 * Optional disk snapshots for fast Dashboard (and tooling) — gitignored under data/local-snapshots/.
 * Env: LOCAL_UI_SNAPSHOTS=1 (read), LOCAL_UI_SNAPSHOT_WRITE=1 (write after live build), LOCAL_UI_SNAPSHOT_MAX_AGE_MS
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { LOCAL_UI_SNAPSHOTS_DIR } from '../config/paths.js';

export function localUiSnapshotsReadEnabled() {
  return process.env.LOCAL_UI_SNAPSHOTS === '1' || process.env.LOCAL_UI_SNAPSHOTS === 'true';
}

export function localUiSnapshotWriteEnabled() {
  return process.env.LOCAL_UI_SNAPSHOT_WRITE === '1' || process.env.LOCAL_UI_SNAPSHOT_WRITE === 'true';
}

export function localUiSnapshotMaxAgeMs() {
  const raw = process.env.LOCAL_UI_SNAPSHOT_MAX_AGE_MS;
  if (raw != null && String(raw).trim() !== '') {
    const n = parseInt(String(raw), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 5 * 60 * 1000; // 5 minutes default
}

function filePath(name) {
  return path.join(LOCAL_UI_SNAPSHOTS_DIR, `${name}.json`);
}

export function readLocalUiSnapshot(name) {
  if (!localUiSnapshotsReadEnabled()) return null;
  const fp = filePath(name);
  if (!existsSync(fp)) return null;
  try {
    const raw = JSON.parse(readFileSync(fp, 'utf-8'));
    if (!raw || typeof raw !== 'object') return null;
    const ts = Number(raw._snapshotTs) || 0;
    const data = raw._snapshotData;
    if (data == null) return null;
    return { ts, data };
  } catch {
    return null;
  }
}

export function writeLocalUiSnapshot(name, data) {
  if (!localUiSnapshotWriteEnabled()) return;
  try {
    mkdirSync(LOCAL_UI_SNAPSHOTS_DIR, { recursive: true });
    const payload = {
      _snapshotTs: Date.now(),
      _snapshotData: data
    };
    writeFileSync(filePath(name), JSON.stringify(payload, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[local-ui-snapshot] write failed', name, e.message);
  }
}

export function isSnapshotFresh(ts) {
  return ts > 0 && Date.now() - ts <= localUiSnapshotMaxAgeMs();
}
