// Read-only mirror of GET /api/dashboard/summary for the Vercel-only deploy.
// Replays whatever scripts/generate-scores-snapshot.mjs last captured from
// the real server.js — this is a periodically refreshed copy, not a live
// backend. See README § Live deployment.
import { readMirror, requireGet } from '../../scripts/lib/read-mirror.mjs';

export default function handler(req, res) {
  if (!requireGet(req, res)) return;
  const data = readMirror('dashboard-summary.json');
  if (!data) {
    res.status(503).json({ success: false, error: 'mirror not generated yet' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json(data);
}
