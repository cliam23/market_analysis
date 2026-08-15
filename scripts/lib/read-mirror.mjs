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

/**
 * Segments after `prefix` in the request's raw path, for catch-all route
 * handlers like api/rl/[...path].js. Vercel's "Other" framework preset (this is a Vite
 * app, not Next.js) doesn't reliably populate req.query.<catchAllParam> the
 * way its docs describe for framework-aware routing — confirmed empty in
 * production even though the exact same code worked against every local
 * simulator, since a hand-rolled simulator can't reproduce a platform
 * routing quirk it doesn't know about. Parsing req.url directly sidesteps
 * that entirely: it's a plain Node http.IncomingMessage property Vercel
 * doesn't touch, so it's reliable regardless of framework-preset routing
 * behavior.
 */
export function catchAllSegments(req, prefix) {
  const pathname = String(req.url || '').split('?')[0];
  const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : '';
  return rest.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
}

export function resolveUniverse(req) {
  const raw = req.query?.universe ?? req.query?.universeId;
  const u = raw != null && String(raw).trim() !== '' ? String(raw).trim() : null;
  return u === 'sp500_top50' ? 'sp500_top50' : 'sp500_top150';
}

/**
 * Every function under api/ only ever reads a static file — none of them
 * call writeFileSync or touch any mutable state. This guard makes that a
 * hard property instead of an implicit one: any non-GET request (a
 * mis-pointed script, a probe, whatever) is rejected outright before the
 * handler body runs, rather than relying on "the code just happens to only
 * read". Nothing served from api/ can ever write anywhere — not on Vercel's
 * own filesystem, and there is no code path back to a developer's machine
 * at all (Vercel's deployment is a separate copy of the repo; the only way
 * data flows from GitHub to a local clone is a `git pull` the developer
 * runs themselves).
 *
 * Returns false (and has already written the 405 response) when the
 * request should stop here.
 */
export function requireGet(req, res) {
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.status(405).json({
      success: false,
      error: 'Method not allowed — every route under /api is a read-only public mirror; nothing here writes anywhere.'
    });
    return false;
  }
  return true;
}
