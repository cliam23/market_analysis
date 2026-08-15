// Read-only mirror of GET /api/diagnostics/{universe-compare,hedge-impact,
// forward-confidence} — consolidated into one catch-all function (Vercel's
// Hobby plan caps a deployment at 12 serverless functions). factors/:id and
// equity-curves/:id are NOT here — they're two-segment paths, and this
// project's framework preset only reliably matches catch-all segments that
// resolve to exactly one path segment (confirmed via curl against the live
// deploy). They're kept as their own single-dynamic-segment files instead:
// api/diagnostics/factors/[universeId].js, api/diagnostics/equity-curves/[universeId].js.
import { readMirror, requireGet, catchAllSegments } from '../../scripts/lib/read-mirror.mjs';
import {
  DIAG_MIRROR_PERIOD,
  UNIVERSE_COMPARE_FILENAME,
  hedgeImpactFilename,
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

function serveByUniverse(req, res, { errorMessage, filenameFor }) {
  const universeId = matchDiagUniverse(req.query);
  if (!universeId) {
    res.status(404).json({ success: false, error: errorMessage });
    return;
  }
  serveMirror(res, filenameFor(universeId));
}

export default function handler(req, res) {
  if (!requireGet(req, res)) return;
  const segs = catchAllSegments(req, '/api/diagnostics/');
  const [route] = segs;

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

  res.status(404).json({ success: false, error: `No mirror for /api/diagnostics/${segs.join('/')}` });
}
