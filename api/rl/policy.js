// Read-only mirror of GET /api/rl/policy?universeId= (Q-learning; DQN sends
// no universeId, but this deploy's trained agent is Q-learning, so that
// path isn't mirrored — see scripts/lib/diagnostics-mirror.mjs).
import { readMirror, requireGet } from '../../scripts/lib/read-mirror.mjs';
import { DIAG_MIRROR_UNIVERSES, rlPolicyFilename } from '../../scripts/lib/diagnostics-mirror.mjs';

export default function handler(req, res) {
  if (!requireGet(req, res)) return;
  const universeId = req.query.universeId;
  if (!DIAG_MIRROR_UNIVERSES.includes(universeId)) {
    res.status(404).json({
      success: false,
      error: 'RL policy is only pre-computed on this read-only deploy for S&P Top 50/150. Run the full backend locally for other universes or DQN.'
    });
    return;
  }
  const data = readMirror(rlPolicyFilename(universeId));
  if (!data) {
    res.status(503).json({ success: false, error: 'mirror not generated yet' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json(data);
}
