export function subtractMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().split('T')[0];
}

export function daysBetween(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

/** Calendar `iso` (YYYY-MM-DD) + `days` (may be negative); returns YYYY-MM-DD in UTC noon math. */
export function isoAddDays(iso, days) {
  if (!iso || typeof iso !== 'string') return null;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + (days | 0));
  return d.toISOString().slice(0, 10);
}
