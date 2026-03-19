import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { LoadingSpinner, InfoTip } from "./shared.jsx";
import { EDUCATION } from "../lib/education.js";
const DCFTab = lazy(() => import("./DCFTab.jsx"));
const CompsTab = lazy(() => import("./CompsTab.jsx"));

const MONO = "'IBM Plex Mono', monospace";
const SANS = "'DM Sans', sans-serif";

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

function Pill({ children, color = "#818cf8", style: sx = {} }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: 0.8,
      borderRadius: 3,
      background: color + "15",
      border: "1px solid " + color + "35",
      color,
      fontFamily: MONO,
      textTransform: "uppercase",
      whiteSpace: "nowrap",
      ...sx
    }}>
      {children}
    </span>
  );
}

function Ring({ value, max = 100, size = 52, sw = 4, color }) {
  const r = (size - sw) / 2;
  const ci = 2 * Math.PI * r;
  const p = Math.min(value / max, 1);
  const c = color || (value >= 75 ? "#22c55e" : value >= 50 ? "#eab308" : "#ef4444");
  
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={sw} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={c}
        strokeWidth={sw}
        strokeDasharray={ci}
        strokeDashoffset={ci * (1 - p)}
        strokeLinecap="round"
        transform={"rotate(-90 " + size / 2 + " " + size / 2 + ")"}
      />
      <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central" fill={c} fontSize={size * 0.26} fontWeight="800" fontFamily={MONO}>
        {value}
      </text>
    </svg>
  );
}

function Met({ label, value, color = "#f0f0f0" }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      borderRadius: 6,
      padding: "8px 10px",
      textAlign: "center",
      flex: "1 1 75px",
      minWidth: 75
    }}>
      <div style={{ fontSize: 8, color: "#555", fontWeight: 700, letterSpacing: 1, fontFamily: MONO }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color, fontFamily: MONO, marginTop: 2 }}>{value}</div>
    </div>
  );
}

const vc = (v) => ({
  strong_buy: "#22c55e", buy: "#4ade80", buy_zone: "#4ade80",
  accumulate: "#eab308", hold: "#94a3b8", avoid: "#ef4444", wait: "#ef4444"
}[v] || "#888");

const tc = (l) => ({ low: "#22c55e", moderate: "#eab308", high: "#f97316", severe: "#ef4444" }[l] || "#888");
const aiColors = { strong_tailwind: "#22c55e", tailwind: "#4ade80", neutral: "#94a3b8", headwind: "#f97316", strong_headwind: "#ef4444" };
const strengthColors = { strong: "#22c55e", moderate: "#eab308", weak: "#f97316", none: "#ef4444" };

function ScoreBar({ score, max = 25, label, strength, color }) {
  const pct = Math.min(score / max, 1) * 100;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#d0d0d0" }}>{label}</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Pill color={strengthColors[strength] || "#888"}>{strength}</Pill>
          <span style={{ fontSize: 11, fontWeight: 700, color, fontFamily: MONO }}>{score}/{max}</span>
        </div>
      </div>
      <div style={{ height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, transition: "width 0.5s" }} />
      </div>
    </div>
  );
}

function NetworkInput({ ticker, onSubmit }) {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (score, label) => {
    setSubmitting(true);
    try {
      await fetch(`/api/analysis/${ticker}/network-input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ networkEffectScore: score, label })
      });
      setSubmitted(true);
      onSubmit();
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return null;
  }

  return (
    <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: 12, marginTop: 8 }}>
      <div style={{ fontSize: 10, color: "#818cf8", marginBottom: 8, fontWeight: 600 }}>🌐 Your product assessment</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[
          { score: 10, label: "Strong", desc: "Core value driver" },
          { score: 7, label: "Moderate", desc: "Some benefits" },
          { score: 3, label: "Weak", desc: "Minimal effects" },
          { score: 0, label: "None", desc: "No network" }
        ].map(opt => (
          <button
            key={opt.score}
            onClick={() => handleSubmit(opt.score, opt.label)}
            disabled={submitting}
            style={{
              padding: "6px 10px",
              background: "rgba(129,140,248,0.08)",
              border: "1px solid rgba(129,140,248,0.2)",
              borderRadius: 6,
              color: "#818cf8",
              fontSize: 10,
              cursor: "pointer",
              fontFamily: MONO
            }}
          >
            {opt.label} ({opt.score})
          </button>
        ))}
      </div>
      <div style={{ fontSize: 9, color: "#555", marginTop: 6 }}>Click to save your assessment for this stock</div>
    </div>
  );
}

function OverviewTab({ data }) {
  const uv = parseFloat(data.intrinsicValue?.undervaluation) || 0;
  const hasEstimatedFields = data.dataQuality?.estimatedFields?.length > 0;
  
  return (
    <>
      {hasEstimatedFields && (
        <div style={{ 
          fontSize: 10, 
          color: "#888", 
          background: "rgba(255,255,255,0.02)", 
          border: "1px solid rgba(255,255,255,0.06)", 
          borderRadius: 6, 
          padding: "8px 12px", 
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          gap: 6
        }}>
          <span>ℹ️</span>
          <span>Some values estimated — Yahoo Finance historical data currently limited. Fields: {data.dataQuality.estimatedFields.join(", ")}</span>
        </div>
      )}
      
      <Box border={(data.composite?.color || vc(data.verdict)) + "30"} style={{ background: `linear-gradient(135deg,${data.composite?.color || vc(data.verdict)}08,transparent)`, padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <Ring value={data.composite?.score || data.buffettChecklist?.total || 0} size={72} sw={5} color={data.composite?.color || "#818cf8"} />
            <div style={{ fontSize: 10, fontWeight: 700, color: data.composite?.color || "#818cf8", fontFamily: MONO, textAlign: "center" }}>
              {data.composite?.grade || ""} {data.composite?.label || ""}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
              <span style={{ fontSize: 28, fontWeight: 900, color: "#f0f0f0", fontFamily: MONO }}>{data.ticker}</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: "#818cf8", fontFamily: MONO }}>${data.price?.toFixed(2)}</span>
              <Pill color={data.composite?.color || vc(data.verdict)}>{data.composite?.label || data.verdict?.replace(/_/g, " ").toUpperCase() || "HOLD"}</Pill>
              {uv >= 0 && <Pill color="#22c55e">{uv.toFixed(1)}% UNDERVALUED</Pill>}
              {uv < 0 && <Pill color="#ef4444">{Math.abs(uv).toFixed(1)}% OVERVALUED</Pill>}
            </div>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 10 }}>{data.sector} {data.industry && `• ${data.industry}`}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Pill color="#a78bfa">P/E {data.fundamentals?.forwardPE?.toFixed(1) || "N/A"}</Pill>
              <Pill color="#f97316">ROIC {data.roicTree?.roic}%</Pill>
              {data.fundamentals?.dividendYield > 0 && (
                <Pill color="#22c55e">DIV {((data.fundamentals.dividendYield || 0) * 100).toFixed(1)}%</Pill>
              )}
            </div>
          </div>
        </div>
        
        {data.composite && data.composite.components && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#888", fontFamily: MONO }}>SCORE BREAKDOWN</span>
              <InfoTip title={EDUCATION.compositeScore?.title || "Composite Score"}>{EDUCATION.compositeScore?.content || "Weighted combination of all analysis signals"}</InfoTip>
            </div>
            
            <div style={{ height: 8, background: "rgba(255,255,255,0.05)", borderRadius: 4, overflow: "hidden", display: "flex", marginBottom: 12 }}>
              {data.composite.components.map((comp, i) => {
                const pct = (comp.weighted / (data.composite.rawScore || 1)) * 100;
                const segColor = comp.score >= 60 ? "#22c55e" : comp.score >= 40 ? "#eab308" : "#ef4444";
                return (
                  <div key={i} style={{ width: `${pct}%`, background: segColor, height: "100%", minWidth: 2 }} title={`${comp.name}: ${comp.weighted.toFixed(1)} pts`} />
                );
              })}
            </div>
            
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
              {data.composite.components.map((comp, i) => {
                const compColor = comp.score >= 60 ? "#22c55e" : comp.score >= 40 ? "#eab308" : "#ef4444";
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: compColor }} />
                    <span style={{ color: "#888" }}>{comp.name.split(" ")[0]}: {comp.weighted.toFixed(1)}</span>
                  </div>
                );
              })}
            </div>
            
            {data.composite.strengths?.length > 0 && data.composite.weaknesses?.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "#22c55e", marginBottom: 6, fontFamily: MONO }}>STRENGTHS</div>
                  {data.composite.strengths.map((s, i) => (
                    <div key={i} style={{ fontSize: 10, color: "#999", marginBottom: 4 }}>
                      <span style={{ color: "#22c55e", fontWeight: 700 }}>✓</span> {s.name}: {s.score}/100
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "#ef4444", marginBottom: 6, fontFamily: MONO }}>WEAKNESSES</div>
                  {data.composite.weaknesses.map((w, i) => (
                    <div key={i} style={{ fontSize: 10, color: "#999", marginBottom: 4 }}>
                      <span style={{ color: "#ef4444", fontWeight: 700 }}>✗</span> {w.name}: {w.score}/100
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {data.composite.catalysts?.toReachBuy && (
              <div style={{ marginTop: 12, fontSize: 10, color: "#60a5fa", padding: "8px 10px", background: "rgba(96,165,250,0.08)", borderRadius: 6 }}>
                <span style={{ fontWeight: 700 }}>📈 CATALYST:</span> {data.composite.catalysts.toReachBuy}
              </div>
            )}
          </div>
        )}
      </Box>

      <Box border="rgba(129,140,248,0.15)">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SH color="#818cf8">Buffett Checklist — {data.buffettChecklist?.total || 0}/100</SH>
          <InfoTip title={EDUCATION.buffettChecklist.title}>{EDUCATION.buffettChecklist.content}</InfoTip>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          {data.buffettChecklist?.items?.map((item, i) => {
            const eduKey = item.name.toLowerCase().replace(/\s+/g, '');
            const edu = EDUCATION[eduKey] || {};
            return (
              <div key={i} style={{ display: "flex", gap: 12, padding: "10px 12px", background: "rgba(255,255,255,0.02)", borderRadius: 6, alignItems: "center" }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: item.pass ? "#22c55e15" : "#ef444415", border: `1.5px solid ${item.pass ? "#22c55e" : "#ef4444"}45`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: item.pass ? "#22c55e" : "#ef4444", fontWeight: 700, flexShrink: 0 }}>
                  {item.pass ? "✓" : "✗"}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#d0d0d0", display: "flex", alignItems: "center", gap: 4 }}>
                      {item.name}
                      {edu.content && <InfoTip title={edu.title}>{edu.content}</InfoTip>}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: item.pass ? "#22c55e" : "#ef4444", fontFamily: MONO }}>{item.value}</span>
                  </div>
                  {item.detail && <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>{item.detail}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </Box>

      <Box border="rgba(34,197,94,0.2)">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <SH color="#22c55e">Earnings Quality</SH>
          <InfoTip title={EDUCATION.earningsQuality.title}>{EDUCATION.earningsQuality.content}</InfoTip>
          <Pill color={data.earningsQuality?.grade === "A" ? "#22c55e" : data.earningsQuality?.grade === "B" ? "#a78bfa" : data.earningsQuality?.grade === "C" ? "#eab308" : "#ef4444"} style={{ fontSize: 11, padding: "3px 10px" }}>
            {data.earningsQuality?.grade || "?"} ({data.earningsQuality?.score || 0}/100)
          </Pill>
        </div>
        {data.earningsQuality?.keyInsight && (
          <div style={{ fontSize: 11, color: "#999", marginBottom: 12, padding: "8px 10px", background: "rgba(255,255,255,0.02)", borderRadius: 6 }}>
            {data.earningsQuality.keyInsight}
          </div>
        )}
        <div style={{ display: "grid", gap: 6 }}>
          {[
            { label: "Accruals", key: "accruals", color: "#818cf8", edu: EDUCATION.accrualRatio },
            { label: "FCF Conversion", key: "fcfConversion", color: "#22c55e", edu: EDUCATION.fcfConversion },
            { label: "Stability", key: "earningsStability", color: "#60a5fa", edu: EDUCATION.earningsStability },
            { label: "Revenue Quality", key: "revenueQuality", color: "#f97316", edu: EDUCATION.revenueQuality },
            { label: "Capital Alloc", key: "capitalAllocation", color: "#a78bfa", edu: EDUCATION.capitalAllocation }
          ].map(comp => {
            const c = data.earningsQuality?.components?.[comp.key] || {};
            const pct = (c.score / c.maxScore) * 100;
            return (
              <div key={comp.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 9, color: "#888", width: 80, display: "flex", alignItems: "center", gap: 4 }}>
                  {comp.label}
                  {comp.edu && <InfoTip title={comp.edu.title}>{comp.edu.content}</InfoTip>}
                </div>
                <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: comp.color, transition: "width 0.3s" }} />
                </div>
                <div style={{ fontSize: 10, fontWeight: 600, color: comp.color, fontFamily: MONO, width: 28 }}>
                  {c.score}/{c.maxScore}
                </div>
              </div>
            );
          })}
        </div>
        {data.earningsQuality?.flags?.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            {data.earningsQuality.flags.map((flag, i) => (
              <div key={i} style={{ fontSize: 10, color: flag.type === "positive" ? "#22c55e" : "#ef4444", padding: "4px 8px", background: flag.type === "positive" ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)", borderRadius: 4 }}>
                {flag.type === "positive" ? "✓" : "⚠"} {flag.message}
              </div>
            ))}
          </div>
        )}
      </Box>

      {data.totalShareholderYield && (
        <Box border="rgba(250,204,21,0.2)">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <SH color="#facc15">Total Shareholder Yield</SH>
            <InfoTip title={EDUCATION.totalShareholderYield.title}>{EDUCATION.totalShareholderYield.content}</InfoTip>
            <Pill color={data.totalShareholderYield.qualityScore >= 70 ? "#22c55e" : data.totalShareholderYield.qualityScore >= 50 ? "#eab308" : "#ef4444"} style={{ fontSize: 11, padding: "3px 10px" }}>
              {data.totalShareholderYield.qualityScore}/100
            </Pill>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Pill 
              color={data.totalShareholderYield.category === "exceptional_returner" ? "#22c55e" : 
                     data.totalShareholderYield.category === "strong_returner" ? "#4ade80" :
                     data.totalShareholderYield.category === "moderate_returner" ? "#eab308" :
                     data.totalShareholderYield.category === "minimal_returner" ? "#f97316" : "#94a3b8"}
            >
              {data.totalShareholderYield.category?.replace(/_/g, " ").toUpperCase()}
            </Pill>
            <div style={{ fontSize: 24, fontWeight: 900, fontFamily: MONO, color: "#facc15" }}>
              {data.totalShareholderYield.totalYield}%
            </div>
            <span style={{ fontSize: 11, color: "#666" }}>annual return to shareholders</span>
          </div>

          <div style={{ height: 10, background: "rgba(255,255,255,0.05)", borderRadius: 5, overflow: "hidden", marginBottom: 16, display: "flex" }}>
            {data.totalShareholderYield.dividendYield > 0 && (
              <div style={{ 
                width: `${Math.min((data.totalShareholderYield.dividendYield / data.totalShareholderYield.totalYield) * 100, 100)}%`, 
                background: "#22c55e", 
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 8,
                color: "#fff",
                fontWeight: 700
              }}>
                {data.totalShareholderYield.dividendYield.toFixed(1)}%
              </div>
            )}
            {data.totalShareholderYield.buybackYield > 0 && (
              <div style={{ 
                width: `${Math.min((data.totalShareholderYield.buybackYield / data.totalShareholderYield.totalYield) * 100, 100)}%`, 
                background: "#60a5fa", 
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 8,
                color: "#fff",
                fontWeight: 700
              }}>
                {data.totalShareholderYield.buybackYield.toFixed(1)}%
              </div>
            )}
            {data.totalShareholderYield.debtPaydownYield > 0 && (
              <div style={{ 
                width: `${Math.min((data.totalShareholderYield.debtPaydownYield / data.totalShareholderYield.totalYield) * 100, 100)}%`, 
                background: "#a78bfa", 
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 8,
                color: "#fff",
                fontWeight: 700
              }}>
                {data.totalShareholderYield.debtPaydownYield.toFixed(1)}%
              </div>
            )}
            {data.totalShareholderYield.totalYield === 0 && (
              <div style={{ width: "100%", background: "rgba(255,255,255,0.1)", height: "100%" }} />
            )}
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "#22c55e" }} />
              <span style={{ color: "#888" }}>Dividends</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "#60a5fa" }} />
              <span style={{ color: "#888" }}>Buybacks</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "#a78bfa" }} />
              <span style={{ color: "#888" }}>Debt Paydown</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <div style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: 6, padding: "8px 12px", flex: "1 1 80px", textAlign: "center" }}>
              <div style={{ fontSize: 8, color: "#22c55e", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>DIVIDENDS</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#22c55e", fontFamily: MONO }}>{data.totalShareholderYield.dividendYield}%</div>
            </div>
            <div style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.15)", borderRadius: 6, padding: "8px 12px", flex: "1 1 80px", textAlign: "center" }}>
              <div style={{ fontSize: 8, color: "#60a5fa", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>BUYBACKS</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#60a5fa", fontFamily: MONO }}>
                {data.totalShareholderYield.buybackYield.toFixed(1)}%
                {data.totalShareholderYield.buybackEstimated && <span style={{ fontSize: 8, color: "#666" }}> *</span>}
              </div>
            </div>
            <div style={{ background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.15)", borderRadius: 6, padding: "8px 12px", flex: "1 1 80px", textAlign: "center" }}>
              <div style={{ fontSize: 8, color: "#a78bfa", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>DEBT</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#a78bfa", fontFamily: MONO }}>
                {data.totalShareholderYield.debtPaydownYield > 0 ? "+" : ""}{data.totalShareholderYield.debtPaydownYield.toFixed(1)}%
              </div>
            </div>
            <div style={{ background: "rgba(250,204,21,0.08)", border: "1px solid rgba(250,204,21,0.15)", borderRadius: 6, padding: "8px 12px", flex: "1 1 80px", textAlign: "center" }}>
              <div style={{ fontSize: 8, color: "#facc15", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>TOTAL</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#facc15", fontFamily: MONO }}>{data.totalShareholderYield.totalYield.toFixed(1)}%</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 16, marginBottom: 12, padding: "8px 12px", background: "rgba(255,255,255,0.02)", borderRadius: 6 }}>
            <div style={{ fontSize: 10 }}>
              <span style={{ color: "#666" }}>vs 10Y Treasury: </span>
              <span style={{ fontFamily: MONO, color: data.totalShareholderYield.yieldVsTreasury >= 0 ? "#22c55e" : "#ef4444", fontWeight: 700 }}>
                {data.totalShareholderYield.yieldVsTreasury >= 0 ? "+" : ""}{data.totalShareholderYield.yieldVsTreasury}%
              </span>
            </div>
            {data.totalShareholderYield.returnCoverage !== null && (
              <div style={{ fontSize: 10 }}>
                <span style={{ color: "#666" }}>FCF Coverage: </span>
                <span style={{ fontFamily: MONO, color: data.totalShareholderYield.returnCoverage >= 1.5 ? "#22c55e" : data.totalShareholderYield.returnCoverage >= 1 ? "#eab308" : "#ef4444", fontWeight: 700 }}>
                  {data.totalShareholderYield.returnCoverage}x
                </span>
                <InfoTip title={EDUCATION.tsyFcfCoverage.title}>{EDUCATION.tsyFcfCoverage.content}</InfoTip>
              </div>
            )}
          </div>

          <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
            {[
              { label: "Yield Level", key: "yieldLevel", color: "#facc15", edu: EDUCATION.totalShareholderYield },
              { label: "Sustainability", key: "sustainability", color: "#22c55e", edu: EDUCATION.tsyFcfCoverage },
              { label: "Buyback Effectiveness", key: "buybackEffectiveness", color: "#60a5fa", edu: EDUCATION.tsyBuybacks },
              { label: "Dividend Growth", key: "dividendGrowth", color: "#a78bfa", edu: EDUCATION.tsyDividends }
            ].map(comp => {
              const c = data.totalShareholderYield.qualityComponents?.[comp.key] || {};
              const pct = (c.score / c.maxScore) * 100;
              return (
                <div key={comp.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 9, color: "#888", width: 120, display: "flex", alignItems: "center", gap: 4 }}>
                    {comp.label}
                    <InfoTip title={comp.edu.title}>{comp.edu.content}</InfoTip>
                  </div>
                  <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: comp.color, transition: "width 0.3s" }} />
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: comp.color, fontFamily: MONO, width: 28 }}>
                    {c.score}/{c.maxScore}
                  </div>
                </div>
              );
            })}
          </div>

          {data.totalShareholderYield.flags?.length > 0 && (
            <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              {data.totalShareholderYield.flags.map((flag, i) => (
                <div key={i} style={{ 
                  fontSize: 10, 
                  color: flag.type === "warning" ? "#eab308" : "#60a5fa", 
                  padding: "6px 10px", 
                  background: flag.type === "warning" ? "rgba(234,179,8,0.08)" : "rgba(96,165,250,0.08)", 
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 6
                }}>
                  <span>{flag.type === "warning" ? "⚠" : "ℹ"}</span>
                  <span>{flag.message}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 11, color: "#999", lineHeight: 1.5, padding: "10px 12px", background: "rgba(255,255,255,0.02)", borderRadius: 6 }}>
            {data.totalShareholderYield.summary}
          </div>
        </Box>
      )}

      <Box border={data.entryTiming?.overextended ? "rgba(239,68,68,0.3)" : "rgba(129,140,248,0.15)"}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SH color="#818cf8">Entry Timing — {data.entryTiming?.signal?.replace(/_/g, " ").toUpperCase()}</SH>
          <InfoTip title={EDUCATION.entryTiming.title}>{EDUCATION.entryTiming.content}</InfoTip>
        </div>
        {data.entryTiming?.overextendedWarning && (
          <div style={{ fontSize: 10, color: "#f87171", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, padding: "8px 12px", marginBottom: 12 }}>
            ⚠️ {data.entryTiming.overextendedWarning}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <Met label="52W HIGH" value={data.entryTiming?.distance + "%" || "—"} color={parseFloat(data.entryTiming?.distance) < 15 ? "#ef4444" : "#eab308"} />
          <Met label="200D MA" value={data.entryTiming?.maDistance !== "N/A" ? data.entryTiming?.maDistance + "%" : "N/A"} color={data.entryTiming?.overextended ? "#ef4444" : "#888"} />
          <Met label="MOS SCORE" value={data.entryTiming?.mos + "/4" || "—"} color="#22c55e" />
          <Met label="PE SCORE" value={data.entryTiming?.pe + "/4" || "—"} color="#a78bfa" />
        </div>
        <Pill color={vc(data.entryTiming?.signal)} style={{ fontSize: 11, padding: "4px 12px" }}>Total: {data.entryTiming?.total || 0}/17</Pill>
      </Box>

      <Box border="rgba(250,204,21,0.15)">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SH color="#facc15">Intrinsic Value</SH>
          <InfoTip title={EDUCATION.intrinsicValue.title}>{EDUCATION.intrinsicValue.content}</InfoTip>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {[
            { label: "EPV", value: data.intrinsicValue?.epv, color: "#818cf8" },
            { label: "FCF", value: data.intrinsicValue?.fcf, color: "#22c55e" },
            { label: "Graham", value: data.intrinsicValue?.graham, color: "#facc15" },
            { label: "AVG", value: data.intrinsicValue?.avg, color: uv >= 0 ? "#22c55e" : "#ef4444" }
          ].map(item => (
            <div key={item.label} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "10px 14px", textAlign: "center", flex: "1 1 80px" }}>
              <div style={{ fontSize: 8, color: "#555", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>{item.label}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: item.color, fontFamily: MONO }}>
                {item.value !== "N/A" ? "$" + item.value : "N/A"}
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "#888", textAlign: "center" }}>
          Current: ${data.price?.toFixed(2)} → <strong style={{ color: uv >= 0 ? "#22c55e" : "#ef4444" }}>{uv.toFixed(1)}%</strong> {uv >= 0 ? "undervalued" : "overvalued"}
        </div>
      </Box>
    </>
  );
}

function MoatCategoryCard({ label, score, max, strength, color, expanded, onClick, details }) {
  const pct = Math.min(score / max, 1) * 100;
  const strengthColor = strengthColors[strength] || "#888";
  
  return (
    <div 
      onClick={onClick}
      style={{ 
        cursor: "pointer",
        background: expanded ? "rgba(129,140,248,0.06)" : "transparent",
        border: `1px solid ${expanded ? color + "40" : "rgba(255,255,255,0.06)"}`,
        borderRadius: 8,
        padding: "10px 12px",
        transition: "all 0.2s ease"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: "#d0d0d0" }}>{label}</span>
        <span style={{ fontSize: 9, color: "#888" }}>{expanded ? "▴" : "▾"}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: color, transition: "width 0.3s" }} />
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 2, background: strengthColor + "15", color: strengthColor }}>{strength.toUpperCase()}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color, fontFamily: MONO }}>{score}/{max}</span>
        </div>
      </div>
    </div>
  );
}

function SubScoreRow({ label, score, max, color }) {
  const pct = Math.min(score / max, 1) * 100;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ fontSize: 9, color: "#888", width: 100 }}>{label}</div>
      <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, transition: "width 0.3s" }} />
      </div>
      <div style={{ fontSize: 10, fontWeight: 600, color, fontFamily: MONO, width: 24 }}>{score}/{max}</div>
    </div>
  );
}

function EvidenceIndicator({ label, value, good, showGood }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10 }}>
      <span style={{ color: "#666" }}>{label}:</span>
      <span style={{ fontFamily: MONO, color: "#f0f0f0" }}>{value}</span>
      {showGood !== undefined && (
        <span style={{ color: good ? "#22c55e" : "#ef4444", fontWeight: 700 }}>{good ? "✓" : "✗"}</span>
      )}
    </div>
  );
}

function SupplySideDetail({ data }) {
  const moatData = data?.moatAnalysis?.categories?.supply_side || {};
  const details = moatData.details || {};
  
  const revenueGrowth = details.revenueGrowth ?? details.revGrowth ?? 'N/A';
  const earningsGrowth = details.earningsGrowth ?? details.earnGrowth ?? 'N/A';
  const leverageDelta = details.leverageDelta ?? details.scaleEfficiency ?? 'N/A';
  const grossMargin = details.grossMargin ?? details.gm ?? 'N/A';
  const operatingMargin = details.operatingMargin ?? details.om ?? 'N/A';
  const scaleRevenue = details.scaleRevenue ?? details.revenueB ?? 'N/A';
  
  const leveragePositive = parseFloat(leverageDelta) >= 0;
  const leverageType = leveragePositive ? 'positive' : 'negative';
  
  return (
    <div style={{ animation: "fadeUp 0.25s ease-out" }}>
      <div style={{ fontSize: 9, color: "#a78bfa", fontFamily: MONO, marginBottom: 12 }}>
        SUB-SCORES
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 16 }}>
        <SubScoreRow label="Scale Efficiency" score={leveragePositive ? 6 : 3} max={8} color="#818cf8" />
        <SubScoreRow label="Gross Margin" score={parseFloat(grossMargin) >= 45 ? 4 : parseFloat(grossMargin) >= 30 ? 2 : 1} max={6} color="#818cf8" />
        <SubScoreRow label="Op Leverage" score={parseFloat(earningsGrowth) > parseFloat(revenueGrowth) ? 4 : 2} max={6} color="#818cf8" />
        <SubScoreRow label="Revenue Scale" score={parseFloat(scaleRevenue) >= 100 ? 5 : parseFloat(scaleRevenue) >= 50 ? 4 : 3} max={5} color="#818cf8" />
      </div>
      
      <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 6, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 9, color: "#888", marginBottom: 8 }}>GROWTH COMPARISON</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ fontSize: 9, color: "#666", marginBottom: 4 }}>Revenue Growth</div>
            <div style={{ height: 6, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(parseFloat(revenueGrowth) || 0, 30) / 30 * 100}%`, background: "#818cf8" }} />
            </div>
            <div style={{ fontSize: 11, color: "#818cf8", fontFamily: MONO, marginTop: 4 }}>{revenueGrowth}%</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#666", marginBottom: 4 }}>Earnings Growth</div>
            <div style={{ height: 6, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(parseFloat(earningsGrowth) || 0, 30) / 30 * 100}%`, background: "#22c55e" }} />
            </div>
            <div style={{ fontSize: 11, color: "#22c55e", fontFamily: MONO, marginTop: 4 }}>{earningsGrowth}%</div>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 10, color: leveragePositive ? "#22c55e" : "#ef4444" }}>
          Leverage Gap: {leveragePositive ? "+" : ""}{leverageDelta}%
        </div>
      </div>
      
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 9, color: "#888", marginBottom: 8 }}>CURRENT MARGINS</div>
        <div style={{ display: "flex", gap: 16 }}>
          <EvidenceIndicator label="Gross Margin" value={grossMargin + "%"} good={parseFloat(grossMargin) >= 40} showGood />
          <EvidenceIndicator label="Operating Margin" value={operatingMargin + "%"} good={parseFloat(operatingMargin) >= 20} showGood />
        </div>
      </div>
      
      <p style={{ fontSize: 12, color: "#999", lineHeight: 1.6, margin: "0 0 12px 0" }}>
        {moatData.explanation || data?.moatAnalysis?.moat_narrative}
      </p>
      
      <div style={{ fontSize: 11, color: "#f0f0f0", fontWeight: 600 }}>
        VERDICT: {moatData.strength?.toUpperCase() || 'N/A'} supply-side advantages — revenue growing {revenueGrowth}% while earnings growing {earningsGrowth}% — {leverageType} operating leverage gap of {leverageDelta}% at ${scaleRevenue}B scale.
      </div>
    </div>
  );
}

function NetworkDetail({ data, ticker, refreshKey }) {
  const moatData = data?.moatAnalysis?.categories?.network_effects || {};
  const details = moatData.details || {};
  const companyName = data?.name || "the company";
  const industryName = details.industryName || data?.industry || 'Unknown';
  
  return (
    <div style={{ animation: "fadeUp 0.25s ease-out" }}>
      <div style={{ fontSize: 9, color: "#22c55e", fontFamily: MONO, marginBottom: 12 }}>
        SUB-SCORES
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 16 }}>
        <SubScoreRow label="Industry Signal" score={details.industrySignal || details.subScores?.industrySignal || 1} max={7} color="#22c55e" />
        <SubScoreRow label="Growth+Margin" score={details.growthMarginSignal || details.subScores?.growthMarginCombo || 0} max={4} color="#22c55e" />
        <SubScoreRow label="Market Dominance" score={details.scaleSignal || details.subScores?.marketDominance || 0} max={4} color="#22c55e" />
        <SubScoreRow label="Your Input" score={details.userInputProvided ? 10 : 0} max={10} color="#22c55e" />
      </div>
      
      {!details.userInputProvided ? (
        <div style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#f0f0f0", marginBottom: 12, fontWeight: 600 }}>
            Does {companyName}'s product get more valuable as more people use it?
          </div>
          <NetworkInput ticker={ticker} onSubmit={refreshKey} />
        </div>
      ) : (
        <div style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 6, padding: 10, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12 }}>🌐</span>
          <span style={{ fontSize: 11, color: "#22c55e", fontWeight: 600 }}>Your assessment: {details.userLabel?.toUpperCase() || details.userInputLabel?.toUpperCase() || 'CONFIRMED'} network effects</span>
        </div>
      )}
      
      <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 6, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 9, color: "#888", marginBottom: 8 }}>ALGORITHMIC SIGNALS</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 10, color: "#999" }}>
            Industry: <span style={{ color: "#f0f0f0" }}>{industryName}</span> → {(details.industrySignal || 0) >= 4 ? "Strong" : (details.industrySignal || 0) >= 2 ? "Moderate" : "Weak"} network signal
          </div>
          <div style={{ fontSize: 10, color: "#999" }}>
            Algorithmic score: <span style={{ color: "#22c55e", fontFamily: MONO }}>{(details.algorithmicScore || 0)}/15</span> (excluding user input)
          </div>
        </div>
      </div>
      
      <p style={{ fontSize: 12, color: "#999", lineHeight: 1.6, margin: "0 0 12px 0" }}>
        {moatData.explanation || `Network effects analysis for ${companyName}.`}
      </p>
      
      <div style={{ fontSize: 11, color: "#f0f0f0", fontWeight: 600 }}>
        VERDICT: {moatData.strength?.toUpperCase() || 'N/A'} network effects — {(details.industrySignal || 0) >= 4 ? "strong industry fundamentals for network dynamics" : (details.industrySignal || 0) >= 2 ? "moderate network potential in this industry" : "limited network effects in this business"}
      </div>
    </div>
  );
}

function LearningDetail({ data }) {
  const moatData = data?.moatAnalysis?.categories?.learning_curve || {};
  const details = moatData.details || {};
  const companyName = data?.name || "the company";
  
  const isHighRD = details.rdIndustry || details.isHighRD || false;
  const isHighBarrier = details.barrierIndustry || details.isHighBarrier || false;
  const isSustained = details.sustainedMargins || details.marginPersistence || false;
  const currentGM = details.currentGrossMargin || details.grossMargin || 'N/A';
  const beta = details.beta || data?.fundamentals?.beta || 'N/A';
  
  return (
    <div style={{ animation: "fadeUp 0.25s ease-out" }}>
      <div style={{ fontSize: 9, color: "#a78bfa", fontFamily: MONO, marginBottom: 12 }}>
        SUB-SCORES
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 16 }}>
        <SubScoreRow label="R&D / IP" score={isHighRD ? 5 : 2} max={7} color="#a78bfa" />
        <SubScoreRow label="Accumulated Scale" score={parseFloat(currentGM) >= 55 ? 5 : parseFloat(currentGM) >= 45 ? 4 : 3} max={6} color="#a78bfa" />
        <SubScoreRow label="Margin Persistence" score={isSustained ? 5 : 3} max={6} color="#a78bfa" />
        <SubScoreRow label="Regulatory Barrier" score={isHighBarrier ? 5 : 2} max={6} color="#a78bfa" />
      </div>
      
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {isHighRD && <span style={{ fontSize: 9, padding: "4px 8px", borderRadius: 4, background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}>🧬 High R&D Industry</span>}
        {!isHighRD && <span style={{ fontSize: 9, padding: "4px 8px", borderRadius: 4, background: "rgba(255,255,255,0.03)", color: "#666", border: "1px solid rgba(255,255,255,0.06)" }}>🧬 Low R&D Intensity</span>}
        {isHighBarrier && <span style={{ fontSize: 9, padding: "4px 8px", borderRadius: 4, background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}>🏛️ Regulatory Barrier</span>}
        {!isHighBarrier && <span style={{ fontSize: 9, padding: "4px 8px", borderRadius: 4, background: "rgba(255,255,255,0.03)", color: "#666", border: "1px solid rgba(255,255,255,0.06)" }}>🏛️ Low Regulatory Barrier</span>}
        {isSustained && <span style={{ fontSize: 9, padding: "4px 8px", borderRadius: 4, background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}>📊 Margins Stable</span>}
        {!isSustained && <span style={{ fontSize: 9, padding: "4px 8px", borderRadius: 4, background: "rgba(255,255,255,0.03)", color: "#666", border: "1px solid rgba(255,255,255,0.06)" }}>📊 Margin Volatility</span>}
      </div>
      
      <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 6, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 9, color: "#888", marginBottom: 8 }}>MARGIN PERSISTENCE</div>
        <div style={{ display: "flex", gap: 16 }}>
          <EvidenceIndicator label="Current GM" value={currentGM + "%"} good={parseFloat(currentGM) >= 45} showGood />
          <EvidenceIndicator label="Beta" value={typeof beta === 'number' ? beta.toFixed(2) : beta} good={parseFloat(beta) < 1.2} showGood />
          <div style={{ fontSize: 10 }}>
            <span style={{ color: "#888" }}>Signal: </span>
            <span style={{ color: isSustained ? "#22c55e" : "#eab308" }}>{isSustained ? "Sustained" : "Volatile"}</span>
          </div>
        </div>
      </div>
      
      <div style={{ fontSize: 10, color: "#999", marginBottom: 12 }}>
        <strong style={{ color: "#f0f0f0" }}>What makes it hard to replicate?</strong>
        <ul style={{ margin: "6px 0", paddingLeft: 16 }}>
          {isHighRD && <li style={{ marginBottom: 4 }}>Cumulative R&D investment in {data?.industry || "this industry"} creates knowledge barriers new entrants cannot shortcut</li>}
          {isHighBarrier && <li style={{ marginBottom: 4 }}>{data?.industry || "This industry"} requires regulatory approvals and expertise that take years to develop</li>}
          {isSustained && <li style={{ marginBottom: 4 }}>Sustained {currentGM}% gross margins confirm durable advantages</li>}
          {!isHighRD && !isHighBarrier && !isSustained && <li style={{ marginBottom: 4 }}>Limited evidence of accumulated learning curve advantages in this business</li>}
        </ul>
      </div>
      
      <p style={{ fontSize: 12, color: "#999", lineHeight: 1.6, margin: "0 0 12px 0" }}>
        {moatData.explanation || `Learning curve analysis for ${companyName}.`}
      </p>
      
      <div style={{ fontSize: 11, color: "#f0f0f0", fontWeight: 600 }}>
        VERDICT: {moatData.strength?.toUpperCase() || 'N/A'} learning curve advantages — {isHighRD ? "high R&D intensity industry with knowledge barriers" : isHighBarrier ? "regulatory barriers protect this business" : "limited accumulated learning detected"}
      </div>
    </div>
  );
}

function SwitchingDetail({ data }) {
  const moatData = data?.moatAnalysis?.categories?.switching_costs || {};
  const details = moatData.details || {};
  const companyName = data?.name || "the company";
  
  const switchingTier = details.switchingTier || details.industryLevel || 'unknown';
  const tierColors = { "Very High": "#22c55e", "High": "#eab308", "Moderate": "#888", "Low": "#ef4444" };
  const tierBg = { "Very High": "rgba(34,197,94,0.1)", "High": "rgba(234,179,8,0.1)", "Moderate": "rgba(136,136,136,0.1)", "Low": "rgba(239,68,68,0.1)" };
  const tierColor = tierColors[details.industryLevel] || "#888";
  
  const gm = details.grossMargin || details.gm || 'N/A';
  const om = details.operatingMargin || details.om || 'N/A';
  const roeVal = details.roe || 'N/A';
  const revGrowth = details.revenueGrowth || 'N/A';
  
  return (
    <div style={{ animation: "fadeUp 0.25s ease-out" }}>
      <div style={{ fontSize: 9, color: "#f97316", fontFamily: MONO, marginBottom: 12 }}>
        SUB-SCORES
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 16 }}>
        <SubScoreRow label="Industry Lock-in" score={details.industryLevel === "Very High" ? 10 : details.industryLevel === "High" ? 7 : details.industryLevel === "Moderate" ? 4 : 1} max={10} color="#f97316" />
        <SubScoreRow label="Revenue Retention" score={parseFloat(gm) >= 50 && parseFloat(om) >= 18 ? 4 : parseFloat(gm) >= 40 ? 2 : 1} max={6} color="#f97316" />
        <SubScoreRow label="ROE Persistence" score={parseFloat(roeVal) >= 25 ? 5 : parseFloat(roeVal) >= 18 ? 4 : 2} max={5} color="#f97316" />
        <SubScoreRow label="Revenue Stability" score={parseFloat(revGrowth) > 0 ? 4 : parseFloat(revGrowth) > -5 ? 2 : 0} max={4} color="#f97316" />
      </div>
      
      <div style={{ background: tierBg[details.industryLevel] || "rgba(255,255,255,0.02)", border: `1px solid ${tierColor}30`, borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14 }}>{details.industryLevel === "Very High" || details.industryLevel === "High" ? "🔒" : "🔓"}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: tierColor }}>{(details.industryLevel || 'UNKNOWN').toUpperCase()} inherent switching costs</span>
        </div>
        {details.industryLevel !== "Low" && (
          <p style={{ fontSize: 10, color: "#999", margin: "8px 0 0 22px", lineHeight: 1.5 }}>
            {data?.industry?.toLowerCase().includes("software") ? "Enterprise software requires deep workflow integration and data migration" :
             data?.industry?.toLowerCase().includes("bank") ? "Financial relationships involve complex regulatory and data transfer processes" :
             data?.industry?.toLowerCase().includes("defense") ? "Defense contracts span multiple years with specialized requirements" :
             data?.industry?.toLowerCase().includes("medical") ? "Medical devices require FDA-specific approvals tied to specific products" :
             "Established business relationships create meaningful switching friction"}
          </p>
        )}
      </div>
      
      <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 6, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 9, color: "#888", marginBottom: 8 }}>FINANCIAL EVIDENCE</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <div style={{ fontSize: 10, color: "#999", marginBottom: 4 }}>Pricing Power</div>
            <div style={{ display: "flex", gap: 12 }}>
              <EvidenceIndicator label="GM" value={gm + "%"} good={parseFloat(gm) >= 40} showGood />
              <EvidenceIndicator label="OM" value={om + "%"} good={parseFloat(om) >= 15} showGood />
            </div>
          </div>
          <EvidenceIndicator label="ROE" value={typeof roeVal === 'number' ? roeVal.toFixed(1) + "%" : roeVal + "%"} good={parseFloat(roeVal) >= 18} showGood />
          <div style={{ fontSize: 10 }}>
            <span style={{ color: "#888" }}>Revenue: </span>
            <span style={{ color: parseFloat(revGrowth) >= 0 ? "#22c55e" : "#ef4444" }}>
              {parseFloat(revGrowth) >= 0 ? "Growing" : "Declining"} {revGrowth}%
            </span>
          </div>
        </div>
      </div>
      
      <p style={{ fontSize: 12, color: "#999", lineHeight: 1.6, margin: "0 0 12px 0" }}>
        {moatData.explanation || `Switching cost analysis for ${companyName}.`}
      </p>
      
      <div style={{ fontSize: 11, color: "#f0f0f0", fontWeight: 600 }}>
        VERDICT: {moatData.strength?.toUpperCase() || 'N/A'} switching costs — {details.industryLevel === "Very High" || details.industryLevel === "High" ? "significant lock-in makes customer retention strong" : details.industryLevel === "Moderate" ? "some friction but customers can switch" : "low switching barriers in this industry"}
      </div>
    </div>
  );
}

function ScaleTab({ data, ticker, refreshKey }) {
  const [expandedMoat, setExpandedMoat] = useState(null);
  const moat = data.moatAnalysis || {};
  const ai = data.aiDisruption || {};
  const roic = data.roicTree || {};
  const sensitivity = data.roicSensitivity || {};
  const profit = data.profitabilityPath || {};
  const constraints = data.growthConstraints || {};

  const moatCategories = [
    { key: "supply_side", label: "Supply-Side", component: SupplySideDetail },
    { key: "network_effects", label: "Network", component: NetworkDetail },
    { key: "learning_curve", label: "Learning", component: LearningDetail },
    { key: "switching_costs", label: "Switching", component: SwitchingDetail },
  ];

  const getCategoryScore = (cat) => moat.categories?.[cat]?.score || 0;
  const getCategoryMax = (cat) => cat === "network_effects" ? (moat.categories?.[cat]?.maxScore || 15) : 25;
  const getCategoryStrength = (cat) => moat.categories?.[cat]?.strength || "none";
  const getCategoryColor = (cat) => cat === "supply_side" ? "#818cf8" : cat === "network_effects" ? "#22c55e" : cat === "learning_curve" ? "#a78bfa" : "#f97316";

  return (
    <>
      {/* MOAT Section */}
      <Box border={moat.moat_type === "wide" ? "#22c55e30" : moat.moat_type === "narrow" ? "#eab30830" : "#ef444430"}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
          <Ring value={moat.moat_score || 0} size={56} sw={4} color={moat.moat_type === "wide" ? "#22c55e" : moat.moat_type === "narrow" ? "#eab308" : "#ef4444"} />
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#d0d0d0", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
              MOAT
              <InfoTip title={EDUCATION.economicMoat.title}>{EDUCATION.economicMoat.content}</InfoTip>
            </div>
            <Pill color={moat.moat_type === "wide" ? "#22c55e" : moat.moat_type === "narrow" ? "#eab308" : "#ef4444"}>
              {moat.moat_type?.toUpperCase()}
            </Pill>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 10 }}>
          {moatCategories.map(({ key, label }) => {
            const eduKey = key === "supply_side" ? "supplySide" : key === "network_effects" ? "networkEffects" : key === "learning_curve" ? "learningCurve" : "switchingCosts";
            const edu = EDUCATION[eduKey] || {};
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <MoatCategoryCard
                  label={label}
                  score={getCategoryScore(key)}
                  max={getCategoryMax(key)}
                  strength={getCategoryStrength(key)}
                  color={getCategoryColor(key)}
                  expanded={expandedMoat === key}
                  onClick={() => setExpandedMoat(expandedMoat === key ? null : key)}
                />
                {edu.content && <InfoTip title={edu.title}>{edu.content}</InfoTip>}
              </div>
            );
          })}
        </div>
        
        {/* Expanded Detail Panels */}
        {expandedMoat === "supply_side" && (
          <div style={{ borderTop: "1px solid rgba(129,140,248,0.15)", paddingTop: 16, marginTop: 8 }}>
            <SupplySideDetail data={data} />
          </div>
        )}
        {expandedMoat === "network_effects" && (
          <div style={{ borderTop: "1px solid rgba(34,197,94,0.15)", paddingTop: 16, marginTop: 8 }}>
            <NetworkDetail data={data} ticker={ticker} refreshKey={refreshKey} />
          </div>
        )}
        {expandedMoat === "learning_curve" && (
          <div style={{ borderTop: "1px solid rgba(167,139,250,0.15)", paddingTop: 16, marginTop: 8 }}>
            <LearningDetail data={data} />
          </div>
        )}
        {expandedMoat === "switching_costs" && (
          <div style={{ borderTop: "1px solid rgba(249,115,22,0.15)", paddingTop: 16, marginTop: 8 }}>
            <SwitchingDetail data={data} />
          </div>
        )}
      </Box>

      {/* ROIC Section */}
      <Box border="rgba(129,140,248,0.15)">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <SH color="#818cf8">ROIC</SH>
            <InfoTip title={EDUCATION.roic.title}>{EDUCATION.roic.content}</InfoTip>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <Met label="ROIC" value={roic.roic + "%"} color="#818cf8" />
            <Met label="WACC" value={roic.wacc + "%"} color="#888" />
            <Met label="SPREAD" value={(parseFloat(roic.spread) > 0 ? "+" : "") + roic.spread + "%"} color={parseFloat(roic.spread) > 10 ? "#22c55e" : "#eab308"} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, padding: "10px 0", background: "rgba(255,255,255,0.02)", borderRadius: 7, marginBottom: 8 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 8, color: "#555", marginBottom: 2, display: "flex", alignItems: "center", gap: 4 }}>
              NOPAT
              <InfoTip title={EDUCATION.nopatMargin.title}>{EDUCATION.nopatMargin.content}</InfoTip>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#a78bfa" }}>{roic.nopatMargin}%</div>
          </div>
          <span style={{ color: "#2a2a2a" }}>×</span>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 8, color: "#555", marginBottom: 2, display: "flex", alignItems: "center", gap: 4 }}>
              TURNOVER
              <InfoTip title={EDUCATION.assetTurnover.title}>{EDUCATION.assetTurnover.content}</InfoTip>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#60a5fa" }}>{roic.assetTurnover}x</div>
          </div>
          <span style={{ color: "#2a2a2a" }}>=</span>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 8, color: "#555", marginBottom: 2 }}>ROIC</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#818cf8" }}>{roic.roic}%</div>
          </div>
        </div>
        {sensitivity.levers?.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 9, color: "#666" }}>SENSITIVITY LEVERS:</div>
            <InfoTip title={EDUCATION.sensitivityLevers.title}>{EDUCATION.sensitivityLevers.content}</InfoTip>
          </div>
        )}
        {sensitivity.levers?.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {sensitivity.levers?.slice(0, 3).map((lever, i) => (
              <div key={i} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "8px 12px", fontSize: 10 }}>
                <span style={{ color: "#888" }}>{lever.name.split("(")[0].trim()}: </span>
                <span style={{ color: "#f0f0f0" }}>{lever.current}</span>
                <span style={{ color: "#22c55e", marginLeft: 4 }}>{parseFloat(lever.roicDelta) >= 0 ? "+" : ""}{lever.roicDelta}%</span>
              </div>
            ))}
          </div>
        )}
      </Box>

      {/* AI Disruption */}
      <Box border={aiColors[ai.net_impact] + "30"}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <SH color={aiColors[ai.net_impact] || "#888"}>AI DISRUPTION</SH>
          <InfoTip title={EDUCATION.aiDisruption.title}>{EDUCATION.aiDisruption.content}</InfoTip>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <Pill color={tc(ai.threat_level)}>Threat: {ai.threat_level?.toUpperCase()}</Pill>
          <Pill color="#22c55e">Opp: {ai.opportunity_level?.toUpperCase()}</Pill>
          <Pill color={aiColors[ai.net_impact]}>{ai.net_impact?.replace(/_/g, " ").toUpperCase()}</Pill>
        </div>
        <p style={{ fontSize: 11, color: "#999", margin: 0, lineHeight: 1.5 }}>{ai.net_assessment}</p>
      </Box>

      {/* Constraints Section */}
      <Box border="rgba(239,68,68,0.15)">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <SH color="#ef4444">CONSTRAINTS</SH>
            <InfoTip title={EDUCATION.growthConstraints.title}>{EDUCATION.growthConstraints.content}</InfoTip>
          </div>
          <Pill color={tc(constraints.overall_severity)}>{constraints.overall_severity?.toUpperCase()}</Pill>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          {constraints.constraints?.map((c, i) => (
            <div key={i} style={{ 
              padding: "8px 10px", 
              background: "rgba(255,255,255,0.02)", 
              borderRadius: 6,
              borderLeft: `3px solid ${tc(c.severity)}`
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#d0d0d0" }}>{c.name}</span>
                <Pill color={tc(c.severity)}>{c.severity}</Pill>
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 10, color: "#666", margin: "10px 0 0", fontStyle: "italic" }}>{constraints.net_assessment}</p>
      </Box>
    </>
  );
}

export default function AnalysisDetail({ ticker, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [refreshKey, setRefreshKey] = useState(0);
  const [dcfData, setDcfData] = useState(null);
  const [dcfLoading, setDcfLoading] = useState(false);

  useEffect(() => {
    fetchAnalysis();
  }, [ticker, refreshKey]);

  const fetchAnalysis = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const res = await fetch(`/api/analysis/${ticker}`);
      const json = await res.json();
      
      if (!json.success) {
        throw new Error(json.error || "Failed to fetch analysis");
      }
      
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => setRefreshKey(k => k + 1);
  
  const fetchDCF = useCallback(async () => {
    if (dcfData || dcfLoading) return;
    setDcfLoading(true);
    try {
      const res = await fetch(`/api/dcf/${ticker}`);
      const json = await res.json();
      if (json.success) {
        setDcfData(json);
      }
    } catch (e) {
      console.error('Failed to fetch DCF:', e);
    } finally {
      setDcfLoading(false);
    }
  }, [ticker, dcfData, dcfLoading]);
  
  useEffect(() => {
    if (activeTab === "dcf") {
      fetchDCF();
    }
  }, [activeTab, fetchDCF]);

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 60 }}>
        <LoadingSpinner size={40} />
        <div style={{ marginTop: 16, color: "#555", fontFamily: MONO }}>Analyzing {ticker}...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 20 }}>
        <button onClick={onBack} style={{ marginBottom: 16, padding: "6px 12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 5, color: "#888", fontSize: 11, cursor: "pointer", fontFamily: MONO }}>← Back</button>
        <div style={{ padding: 20, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, color: "#ef4444", textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Error</div>
          <div style={{ fontSize: 12 }}>{error}</div>
        </div>
      </div>
    );
  }

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "scale", label: "Scale" },
    { key: "dcf", label: "DCF" },
    { key: "comps", label: "Comps" }
  ];

  return (
    <div style={{ animation: "fadeUp .3s ease-out" }}>
      <button onClick={onBack} style={{ marginBottom: 16, padding: "6px 12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 5, color: "#888", fontSize: 11, cursor: "pointer", fontFamily: MONO }}>← Back</button>

      <div style={{ display: "flex", gap: 2, marginBottom: 16, overflowX: "auto", background: "rgba(255,255,255,0.02)", borderRadius: 7, padding: 3, width: "fit-content" }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{ padding: "8px 16px", background: activeTab === t.key ? "rgba(129,140,248,0.15)" : "transparent", border: "none", borderRadius: 5, color: activeTab === t.key ? "#f0f0f0" : "#555", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: MONO, whiteSpace: "nowrap" }}>
            {t.label.toUpperCase()}
          </button>
        ))}
      </div>

      {activeTab === "overview" && <OverviewTab data={data} />}
      {activeTab === "scale" && <ScaleTab data={data} ticker={ticker} refreshKey={handleRefresh} />}
      {activeTab === "dcf" && (dcfLoading ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 60 }}>
          <LoadingSpinner size={40} />
          <div style={{ marginTop: 16, color: "#555", fontFamily: MONO }}>Building DCF model...</div>
        </div>
      ) : dcfData ? (
        <Suspense fallback={<div style={{ padding: 20, textAlign: "center", color: "#555" }}>Loading...</div>}>
          <DCFTab data={dcfData} />
        </Suspense>
      ) : (
        <div style={{ padding: 20, textAlign: "center", color: "#888" }}>Failed to load DCF data</div>
      ))}
      {activeTab === "comps" && (
        <Suspense fallback={<div style={{ padding: 20, textAlign: "center", color: "#555" }}>Loading...</div>}>
          <CompsTab ticker={ticker} />
        </Suspense>
      )}

      {data.description && (
        <Box border="rgba(129,140,248,0.1)" style={{ marginTop: 4 }}>
          <SH color="#818cf8">About</SH>
          <p style={{ fontSize: 11, color: "#888", lineHeight: 1.7, margin: 0 }}>
            {data.description.substring(0, 300)}{data.description.length > 300 && "..."}
          </p>
        </Box>
      )}
    </div>
  );
}
