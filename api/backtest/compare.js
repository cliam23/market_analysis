// Headline rules-vs-RL-vs-benchmark comparison for the public deploy.
// Deliberately a new path, not a mirror of GET /api/rl/compare — that route
// takes user-chosen period/universe/strategy params from AlphaLabTab and
// RLTab, so a fixed static file at the same path would silently serve the
// wrong period's numbers whenever someone changed a setting there. This
// endpoint is always the one fixed config captured by
// scripts/generate-scores-snapshot.mjs (see its compareParams constant).
import { readMirror } from '../../scripts/lib/read-mirror.mjs';

export default function handler(req, res) {
  const data = readMirror('backtest-compare.json');
  if (!data) {
    res.status(503).json({ success: false, error: 'mirror not generated yet' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json(data);
}
