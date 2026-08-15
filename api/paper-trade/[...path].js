// Read-only mirror of GET /api/paper-trade/{portfolio,history,preview} —
// consolidated into one catch-all function (Vercel's Hobby plan caps a
// deployment at 12 serverless functions; three separate files here counted
// toward that limit). Mutating routes (init/rebalance/reset/config) are
// intentionally not mirrored; they need a live server.js. Each sub-route
// keeps its exact prior behavior — see git history for the original
// per-file versions.
import { readMirror, resolveUniverse, requireGet } from '../../scripts/lib/read-mirror.mjs';
import { PAPER_TRADE_PREVIEW_FILENAME } from '../../scripts/lib/diagnostics-mirror.mjs';

function serveMirror(res, filename) {
  const data = readMirror(filename);
  if (!data) {
    res.status(503).json({ success: false, error: 'mirror not generated yet' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json(data);
}

export default function handler(req, res) {
  if (!requireGet(req, res)) return;
  const segs = Array.isArray(req.query.path) ? req.query.path : [req.query.path];
  const [route] = segs;

  if (route === 'portfolio') {
    serveMirror(res, `paper-trade-portfolio-${resolveUniverse(req)}.json`);
    return;
  }
  if (route === 'history') {
    serveMirror(res, `paper-trade-history-${resolveUniverse(req)}.json`);
    return;
  }
  if (route === 'preview') {
    serveMirror(res, PAPER_TRADE_PREVIEW_FILENAME);
    return;
  }

  res.status(404).json({ success: false, error: `No mirror for /api/paper-trade/${segs.join('/')}` });
}
