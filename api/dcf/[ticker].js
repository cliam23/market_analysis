// Read-only mirror of GET /api/dcf/:ticker — same sp500_top150 ticker set
// as api/analysis/[ticker].js (see scripts/lib/analysis-mirror.mjs).
import { readMirror, requireGet } from '../../scripts/lib/read-mirror.mjs';
import { dcfMirrorFilename } from '../../scripts/lib/analysis-mirror.mjs';

export default function handler(req, res) {
  if (!requireGet(req, res)) return;
  const ticker = String(req.query.ticker || '').toUpperCase();
  const data = readMirror(dcfMirrorFilename(ticker));

  if (!data) {
    res.status(404).json({
      success: false,
      error: `DCF for ${ticker} isn't available on this read-only deploy — only S&P 500 Top 150 tickers are pre-computed. Run the full backend locally for any ticker.`
    });
    return;
  }

  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json(data);
}
