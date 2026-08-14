// Shared by the api/ Vercel functions that replay a read-only mirror of
// server.js's GET routes (see scripts/generate-scores-snapshot.mjs). Lives
// outside api/ so Vercel's file-based routing doesn't turn it into its own
// endpoint — only files directly under api/ become routes.
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Computed per call (not hoisted to module scope) so it reflects the
// current process.cwd() even when this module is imported once and cached
// across multiple cwd changes (e.g. the test suite's scratch projects).
export function readMirror(filename) {
  const mirrorDir = path.join(process.cwd(), 'public', 'data', 'mirror');
  let wrapped;
  try {
    wrapped = JSON.parse(readFileSync(path.join(mirrorDir, filename), 'utf8'));
  } catch {
    return null;
  }
  const ts = wrapped._snapshotTs ?? Date.now();
  const data = wrapped._snapshotData ?? wrapped;
  return {
    ...data,
    publicMirror: true,
    mirroredAt: new Date(ts).toISOString(),
    mirrorAgeMs: Date.now() - ts
  };
}

export function resolveUniverse(req) {
  const raw = req.query?.universe ?? req.query?.universeId;
  const u = raw != null && String(raw).trim() !== '' ? String(raw).trim() : null;
  return u === 'sp500_top50' ? 'sp500_top50' : 'sp500_top150';
}
