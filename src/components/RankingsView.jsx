import { useState } from "react";
import { Box, SH, Pill, LoadingSpinner, TrendBadge, vc } from "./shared.jsx";

const UNIVERSES = [
  { id: "sp500_top50", label: "S&P 500 Top 50" },
  { id: "vgt", label: "VGT (Tech)" },
  { id: "mag7", label: "Mag 7" },
  { id: "russell_growth", label: "Russell Growth" },
  { id: "dividend_aristocrats", label: "Dividend Aristocrats" }
];

const LOOKBACKS = [
  { id: "3", label: "3 Months" },
  { id: "6", label: "6 Months" },
  { id: "12", label: "12 Months" }
];

const SORT_OPTIONS = [
  { id: "momentum", label: "Momentum" },
  { id: "composite", label: "Composite Score" },
  { id: "riskAdj", label: "Risk-Adjusted" }
];

function calcQuickComposite(r) {
  const momentumScore = Math.min(100, Math.max(0, 50 + parseFloat(r.rawMomentum || 0) * 3));
  const riskAdjScore = parseFloat(r.riskAdjMomentum || 0) >= 1 ? 80 : parseFloat(r.riskAdjMomentum || 0) >= 0.5 ? 60 : 40;
  return Math.round((momentumScore * 0.6 + riskAdjScore * 0.4));
}

export default function RankingsView({ onSelectTicker }) {
  const [selectedUniverse, setSelectedUniverse] = useState("sp500_top50");
  const [selectedLookback, setSelectedLookback] = useState("6");
  const [smooth, setSmooth] = useState(true);
  const [sortBy, setSortBy] = useState("momentum");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const runScan = async () => {
    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const response = await fetch(
        `/api/momentum/${selectedUniverse}?lookback=${selectedLookback}&smooth=${smooth}&fresh=true`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || "Scan failed");
      }
      
      setResults(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Controls */}
      <Box border="rgba(255,255,255,0.06)" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <label style={{ fontSize: 9, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, display: "block", marginBottom: 4, fontFamily: "'IBM Plex Mono', monospace" }}>
              UNIVERSE
            </label>
            <select
              value={selectedUniverse}
              onChange={(e) => setSelectedUniverse(e.target.value)}
              disabled={loading}
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 6,
                padding: "8px 12px",
                color: "#f0f0f0",
                fontSize: 12,
                fontFamily: "'IBM Plex Mono', monospace",
                cursor: "pointer",
                minWidth: 160
              }}
            >
              {UNIVERSES.map((u) => (
                <option key={u.id} value={u.id}>{u.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 9, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, display: "block", marginBottom: 4, fontFamily: "'IBM Plex Mono', monospace" }}>
              LOOKBACK
            </label>
            <select
              value={selectedLookback}
              onChange={(e) => setSelectedLookback(e.target.value)}
              disabled={loading}
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 6,
                padding: "8px 12px",
                color: "#f0f0f0",
                fontSize: 12,
                fontFamily: "'IBM Plex Mono', monospace",
                cursor: "pointer"
              }}
            >
              {LOOKBACKS.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 9, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, display: "block", marginBottom: 4, fontFamily: "'IBM Plex Mono', monospace" }}>
              TREND FILTER
            </label>
            <button
              onClick={() => setSmooth(!smooth)}
              disabled={loading}
              style={{
                padding: "8px 16px",
                background: smooth ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${smooth ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.1)"}`,
                borderRadius: 6,
                color: smooth ? "#22c55e" : "#888",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "'IBM Plex Mono', monospace"
              }}
            >
              {smooth ? "ON" : "OFF"}
            </button>
          </div>

          <div>
            <label style={{ fontSize: 9, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, display: "block", marginBottom: 4, fontFamily: "'IBM Plex Mono', monospace" }}>
              SORT BY
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              disabled={loading}
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 6,
                padding: "8px 12px",
                color: "#f0f0f0",
                fontSize: 12,
                fontFamily: "'IBM Plex Mono', monospace",
                cursor: "pointer"
              }}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>

          <div style={{ marginLeft: "auto" }}>
            <label style={{ fontSize: 9, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, display: "block", marginBottom: 4, fontFamily: "'IBM Plex Mono', monospace" }}>
              &nbsp;
            </label>
            <button
              onClick={runScan}
              disabled={loading}
              style={{
                padding: "8px 20px",
                background: loading ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 6,
                color: loading ? "#555" : "#818cf8",
                fontSize: 12,
                fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                fontFamily: "'IBM Plex Mono', monospace"
              }}
            >
              {loading ? "SCANNING..." : "RUN SCAN"}
            </button>
          </div>
        </div>

        {loading && (
          <Box border="rgba(255,255,255,0.06)" style={{ textAlign: "center", padding: "40px 20px" }}>
            <LoadingSpinner size={32} />
            <div style={{ marginTop: 16, color: "#f0f0f0", fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" }}>
              Scanning universe...
            </div>
          </Box>
        )}
      </Box>

      {error && (
        <Box border="rgba(239,68,68,0.3)" style={{ background: "rgba(239,68,68,0.05)" }}>
          <div style={{ color: "#ef4444", fontSize: 12 }}>Error: {error}</div>
        </Box>
      )}

      {/* Results */}
      {results && (
        <>
          {/* Summary */}
          <Box border="rgba(255,255,255,0.06)" style={{ marginBottom: 16 }}>
            <SH color="#f0f0f0">Scan Summary</SH>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "14px 18px", textAlign: "center", flex: "1 1 100px" }}>
                <div style={{ fontSize: 11, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: "'IBM Plex Mono', monospace" }}>ASSETS</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#f0f0f0", fontFamily: "'IBM Plex Mono', monospace" }}>{results.summary.totalAssets}</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "14px 18px", textAlign: "center", flex: "1 1 100px" }}>
                <div style={{ fontSize: 11, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: "'IBM Plex Mono', monospace" }}>AVG MOMENTUM</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: parseFloat(results.summary.avgMomentum) >= 0 ? "#22c55e" : "#ef4444", fontFamily: "'IBM Plex Mono', monospace" }}>
                  {results.summary.avgMomentum}%
                </div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "14px 18px", textAlign: "center", flex: "1 1 100px" }}>
                <div style={{ fontSize: 11, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: "'IBM Plex Mono', monospace" }}>UPTREND</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#22c55e", fontFamily: "'IBM Plex Mono', monospace" }}>{results.summary.percentUptrend}%</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "14px 18px", textAlign: "center", flex: "1 1 100px" }}>
                <div style={{ fontSize: 11, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: "'IBM Plex Mono', monospace" }}>MED VOL</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#f0f0f0", fontFamily: "'IBM Plex Mono', monospace" }}>{results.summary.medianVolatility}</div>
              </div>
            </div>
          </Box>

          {/* Table */}
          <Box border="rgba(255,255,255,0.06)" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.02)" }}>
                    <th style={{ padding: "10px 12px", textAlign: "left", color: "#f0f0f0", fontWeight: 700, fontSize: 9, letterSpacing: 1, fontFamily: "'IBM Plex Mono', monospace" }}>#</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", color: "#f0f0f0", fontWeight: 700, fontSize: 9, letterSpacing: 1, fontFamily: "'IBM Plex Mono', monospace" }}>TICKER</th>
                    <th style={{ padding: "10px 12px", textAlign: "right", color: "#f0f0f0", fontWeight: 700, fontSize: 9, letterSpacing: 1, fontFamily: "'IBM Plex Mono', monospace" }}>PRICE</th>
                    <th style={{ padding: "10px 12px", textAlign: "right", color: "#f0f0f0", fontWeight: 700, fontSize: 9, letterSpacing: 1, fontFamily: "'IBM Plex Mono', monospace" }}>MOMENTUM</th>
                    <th style={{ padding: "10px 12px", textAlign: "right", color: "#f0f0f0", fontWeight: 700, fontSize: 9, letterSpacing: 1, fontFamily: "'IBM Plex Mono', monospace" }}>RISK ADJ</th>
                    <th style={{ padding: "10px 12px", textAlign: "center", color: "#f0f0f0", fontWeight: 700, fontSize: 9, letterSpacing: 1, fontFamily: "'IBM Plex Mono', monospace" }}>COMPOSITE</th>
                    <th style={{ padding: "10px 12px", textAlign: "center", color: "#f0f0f0", fontWeight: 700, fontSize: 9, letterSpacing: 1, fontFamily: "'IBM Plex Mono', monospace" }}>TREND</th>
                    <th style={{ padding: "10px 12px", textAlign: "right", color: "#f0f0f0", fontWeight: 700, fontSize: 9, letterSpacing: 1, fontFamily: "'IBM Plex Mono', monospace" }}>VOL</th>
                    <th style={{ padding: "10px 12px", textAlign: "right", color: "#f0f0f0", fontWeight: 700, fontSize: 9, letterSpacing: 1, fontFamily: "'IBM Plex Mono', monospace" }}>MAX DD</th>
                    <th style={{ padding: "10px 12px", textAlign: "center", color: "#f0f0f0", fontWeight: 700, fontSize: 9, letterSpacing: 1, fontFamily: "'IBM Plex Mono', monospace" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const rows = [...(results?.results || [])];
                    if (sortBy === "composite") {
                      rows.sort((a, b) => {
                        const aScore = calcQuickComposite(a);
                        const bScore = calcQuickComposite(b);
                        return bScore - aScore;
                      });
                    } else if (sortBy === "riskAdj") {
                      rows.sort((a, b) => parseFloat(b.riskAdjMomentum || 0) - parseFloat(a.riskAdjMomentum || 0));
                    }
                    return rows.map((r, i) => {
                      const compositeScore = calcQuickComposite(r);
                      const compColor = compositeScore >= 70 ? "#22c55e" : compositeScore >= 50 ? "#eab308" : "#ef4444";
                      return (
                        <tr
                          key={r.ticker}
                          style={{
                            borderTop: "1px solid rgba(255,255,255,0.03)",
                            cursor: "pointer",
                            transition: "background 0.15s"
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                          onClick={() => onSelectTicker(r.ticker)}
                        >
                          <td style={{ padding: "10px 12px" }}>
                            <span style={{
                              fontFamily: "'IBM Plex Mono', monospace",
                              fontWeight: 800,
                              color: i === 0 ? "#fbbf24" : i === 1 ? "#f0f0f0" : i === 2 ? "#cd7f32" : "#f0f0f0"
                            }}>
                              {i + 1}
                            </span>
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <div style={{ fontWeight: 700, color: "#f0f0f0", fontFamily: "'IBM Plex Mono', monospace" }}>{r.ticker}</div>
                            <div style={{ fontSize: 10, color: "#f0f0f0", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", color: "#f0f0f0" }}>
                            ${r.currentPrice?.toFixed(2) || "—"}
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", color: parseFloat(r.rawMomentum) >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                            {r.rawMomentum}%
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", color: "#f0f0f0", fontWeight: 600 }}>
                            {r.riskAdjMomentum}
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "center" }}>
                            <span style={{
                              fontFamily: "'IBM Plex Mono', monospace",
                              fontWeight: 700,
                              color: compColor,
                              background: compColor + "15",
                              padding: "3px 8px",
                              borderRadius: 4,
                              fontSize: 11
                            }}>
                              {compositeScore}
                            </span>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "center" }}>
                            <TrendBadge status={r.trendStatus} />
                            {r.volatilityFlagged && <span title="High volatility detected" style={{ marginLeft: 4, color: "#f97316", fontSize: 10 }}>⚠</span>}
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", color: "#f0f0f0" }}>
                            {r.volatility}
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", color: "#ef4444" }}>
                            {r.maxDrawdown}%
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "center" }}>
                            <span style={{ color: "#f0f0f0", fontSize: 14 }}>→</span>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </Box>

          {/* Methodology note */}
          <Box border="rgba(255,255,255,0.06)" style={{ marginTop: 16, background: "rgba(255,255,255,0.01)" }}>
            <div style={{ fontSize: 10, color: "#f0f0f0", lineHeight: 1.6, fontFamily: "'IBM Plex Mono', monospace" }}>
              <strong style={{ color: "#f0f0f0" }}>Methodology:</strong> Risk-adjusted momentum = Annualized Return / Annualized Volatility. 
              Trend filter adds +2 for strong uptrends, +1 for pullbacks, -1 for downtrends (when enabled). 
              Rankings sorted by final score descending.
            </div>
          </Box>
        </>
      )}

      {!results && !loading && !error && (
        <Box border="rgba(255,255,255,0.06)" style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#f0f0f0", marginBottom: 6 }}>Momentum Scanner</div>
          <div style={{ fontSize: 11, color: "#f0f0f0" }}>Select a universe and click "Run Scan" to analyze {selectedLookback}-month momentum.</div>
        </Box>
      )}
    </div>
  );
}
