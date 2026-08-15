// Full interactive backtests for the Vercel-only deploy — but only for a
// fixed matrix (S&P Top 50/150 × 3y/5y × RL on/off, Full Composite; see
// scripts/lib/backtest-mirror.mjs). Requests matching that matrix get the
// real captured backtest response (equity curve, rebalance log, everything
// — same shape server.js would return) verbatim. Anything else — a
// different strategy, period, universe, or tweaked Advanced setting — has
// no live server to compute it here, so it gets a clear explanation
// instead of a generic 404.
import { readMirror, requireGet } from '../../scripts/lib/read-mirror.mjs';
import { matchBacktestMirrorConfig, backtestMirrorFilename } from '../../scripts/lib/backtest-mirror.mjs';

export default function handler(req, res) {
  if (!requireGet(req, res)) return;
  const universeId = req.query.universeId;
  const config = matchBacktestMirrorConfig(universeId, req.query);

  if (!config) {
    res.status(404).json({
      success: false,
      error:
        'This read-only deploy only has pre-computed backtests for S&P Top 50 / Top 150, 3 Years / 5 Years, ' +
        'Full Composite strategy (default Advanced settings). Pick that combination, or run the full backend ' +
        'locally for anything else — see README § Live deployment.'
    });
    return;
  }

  const data = readMirror(backtestMirrorFilename(config));
  if (!data) {
    res.status(503).json({ success: false, error: 'mirror not generated yet' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json(data);
}
