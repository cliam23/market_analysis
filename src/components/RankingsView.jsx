import { useState, useEffect } from "react";
import { Box, SH, Pill, LoadingSpinner, TrendBadge } from "./shared.jsx";
import { MONO } from "../lib/theme.js";
import { useAbortableApi, isAbortError } from "../hooks/useAbortableApi.js";

const STRATEGIES = [
  { id: "momentum", label: "Momentum Only" },
  { id: "momentum_value", label: "Momentum + Value" },
  { id: "full_composite", label: "Full Composite" },
  { id: "full_composite_aggressive", label: "Full Composite (Aggressive)" },
  { id: "full_composite_turbo", label: "Full Composite (Turbo)" },
  { id: "quality_momentum", label: "Quality + Momentum" }
];

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
  { id: "strategy", label: "Strategy Score" },
  { id: "momentum", label: "Momentum" },
  { id: "riskAdj", label: "Risk-Adjusted" }
];

const METHODOLOGY = {
  momentum: "Ranks by risk-adjusted momentum (annualized return / volatility) with optional trend filter bonus. Pure price-based signal.",
  momentum_value: "Combines momentum (60%) with valuation metrics like P/E and P/B (40%). Balances price trend with value attractiveness.",
  quality_momentum: "Weights quality fundamentals (60%) — ROE, gross margin, operating margin — alongside momentum (40%).",
  full_composite: "Full Composite: same five-pillar blend as the backtest (fundamental 35%, DCF 10%, dynamic valuation 15%, momentum 25%, price value 15%) — not the old checklist-only composite.",
  full_composite_aggressive: "Same pillars as Full Composite with aggressive weights (e.g. 25/0/10/40/25) and 65/35 momentum vs momentum-quality blend in the ranking engine; backtest also uses tighter sector cap and different regime/stop behavior.",
  full_composite_turbo: "Turbo pillar weights (e.g. 10/0/5/55/30) and 50/50 momentum vs momentum-quality blend; minimal quality gates in the backtest — for experimentation only."
};

const selectStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  padding: "8px 12px",
  color: "#f0f0f0",
  fontSize: 12,
  fontFamily: MONO,
  cursor: "pointer"
};

const labelStyle = {
  fontSize: 9, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1,
  display: "block", marginBottom: 4, fontFamily: MONO
};

const thStyle = {
  padding: "10px 12px", color: "#f0f0f0", fontWeight: 700,
  fontSize: 9, letterSpacing: 1, fontFamily: MONO
};

export default function RankingsView({ onSelectTicker }) {
  const [selectedStrategy, setSelectedStrategy] = useState("momentum");
  const [selectedUniverse, setSelectedUniverse] = useState("sp500_top50");
  const [selectedLookback, setSelectedLookback] = useState("6");
  const [smooth, setSmooth] = useState(true);
  const [sortBy, setSortBy] = useState("strategy");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [scanBtnHover, setScanBtnHover] = useState(false);
  const { abortInFlight, beginRequest, clearIfCurrent } = useAbortableApi();

  // Changing strategy/universe/etc. while a scan is running cancels the in-flight request.
  useEffect(() => {
    if (!loading) return;
    abortInFlight();
    setLoading(false);
    setResults(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStrategy, selectedUniverse, selectedLookback, smooth]);

  const runScan = async () => {
    const ac = beginRequest();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/scan/${selectedUniverse}?strategy=${selectedStrategy}&lookback=${selectedLookback}&smooth=${smooth}&fresh=true`,
        { signal: ac.signal }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data.success) throw new Error(data.error || "Scan failed");
      setResults(data);
    } catch (err) {
      if (isAbortError(err)) return;
      setError(err.message);
    } finally {
      clearIfCurrent(ac);
      setLoading(false);
    }
  };

  const onScanClick = () => {
    if (loading) {
      abortInFlight();
      setLoading(false);
      return;
    }
    runScan();
  };

  const sortRows = (rows) => {
    const sorted = [...rows];
    if (sortBy === "strategy") sorted.sort((a, b) => b.strategyScore - a.strategyScore);
    else if (sortBy === "momentum") sorted.sort((a, b) => parseFloat(b.rawMomentum || 0) - parseFloat(a.rawMomentum || 0));
    else if (sortBy === "riskAdj") sorted.sort((a, b) => parseFloat(b.riskAdjMomentum || 0) - parseFloat(a.riskAdjMomentum || 0));
    return sorted;
  };

  const scoreColor = (s) => s >= 70 ? "#22c55e" : s >= 50 ? "#eab308" : "#ef4444";
  const gradeColor = (label) => {
    if (!label) return "#888";
    const l = label.toUpperCase();
    if (l.includes("STRONG BUY") || l === "BUY") return "#22c55e";
    if (l.includes("ACCUMULATE") || l.includes("LEAN BUY")) return "#4ade80";
    if (l.includes("HOLD")) return "#eab308";
    if (l.includes("LEAN SELL")) return "#f97316";
    return "#ef4444";
  };

  return (
    <div>
      {/* Controls */}
      <Box border="rgba(255,255,255,0.06)" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <label style={labelStyle}>STRATEGY</label>
            <select
              value={selectedStrategy}
              onChange={(e) => setSelectedStrategy(e.target.value)}
              style={{ ...selectStyle, minWidth: 170 }}
            >
              {STRATEGIES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>UNIVERSE</label>
            <select
              value={selectedUniverse}
              onChange={(e) => setSelectedUniverse(e.target.value)}
              style={{ ...selectStyle, minWidth: 160 }}
            >
              {UNIVERSES.map((u) => (
                <option key={u.id} value={u.id}>{u.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>LOOKBACK</label>
            <select
              value={selectedLookback}
              onChange={(e) => setSelectedLookback(e.target.value)}
              style={selectStyle}
            >
              {LOOKBACKS.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>TREND FILTER</label>
            <select
              value={smooth ? "on" : "off"}
              onChange={(e) => setSmooth(e.target.value === "on")}
              style={selectStyle}
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>SORT BY</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={selectStyle}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>

          <div style={{ marginLeft: "auto" }}>
            <label style={labelStyle}>&nbsp;</label>
            <button
              type="button"
              onClick={onScanClick}
              onMouseEnter={() => setScanBtnHover(true)}
              onMouseLeave={() => setScanBtnHover(false)}
              style={{
                padding: "8px 20px",
                background:
                  loading && scanBtnHover
                    ? "rgba(239,68,68,0.15)"
                    : loading
                      ? "rgba(255,255,255,0.04)"
                      : "rgba(255,255,255,0.08)",
                border:
                  loading && scanBtnHover
                    ? "1px solid rgba(239,68,68,0.45)"
                    : "1px solid rgba(255,255,255,0.12)",
                borderRadius: 6,
                color:
                  loading && scanBtnHover
                    ? "#fca5a5"
                    : loading
                      ? "#888"
                      : "#818cf8",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: MONO
              }}
            >
              {loading && scanBtnHover
                ? "CANCEL"
                : loading
                  ? "SCANNING..."
                  : "RUN SCAN"}
            </button>
          </div>
        </div>

        {loading && results && (
          <div style={{ textAlign: "center", padding: "10px 12px", fontSize: 11, fontFamily: MONO, color: "#888" }}>
            Updating scan…
          </div>
        )}
        {loading && !results && (
          <Box border="rgba(255,255,255,0.06)" style={{ textAlign: "center", padding: "40px 20px" }}>
            <LoadingSpinner size={32} />
            <div style={{ marginTop: 16, color: "#f0f0f0", fontSize: 12, fontFamily: MONO }}>
              Scanning universe with {STRATEGIES.find(s => s.id === selectedStrategy)?.label} strategy...
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
        <div style={{ opacity: loading ? 0.72 : 1, transition: "opacity 0.2s ease" }}>
        <>
          {/* Summary */}
          <Box border="rgba(255,255,255,0.06)" style={{ marginBottom: 16 }}>
            <SH color="#f0f0f0">Scan Summary</SH>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "14px 18px", textAlign: "center", flex: "1 1 100px" }}>
                <div style={{ fontSize: 11, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>ASSETS</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#f0f0f0", fontFamily: MONO }}>{results.summary.totalAssets}</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "14px 18px", textAlign: "center", flex: "1 1 100px" }}>
                <div style={{ fontSize: 11, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>AVG SCORE</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: scoreColor(results.summary.avgStrategyScore), fontFamily: MONO }}>
                  {results.summary.avgStrategyScore}
                </div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "14px 18px", textAlign: "center", flex: "1 1 100px" }}>
                <div style={{ fontSize: 11, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>AVG MOMENTUM</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: parseFloat(results.summary.avgMomentum) >= 0 ? "#22c55e" : "#ef4444", fontFamily: MONO }}>
                  {results.summary.avgMomentum}%
                </div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "14px 18px", textAlign: "center", flex: "1 1 100px" }}>
                <div style={{ fontSize: 11, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>UPTREND</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#22c55e", fontFamily: MONO }}>{results.summary.percentUptrend}%</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "14px 18px", textAlign: "center", flex: "1 1 100px" }}>
                <div style={{ fontSize: 11, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>MED VOL</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#f0f0f0", fontFamily: MONO }}>{results.summary.medianVolatility}</div>
              </div>
            </div>
          </Box>

          {/* Table */}
          <Box border="rgba(255,255,255,0.06)" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.02)" }}>
                    <th style={{ ...thStyle, textAlign: "left" }}>#</th>
                    <th style={{ ...thStyle, textAlign: "left" }}>TICKER</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>PRICE</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>SCORE</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>GRADE</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>MOMENTUM</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>RISK ADJ</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>TREND</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>VOL</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>MAX DD</th>
                  </tr>
                </thead>
                <tbody>
                  {sortRows(results?.results || []).map((r, i) => (
                    <tr
                      key={r.ticker}
                      style={{ borderTop: "1px solid rgba(255,255,255,0.03)", cursor: "pointer", transition: "background 0.15s" }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                      onClick={() => onSelectTicker(r.ticker)}
                    >
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{
                          fontFamily: MONO, fontWeight: 800,
                          color: i === 0 ? "#fbbf24" : i === 1 ? "#f0f0f0" : i === 2 ? "#cd7f32" : "#f0f0f0"
                        }}>
                          {i + 1}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <div style={{ fontWeight: 700, color: "#f0f0f0", fontFamily: MONO }}>{r.ticker}</div>
                        <div style={{ fontSize: 10, color: "#f0f0f0", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: MONO, color: "#f0f0f0" }}>
                        ${r.currentPrice?.toFixed(2) || "—"}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "center" }}>
                        <span style={{
                          fontFamily: MONO, fontWeight: 700, color: scoreColor(r.strategyScore),
                          background: scoreColor(r.strategyScore) + "15", padding: "3px 8px", borderRadius: 4, fontSize: 11
                        }}>
                          {r.strategyScore}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "center" }}>
                        <Pill color={gradeColor(r.strategyLabel)}>{r.strategyLabel}</Pill>
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: MONO, color: parseFloat(r.rawMomentum) >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                        {r.rawMomentum}%
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: MONO, color: "#f0f0f0", fontWeight: 600 }}>
                        {r.riskAdjMomentum}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "center" }}>
                        <TrendBadge status={r.trendStatus} />
                        {r.volatilityFlagged && <span title="High volatility detected" style={{ marginLeft: 4, color: "#f97316", fontSize: 10 }}>!</span>}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: MONO, color: "#f0f0f0" }}>
                        {r.volatility}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: MONO, color: "#ef4444" }}>
                        {r.maxDrawdown}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Box>

          {/* Methodology note */}
          <Box border="rgba(255,255,255,0.06)" style={{ marginTop: 8, background: "rgba(255,255,255,0.01)" }}>
            <div style={{ fontSize: 10, color: "#f0f0f0", lineHeight: 1.6, fontFamily: MONO }}>
              <strong style={{ color: "#f0f0f0" }}>Methodology:</strong> {METHODOLOGY[selectedStrategy] || METHODOLOGY.momentum}
            </div>
          </Box>
        </>
        </div>
      )}

      {!results && !loading && !error && (
        <Box border="rgba(255,255,255,0.06)" style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#f0f0f0", marginBottom: 6 }}>Strategy Scanner</div>
          <div style={{ fontSize: 11, color: "#f0f0f0" }}>
            Select a strategy and universe, then click "Run Scan" to rank stocks.
          </div>
        </Box>
      )}
    </div>
  );
}
