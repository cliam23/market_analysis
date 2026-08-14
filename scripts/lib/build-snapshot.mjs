// Pure transform: turns raw /api/scan + /api/dashboard/summary responses
// into the small public snapshot shape served by api/scores.js.
// Kept separate from generate-scores-snapshot.mjs so it's unit-testable
// without booting a server or hitting the network.

export function buildSnapshotPayload(scan, summary, { universeId, topN = 15, rlStatus } = {}) {
  if (!scan?.results) throw new Error('buildSnapshotPayload: scan.results missing');
  if (!summary) throw new Error('buildSnapshotPayload: summary missing');

  const topScores = scan.results.slice(0, topN).map((r) => ({
    rank: r.rank,
    ticker: r.ticker,
    name: r.name,
    sector: r.sector,
    price: r.currentPrice,
    compositeScore: r.strategyScore,
    grade: r.strategyGrade
  }));

  const rl = { ...summary.rl };
  if (rlStatus?.paperTrade) {
    rl.decision = rlStatus.paperTrade.rlLastAction ?? null;
    rl.coveragePct = rlStatus.coveragePct ?? null;
    rl.statesVisited = rlStatus.statesVisited ?? null;
  }

  return {
    generatedAt: new Date().toISOString(),
    universeId: universeId ?? scan.universeId,
    regime: summary.regime,
    rl,
    systemStatus: summary.systemStatus,
    topScores,
    scanSummary: scan.summary
  };
}
