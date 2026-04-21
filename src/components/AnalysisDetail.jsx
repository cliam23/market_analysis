import { useState, useEffect, useRef, lazy, Suspense, useMemo } from "react";
import { Search } from "lucide-react";
import { LoadingSpinner, InfoTip, RUN_ACTION_BAR_STYLE } from "./shared.jsx";
import { EDUCATION } from "../lib/education.js";
const DCFTab = lazy(() => import("./DCFTab.jsx"));
const CompsTab = lazy(() => import("./CompsTab.jsx"));

import { MONO, SANS } from "../lib/theme.js";
import { apiFetch } from "../lib/api.js";
import { useAbortableApi, isAbortError } from "../hooks/useAbortableApi.js";

function Box({ border, children, style: sx = {} }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.02)",
      border: "1px solid " + (border || "rgba(255,255,255,0.06)"),
      borderRadius: 10,
      padding: 16,
      marginBottom: 12,
      ...sx
    }}>
      {children}
    </div>
  );
}

function SH({ color, children, compact }) {
  return (
    <div style={{
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 2,
      color,
      marginBottom: compact ? 0 : 8,
      lineHeight: compact ? 1.2 : undefined,
      textTransform: "uppercase",
      fontFamily: MONO
    }}>
      {children}
    </div>
  );
}

function Pill({ children, color = "#888", style: sx = {} }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 10px",
      fontSize: 11,
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

function useCountUp(target, durationMs = 650) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const to = Math.round(Number(target) || 0);
    setV(0);
    const t0 = performance.now();
    let raf = 0;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(Math.round(to * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return v;
}

function Ring({ value, max = 100, size = 52, sw = 4, color, displayValue, className }) {
  const r = (size - sw) / 2;
  const ci = 2 * Math.PI * r;
  const p = Math.min(value / max, 1);
  const c = color || (value >= 75 ? "#22c55e" : value >= 50 ? "#eab308" : "#ef4444");
  const show = displayValue !== undefined ? displayValue : value;

  return (
    <svg width={size} height={size} className={className || ""} style={{ flexShrink: 0 }}>
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
      <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central" fill={c} fontSize={size * 0.31} fontWeight="800" fontFamily={MONO}>
        {show}
      </text>
    </svg>
  );
}

function fmtMarketCap(mc) {
  if (mc == null || !Number.isFinite(Number(mc))) return "—";
  const n = Number(mc);
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${Math.round(n)}`;
}

function scoreTierClass100(score) {
  const s = Number(score) || 0;
  if (s >= 75) return "ma-score-pill ma-score-pill--hi";
  if (s >= 50) return "ma-score-pill ma-score-pill--mid";
  return "ma-score-pill ma-score-pill--lo";
}

function subBarFillClass(score, max) {
  const r20 = max > 0 ? (Number(score) / Number(max)) * 20 : 0;
  if (r20 >= 16) return "ma-subbar__fill ma-subbar__fill--g";
  if (r20 >= 11) return "ma-subbar__fill ma-subbar__fill--b";
  if (r20 >= 6) return "ma-subbar__fill ma-subbar__fill--y";
  return "ma-subbar__fill ma-subbar__fill--r";
}

function subBarPct(score, max) {
  return max > 0 ? Math.min(100, (Number(score) / Number(max)) * 100) : 0;
}

const PILLAR_HINT_COLORS = {
  Quality: "#58a6ff",
  Moat: "#a855f7",
  Valuation: "#d29922",
  ROIC: "#14b8a6",
  "Earnings Quality": "#f778ba",
  Momentum: "#3fb950",
  "Shareholder Yield": "#f85171",
  Fundamental: "#58a6ff",
  DCF: "#79c0ff",
  "Dynamic valuation": "#d29922",
  "Price value": "#f97316",
  "Quality Floor": "#4ade80"
};

function normalizePillarLabel(name) {
  const n = String(name || "");
  const lower = n.toLowerCase();
  if (lower.includes("momentum")) return "Momentum";
  if (lower.includes("yield") || lower.includes("shareholder")) return "Yield";
  if (lower.includes("earnings quality") || lower === "earnings") return "Earnings";
  if (lower.includes("valuat") || lower.includes("dcf") || lower.includes("price value")) return "Value";
  if (lower.includes("quality") || lower.includes("floor")) return "Quality";
  if (lower.includes("moat")) return "Moat";
  return n.length > 14 ? n.slice(0, 14) : n;
}

function StockResearchHeader({ data }) {
  const overall = data.composite?.score ?? data.buffettChecklist?.total ?? 0;
  const displayScore = useCountUp(overall);
  const tierColor = overall >= 75 ? "#3fb950" : overall >= 50 ? "#d29922" : "#f85149";
  const chg = data.regularMarketChangePercent;
  const chgNum = chg != null && Number.isFinite(Number(chg)) ? Number(chg) : null;

  const pillars = useMemo(() => {
    const comps = data.composite?.components;
    if (!comps?.length) return [];
    const totalW = comps.reduce((s, c) => s + (c.adjustedWeight || c.weight || 0), 0) || 1;
    const seen = new Set();
    const rows = [];
    for (const c of comps) {
      const label = normalizePillarLabel(c.name);
      if (seen.has(label)) continue;
      seen.add(label);
      const col = PILLAR_HINT_COLORS[c.name] || PILLAR_HINT_COLORS[label] || "#8b949e";
      rows.push({
        label,
        score: Math.min(100, Math.max(0, Math.round(c.score))),
        color: col
      });
      if (rows.length >= 5) break;
    }
    return rows;
  }, [data.composite]);

  return (
    <header className="ma-analysis-header">
      <div className="ma-analysis-header__identity">
        <h1 className="ma-analysis-header__name">{data.name || data.ticker}</h1>
        <div className="ma-analysis-header__tickerline">
          {data.ticker}
          {data.exchangeName ? ` · ${data.exchangeName}` : ""}
        </div>
        <div className="ma-analysis-header__price-row">
          <span className="ma-analysis-header__price">
            {typeof data.price === "number" ? `$${data.price.toFixed(2)}` : "—"}
          </span>
          {chgNum != null && (
            <span
              className={
                "ma-analysis-header__chg " +
                (chgNum >= 0 ? "ma-analysis-header__chg--up" : "ma-analysis-header__chg--down")
              }
            >
              {chgNum >= 0 ? "+" : ""}
              {chgNum.toFixed(2)}%
            </span>
          )}
        </div>
        <div className="ma-analysis-header__meta">
          {data.sector ? <span>Sector: {data.sector}</span> : null}
          {data.sector && data.marketCap != null ? <span> · </span> : null}
          <span>Market cap {fmtMarketCap(data.marketCap)}</span>
        </div>
      </div>
      <div className="ma-analysis-scorecol">
        <Ring
          value={overall}
          max={100}
          size={80}
          sw={4}
          color={tierColor}
          displayValue={displayScore}
          className={overall >= 75 ? "ma-ring-count" : undefined}
        />
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: "var(--text-secondary)",
            fontFamily: MONO
          }}
        >
          OVERALL
        </div>
        <div className="ma-analysis-pillars">
          {pillars.map((p, i) => (
            <div key={p.label + "-" + i} className="ma-analysis-pillar-row">
              <span>{p.label}</span>
              <div className="ma-analysis-pillar-bar">
                <span
                  style={{
                    ["--bar-pct"]: `${p.score}%`,
                    ["--bar-delay"]: `${40 + i * 35}ms`,
                    background: p.color
                  }}
                />
              </div>
              <span className="ma-mono" style={{ fontSize: 11, color: "var(--text-primary)" }}>
                {p.score}
              </span>
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}

function AnalysisToolbar({ ticker, onBack, onAnalyzeTicker }) {
  const [q, setQ] = useState(ticker);
  useEffect(() => setQ(ticker), [ticker]);
  return (
    <div className="ma-analysis-toolbar">
      <button type="button" className="ma-analysis-toolbar__back" onClick={onBack}>
        ← Back
      </button>
      <form
        className="ma-analysis-toolbar__mini"
        onSubmit={(e) => {
          e.preventDefault();
          const t = q.trim().toUpperCase();
          if (t) onAnalyzeTicker(t);
        }}
      >
        <div className="ma-search-input-wrap">
          <Search className="ma-search-icon" size={18} strokeWidth={2} aria-hidden />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value.toUpperCase())}
            placeholder="Search another ticker…"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </form>
      <span className="ma-analysis-toolbar__hint">{ticker}</span>
    </div>
  );
}

function PortfolioStatusCard({ ticker, compositeScore, staggerMs = 420 }) {
  const [loading, setLoading] = useState(true);
  const [p50, setP50] = useState(null);
  const [p150, setP150] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiFetch("/api/paper-trade/portfolio?universe=sp500_top50").then((r) => r.json()),
      apiFetch("/api/paper-trade/portfolio?universe=sp500_top150").then((r) => r.json())
    ])
      .then(([j50, j150]) => {
        if (cancelled) return;
        setP50(j50.success && j50.portfolio ? j50.portfolio : null);
        setP150(j150.success && j150.portfolio ? j150.portfolio : null);
      })
      .catch(() => {
        if (!cancelled) {
          setP50(null);
          setP150(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  const findH = (port) => port?.holdings?.find((h) => h.ticker === ticker);
  const h50 = findH(p50);
  const h150 = findH(p150);
  const held = !!(h50 || h150);

  let reason = "Not among current holdings after the last rebalance.";
  if (compositeScore != null && Number(compositeScore) < 48) {
    reason = "Composite score is below a typical entry band for these portfolios.";
  }

  const line = (label, h) => (
    <div key={label} style={{ marginBottom: 10 }}>
      ✓ Held in <strong>{label}</strong> — weight {h.weight}% · entry ${Number(h.entryPrice).toFixed(2)} ·{" "}
      {h.entryDate ? String(h.entryDate).slice(0, 10) : "—"} ·{" "}
      <span style={{ color: h.pnlPct >= 0 ? "var(--green)" : "var(--red)" }}>
        P&amp;L {h.pnlPct >= 0 ? "+" : ""}
        {h.pnlPct}%
      </span>
    </div>
  );

  return (
    <div
      className={
        "ma-portfolio-status " + (held ? "ma-portfolio-status--held" : "ma-portfolio-status--not")
      }
      style={{ ["--stagger"]: `${staggerMs}ms` }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.12em",
          color: "var(--text-secondary)",
          marginBottom: 10
        }}
      >
        PORTFOLIO STATUS
      </div>
      {loading ? (
        <p style={{ color: "var(--text-secondary)", margin: 0 }}>Loading…</p>
      ) : held ? (
        <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-primary)" }}>
          {h50 && line("Top 50", h50)}
          {h150 && line("Top 150", h150)}
        </div>
      ) : (
        <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-secondary)" }}>
          ○ Not currently held in Top 50 or Top 150 paper portfolios.
          <div style={{ marginTop: 8, color: "var(--text-secondary)" }}>{reason}</div>
        </div>
      )}
    </div>
  );
}

function Met({ label, value, color = "#f0f0f0" }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      borderRadius: 6,
      padding: "10px 12px",
      textAlign: "center",
      flex: "1 1 75px",
      minWidth: 75
    }}>
      <div style={{ fontSize: 10, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, fontFamily: MONO }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color, fontFamily: MONO, marginTop: 2 }}>{value}</div>
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

function ScoreSection({ title, score, max, grade, infoTip, color: colorOverride, children, staggerMs = 0 }) {
  const pct = max > 0 ? (score / max) * 100 : 0;
  const color = colorOverride || (pct >= 70 ? "#22c55e" : pct >= 50 ? "#eab308" : "#ef4444");
  return (
    <div
      className="ma-analysis-card"
      style={{ ["--stagger"]: `${staggerMs}ms`, borderColor: color + "28" }}
    >
      <div className="ma-analysis-card__head">
        <h3 className="ma-analysis-card__title">
          {title}
          {infoTip && <InfoTip title={infoTip.title}>{infoTip.content}</InfoTip>}
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {grade ? <span className="ma-grade-pill">{String(grade).toUpperCase()}</span> : null}
          <span
            className={scoreTierClass100(max > 0 ? (Number(score) / Number(max)) * 100 : 0)}
          >
            {Math.round(score)}/{max}
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}

function SubBar({ label, score, max, infoTip, delayMs = 0 }) {
  const pct = subBarPct(score, max);
  const fillClass = subBarFillClass(score, max);
  const r20 = max > 0 ? (Number(score) / Number(max)) * 20 : 0;
  const tier =
    r20 >= 16 ? "#22c55e" : r20 >= 11 ? "#58a6ff" : r20 >= 6 ? "#d29922" : "#f85149";
  return (
    <div className="ma-subbar">
      <div className="ma-subbar__label">{label}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        {infoTip ? <InfoTip title={infoTip.title}>{infoTip.content}</InfoTip> : null}
      </div>
      <div className="ma-subbar__track">
        <div
          className={fillClass}
          style={{
            ["--sub-w"]: `${pct}%`,
            ["--sub-delay"]: `${delayMs}ms`
          }}
        />
      </div>
      <div className="ma-subbar__score" style={{ color: tier }}>
        {score}/{max}
      </div>
    </div>
  );
}

function NetworkInput({ ticker, onSubmit }) {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const submitAcRef = useRef(null);

  useEffect(() => () => submitAcRef.current?.abort(), [ticker]);

  const handleSubmit = async (score, label) => {
    submitAcRef.current?.abort();
    const ac = new AbortController();
    submitAcRef.current = ac;
    setSubmitting(true);
    try {
      await apiFetch(`/api/analysis/${ticker}/network-input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({ networkEffectScore: score, label })
      });
      setSubmitted(true);
      onSubmit();
    } catch (e) {
      if (!isAbortError(e)) console.error(e);
    } finally {
      if (submitAcRef.current === ac) submitAcRef.current = null;
      setSubmitting(false);
    }
  };

  if (submitted) {
    return null;
  }

  return (
    <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: 12, marginTop: 8 }}>
      <div style={{ fontSize: 12, color: "#f0f0f0", marginBottom: 8, fontWeight: 600 }}>🌐 Your product assessment</div>
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
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 6,
              color: "#f0f0f0",
              fontSize: 12,
              cursor: "pointer",
              fontFamily: MONO
            }}
          >
            {opt.label} ({opt.score})
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "#f0f0f0", marginTop: 6 }}>Click to save your assessment for this stock</div>
    </div>
  );
}

function OverviewTab({ data, ticker }) {
  const uv = parseFloat(data.intrinsicValue?.undervaluation) || 0;
  const hasEstimatedFields = data.dataQuality?.estimatedFields?.length > 0;
  const moat = data.moatAnalysis || {};
  const moatCatKeys = [
    { key: "supply_side", label: "Supply-side" },
    { key: "network_effects", label: "Network" },
    { key: "learning_curve", label: "Learning" },
    { key: "switching_costs", label: "Switching" }
  ];
  const getMoatScore = (cat) => moat.categories?.[cat]?.score || 0;
  const getMoatMax = (cat) =>
    cat === "network_effects" ? moat.categories?.[cat]?.maxScore || 15 : 25;

  return (
    <>
      {hasEstimatedFields && (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-secondary)",
            background: "var(--bg-card)",
            border: "1px solid var(--border-card)",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 16,
            display: "flex",
            alignItems: "flex-start",
            gap: 8
          }}
        >
          <span aria-hidden>ℹ️</span>
          <span>Some values are estimated from limited historical statements.</span>
        </div>
      )}

      <div className="ma-analysis-grid">
      <ScoreSection title="Earnings Quality" staggerMs={0} score={data.earningsQuality?.score || 0} max={100} grade={data.earningsQuality?.grade} infoTip={EDUCATION.earningsQuality}>
        {data.earningsQuality?.keyInsight && (
          <div style={{ fontSize: 13, color: "var(--text-primary)", marginBottom: 12, lineHeight: 1.5 }}>
            {data.earningsQuality.keyInsight}
          </div>
        )}
        <div style={{ display: "grid", gap: 6 }}>
          {[
            { label: "Accruals", key: "accruals", edu: EDUCATION.accrualRatio },
            { label: "FCF Conversion", key: "fcfConversion", edu: EDUCATION.fcfConversion },
            { label: "Stability", key: "earningsStability", edu: EDUCATION.earningsStability },
            { label: "Revenue Quality", key: "revenueQuality", edu: EDUCATION.revenueQuality },
            { label: "Capital Alloc", key: "capitalAllocation", edu: EDUCATION.capitalAllocation }
          ].map(comp => {
            const c = data.earningsQuality?.components?.[comp.key] || {};
            return <SubBar key={comp.key} label={comp.label} score={c.score || 0} max={c.maxScore || 1} infoTip={comp.edu} />;
          })}
        </div>
        {data.earningsQuality?.flags?.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            {data.earningsQuality.flags.map((flag, i) => (
              <div
                key={i}
                className={flag.type === "positive" ? "ma-insight ma-insight--pos" : "ma-insight ma-insight--neg"}
                style={{ fontSize: 12 }}
              >
                {flag.type === "positive" ? "✓" : "✗"} {flag.message}
              </div>
            ))}
          </div>
        )}
      </ScoreSection>

      {data.totalShareholderYield && (
        <ScoreSection title="Shareholder Yield" staggerMs={50} score={data.totalShareholderYield.qualityScore || 0} max={100} infoTip={EDUCATION.totalShareholderYield}>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Pill 
              color={data.totalShareholderYield.category === "exceptional_returner" ? "#22c55e" : 
                     data.totalShareholderYield.category === "strong_returner" ? "#4ade80" :
                     data.totalShareholderYield.category === "moderate_returner" ? "#eab308" :
                     data.totalShareholderYield.category === "minimal_returner" ? "#f97316" : "#94a3b8"}
            >
              {data.totalShareholderYield.category?.replace(/_/g, " ").toUpperCase()}
            </Pill>
            <div style={{ fontSize: 24, fontWeight: 900, fontFamily: MONO, color: "#f0f0f0" }}>
              {data.totalShareholderYield.totalYield}%
            </div>
            <span style={{ fontSize: 13, color: "#f0f0f0" }}>annual return to shareholders</span>
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
                fontSize: 10,
                color: "#fff",
                fontWeight: 700
              }}>
                {data.totalShareholderYield.dividendYield.toFixed(1)}%
              </div>
            )}
            {data.totalShareholderYield.buybackYield > 0 && (
              <div style={{ 
                width: `${Math.min((data.totalShareholderYield.buybackYield / data.totalShareholderYield.totalYield) * 100, 100)}%`, 
                background: "#f0f0f0", 
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                color: "#fff",
                fontWeight: 700
              }}>
                {data.totalShareholderYield.buybackYield.toFixed(1)}%
              </div>
            )}
            {data.totalShareholderYield.debtPaydownYield > 0 && (
              <div style={{ 
                width: `${Math.min((data.totalShareholderYield.debtPaydownYield / data.totalShareholderYield.totalYield) * 100, 100)}%`, 
                background: "#f0f0f0", 
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
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
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "#22c55e" }} />
              <span style={{ color: "#f0f0f0" }}>Dividends</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "#f0f0f0" }} />
              <span style={{ color: "#f0f0f0" }}>Buybacks</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "#f0f0f0" }} />
              <span style={{ color: "#f0f0f0" }}>Debt Paydown</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <div style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: 6, padding: "8px 12px", flex: "1 1 80px", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#22c55e", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>DIVIDENDS</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#22c55e", fontFamily: MONO }}>{data.totalShareholderYield.dividendYield}%</div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, padding: "8px 12px", flex: "1 1 80px", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>BUYBACKS</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#f0f0f0", fontFamily: MONO }}>
                {data.totalShareholderYield.buybackYield.toFixed(1)}%
                {data.totalShareholderYield.buybackEstimated && <span style={{ fontSize: 10, color: "#f0f0f0" }}> *</span>}
              </div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, padding: "8px 12px", flex: "1 1 80px", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>DEBT</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#f0f0f0", fontFamily: MONO }}>
                {data.totalShareholderYield.debtPaydownYield > 0 ? "+" : ""}{data.totalShareholderYield.debtPaydownYield.toFixed(1)}%
              </div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, padding: "8px 12px", flex: "1 1 80px", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>TOTAL</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#f0f0f0", fontFamily: MONO }}>{data.totalShareholderYield.totalYield.toFixed(1)}%</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 16, marginBottom: 12, padding: "8px 12px", background: "rgba(255,255,255,0.02)", borderRadius: 6 }}>
            <div style={{ fontSize: 12 }}>
              <span style={{ color: "#f0f0f0" }}>vs 10Y Treasury: </span>
              <span style={{ fontFamily: MONO, color: data.totalShareholderYield.yieldVsTreasury >= 0 ? "#22c55e" : "#ef4444", fontWeight: 700 }}>
                {data.totalShareholderYield.yieldVsTreasury >= 0 ? "+" : ""}{data.totalShareholderYield.yieldVsTreasury}%
              </span>
            </div>
            {data.totalShareholderYield.returnCoverage !== null && (
              <div style={{ fontSize: 12 }}>
                <span style={{ color: "#f0f0f0" }}>FCF Coverage: </span>
                <span style={{ fontFamily: MONO, color: data.totalShareholderYield.returnCoverage >= 1.5 ? "#22c55e" : data.totalShareholderYield.returnCoverage >= 1 ? "#eab308" : "#ef4444", fontWeight: 700 }}>
                  {data.totalShareholderYield.returnCoverage}x
                </span>
                <InfoTip title={EDUCATION.tsyFcfCoverage.title}>{EDUCATION.tsyFcfCoverage.content}</InfoTip>
              </div>
            )}
          </div>

          <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
            {[
              { label: "Yield Level", key: "yieldLevel", edu: EDUCATION.totalShareholderYield },
              { label: "Sustainability", key: "sustainability", edu: EDUCATION.tsyFcfCoverage },
              { label: "Buyback Effect.", key: "buybackEffectiveness", edu: EDUCATION.tsyBuybacks },
              { label: "Dividend Growth", key: "dividendGrowth", edu: EDUCATION.tsyDividends }
            ].map(comp => {
              const c = data.totalShareholderYield.qualityComponents?.[comp.key] || {};
              return <SubBar key={comp.key} label={comp.label} score={c.score || 0} max={c.maxScore || 1} infoTip={comp.edu} />;
            })}
          </div>

          {data.totalShareholderYield.flags?.length > 0 && (
            <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              {data.totalShareholderYield.flags.map((flag, i) => (
                <div key={i} style={{ 
                  fontSize: 12, 
                  color: flag.type === "warning" ? "#eab308" : "#888", 
                  padding: "6px 10px", 
                  background: flag.type === "warning" ? "rgba(234,179,8,0.08)" : "rgba(255,255,255,0.03)", 
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

          <div style={{ fontSize: 13, color: "#f0f0f0", lineHeight: 1.5, padding: "10px 12px", background: "rgba(255,255,255,0.02)", borderRadius: 6 }}>
            {data.totalShareholderYield.summary}
          </div>
        </ScoreSection>
      )}

      <ScoreSection
        title="Durable Advantage"
        staggerMs={100}
        score={moat.moat_score || 0}
        max={100}
        grade={moat.moat_type?.replace(/_/g, " ").toUpperCase()}
        infoTip={EDUCATION.economicMoat}
        color={moat.moat_type === "wide" ? "#22c55e" : moat.moat_type === "narrow" ? "#eab308" : "#ef4444"}
      >
        {moat.moat_narrative && (
          <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.55, margin: "0 0 12px" }}>
            {moat.moat_narrative}
          </p>
        )}
        <div style={{ display: "grid", gap: 6 }}>
          {moatCatKeys.map(({ key, label }, idx) => (
            <SubBar
              key={key}
              label={label}
              score={getMoatScore(key)}
              max={getMoatMax(key)}
              delayMs={idx * 28}
            />
          ))}
        </div>
      </ScoreSection>

      <ScoreSection title="Valuation" staggerMs={150} score={Math.min(100, Math.max(0, Math.round(50 + uv)))} max={100} infoTip={EDUCATION.intrinsicValue}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {[
            { label: "EPV", value: data.intrinsicValue?.epv, color: "#f0f0f0" },
            { label: "FCF", value: data.intrinsicValue?.fcf, color: "#22c55e" },
            { label: "Graham", value: data.intrinsicValue?.graham, color: "#f0f0f0" },
            { label: "AVG", value: data.intrinsicValue?.avg, color: uv >= 0 ? "#22c55e" : "#ef4444" }
          ].map((item) => (
            <div key={item.label} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "10px 14px", textAlign: "center", flex: "1 1 80px" }}>
              <div style={{ fontSize: 10, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>{item.label}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: item.color, fontFamily: MONO }}>
                {item.value !== "N/A" ? "$" + item.value : "N/A"}
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-primary)", textAlign: "center" }}>
          Current: ${data.price?.toFixed(2)} → <strong style={{ color: uv >= 0 ? "#22c55e" : "#ef4444" }}>{uv.toFixed(1)}%</strong>{" "}
          {uv >= 0 ? "undervalued" : "overvalued"}
        </div>
      </ScoreSection>
      </div>

      <ScoreSection title="Buffett Checklist" staggerMs={200} score={data.buffettChecklist?.total || 0} max={100} infoTip={EDUCATION.buffettChecklist}>
        <div style={{ display: "grid", gap: 6 }}>
          {data.buffettChecklist?.items?.map((item, i) => {
            const eduKey = item.name.toLowerCase().replace(/\s+/g, "");
            const edu = EDUCATION[eduKey] || {};
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "10px 12px",
                  background: "rgba(255,255,255,0.02)",
                  borderRadius: 6,
                  alignItems: "center"
                }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: item.pass ? "#22c55e15" : "#ef444415",
                    border: `1.5px solid ${item.pass ? "#22c55e" : "#ef4444"}45`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    color: item.pass ? "#22c55e" : "#ef4444",
                    fontWeight: 700,
                    flexShrink: 0
                  }}
                >
                  {item.pass ? "✓" : "✗"}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "var(--text-primary)",
                        display: "flex",
                        alignItems: "center",
                        gap: 4
                      }}
                    >
                      {item.name}
                      {edu.content && <InfoTip title={edu.title}>{edu.content}</InfoTip>}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: item.pass ? "#22c55e" : "#ef4444",
                        fontFamily: MONO
                      }}
                    >
                      {item.value}
                    </span>
                  </div>
                  {item.detail && (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{item.detail}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScoreSection>

      <ScoreSection title="Entry Timing" staggerMs={250} score={data.entryTiming?.total || 0} max={17} infoTip={EDUCATION.entryTiming}>
        {data.entryTiming?.overextendedWarning && (
          <div className="ma-insight ma-insight--neg" style={{ marginBottom: 12 }}>
            ⚠️ {data.entryTiming.overextendedWarning}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <Met label="52W HIGH" value={data.entryTiming?.distance + "%" || "—"} color={parseFloat(data.entryTiming?.distance) < 15 ? "#ef4444" : "#eab308"} />
          <Met label="200D MA" value={data.entryTiming?.maDistance !== "N/A" ? data.entryTiming?.maDistance + "%" : "N/A"} color={data.entryTiming?.overextended ? "#ef4444" : "#888"} />
          <Met label="MOS SCORE" value={data.entryTiming?.mos + "/4" || "—"} color="#22c55e" />
          <Met label="PE SCORE" value={data.entryTiming?.pe + "/4" || "—"} color="#f0f0f0" />
        </div>
      </ScoreSection>

      <PortfolioStatusCard ticker={ticker} compositeScore={data.composite?.score} staggerMs={300} />
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
        background: expanded ? "rgba(255,255,255,0.04)" : "transparent",
        border: `1px solid ${expanded ? color + "40" : "rgba(255,255,255,0.06)"}`,
        borderRadius: 8,
        padding: "10px 12px",
        transition: "all 0.2s ease"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#f0f0f0" }}>{label}</span>
        <span style={{ fontSize: 11, color: "#f0f0f0" }}>{expanded ? "▴" : "▾"}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: color, transition: "width 0.3s" }} />
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 11, padding: "1px 5px", borderRadius: 2, background: strengthColor + "15", color: strengthColor }}>{strength.toUpperCase()}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: MONO }}>{score}/{max}</span>
        </div>
      </div>
    </div>
  );
}

function SubScoreRow({ label, score, max, color }) {
  const pct = Math.min(score / max, 1) * 100;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ fontSize: 11, color: "#f0f0f0", width: 100 }}>{label}</div>
      <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, transition: "width 0.3s" }} />
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color, fontFamily: MONO, width: 24 }}>{score}/{max}</div>
    </div>
  );
}

function EvidenceIndicator({ label, value, good, showGood }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
      <span style={{ color: "#f0f0f0" }}>{label}:</span>
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
    <div>
      <div style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO, marginBottom: 12 }}>
        SUB-SCORES
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 16 }}>
        <SubScoreRow label="Scale Efficiency" score={leveragePositive ? 6 : 3} max={8} color="#888" />
        <SubScoreRow label="Gross Margin" score={parseFloat(grossMargin) >= 45 ? 4 : parseFloat(grossMargin) >= 30 ? 2 : 1} max={6} color="#888" />
        <SubScoreRow label="Op Leverage" score={parseFloat(earningsGrowth) > parseFloat(revenueGrowth) ? 4 : 2} max={6} color="#888" />
        <SubScoreRow label="Revenue Scale" score={parseFloat(scaleRevenue) >= 100 ? 5 : parseFloat(scaleRevenue) >= 50 ? 4 : 3} max={5} color="#888" />
      </div>
      
      <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 6, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#f0f0f0", marginBottom: 8 }}>GROWTH COMPARISON</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: "#f0f0f0", marginBottom: 4 }}>Revenue Growth</div>
            <div style={{ height: 6, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(parseFloat(revenueGrowth) || 0, 30) / 30 * 100}%`, background: "#f0f0f0" }} />
            </div>
            <div style={{ fontSize: 12, color: "#f0f0f0", fontFamily: MONO, marginTop: 4 }}>{revenueGrowth}%</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#f0f0f0", marginBottom: 4 }}>Earnings Growth</div>
            <div style={{ height: 6, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(parseFloat(earningsGrowth) || 0, 30) / 30 * 100}%`, background: "#22c55e" }} />
            </div>
            <div style={{ fontSize: 12, color: "#22c55e", fontFamily: MONO, marginTop: 4 }}>{earningsGrowth}%</div>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: leveragePositive ? "#22c55e" : "#ef4444" }}>
          Leverage Gap: {leveragePositive ? "+" : ""}{leverageDelta}%
        </div>
      </div>
      
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#f0f0f0", marginBottom: 8 }}>CURRENT MARGINS</div>
        <div style={{ display: "flex", gap: 16 }}>
          <EvidenceIndicator label="Gross Margin" value={grossMargin + "%"} good={parseFloat(grossMargin) >= 40} showGood />
          <EvidenceIndicator label="Operating Margin" value={operatingMargin + "%"} good={parseFloat(operatingMargin) >= 20} showGood />
        </div>
      </div>
      
      <p style={{ fontSize: 12, color: "#f0f0f0", lineHeight: 1.6, margin: "0 0 12px 0" }}>
        {moatData.explanation || data?.moatAnalysis?.moat_narrative}
      </p>
      
      <div style={{ fontSize: 13, color: "#f0f0f0", fontWeight: 600 }}>
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
    <div>
      <div style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO, marginBottom: 12 }}>
        SUB-SCORES
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 16 }}>
        <SubScoreRow label="Industry Signal" score={details.industrySignal || details.subScores?.industrySignal || 1} max={7} color="#888" />
        <SubScoreRow label="Growth+Margin" score={details.growthMarginSignal || details.subScores?.growthMarginCombo || 0} max={4} color="#888" />
        <SubScoreRow label="Market Dominance" score={details.scaleSignal || details.subScores?.marketDominance || 0} max={4} color="#888" />
        <SubScoreRow label="Your Input" score={details.userInputProvided ? 10 : 0} max={10} color="#888" />
      </div>
      
      {!details.userInputProvided ? (
        <div style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: "#f0f0f0", marginBottom: 12, fontWeight: 600 }}>
            Does {companyName}'s product get more valuable as more people use it?
          </div>
          <NetworkInput ticker={ticker} onSubmit={refreshKey} />
        </div>
      ) : (
        <div style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 6, padding: 10, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12 }}>🌐</span>
          <span style={{ fontSize: 13, color: "#22c55e", fontWeight: 600 }}>Your assessment: {details.userLabel?.toUpperCase() || details.userInputLabel?.toUpperCase() || 'CONFIRMED'} network effects</span>
        </div>
      )}
      
      <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 6, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#f0f0f0", marginBottom: 8 }}>ALGORITHMIC SIGNALS</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 12, color: "#f0f0f0" }}>
            Industry: <span style={{ color: "#f0f0f0" }}>{industryName}</span> → {(details.industrySignal || 0) >= 4 ? "Strong" : (details.industrySignal || 0) >= 2 ? "Moderate" : "Weak"} network signal
          </div>
          <div style={{ fontSize: 12, color: "#f0f0f0" }}>
            Algorithmic score: <span style={{ color: "#22c55e", fontFamily: MONO }}>{(details.algorithmicScore || 0)}/15</span> (excluding user input)
          </div>
        </div>
      </div>
      
      <p style={{ fontSize: 12, color: "#f0f0f0", lineHeight: 1.6, margin: "0 0 12px 0" }}>
        {moatData.explanation || `Network effects analysis for ${companyName}.`}
      </p>
      
      <div style={{ fontSize: 13, color: "#f0f0f0", fontWeight: 600 }}>
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
    <div>
      <div style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO, marginBottom: 12 }}>
        SUB-SCORES
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 16 }}>
        <SubScoreRow label="R&D / IP" score={isHighRD ? 5 : 2} max={7} color="#888" />
        <SubScoreRow label="Accumulated Scale" score={parseFloat(currentGM) >= 55 ? 5 : parseFloat(currentGM) >= 45 ? 4 : 3} max={6} color="#888" />
        <SubScoreRow label="Margin Persistence" score={isSustained ? 5 : 3} max={6} color="#888" />
        <SubScoreRow label="Regulatory Barrier" score={isHighBarrier ? 5 : 2} max={6} color="#888" />
      </div>
      
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {isHighRD && <span style={{ fontSize: 11, padding: "4px 8px", borderRadius: 4, background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}>🧬 High R&D Industry</span>}
        {!isHighRD && <span style={{ fontSize: 11, padding: "4px 8px", borderRadius: 4, background: "rgba(255,255,255,0.03)", color: "#f0f0f0", border: "1px solid rgba(255,255,255,0.06)" }}>🧬 Low R&D Intensity</span>}
        {isHighBarrier && <span style={{ fontSize: 11, padding: "4px 8px", borderRadius: 4, background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}>🏛️ Regulatory Barrier</span>}
        {!isHighBarrier && <span style={{ fontSize: 11, padding: "4px 8px", borderRadius: 4, background: "rgba(255,255,255,0.03)", color: "#f0f0f0", border: "1px solid rgba(255,255,255,0.06)" }}>🏛️ Low Regulatory Barrier</span>}
        {isSustained && <span style={{ fontSize: 11, padding: "4px 8px", borderRadius: 4, background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}>📊 Margins Stable</span>}
        {!isSustained && <span style={{ fontSize: 11, padding: "4px 8px", borderRadius: 4, background: "rgba(255,255,255,0.03)", color: "#f0f0f0", border: "1px solid rgba(255,255,255,0.06)" }}>📊 Margin Volatility</span>}
      </div>
      
      <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 6, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#f0f0f0", marginBottom: 8 }}>MARGIN PERSISTENCE</div>
        <div style={{ display: "flex", gap: 16 }}>
          <EvidenceIndicator label="Current GM" value={currentGM + "%"} good={parseFloat(currentGM) >= 45} showGood />
          <EvidenceIndicator label="Beta" value={typeof beta === 'number' ? beta.toFixed(2) : beta} good={parseFloat(beta) < 1.2} showGood />
          <div style={{ fontSize: 12 }}>
            <span style={{ color: "#f0f0f0" }}>Signal: </span>
            <span style={{ color: isSustained ? "#22c55e" : "#eab308" }}>{isSustained ? "Sustained" : "Volatile"}</span>
          </div>
        </div>
      </div>
      
      <div style={{ fontSize: 12, color: "#f0f0f0", marginBottom: 12 }}>
        <strong style={{ color: "#f0f0f0" }}>What makes it hard to replicate?</strong>
        <ul style={{ margin: "6px 0", paddingLeft: 16 }}>
          {isHighRD && <li style={{ marginBottom: 4 }}>Cumulative R&D investment in {data?.industry || "this industry"} creates knowledge barriers new entrants cannot shortcut</li>}
          {isHighBarrier && <li style={{ marginBottom: 4 }}>{data?.industry || "This industry"} requires regulatory approvals and expertise that take years to develop</li>}
          {isSustained && <li style={{ marginBottom: 4 }}>Sustained {currentGM}% gross margins confirm durable advantages</li>}
          {!isHighRD && !isHighBarrier && !isSustained && <li style={{ marginBottom: 4 }}>Limited evidence of accumulated learning curve advantages in this business</li>}
        </ul>
      </div>
      
      <p style={{ fontSize: 12, color: "#f0f0f0", lineHeight: 1.6, margin: "0 0 12px 0" }}>
        {moatData.explanation || `Learning curve analysis for ${companyName}.`}
      </p>
      
      <div style={{ fontSize: 13, color: "#f0f0f0", fontWeight: 600 }}>
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
    <div>
      <div style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO, marginBottom: 12 }}>
        SUB-SCORES
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 16 }}>
        <SubScoreRow label="Industry Lock-in" score={details.industryLevel === "Very High" ? 10 : details.industryLevel === "High" ? 7 : details.industryLevel === "Moderate" ? 4 : 1} max={10} color="#888" />
        <SubScoreRow label="Revenue Retention" score={parseFloat(gm) >= 50 && parseFloat(om) >= 18 ? 4 : parseFloat(gm) >= 40 ? 2 : 1} max={6} color="#888" />
        <SubScoreRow label="ROE Persistence" score={parseFloat(roeVal) >= 25 ? 5 : parseFloat(roeVal) >= 18 ? 4 : 2} max={5} color="#888" />
        <SubScoreRow label="Revenue Stability" score={parseFloat(revGrowth) > 0 ? 4 : parseFloat(revGrowth) > -5 ? 2 : 0} max={4} color="#888" />
      </div>
      
      <div style={{ background: tierBg[details.industryLevel] || "rgba(255,255,255,0.02)", border: `1px solid ${tierColor}30`, borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14 }}>{details.industryLevel === "Very High" || details.industryLevel === "High" ? "🔒" : "🔓"}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: tierColor }}>{(details.industryLevel || 'UNKNOWN').toUpperCase()} inherent switching costs</span>
        </div>
        {details.industryLevel !== "Low" && (
          <p style={{ fontSize: 12, color: "#f0f0f0", margin: "8px 0 0 22px", lineHeight: 1.5 }}>
            {data?.industry?.toLowerCase().includes("software") ? "Enterprise software requires deep workflow integration and data migration" :
             data?.industry?.toLowerCase().includes("bank") ? "Financial relationships involve complex regulatory and data transfer processes" :
             data?.industry?.toLowerCase().includes("defense") ? "Defense contracts span multiple years with specialized requirements" :
             data?.industry?.toLowerCase().includes("medical") ? "Medical devices require FDA-specific approvals tied to specific products" :
             "Established business relationships create meaningful switching friction"}
          </p>
        )}
      </div>
      
      <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 6, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#f0f0f0", marginBottom: 8 }}>FINANCIAL EVIDENCE</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <div style={{ fontSize: 12, color: "#f0f0f0", marginBottom: 4 }}>Pricing Power</div>
            <div style={{ display: "flex", gap: 12 }}>
              <EvidenceIndicator label="GM" value={gm + "%"} good={parseFloat(gm) >= 40} showGood />
              <EvidenceIndicator label="OM" value={om + "%"} good={parseFloat(om) >= 15} showGood />
            </div>
          </div>
          <EvidenceIndicator label="ROE" value={typeof roeVal === 'number' ? roeVal.toFixed(1) + "%" : roeVal + "%"} good={parseFloat(roeVal) >= 18} showGood />
          <div style={{ fontSize: 12 }}>
            <span style={{ color: "#f0f0f0" }}>Revenue: </span>
            <span style={{ color: parseFloat(revGrowth) >= 0 ? "#22c55e" : "#ef4444" }}>
              {parseFloat(revGrowth) >= 0 ? "Growing" : "Declining"} {revGrowth}%
            </span>
          </div>
        </div>
      </div>
      
      <p style={{ fontSize: 12, color: "#f0f0f0", lineHeight: 1.6, margin: "0 0 12px 0" }}>
        {moatData.explanation || `Switching cost analysis for ${companyName}.`}
      </p>
      
      <div style={{ fontSize: 13, color: "#f0f0f0", fontWeight: 600 }}>
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
  const getCategoryColor = () => "#888";

  return (
    <>
      {/* MOAT Section */}
      <ScoreSection title="Moat" score={moat.moat_score || 0} max={100} grade={moat.moat_type?.toUpperCase()} infoTip={EDUCATION.economicMoat} color={moat.moat_type === "wide" ? "#22c55e" : moat.moat_type === "narrow" ? "#eab308" : "#ef4444"}>
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
        
        {expandedMoat === "supply_side" && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 16, marginTop: 8 }}>
            <SupplySideDetail data={data} />
          </div>
        )}
        {expandedMoat === "network_effects" && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 16, marginTop: 8 }}>
            <NetworkDetail data={data} ticker={ticker} refreshKey={refreshKey} />
          </div>
        )}
        {expandedMoat === "learning_curve" && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 16, marginTop: 8 }}>
            <LearningDetail data={data} />
          </div>
        )}
        {expandedMoat === "switching_costs" && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 16, marginTop: 8 }}>
            <SwitchingDetail data={data} />
          </div>
        )}
      </ScoreSection>

      {/* ROIC Section */}
      <ScoreSection title="ROIC" score={Math.min(100, Math.max(0, Math.round(parseFloat(roic.roic || 0))))} max={100} infoTip={EDUCATION.roic}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <Met label="ROIC" value={roic.roic + "%"} color="#f0f0f0" />
          <Met label="WACC" value={roic.wacc + "%"} color="#f0f0f0" />
          <Met label="SPREAD" value={(parseFloat(roic.spread) > 0 ? "+" : "") + roic.spread + "%"} color={parseFloat(roic.spread) > 10 ? "#22c55e" : "#eab308"} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, padding: "10px 0", background: "rgba(255,255,255,0.02)", borderRadius: 7, marginBottom: 8 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "#f0f0f0", marginBottom: 2, display: "flex", alignItems: "center", gap: 4 }}>
              NOPAT
              <InfoTip title={EDUCATION.nopatMargin.title}>{EDUCATION.nopatMargin.content}</InfoTip>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#f0f0f0" }}>{roic.nopatMargin}%</div>
          </div>
          <span style={{ color: "#2a2a2a" }}>×</span>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "#f0f0f0", marginBottom: 2, display: "flex", alignItems: "center", gap: 4 }}>
              TURNOVER
              <InfoTip title={EDUCATION.assetTurnover.title}>{EDUCATION.assetTurnover.content}</InfoTip>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#f0f0f0" }}>{roic.assetTurnover}x</div>
          </div>
          <span style={{ color: "#2a2a2a" }}>=</span>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "#f0f0f0", marginBottom: 2 }}>ROIC</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#f0f0f0" }}>{roic.roic}%</div>
          </div>
        </div>
        {sensitivity.levers?.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: "#f0f0f0" }}>SENSITIVITY LEVERS:</div>
            <InfoTip title={EDUCATION.sensitivityLevers.title}>{EDUCATION.sensitivityLevers.content}</InfoTip>
          </div>
        )}
        {sensitivity.levers?.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {sensitivity.levers?.slice(0, 3).map((lever, i) => (
              <div key={i} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "8px 12px", fontSize: 12 }}>
                <span style={{ color: "#f0f0f0" }}>{lever.name.split("(")[0].trim()}: </span>
                <span style={{ color: "#f0f0f0" }}>{lever.current}</span>
                <span style={{ color: "#22c55e", marginLeft: 4 }}>{parseFloat(lever.roicDelta) >= 0 ? "+" : ""}{lever.roicDelta}%</span>
              </div>
            ))}
          </div>
        )}
      </ScoreSection>

      {/* AI Disruption */}
      {(() => {
        const aiScoreMap = { strong_tailwind: 90, tailwind: 70, neutral: 50, headwind: 30, strong_headwind: 10 };
        const aiScore = aiScoreMap[ai.net_impact] || 50;
        return (
          <ScoreSection title="AI Disruption" score={aiScore} max={100} grade={ai.net_impact?.replace(/_/g, " ")} infoTip={EDUCATION.aiDisruption} color={aiColors[ai.net_impact]}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <Pill color={tc(ai.threat_level)}>Threat: {ai.threat_level?.toUpperCase()}</Pill>
              <Pill color="#22c55e">Opp: {ai.opportunity_level?.toUpperCase()}</Pill>
              <Pill color={aiColors[ai.net_impact]}>{ai.net_impact?.replace(/_/g, " ").toUpperCase()}</Pill>
            </div>
            <p style={{ fontSize: 13, color: "#f0f0f0", margin: 0, lineHeight: 1.5 }}>{ai.net_assessment}</p>
          </ScoreSection>
        );
      })()}

      {/* Constraints Section */}
      {(() => {
        const constraintScoreMap = { low: 85, moderate: 55, high: 25, severe: 10 };
        const constraintScore = constraintScoreMap[constraints.overall_severity] || 50;
        return (
          <ScoreSection title="Growth Constraints" score={constraintScore} max={100} grade={constraints.overall_severity?.toUpperCase()} infoTip={EDUCATION.growthConstraints}>
            <div style={{ display: "grid", gap: 6 }}>
              {constraints.constraints?.map((c, i) => (
                <div key={i} style={{ 
                  padding: "8px 10px", 
                  background: "rgba(255,255,255,0.02)", 
                  borderRadius: 6,
                  borderLeft: `3px solid ${tc(c.severity)}`
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#f0f0f0" }}>{c.name}</span>
                    <Pill color={tc(c.severity)}>{c.severity}</Pill>
                  </div>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 12, color: "#f0f0f0", margin: "10px 0 0", fontStyle: "italic" }}>{constraints.net_assessment}</p>
          </ScoreSection>
        );
      })()}
    </>
  );
}

export default function AnalysisDetail({ ticker, onBack, onAnalyzeTicker }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [refreshKey, setRefreshKey] = useState(0);
  const [dcfData, setDcfData] = useState(null);
  const [dcfLoading, setDcfLoading] = useState(false);
  const [analyzeBtnHover, setAnalyzeBtnHover] = useState(false);
  const [dcfBtnHover, setDcfBtnHover] = useState(false);

  const analysisApi = useAbortableApi();
  const dcfApi = useAbortableApi();
  const analysisReqId = useRef(0);
  const dcfReqId = useRef(0);

  useEffect(() => {
    setDcfData(null);
  }, [ticker]);

  useEffect(() => {
    setData(null);
  }, [ticker]);

  useEffect(() => {
    const id = ++analysisReqId.current;
    const ac = analysisApi.beginRequest();
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await apiFetch(`/api/analysis/${ticker}`, { signal: ac.signal });
        const json = await res.json();

        if (!json.success) {
          throw new Error(json.error || "Failed to fetch analysis");
        }
        if (analysisReqId.current !== id) return;
        setData(json);
      } catch (err) {
        if (isAbortError(err)) return;
        if (analysisReqId.current !== id) return;
        setError(err.message);
      } finally {
        analysisApi.clearIfCurrent(ac);
        if (analysisReqId.current === id) setLoading(false);
      }
    })();
    // analysisApi methods are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, refreshKey]);

  const handleRefresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    if (activeTab !== "dcf") return undefined;
    if (dcfData) return undefined;

    const id = ++dcfReqId.current;
    const ac = dcfApi.beginRequest();
    setDcfLoading(true);

    (async () => {
      try {
        const res = await apiFetch(`/api/dcf/${ticker}`, { signal: ac.signal });
        const json = await res.json();
        if (dcfReqId.current !== id) return;
        if (json.success) {
          setDcfData(json);
        }
      } catch (e) {
        if (!isAbortError(e)) console.error("Failed to fetch DCF:", e);
      } finally {
        dcfApi.clearIfCurrent(ac);
        if (dcfReqId.current === id) setDcfLoading(false);
      }
    })();

    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch when tab/ticker/data cleared; skip if dcf already loaded
  }, [activeTab, ticker, dcfData]);

  if (loading && !data) {
    return (
      <div className="ma-analysis-shell" style={{ padding: "48px 24px 40px", width: "100%", boxSizing: "border-box" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <LoadingSpinner size={40} />
          <div style={{ color: "#f0f0f0", fontFamily: MONO }}>Analyzing {ticker}...</div>
        </div>
        <div style={RUN_ACTION_BAR_STYLE}>
          <button
            type="button"
            onClick={() => {
              analysisApi.abortInFlight();
              setLoading(false);
            }}
            onMouseEnter={() => setAnalyzeBtnHover(true)}
            onMouseLeave={() => setAnalyzeBtnHover(false)}
            style={{
              padding: "8px 20px",
              flexShrink: 0,
              background: analyzeBtnHover ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.06)",
              border: analyzeBtnHover ? "1px solid rgba(239,68,68,0.45)" : "1px solid rgba(255,255,255,0.12)",
              borderRadius: 6,
              color: analyzeBtnHover ? "#fca5a5" : "#888",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: MONO
            }}
          >
            {analyzeBtnHover ? "CANCEL" : "STOP LOADING"}
          </button>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="ma-analysis-shell" style={{ padding: 20 }}>
        <button type="button" className="ma-analysis-toolbar__back" onClick={onBack}>
          ← Back
        </button>
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

  const analyze = typeof onAnalyzeTicker === "function" ? onAnalyzeTicker : () => {};

  return (
    <div className="ma-analysis-shell">
      <AnalysisToolbar ticker={ticker} onBack={onBack} onAnalyzeTicker={analyze} />

      <StockResearchHeader data={data} />

      {loading && data && (
        <Box border="rgba(255,255,255,0.08)" style={{ marginBottom: 12, padding: "10px 14px", background: "rgba(255,255,255,0.02)" }}>
          <div style={{ fontSize: 12, color: "#888", fontFamily: MONO }}>Refreshing analysis for {ticker}…</div>
        </Box>
      )}
      {error && data && (
        <Box border="rgba(239,68,68,0.25)" style={{ marginBottom: 12, padding: "10px 14px", background: "rgba(239,68,68,0.06)" }}>
          <div style={{ fontSize: 12, color: "#ef4444", fontFamily: MONO }}>Could not refresh: {error}</div>
        </Box>
      )}

      <div style={{ opacity: loading && data ? 0.72 : 1, transition: "opacity 0.2s ease" }}>
      <div style={{ display: "flex", gap: 2, marginBottom: 16, overflowX: "auto", background: "rgba(255,255,255,0.02)", borderRadius: 7, padding: 3, width: "fit-content" }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{ padding: "8px 16px", background: activeTab === t.key ? "rgba(255,255,255,0.08)" : "transparent", border: "none", borderRadius: 5, color: activeTab === t.key ? "#f0f0f0" : "#555", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: MONO, whiteSpace: "nowrap" }}>
            {t.label.toUpperCase()}
          </button>
        ))}
      </div>

      {activeTab === "overview" && <OverviewTab data={data} ticker={ticker} />}
      {activeTab === "scale" && <ScaleTab data={data} ticker={ticker} refreshKey={handleRefresh} />}
      {activeTab === "dcf" && (dcfLoading ? (
        <div style={{ padding: "48px 24px 40px", width: "100%", boxSizing: "border-box" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
            <LoadingSpinner size={40} />
            <div style={{ color: "#f0f0f0", fontFamily: MONO }}>Building DCF model...</div>
          </div>
          <div style={RUN_ACTION_BAR_STYLE}>
            <button
              type="button"
              onClick={() => {
                dcfApi.abortInFlight();
                setDcfLoading(false);
              }}
              onMouseEnter={() => setDcfBtnHover(true)}
              onMouseLeave={() => setDcfBtnHover(false)}
              style={{
                padding: "8px 20px",
                flexShrink: 0,
                background: dcfBtnHover ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.06)",
                border: dcfBtnHover ? "1px solid rgba(239,68,68,0.45)" : "1px solid rgba(255,255,255,0.12)",
                borderRadius: 6,
                color: dcfBtnHover ? "#fca5a5" : "#888",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: MONO
              }}
            >
              {dcfBtnHover ? "CANCEL" : "STOP LOADING"}
            </button>
          </div>
        </div>
      ) : dcfData ? (
        <Suspense fallback={<div style={{ padding: 20, textAlign: "center", color: "#f0f0f0", fontFamily: MONO }}>Loading...</div>}>
          <DCFTab data={dcfData} />
        </Suspense>
      ) : (
        <div style={{ padding: 20, textAlign: "center", color: "#f0f0f0", fontFamily: MONO }}>Failed to load DCF data</div>
      ))}
      {activeTab === "comps" && (
        <Suspense fallback={<div style={{ padding: 20, textAlign: "center", color: "#f0f0f0" }}>Loading...</div>}>
          <CompsTab ticker={ticker} />
        </Suspense>
      )}

      {data.description && (
        <Box border="rgba(255,255,255,0.06)" style={{ marginTop: 4 }}>
          <SH color="#f0f0f0">About</SH>
          <p style={{ fontSize: 13, color: "#f0f0f0", lineHeight: 1.7, margin: 0 }}>
            {data.description.substring(0, 300)}{data.description.length > 300 && "..."}
          </p>
        </Box>
      )}
      </div>
    </div>
  );
}
