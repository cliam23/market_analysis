// Read-only mirror of GET /api/paper-trade/preview. The real route takes
// no query params today (always previews the default universe), so
// there's exactly one snapshot — see scripts/lib/diagnostics-mirror.mjs.
import { readMirror, requireGet } from '../../scripts/lib/read-mirror.mjs';
import { PAPER_TRADE_PREVIEW_FILENAME } from '../../scripts/lib/diagnostics-mirror.mjs';

export default function handler(req, res) {
  if (!requireGet(req, res)) return;
  const data = readMirror(PAPER_TRADE_PREVIEW_FILENAME);
  if (!data) {
    res.status(503).json({ success: false, error: 'mirror not generated yet' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json(data);
}
