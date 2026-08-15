// Read-only mirror of GET /api/rl/{status,compare,policy} — consolidated
// into one catch-all function (Vercel's Hobby plan caps a deployment at 12
// serverless functions; three separate files here counted toward that
// limit). Each sub-route keeps its exact prior behavior — see git history
// for the original per-file versions.
import { readMirror, resolveUniverse, requireGet } from '../../scripts/lib/read-mirror.mjs';
import { DIAG_MIRROR_UNIVERSES, RL_COMPARE_PARAMS, rlCompareFilename, rlPolicyFilename, matchRlCompareUniverse } from '../../scripts/lib/diagnostics-mirror.mjs';

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

  if (route === 'status') {
    const universe = resolveUniverse(req);
    serveMirror(res, `rl-status-${universe}.json`);
    return;
  }

  if (route === 'compare') {
    const universeId = matchRlCompareUniverse(req.query);
    if (!universeId) {
      res.status(404).json({
        success: false,
        error: `This read-only deploy only has a pre-computed RL comparison for S&P Top 50/150 at period=${RL_COMPARE_PARAMS.period}, topN=${RL_COMPARE_PARAMS.topN}, rebalanceFreq=${RL_COMPARE_PARAMS.rebalanceFreq}, strategy=${RL_COMPARE_PARAMS.strategy}. Run the full backend locally for other configs.`
      });
      return;
    }
    serveMirror(res, rlCompareFilename(universeId));
    return;
  }

  if (route === 'policy') {
    const universeId = req.query.universeId;
    if (!DIAG_MIRROR_UNIVERSES.includes(universeId)) {
      res.status(404).json({
        success: false,
        error: 'RL policy is only pre-computed on this read-only deploy for S&P Top 50/150. Run the full backend locally for other universes or DQN.'
      });
      return;
    }
    serveMirror(res, rlPolicyFilename(universeId));
    return;
  }

  res.status(404).json({ success: false, error: `No mirror for /api/rl/${segs.join('/')}` });
}
