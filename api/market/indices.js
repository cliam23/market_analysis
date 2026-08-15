// Read-only mirror of GET /api/market/indices — see api/dashboard/summary.js.
import { readMirror, requireGet } from '../../scripts/lib/read-mirror.mjs';

export default function handler(req, res) {
  if (!requireGet(req, res)) return;
  const data = readMirror('market-indices.json');
  if (!data) {
    res.status(503).json({ success: false, error: 'mirror not generated yet' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json(data);
}
