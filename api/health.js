// Vercel serverless function — mirrors GET /api/health from server.js so the
// SPA's connectivity check (src/App.jsx) doesn't show "Backend not
// connected" on the Vercel-only deploy, which intentionally runs a
// lightweight public API (api/scores.js) instead of the full Express app.
export default function handler(req, res) {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString(), mode: 'lite' });
}
