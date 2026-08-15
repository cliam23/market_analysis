// Read-only mirror of GET /api/diagnostics/universe-compare — takes no
// params in the real app, so there's exactly one snapshot to serve.
import { readMirror, requireGet } from '../../scripts/lib/read-mirror.mjs';
import { UNIVERSE_COMPARE_FILENAME } from '../../scripts/lib/diagnostics-mirror.mjs';

export default function handler(req, res) {
  if (!requireGet(req, res)) return;
  const data = readMirror(UNIVERSE_COMPARE_FILENAME);
  if (!data) {
    res.status(503).json({ success: false, error: 'mirror not generated yet' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json(data);
}
