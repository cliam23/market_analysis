/** Mean (actual/estimate - 1) over quarters with usable EPS; null if none. */
export function rawAvgEarningsSurpriseRatio(earningsData) {
  if (!earningsData?.quarters?.length) return null;
  const parts = [];
  for (const q of earningsData.quarters) {
    const est = q.epsEstimate;
    const act = q.epsActual;
    if (est == null || Math.abs(est) < 1e-8 || act == null) continue;
    parts.push(act / est - 1);
  }
  if (parts.length === 0) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

/** EPS revision momentum vs 90d-ago consensus for current quarter. */
export function rawEpsRevisionDelta(earningsData) {
  const t = earningsData?.epsTrend;
  if (!t) return null;
  const cur = t.currentQtrEstimate;
  const ago = t.currentQtr90dAgoEstimate;
  if (cur == null || ago == null || !Number.isFinite(cur) || !Number.isFinite(ago) || Math.abs(ago) < 1e-8) {
    return null;
  }
  return (cur - ago) / Math.abs(ago);
}

/**
 * Sequential revenue growth acceleration (newest vs prior quarter growth).
 * True YoY needs >4 quarters of revenue; Yahoo history often omits revenue — neutral when insufficient.
 */
export function rawRevenueAcceleration(earningsData) {
  const q = earningsData?.quarters;
  if (!Array.isArray(q) || q.length < 3) return null;
  const r0 = q[0]?.revenue;
  const r1 = q[1]?.revenue;
  const r2 = q[2]?.revenue;
  if (r0 == null || r1 == null || r2 == null) return null;
  if (!(r0 > 0) || !(r1 > 0) || !(r2 > 0)) return null;
  const g01 = (r0 - r1) / r1;
  const g12 = (r1 - r2) / r2;
  if (!Number.isFinite(g01) || !Number.isFinite(g12)) return null;
  return g01 - g12;
}

/** True when Yahoo earnings payload has at least one usable raw signal for momentum pillar. */
export function hasUsableEarningsRaw(earningsData) {
  if (!earningsData || typeof earningsData !== 'object') return false;
  const s = rawAvgEarningsSurpriseRatio(earningsData);
  const r = rawEpsRevisionDelta(earningsData);
  const v = rawRevenueAcceleration(earningsData);
  return (
    (s != null && Number.isFinite(s)) ||
    (r != null && Number.isFinite(r)) ||
    (v != null && Number.isFinite(v))
  );
}
