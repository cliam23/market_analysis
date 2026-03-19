import { useState, useEffect } from "react";
import { InfoTip } from "./shared.jsx";
import { EDUCATION } from "../lib/education.js";

const MONO = "'IBM Plex Mono', monospace";

function Box({ border, children, style: sx = {} }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.02)",
      border: "1px solid " + (border || "rgba(255,255,255,0.06)"),
      borderRadius: 10,
      padding: 14,
      marginBottom: 10,
      ...sx
    }}>
      {children}
    </div>
  );
}

function SH({ color, children }) {
  return (
    <div style={{
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: 2,
      color,
      marginBottom: 8,
      textTransform: "uppercase",
      fontFamily: MONO
    }}>
      {children}
    </div>
  );
}

function fmtBillions(val) {
  if (!val) return "$0";
  const absVal = Math.abs(val);
  if (absVal >= 1e12) return `$${(val / 1e12).toFixed(2)}T`;
  if (absVal >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (absVal >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  return `$${val.toFixed(0)}`;
}

function ScoreRing({ score }) {
  if (score === null || score === undefined) {
    return (
      <div style={{ position: "relative", width: 90, height: 90 }}>
        <svg width="90" height="90">
          <circle cx="45" cy="45" r="35" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
          <text x="45" y="50" textAnchor="middle" fill="#666" fontSize="14" fontFamily="IBM Plex Mono, monospace">N/A</text>
        </svg>
      </div>
    );
  }
  
  const radius = 35;
  const stroke = 6;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  
  const getColor = (s) => {
    if (s >= 65) return "#22c55e";
    if (s >= 50) return "#84cc16";
    if (s >= 35) return "#facc15";
    return "#f87171";
  };
  
  return (
    <div style={{ position: "relative", width: 90, height: 90 }}>
      <svg width="90" height="90" style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx="45" cy="45" r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
        />
        <circle
          cx="45" cy="45" r={radius}
          fill="none"
          stroke={getColor(score)}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        textAlign: "center"
      }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: "#f0f0f0", fontFamily: MONO }}>{score}</div>
      </div>
    </div>
  );
}

function MetricCard({ label, targetValue, peerMedian, percentile, verdict, excluded, excludedReason, softCapped, infoTip }) {
  const hasData = !excluded && targetValue !== null && targetValue !== undefined && peerMedian !== null && peerMedian !== undefined;
  
  const getVerdictColor = (v) => {
    if (v === "very_cheap" || v === "cheap") return "#22c55e";
    if (v === "very_expensive" || v === "expensive") return "#f87171";
    return "#facc15";
  };
  
  const getBarColor = (p) => {
    if (p <= 30) return "#22c55e";
    if (p <= 45) return "#84cc16";
    if (p <= 55) return "#facc15";
    if (p <= 70) return "#f97316";
    return "#f87171";
  };
  
  // Excluded metric (buyback distortion)
  if (excluded) {
    return (
      <div style={{
        background: "rgba(255,255,255,0.01)",
        borderRadius: 8,
        padding: 12,
        flex: "1 1 200px",
        border: "1px dashed rgba(255,255,255,0.1)"
      }}>
        <div style={{ fontSize: 9, color: "#555", fontFamily: MONO, marginBottom: 8, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
          {label}
          {infoTip && <InfoTip title={infoTip.title}>{infoTip.content}</InfoTip>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: "#666", fontFamily: MONO }}>{targetValue?.toFixed(1)}</span>
          <span style={{ fontSize: 9, color: "#888", padding: "2px 6px", background: "rgba(255,255,255,0.05)", borderRadius: 3 }}>EXCLUDED</span>
        </div>
        <div style={{ fontSize: 9, color: "#666", marginTop: 6, lineHeight: 1.4 }}>
          {excludedReason || "Distorted by share buybacks"}
        </div>
      </div>
    );
  }
  
  if (!hasData) {
    return (
      <div style={{
        background: "rgba(255,255,255,0.02)",
        borderRadius: 8,
        padding: 12,
        flex: "1 1 200px",
        opacity: 0.5
      }}>
        <div style={{ fontSize: 9, color: "#555", fontFamily: MONO, marginBottom: 8, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
          {label}
          {infoTip && <InfoTip title={infoTip.title}>{infoTip.content}</InfoTip>}
        </div>
        <div style={{ fontSize: 14, color: "#666", fontFamily: MONO, textAlign: "center", padding: "12px 0" }}>
          Data unavailable
        </div>
      </div>
    );
  }
  
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      borderRadius: 8,
      padding: 12,
      flex: "1 1 200px"
    }}>
      <div style={{ fontSize: 9, color: "#555", fontFamily: MONO, marginBottom: 8, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
        {label}
        {infoTip && <InfoTip title={infoTip.title}>{infoTip.content}</InfoTip>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: "#f0f0f0", fontFamily: MONO }}>
              {targetValue.toFixed(1)}
            </span>
            <span style={{ fontSize: 11, color: "#666", fontFamily: MONO }}>
              median: {peerMedian.toFixed(1)}
            </span>
          </div>
          <div style={{ height: 6, background: "rgba(255,255,255,0.1)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              width: `${percentile}%`,
              height: "100%",
              background: getBarColor(percentile),
              borderRadius: 3
            }} />
          </div>
        </div>
      </div>
      <div style={{ fontSize: 9, color: getVerdictColor(verdict), marginTop: 6, fontFamily: MONO, textTransform: "capitalize" }}>
        {verdict.replace("_", " ")}
      </div>
      {softCapped && (
        <div style={{ fontSize: 8, color: "#888", marginTop: 4 }}>
          * P/B elevated by high ROE
        </div>
      )}
    </div>
  );
}

function ComparisonTable({ comps }) {
  if (!comps?.compTable) return null;
  
  const formatVal = (val, decimals = 1) => {
    if (val === null || val === undefined) return "—";
    return val.toFixed(decimals);
  };
  
  const formatMC = (val) => {
    if (!val) return "—";
    if (val >= 1e12) return `$${(val / 1e12).toFixed(2)}T`;
    if (val >= 1e9) return `$${(val / 1e9).toFixed(0)}B`;
    return `$${(val / 1e6).toFixed(0)}M`;
  };
  
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: MONO }}>
        <thead>
          <tr style={{ color: "#555", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
            <th style={{ padding: "8px 10px", textAlign: "left" }}>Ticker</th>
            <th style={{ padding: "8px 10px", textAlign: "right" }}>Mkt Cap</th>
            <th style={{ padding: "8px 10px", textAlign: "right" }}>P/E</th>
            <th style={{ padding: "8px 10px", textAlign: "right" }}>Fwd P/E</th>
            <th style={{ padding: "8px 10px", textAlign: "right" }}>P/S</th>
            <th style={{ padding: "8px 10px", textAlign: "right" }}>P/B</th>
            <th style={{ padding: "8px 10px", textAlign: "right" }}>GM</th>
            <th style={{ padding: "8px 10px", textAlign: "right" }}>OM</th>
            <th style={{ padding: "8px 10px", textAlign: "right" }}>Rev Gr</th>
          </tr>
        </thead>
        <tbody>
          {comps.compTable.map((stock, i) => (
            <tr key={stock.ticker} style={{
              borderBottom: "1px solid rgba(255,255,255,0.03)",
              background: stock.isTarget ? "rgba(129,140,248,0.08)" : "transparent"
            }}>
              <td style={{ padding: "10px 10px" }}>
                <span style={{ fontWeight: stock.isTarget ? 700 : 400, color: stock.isTarget ? "#818cf8" : "#f0f0f0" }}>
                  {stock.ticker}
                </span>
                {stock.isTarget && <span style={{ fontSize: 8, color: "#818cf8", marginLeft: 6 }}>TARGET</span>}
              </td>
              <td style={{ padding: "10px 10px", textAlign: "right", color: "#888" }}>{formatMC(stock.marketCap)}</td>
              <td style={{ padding: "10px 10px", textAlign: "right", color: stock.trailingPE ? "#f0f0f0" : "#444" }}>
                {formatVal(stock.trailingPE)}
              </td>
              <td style={{ padding: "10px 10px", textAlign: "right", color: stock.forwardPE ? "#f0f0f0" : "#444" }}>
                {formatVal(stock.forwardPE)}
              </td>
              <td style={{ padding: "10px 10px", textAlign: "right", color: stock.priceToSales ? "#f0f0f0" : "#444" }}>
                {formatVal(stock.priceToSales)}
              </td>
              <td style={{ padding: "10px 10px", textAlign: "right", color: stock.priceToBook ? "#f0f0f0" : "#444" }}>
                {formatVal(stock.priceToBook)}
              </td>
              <td style={{ padding: "10px 10px", textAlign: "right", color: stock.grossMargin ? "#f0f0f0" : "#444" }}>
                {formatVal(stock.grossMargin)}%
              </td>
              <td style={{ padding: "10px 10px", textAlign: "right", color: stock.operatingMargin ? "#f0f0f0" : "#444" }}>
                {formatVal(stock.operatingMargin)}%
              </td>
              <td style={{ padding: "10px 10px", textAlign: "right", color: stock.revenueGrowth ? "#f0f0f0" : "#444" }}>
                {formatVal(stock.revenueGrowth)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CompsTab({ ticker }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ticker) return;
    
    setLoading(true);
    setError(null);
    
    fetch(`/api/comps/${ticker}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setData(d);
        } else {
          setError(d.error || "Failed to load comps");
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [ticker]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40, color: "#666" }}>
        Loading peer comparison...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: "center", padding: 40, color: "#f87171" }}>
        Error: {error}
      </div>
    );
  }

  if (!data) return null;

  const { composite, metrics, impliedFairValue, target } = data;

  const getVerdictColor = (v) => {
    if (v === "very_cheap" || v === "cheap") return "#22c55e";
    if (v === "very_expensive" || v === "expensive") return "#f87171";
    return "#facc15";
  };

  const validMetricCount = Object.values(metrics).filter(m => m?.targetValue != null && m?.peerMedian != null).length;
  const hasInsufficientData = validMetricCount < 2;

  return (
    <div>
      {/* Summary Card */}
      <Box border="rgba(129,140,248,0.2)">
        {hasInsufficientData && (
          <div style={{ fontSize: 10, color: "#facc15", background: "rgba(250,204,21,0.1)", border: "1px solid rgba(250,204,21,0.3)", borderRadius: 6, padding: "8px 12px", marginBottom: 12 }}>
            Limited valuation data ({validMetricCount} of 7 metrics) — comparison may be unreliable
          </div>
        )}
        <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
          <ScoreRing score={hasInsufficientData ? null : composite.relativeValueScore} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 6, fontFamily: MONO, display: "flex", alignItems: "center", gap: 6 }}>
              RELATIVE VALUE SCORE
              <InfoTip title={EDUCATION.relativeValueScore.title}>{EDUCATION.relativeValueScore.content}</InfoTip>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: hasInsufficientData ? "#666" : getVerdictColor(composite.verdict), marginBottom: 8 }}>
              {hasInsufficientData ? "N/A" : composite.verdict.replace("_", " ").toUpperCase()}
            </div>
            <div style={{ fontSize: 12, color: "#888", lineHeight: 1.5 }}>
              {composite.summary}
            </div>
            {composite.growthContext !== "fairly_priced" && (
              <div style={{ marginTop: 8, fontSize: 11, color: "#a78bfa" }}>
                Growth context: {composite.growthContext.replace("_", " ")}
              </div>
            )}
            {composite.growthDifferentialNote && (
              <div style={{ marginTop: 10, fontSize: 10, color: "#888", background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "10px 12px", lineHeight: 1.5 }}>
                {composite.growthDifferentialNote}
              </div>
            )}
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: "#555", fontFamily: MONO, marginBottom: 4, display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
              IMPLIED FAIR VALUE
              <InfoTip title={EDUCATION.impliedFairValue.title}>{EDUCATION.impliedFairValue.content}</InfoTip>
            </div>
            {impliedFairValue?.median > 0 ? (
              <>
                <div style={{ fontSize: 28, fontWeight: 700, color: impliedFairValue.upside >= 0 ? "#22c55e" : "#f87171", fontFamily: MONO }}>
                  ${impliedFairValue.median.toFixed(2)}
                </div>
                <div style={{ fontSize: 12, color: impliedFairValue.upside >= 0 ? "#22c55e" : "#f87171", fontFamily: MONO }}>
                  {impliedFairValue.upside >= 0 ? "+" : ""}{impliedFairValue.upside.toFixed(1)}% from ${target.currentPrice?.toFixed(2)}
                </div>
                {impliedFairValue.methodCount > 1 && (
                  <div style={{ fontSize: 9, color: "#555", marginTop: 2 }}>
                    Based on {impliedFairValue.methodCount} methods
                  </div>
                )}
                {impliedFairValue.pbExcluded && (
                  <div style={{ fontSize: 9, color: "#666", marginTop: 2 }}>
                    P/B excluded (buyback distortion)
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 14, color: "#666" }}>Insufficient data</div>
            )}
          </div>
        </div>
        <div style={{ marginTop: 12, fontSize: 9, color: "#444", fontFamily: MONO }}>
          Peer source: {data.peerSource?.replace("_", " ")} | {data.peers?.length || 0} peers
        </div>
      </Box>

      {/* Valuation Metrics */}
      <Box border="rgba(255,255,255,0.05)">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <SH color="#818cf8">VALUATION METRICS</SH>
          <InfoTip title={EDUCATION.comps.title}>{EDUCATION.comps.content}</InfoTip>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {metrics.trailingPE && (
            <MetricCard
              label="Trailing P/E"
              targetValue={metrics.trailingPE.targetValue}
              peerMedian={metrics.trailingPE.peerMedian}
              percentile={metrics.trailingPE.percentile}
              verdict={metrics.trailingPE.verdict}
              infoTip={EDUCATION.trailingPE}
            />
          )}
          {metrics.forwardPE && (
            <MetricCard
              label="Forward P/E"
              targetValue={metrics.forwardPE.targetValue}
              peerMedian={metrics.forwardPE.peerMedian}
              percentile={metrics.forwardPE.percentile}
              verdict={metrics.forwardPE.verdict}
              infoTip={EDUCATION.forwardPE}
            />
          )}
          {metrics.priceToSales && (
            <MetricCard
              label="P/S Ratio"
              targetValue={metrics.priceToSales.targetValue}
              peerMedian={metrics.priceToSales.peerMedian}
              percentile={metrics.priceToSales.percentile}
              verdict={metrics.priceToSales.verdict}
              infoTip={EDUCATION.priceToSales}
            />
          )}
          {metrics.priceToBook && (
            <MetricCard
              label="P/B Ratio"
              targetValue={metrics.priceToBook.targetValue}
              peerMedian={metrics.priceToBook.peerMedian}
              percentile={metrics.priceToBook.percentile}
              verdict={metrics.priceToBook.verdict}
              excluded={metrics.priceToBook.excluded}
              excludedReason={metrics.priceToBook.excludedReason}
              softCapped={metrics.priceToBook.softCapped}
              infoTip={EDUCATION.priceToBook}
            />
          )}
          {metrics.evToEbitda && (
            <MetricCard
              label="EV/EBITDA"
              targetValue={metrics.evToEbitda.targetValue}
              peerMedian={metrics.evToEbitda.peerMedian}
              percentile={metrics.evToEbitda.percentile}
              verdict={metrics.evToEbitda.verdict}
              infoTip={EDUCATION.evToEbitda}
            />
          )}
          {metrics.pegRatio && (
            <MetricCard
              label="PEG Ratio"
              targetValue={metrics.pegRatio.targetValue}
              peerMedian={metrics.pegRatio.peerMedian}
              percentile={metrics.pegRatio.percentile}
              verdict={metrics.pegRatio.verdict}
              infoTip={EDUCATION.pegRatio}
            />
          )}
        </div>
      </Box>

      {/* Comparison Table */}
      <Box border="rgba(255,255,255,0.05)">
        <SH color="#f0f0f0">COMPARABLE COMPANIES</SH>
        <ComparisonTable comps={data} />
      </Box>

      {/* Metric Explanations */}
      {Object.entries(metrics).filter(([k, v]) => v?.explanation).length > 0 && (
        <Box border="rgba(255,255,255,0.05)">
          <SH color="#888">ANALYSIS</SH>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.entries(metrics)
              .filter(([k, v]) => v?.explanation)
              .map(([key, m]) => (
                <div key={key} style={{ fontSize: 11, color: "#999", lineHeight: 1.5 }}>
                  <span style={{ color: "#f0f0f0", fontWeight: 600 }}>{key.replace(/([A-Z])/g, ' $1').toUpperCase()}:</span> {m.explanation}
                </div>
              ))}
          </div>
        </Box>
      )}
    </div>
  );
}
