// Vercel serverless function — public read API for the composite-score /
// RL-decision snapshot. The snapshot itself is produced on a schedule by
// scripts/generate-scores-snapshot.mjs (see .github/workflows/scheduled-pipeline.yml),
// which boots the real server.js and calls its own production endpoints,
// so the numbers here are the same composite-score + RL-agent output the
// dashboard uses — just served from a static snapshot instead of a live
// Express process, since Vercel doesn't run the always-on Node server.
//
// Also serves GET /api/health (via a vercel.json rewrite to ?health=1) —
// folded in here, rather than kept as its own file, to stay under the
// Hobby plan's 12-serverless-function-per-deployment cap. The frontend's
// connectivity check (src/App.jsx, src/hooks/useBackendMode.js) still calls
// the unchanged public path /api/health; only the routing underneath moved.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { requireGet } from '../scripts/lib/read-mirror.mjs';

export default function handler(req, res) {
  if (!requireGet(req, res)) return;
  if (req.query?.health) {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString(), mode: 'lite' });
    return;
  }
  let snapshot;
  try {
    const snapshotPath = path.join(process.cwd(), 'public', 'data', 'scores-snapshot.json');
    snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  } catch {
    res.status(503).json({ success: false, error: 'snapshot not generated yet' });
    return;
  }

  let topScores = snapshot.topScores ?? [];
  const ticker = req.query?.ticker;
  if (ticker) {
    const t = String(ticker).toUpperCase();
    topScores = topScores.filter((r) => r.ticker === t);
  }

  const ageMs = Date.now() - new Date(snapshot.generatedAt).getTime();

  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json({
    success: true,
    generatedAt: snapshot.generatedAt,
    ageHours: Math.round((ageMs / 3600000) * 10) / 10,
    universeId: snapshot.universeId,
    regime: snapshot.regime,
    rl: snapshot.rl,
    systemStatus: snapshot.systemStatus,
    scanSummary: snapshot.scanSummary,
    topScores
  });
}
