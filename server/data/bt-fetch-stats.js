/** Per-backtest aggregates for chart fetches (wired from bt_fetchPriceHistoryCore). */

let chartSourceCounts = { gold: 0, diskFresh: 0, yahoo: 0, stale: 0 };
const validationAgg = { warnings: [], errors: [] };

export function resetBtChartFetchStats() {
  chartSourceCounts = { gold: 0, diskFresh: 0, yahoo: 0, stale: 0 };
  validationAgg.warnings = [];
  validationAgg.errors = [];
}

/** @param {'gold'|'diskFresh'|'yahoo'|'stale'} kind */
export function bumpChartSource(kind) {
  chartSourceCounts[kind] = (chartSourceCounts[kind] || 0) + 1;
}

export function pushValidationSlice(v) {
  if (!v) return;
  for (const w of v.warnings || []) {
    if (validationAgg.warnings.length < 50) validationAgg.warnings.push(w);
  }
  for (const e of v.errors || []) {
    if (validationAgg.errors.length < 30) validationAgg.errors.push(e);
  }
}

export function getDataQualitySnapshot(extra = {}) {
  return {
    bars: {
      sources: { ...chartSourceCounts },
      validation: {
        warnCount: validationAgg.warnings.length,
        errorCount: validationAgg.errors.length,
        warnings: [...validationAgg.warnings],
        errors: [...validationAgg.errors]
      },
      goldLayer: process.env.DATA_GOLD_LAYER === '1' || process.env.DATA_GOLD_LAYER === 'true',
      goldWrite: process.env.DATA_GOLD_WRITE === '1' || process.env.DATA_GOLD_WRITE === 'true',
      ...extra
    }
  };
}
