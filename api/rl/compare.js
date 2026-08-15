// Read-only mirror of GET /api/rl/compare — used by both AlphaLabTab
// (always with the fixed params below) and RLTab (user-adjustable period/
// topN/rebalanceFreq). Only the one combo per universe that matches both
// tabs' defaults is mirrored; anything else gets a clear 404 rather than
// silently serving the wrong period's numbers. See
// scripts/lib/diagnostics-mirror.mjs.
import { readMirror, requireGet } from '../../scripts/lib/read-mirror.mjs';
import { RL_COMPARE_PARAMS, rlCompareFilename, matchRlCompareUniverse } from '../../scripts/lib/diagnostics-mirror.mjs';

export default function handler(req, res) {
  if (!requireGet(req, res)) return;
  const universeId = matchRlCompareUniverse(req.query);
  if (!universeId) {
    res.status(404).json({
      success: false,
      error: `This read-only deploy only has a pre-computed RL comparison for S&P Top 50/150 at period=${RL_COMPARE_PARAMS.period}, topN=${RL_COMPARE_PARAMS.topN}, rebalanceFreq=${RL_COMPARE_PARAMS.rebalanceFreq}, strategy=${RL_COMPARE_PARAMS.strategy}. Run the full backend locally for other configs.`
    });
    return;
  }
  const data = readMirror(rlCompareFilename(universeId));
  if (!data) {
    res.status(503).json({ success: false, error: 'mirror not generated yet' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json(data);
}
