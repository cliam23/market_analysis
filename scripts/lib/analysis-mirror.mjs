// Ticker list mirrored for the Search tab on the Vercel-only deploy — the
// sp500_top50 universe is a strict subset of sp500_top150, so mirroring
// just the 150 list covers both. See scripts/generate-scores-snapshot.mjs
// (captures GET /api/analysis/:ticker for each) and api/analysis/[ticker].js
// (serves them).
export const ANALYSIS_MIRROR_UNIVERSE = 'sp500_top150';

export function analysisMirrorFilename(ticker) {
  return `analysis-${String(ticker).toUpperCase()}.json`;
}

export function dcfMirrorFilename(ticker) {
  return `dcf-${String(ticker).toUpperCase()}.json`;
}

export function compsMirrorFilename(ticker) {
  return `comps-${String(ticker).toUpperCase()}.json`;
}
