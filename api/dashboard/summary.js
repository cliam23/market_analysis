// Read-only mirror of GET /api/dashboard/summary for the Vercel-only deploy.
// Replays whatever scripts/generate-scores-snapshot.mjs last captured from
// the real server.js — this is a periodically refreshed copy, not a live
// backend. See README § Live deployment.
//
// Also serves GET /api/market/indices (via a vercel.json rewrite to
// ?kind=indices) — folded in here rather than kept as its own file to stay
// under the Hobby plan's 12-serverless-function-per-deployment cap. Static
// (non-parameterized) paths like these are a safe rewrite target; the
// project's existing SPA-fallback rewrite already proves rewrites work
// reliably in this deployment. Dynamic catch-all *route segments*
// ([...path].js) are the thing that's unreliable here — that's a
// completely different mechanism, not a reason to distrust rewrites too.
import { readMirror, requireGet } from '../../scripts/lib/read-mirror.mjs';

export default function handler(req, res) {
  if (!requireGet(req, res)) return;
  const filename = req.query.kind === 'indices' ? 'market-indices.json' : 'dashboard-summary.json';
  const data = readMirror(filename);
  if (!data) {
    res.status(503).json({ success: false, error: 'mirror not generated yet' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json(data);
}
