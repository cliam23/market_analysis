export function spearmanCorrelation(xs, ys) {
  if (xs.length !== ys.length || xs.length < 3) return 0;
  const n = xs.length;
  const rank = (arr) => {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    for (let i = 0; i < n; i++) ranks[sorted[i].i] = i + 1;
    return ranks;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  let sumD2 = 0;
  for (let i = 0; i < n; i++) sumD2 += (rx[i] - ry[i]) ** 2;
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

export function pearsonCorrelation(xs, ys) {
  const n = xs.length;
  if (n !== ys.length || n < 5) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const zx = xs[i] - mx;
    const zy = ys[i] - my;
    num += zx * zy;
    dx += zx * zx;
    dy += zy * zy;
  }
  if (dx <= 1e-14 || dy <= 1e-14) return null;
  return num / Math.sqrt(dx * dy);
}
