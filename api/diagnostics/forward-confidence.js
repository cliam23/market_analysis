// Read-only mirror of POST /api/diagnostics/forward-confidence — the real
// route takes a `weights` body since the UI lets you edit weights, but
// nothing under api/ accepts writes (see scripts/lib/read-mirror.mjs's
// requireGet). Since the lite deploy can't apply custom weights anyway
// (paper-trade portfolios are read-only there), this mirror only ever
// reflects that portfolio's actual current weights — captured as a GET
// with ?universeId=&period= instead of a POST body. The frontend calls
// this differently depending on mode (see AlphaLabTab.jsx's loadForwardConfidence).
import { readMirror, requireGet } from '../../scripts/lib/read-mirror.mjs';
import { DIAG_MIRROR_PERIOD, forwardConfidenceFilename, matchDiagUniverse } from '../../scripts/lib/diagnostics-mirror.mjs';

export default function handler(req, res) {
  if (!requireGet(req, res)) return;
  const universeId = matchDiagUniverse(req.query);
  if (!universeId) {
    res.status(404).json({
      success: false,
      error: `Forward confidence isn't available on this read-only deploy for that combination — only period=${DIAG_MIRROR_PERIOD} on S&P Top 50/150, using that portfolio's real weights, is pre-computed.`
    });
    return;
  }
  const data = readMirror(forwardConfidenceFilename(universeId));
  if (!data) {
    res.status(503).json({ success: false, error: 'mirror not generated yet' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json(data);
}
