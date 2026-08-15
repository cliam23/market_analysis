// Read-only mirror of GET /api/diagnostics/equity-curves/:universeId?period=
// — only for the fixed default period (see scripts/lib/diagnostics-mirror.mjs).
import { readMirror, requireGet } from '../../../scripts/lib/read-mirror.mjs';
import { DIAG_MIRROR_PERIOD, equityCurvesFilename, matchDiagUniverse } from '../../../scripts/lib/diagnostics-mirror.mjs';

export default function handler(req, res) {
  if (!requireGet(req, res)) return;
  const universeId = matchDiagUniverse({ universeId: req.query.universeId, period: req.query.period });
  if (!universeId) {
    res.status(404).json({
      success: false,
      error: `Equity curves aren't available on this read-only deploy for that combination — only period=${DIAG_MIRROR_PERIOD} on S&P Top 50/150 is pre-computed. Run the full backend locally for other periods.`
    });
    return;
  }
  const data = readMirror(equityCurvesFilename(universeId));
  if (!data) {
    res.status(503).json({ success: false, error: 'mirror not generated yet' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json(data);
}
