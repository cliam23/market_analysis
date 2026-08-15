// Read-only mirror of GET /api/diagnostics/{universe-compare,hedge-impact,
// forward-confidence,factors/:universeId,equity-curves/:universeId} —
// consolidated into one catch-all function (Vercel's Hobby plan caps a
// deployment at 12 serverless functions; five separate files here pushed
// the project over that limit). Each sub-route keeps its exact prior
// behavior — see git history for the original per-file versions.
import { readMirror, requireGet, catchAllSegments } from '../../scripts/lib/read-mirror.mjs';
import {
  DIAG_MIRROR_PERIOD,
  UNIVERSE_COMPARE_FILENAME,
  factorsFilename,
  hedgeImpactFilename,
  equityCurvesFilename,
  forwardConfidenceFilename,
  matchDiagUniverse
} from '../../scripts/lib/diagnostics-mirror.mjs';

function serveMirror(res, filename) {
  const data = readMirror(filename);
  if (!data) {
    res.status(503).json({ success: false, error: 'mirror not generated yet' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json(data);
}

function serveByUniverse(req, res, { errorMessage, filenameFor, universeIdFromPath }) {
  const query = universeIdFromPath != null ? { universeId: universeIdFromPath, period: req.query.period } : req.query;
  const universeId = matchDiagUniverse(query);
  if (!universeId) {
    res.status(404).json({ success: false, error: errorMessage });
    return;
  }
  serveMirror(res, filenameFor(universeId));
}

export default function handler(req, res) {
  if (!requireGet(req, res)) return;
  const segs = catchAllSegments(req, '/api/diagnostics/');
  const [route, universeIdFromPath] = segs;

  if (route === 'universe-compare') {
    serveMirror(res, UNIVERSE_COMPARE_FILENAME);
    return;
  }
  if (route === 'hedge-impact') {
    serveByUniverse(req, res, {
      filenameFor: hedgeImpactFilename,
      errorMessage: `Hedging impact isn't available on this read-only deploy for that combination — only period=${DIAG_MIRROR_PERIOD} on S&P Top 50/150 is pre-computed. Run the full backend locally for other periods.`
    });
    return;
  }
  if (route === 'forward-confidence') {
    serveByUniverse(req, res, {
      filenameFor: forwardConfidenceFilename,
      errorMessage: `Forward confidence isn't available on this read-only deploy for that combination — only period=${DIAG_MIRROR_PERIOD} on S&P Top 50/150, using that portfolio's real weights, is pre-computed.`
    });
    return;
  }
  if (route === 'factors') {
    serveByUniverse(req, res, {
      filenameFor: factorsFilename,
      universeIdFromPath,
      errorMessage: `Factor strength isn't available on this read-only deploy for that combination — only period=${DIAG_MIRROR_PERIOD} on S&P Top 50/150 is pre-computed. Run the full backend locally for other periods.`
    });
    return;
  }
  if (route === 'equity-curves') {
    serveByUniverse(req, res, {
      filenameFor: equityCurvesFilename,
      universeIdFromPath,
      errorMessage: `Equity curves aren't available on this read-only deploy for that combination — only period=${DIAG_MIRROR_PERIOD} on S&P Top 50/150 is pre-computed. Run the full backend locally for other periods.`
    });
    return;
  }

  res.status(404).json({ success: false, error: `No mirror for /api/diagnostics/${segs.join('/')}` });
}
