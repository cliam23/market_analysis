// Read-only mirror of GET /api/paper-trade/history?universe= — see
// api/dashboard/summary.js. Mirrored alongside portfolio.js because the
// frontend fetches both together and treats either failing as fatal.
import { readMirror, resolveUniverse } from '../../scripts/lib/read-mirror.mjs';

export default function handler(req, res) {
  const universe = resolveUniverse(req);
  const data = readMirror(`paper-trade-history-${universe}.json`);
  if (!data) {
    res.status(503).json({ success: false, error: 'mirror not generated yet' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json(data);
}
