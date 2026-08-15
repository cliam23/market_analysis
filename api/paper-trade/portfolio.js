// Read-only mirror of GET /api/paper-trade/portfolio?universe= — see
// api/dashboard/summary.js. Mutating routes (init/rebalance/reset/config)
// are intentionally not mirrored; they need a live server.js.
import { readMirror, resolveUniverse, requireGet } from '../../scripts/lib/read-mirror.mjs';

export default function handler(req, res) {
  if (!requireGet(req, res)) return;
  const universe = resolveUniverse(req);
  const data = readMirror(`paper-trade-portfolio-${universe}.json`);
  if (!data) {
    res.status(503).json({ success: false, error: 'mirror not generated yet' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json(data);
}
