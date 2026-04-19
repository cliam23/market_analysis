export function fmtDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtBillions(val) {
  if (!val) return "$0";
  const absVal = Math.abs(val);
  if (absVal >= 1e12) return `$${(val / 1e12).toFixed(2)}T`;
  if (absVal >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (absVal >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  return `$${val.toFixed(0)}`;
}

export function fmtMoney(n, decimals = 0) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function fmtPctSigned(n, digits = 2) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const x = Number(n);
  return `${x >= 0 ? "+" : ""}${x.toFixed(digits)}%`;
}

export function weightToPct(raw) {
  if (raw == null || Number.isNaN(Number(raw))) return 0;
  const n = Number(raw);
  return n <= 1 && n >= 0 ? n * 100 : n;
}

export function fmtWeightPct(raw) {
  if (raw == null || Number.isNaN(Number(raw))) return "—";
  const n = Number(raw);
  const pct = n <= 1 && n >= 0 ? n * 100 : n;
  return `${pct.toFixed(1)}%`;
}
