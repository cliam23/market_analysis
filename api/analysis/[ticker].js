// Read-only mirror of GET /api/analysis/:ticker for the Vercel-only
// deploy — but only for tickers in the sp500_top150 universe (a superset
// of sp500_top50; see scripts/lib/analysis-mirror.mjs). Search on any
// other ticker, and DCF/Comps on any ticker, still need the full backend
// running locally — those aren't mirrored (arbitrary ticker input and
// per-model compute made a fixed matrix impractical the way Backtest's
// was).
import { readMirror, requireGet } from '../../scripts/lib/read-mirror.mjs';
import { analysisMirrorFilename } from '../../scripts/lib/analysis-mirror.mjs';

export default function handler(req, res) {
  if (!requireGet(req, res)) return;
  const ticker = String(req.query.ticker || '').toUpperCase();
  const data = readMirror(analysisMirrorFilename(ticker));

  if (!data) {
    res.status(404).json({
      success: false,
      error: `Full analysis for ${ticker} isn't available on this read-only deploy — only S&P 500 Top 150 tickers are pre-computed. Run the full backend locally for any ticker.`
    });
    return;
  }

  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json(data);
}
