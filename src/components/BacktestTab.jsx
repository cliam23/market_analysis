import { useState, useEffect, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, ComposedChart, Bar } from "recharts";

import { MONO, SANS } from "../lib/theme.js";
import { apiFetch } from "../lib/api.js";
import { useAbortableApi, isAbortError } from "../hooks/useAbortableApi.js";
import { Box, Select } from "./shared.jsx";
import { PILLAR_ORDER, PILLAR_LABELS, isCompositeStrategy, UNIVERSE_OPTIONS, STRATEGY_OPTIONS, TOP_N_OPTIONS, PERIOD_OPTIONS } from "../lib/constants.js";
import { fmtWeightPct } from "../lib/formatters.js";

function MetricCard({ label, value, subValue, color, compareColor }) {
  const isPositive = parseFloat(value) >= 0;
  const displayColor = color || (isPositive ? "#22c55e" : "#ef4444");
  
  return (
    <div style={{ 
      background: "rgba(255,255,255,0.03)", 
      borderRadius: 8, 
      padding: "12px 16px", 
      textAlign: "center",
      flex: "1 1 120px"
    }}>
      <div style={{ fontSize: 10, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 6, fontFamily: MONO }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: displayColor, fontFamily: MONO }}>
        {value}
      </div>
      {subValue && (
        <div style={{ fontSize: 11, color: compareColor || "#666", marginTop: 4, fontFamily: MONO }}>
          vs {subValue}
        </div>
      )}
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;

  const stratGreen = payload.find((p) => p.dataKey === "portfolioGreen" && p.value != null);
  const stratRed = payload.find((p) => p.dataKey === "portfolioRed" && p.value != null);
  const bench = payload.find((p) => p.dataKey === "benchmark" && p.value != null);
  const cashNom = payload.find((p) => p.dataKey === "cashInflationAdjusted" && p.value != null && Number.isFinite(Number(p.value)));

  const rows = [];
  if (stratGreen || stratRed) {
    const v = stratGreen?.value ?? stratRed?.value;
    const color =
      stratGreen && stratRed && stratGreen.value === stratRed.value
        ? "#e5e5e5"
        : stratGreen
          ? C_VS_SPY_WIN
          : C_VS_SPY_LOSE;
    rows.push({ key: "strat", color, text: `Strategy: $${Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` });
  }
  if (bench) {
    rows.push({
      key: "bench",
      color: bench.color,
      text: `${bench.name}: $${Number(bench.value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    });
  }
  if (cashNom) {
    rows.push({
      key: "cash",
      color: cashNom.color,
      text: `${cashNom.name}: $${Number(cashNom.value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    });
  }
  for (let i = 0; i < payload.length; i++) {
    const p = payload[i];
    if (p.dataKey === "portfolioGreen" || p.dataKey === "portfolioRed" || p.dataKey === "benchmark" || p.dataKey === "cashInflationAdjusted") continue;
    rows.push({
      key: `o-${i}`,
      color: p.color,
      text: `${p.name}: $${p.value?.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    });
  }

  return (
    <div style={{ 
      background: "rgba(20,20,20,0.95)", 
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: 8,
      padding: 12,
      fontFamily: MONO,
      fontSize: 12
    }}>
      <div style={{ color: "#f0f0f0", marginBottom: 6 }}>{label}</div>
      {rows.map((r) => (
        <div key={r.key} style={{ color: r.color, marginBottom: 2 }}>
          {r.text}
        </div>
      ))}
    </div>
  );
}

const isCompositeFamily = isCompositeStrategy;

/** Green = beating benchmark, red = trailing benchmark (for headline metrics). */
const C_VS_SPY_WIN = "#22c55e";
const C_VS_SPY_LOSE = "#ef4444";
const C_SPY_LINE = "#94a3b8";
const C_CASH_LINE = "#38bdf8";

function finiteNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Nominal $ with same purchasing power as day-1 capital (flat ~3%/yr compound if API omits series — stale cache). */
function cashInflationBaselineForRow(row, firstRow, initialCapital, annualPct) {
  const fromApi = finiteNum(row.cashInflationAdjusted);
  if (fromApi != null) return fromApi;
  const cap = finiteNum(initialCapital);
  const start = firstRow?.date;
  if (cap == null || !start || !row?.date) return null;
  const pct = finiteNum(annualPct);
  const r = pct != null && pct > 0 ? pct / 100 : 0.03;
  const t0 = new Date(start + "T12:00:00").getTime();
  const t1 = new Date(row.date + "T12:00:00").getTime();
  const years = (t1 - t0) / (365.25 * 86400000);
  return cap * Math.pow(1 + r, years);
}

/** Split equity vs benchmark into green (above) / red (below) series; inserts crossover points so segments meet cleanly. */
function buildSegmentedEquityChartData(curve, initialCapital, inflationBaselineAnnualPct) {
  if (!curve || curve.length === 0) return [];

  const first = curve[0];
  const out = [];

  const push = (date, benchmark, portfolio, above, cashBaseline) => {
    const b = Number(benchmark);
    const p = Number(portfolio);
    out.push({
      date,
      benchmark: b,
      portfolioGreen: above ? p : null,
      portfolioRed: above ? null : p,
      cashInflationAdjusted: finiteNum(cashBaseline)
    });
  };

  push(
    first.date,
    first.benchmark,
    first.portfolio,
    Number(first.portfolio) >= Number(first.benchmark),
    cashInflationBaselineForRow(first, first, initialCapital, inflationBaselineAnnualPct)
  );

  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1];
    const curr = curve[i];
    const p0 = Number(prev.portfolio);
    const b0 = Number(prev.benchmark);
    const p1 = Number(curr.portfolio);
    const b1 = Number(curr.benchmark);
    const c0 = cashInflationBaselineForRow(prev, first, initialCapital, inflationBaselineAnnualPct);
    const c1 = cashInflationBaselineForRow(curr, first, initialCapital, inflationBaselineAnnualPct);
    const a0 = p0 >= b0;
    const a1 = p1 >= b1;

    if (a0 === a1) {
      push(curr.date, b1, p1, a1, c1);
      continue;
    }

    const dp = p1 - p0;
    const db = b1 - b0;
    const denom = dp - db;
    let t = 0.5;
    if (Math.abs(denom) > 1e-12) {
      t = (b0 - p0) / denom;
    }
    t = Math.max(0, Math.min(1, t));

    const crossP = p0 + t * dp;
    const crossB = b0 + t * db;
    const crossC = c0 != null && c1 != null ? c0 + t * (c1 - c0) : c1 ?? c0;
    const tms0 = new Date(prev.date + "T12:00:00").getTime();
    const tms1 = new Date(curr.date + "T12:00:00").getTime();
    const crossDate = new Date(tms0 + t * (tms1 - tms0)).toISOString().slice(0, 10);

    out.push({
      date: crossDate,
      benchmark: crossB,
      portfolioGreen: crossP,
      portfolioRed: crossP,
      cashInflationAdjusted: finiteNum(crossC)
    });

    push(curr.date, b1, p1, a1, c1);
  }

  return out;
}
const C_SUB_NEUTRAL = "#64748b";

const TRADE_LOG_TH_STICKY = {
  padding: "8px 10px",
  color: "#f0f0f0",
  position: "sticky",
  top: 0,
  background: "rgba(24,24,26,0.98)",
  boxShadow: "0 1px 0 rgba(255,255,255,0.06)",
  zIndex: 1,
};

/** Table cell: strategy value vs benchmark (or alpha vs 0). */
function colorMetricVsBench(label, stratRaw, benchRaw) {
  const strat = parseFloat(stratRaw);
  const bench = benchRaw != null && benchRaw !== "" ? parseFloat(benchRaw) : NaN;
  if (label === "Alpha %") {
    if (strat > 0) return C_VS_SPY_WIN;
    if (strat < 0) return C_VS_SPY_LOSE;
    return "#eab308";
  }
  if (label.includes("Win rate") || label.includes("Hit rate")) {
    return strat >= 50 ? C_VS_SPY_WIN : C_VS_SPY_LOSE;
  }
  if (benchRaw == null || benchRaw === "" || Number.isNaN(bench)) return "#f0f0f0";
  // API sends drawdown as negative % (e.g. -14 vs -19). Less loss = higher number → beat when strat >= bench.
  if (label.includes("Max DD")) {
    return strat >= bench ? C_VS_SPY_WIN : C_VS_SPY_LOSE;
  }
  return strat >= bench ? C_VS_SPY_WIN : C_VS_SPY_LOSE;
}

export default function BacktestTab() {
  const [loading, setLoading] = useState(false);
  const [loadSec, setLoadSec] = useState(0);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [showTrades, setShowTrades] = useState(false);
  const [compareSnaps, setCompareSnaps] = useState({ full_composite: null, full_composite_aggressive: null });
  
  const [settings, setSettings] = useState({
    universe: "sp500_top150",
    period: "3y",
    rebalanceFreq: "bimonthly",
    topN: "15",
    strategy: "full_composite",
    initialCapital: "10000",
    adaptiveMode: "adaptive",
    positionSizing: "invVol"
  });
  /** Composite-only: server defaults to RL when trained agent exists; UI sends explicit true/false. */
  const [rlAgentOn, setRlAgentOn] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedWrapRef = useRef(null);

  useEffect(() => {
    if (!advancedOpen) return;
    const onDown = (e) => {
      if (advancedWrapRef.current && !advancedWrapRef.current.contains(e.target)) {
        setAdvancedOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setAdvancedOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [advancedOpen]);

  const updateSetting = (key, value) => {
    setSettings(s => ({ ...s, [key]: value }));
    setResults(null);
    setError(null);
  };
  
  const freqOptions = [
    { id: "monthly", label: "Monthly" },
    { id: "bimonthly", label: "Bimonthly" },
    { id: "quarterly", label: "Quarterly" },
    { id: "weekly", label: "Weekly" },
    { id: "biweekly", label: "Biweekly" }
  ];

  const adaptiveModeOptions = [
    { id: "adaptive", label: "Adaptive" },
    { id: "fixed", label: "Fixed (server defaults)" },
    { id: "conservative", label: "Conservative blend" }
  ];

  const positionSizingOptions = [
    { id: "invVol", label: "Inverse vol" },
    { id: "invVolBlend", label: "Inv vol + 40% equal" },
    { id: "equal", label: "Equal" },
    { id: "score", label: "Score-weighted" }
  ];
  
  const { abortInFlight: abortInFlightBacktest, beginRequest, clearIfCurrent } = useAbortableApi();

  useEffect(() => {
    if (!loading) {
      setLoadSec(0);
      return;
    }
    const t0 = Date.now();
    const id = setInterval(() => setLoadSec(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [loading]);

  // Stop loading when universe/strategy/period/etc. change so the previous model's request doesn't finish later.
  useEffect(() => {
    if (!loading) return;
    abortInFlightBacktest();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only abort when filters change, not when loading toggles
  }, [
    settings.universe,
    settings.period,
    settings.rebalanceFreq,
    settings.topN,
    settings.strategy,
    settings.initialCapital,
    settings.adaptiveMode,
    settings.positionSizing,
    rlAgentOn
  ]);

  const runBacktest = async () => {
    const ac = beginRequest();
    const { signal } = ac;

    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({
        period: settings.period,
        rebalanceFreq: settings.rebalanceFreq,
        topN: settings.topN,
        strategy: settings.strategy,
        initialCapital: settings.initialCapital,
        adaptiveMode: settings.adaptiveMode,
        positionSizing: settings.positionSizing,
        optimize: "false",
        _t: Date.now()
      });
      if (isCompositeFamily(settings.strategy)) {
        params.set("rlAgent", rlAgentOn ? "true" : "false");
      }

      const response = await apiFetch(`/api/backtest/${settings.universe}?${params}`, { signal });
      const rawText = await response.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(rawText.slice(0, 200) || `Bad response (HTTP ${response.status})`);
      }
      if (!response.ok) {
        throw new Error(data.error || data.message || `HTTP ${response.status}`);
      }

      if (!data.success) {
        throw new Error(data.error || "Backtest failed");
      }
      
      setResults(data);
      const strat = (data.strategy || "").toLowerCase().trim();
      if (strat === "full_composite" || strat === "full_composite_aggressive") {
        setCompareSnaps((prev) => ({
          ...prev,
          [strat]: {
            performance: data.performance,
            strategy: strat,
            universe: data.universe,
            period: data.period
          }
        }));
      }
    } catch (err) {
      if (isAbortError(err)) {
        return;
      }
      setError(err.message);
    } finally {
      clearIfCurrent(ac);
      setLoading(false);
    }
  };

  const onRunBacktestClick = () => {
    if (loading) {
      abortInFlightBacktest();
      setLoading(false);
      return;
    }
    runBacktest();
  };
  
  const formatValue = (val) => {
    const num = parseFloat(val);
    const sign = num >= 0 ? "+" : "";
    return `${sign}${num.toFixed(1)}%`;
  };
  
  /** Alpha > 0 = beat benchmark on risk-adjusted basis → green; < 0 → red. */
  const alphaVsBenchColor = (alpha) => {
    const n = parseFloat(alpha);
    if (n > 0) return C_VS_SPY_WIN;
    if (n < 0) return C_VS_SPY_LOSE;
    return "#eab308";
  };

  /** Aligns with server UNIVERSE_BENCHMARK_LABELS + Backtest universe dropdown ids. */
  const UNIVERSE_BENCH_DISPLAY = {
    sp500_top50: { short: "S&P Top 50", line: "Equal-weight S&P Top 50", tag: "S&P" },
    sp500_top150: { short: "S&P Top 150", line: "Equal-weight S&P Top 150", tag: "S&P" },
    vgt: { short: "VGT", line: "VGT universe (equal-weight)", tag: "VGT" },
    mag7: { short: "Mag 7", line: "Mag 7 (equal-weight)", tag: "M7" },
    russell_growth: { short: "Russell growth", line: "Russell growth (equal-weight)", tag: "RusG" },
    dividend_aristocrats: { short: "Div. aristocrats", line: "Dividend aristocrats (equal-weight)", tag: "Arist" }
  };
  const apiBench = results?.benchmark;
  const disp = results?.universe ? UNIVERSE_BENCH_DISPLAY[results.universe] : null;
  const benchShort =
    apiBench?.type === "universe_equal_weight"
      ? disp?.short ?? apiBench.shortLabel ?? "Universe"
      : apiBench?.type === "spy_fallback"
        ? apiBench.shortLabel ?? "SPY"
        : "SPY";
  /** Ultra-short suffix for KPI subs (uniform “value vs tag”). Full name stays in benchmark line + chart. */
  const benchTag =
    apiBench?.type === "universe_equal_weight"
      ? disp?.tag ?? benchShort
      : apiBench?.type === "spy_fallback"
        ? "SPY"
        : "SPY";
  const benchLineName =
    apiBench?.type === "universe_equal_weight"
      ? apiBench.label ?? disp?.line ?? benchShort
      : apiBench?.type === "spy_fallback"
        ? apiBench.label ?? "S&P 500 (SPY)"
        : "S&P 500 (SPY)";
  const benchDescription = apiBench?.description ?? null;
  const strategyAboveLabel = `Strategy (above ${benchShort})`;
  const strategyBelowLabel = `Strategy (below ${benchShort})`;

  const btFilterGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(6.75rem, 1fr))",
    gap: "6px 8px",
    alignItems: "end"
  };

  const btAdvancedPopoverGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(8.25rem, 1fr))",
    gap: "8px 10px",
    alignItems: "end"
  };

  return (
    <div>
      {/* Controls */}
      <Box style={{ marginBottom: 12, padding: "10px 12px" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            gap: "8px 10px",
            justifyContent: "space-between"
          }}
        >
          <div style={{ ...btFilterGridStyle, flex: "1 1 12rem", minWidth: 0, maxWidth: "100%" }}>
            <Select
              compact
              label="UNIVERSE"
              value={settings.universe}
              onChange={(v) => updateSetting('universe', v)}
              options={UNIVERSE_OPTIONS}
            />
            <Select
              compact
              label="PERIOD"
              value={settings.period}
              onChange={(v) => updateSetting('period', v)}
              options={PERIOD_OPTIONS}
            />
            <Select
              compact
              label="STRATEGY"
              value={settings.strategy}
              onChange={(v) => updateSetting('strategy', v)}
              options={STRATEGY_OPTIONS}
            />
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "flex-end",
              gap: 8,
              flexShrink: 0,
              marginLeft: "auto"
            }}
          >
            <div ref={advancedWrapRef} style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setAdvancedOpen((o) => !o)}
                aria-expanded={advancedOpen}
                aria-haspopup="dialog"
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  color: advancedOpen ? "#e5e5e5" : "#a8a8a8",
                  cursor: "pointer",
                  padding: "6px 10px",
                  userSelect: "none",
                  background: advancedOpen ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 6,
                  whiteSpace: "nowrap",
                  boxSizing: "border-box"
                }}
              >
                Advanced {advancedOpen ? "▲" : "▼"}
              </button>
              {advancedOpen && (
                <div
                  role="dialog"
                  aria-label="Advanced backtest settings"
                  style={{
                    position: "absolute",
                    top: "100%",
                    right: 0,
                    marginTop: 6,
                    zIndex: 50,
                    minWidth: "min(92vw, 17.5rem)",
                    maxWidth: "min(92vw, 34rem)",
                    maxHeight: "min(72vh, 28rem)",
                    overflow: "auto",
                    padding: 12,
                    background: "rgba(18, 18, 22, 0.98)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 10,
                    boxShadow: "0 14px 48px rgba(0,0,0,0.5)"
                  }}
                >
                  <div style={btAdvancedPopoverGridStyle}>
                    <Select
                      compact
                      label="REBALANCE"
                      value={settings.rebalanceFreq}
                      onChange={(v) => updateSetting('rebalanceFreq', v)}
                      options={freqOptions}
                    />
                    <Select
                      compact
                      label="HOLD TOP"
                      value={settings.topN}
                      onChange={(v) => updateSetting('topN', v)}
                      options={TOP_N_OPTIONS}
                    />
                    <Select
                      compact
                      label="ADAPTIVE MODE"
                      value={settings.adaptiveMode}
                      onChange={(v) => updateSetting("adaptiveMode", v)}
                      options={adaptiveModeOptions}
                    />
                    <Select
                      compact
                      label="POSITION SIZING"
                      value={settings.positionSizing}
                      onChange={(v) => updateSetting("positionSizing", v)}
                      options={positionSizingOptions}
                    />
                    {isCompositeFamily(settings.strategy) && (
                      <Select
                        compact
                        label="RL AGENT"
                        value={rlAgentOn ? "on" : "off"}
                        onChange={(v) => {
                          setRlAgentOn(v === "on");
                          setResults(null);
                          setError(null);
                        }}
                        options={[
                          { id: "on", label: "On (RL policy)" },
                          { id: "off", label: "Off (rules only)" }
                        ]}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onRunBacktestClick}
              title={loading ? "Click to cancel the in-flight backtest" : undefined}
              style={{
                padding: "7px 14px",
                flexShrink: 0,
                minWidth: "9.25rem",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: loading ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 6,
                color: loading ? "#888" : "#f0f0f0",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: MONO,
                boxSizing: "border-box",
                whiteSpace: "nowrap"
              }}
            >
              {loading ? "RUNNING…" : "RUN BACKTEST"}
            </button>
          </div>
        </div>
      </Box>
      
      {loading && results && (
        <Box style={{ textAlign: "center", padding: "12px 16px", marginBottom: 12, borderColor: "rgba(255,255,255,0.08)" }}>
          <div style={{ color: "#888", fontFamily: MONO, fontSize: 12 }}>
            Updating backtest…
          </div>
        </Box>
      )}
      {loading && !results && (
        <Box style={{ textAlign: "center", padding: "40px" }}>
          <div style={{ color: "#f0f0f0", fontFamily: MONO, fontSize: 13 }}>
            Fetching historical data and running simulation…
            {loadSec > 0 ? (
              <span style={{ display: "block", marginTop: 10, color: "#a8a8a8", fontSize: 12 }}>
                {loadSec}s elapsed — large universe + Full Composite + ML can take 30–90s on a cold run; results appear when the server finishes.
              </span>
            ) : null}
          </div>
        </Box>
      )}
      
      {error && (
        <Box style={{ background: "rgba(239,68,68,0.05)", borderColor: "rgba(239,68,68,0.2)" }}>
          <div style={{ color: "#ef4444", fontSize: 13 }}>Error: {error}</div>
        </Box>
      )}
      
      {results && (
        <div style={{ opacity: loading ? 0.72 : 1, transition: "opacity 0.2s ease" }}>
        <>
          {/* Performance Summary */}
          <Box>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f0f0", marginBottom: 6, fontFamily: MONO, letterSpacing: 1 }}>
              PERFORMANCE SUMMARY — {results.period} ({results.performance.years} years)
            </div>
            {benchDescription ? (
              <div style={{ fontSize: 10, color: "#888", marginTop: -8, marginBottom: 12, fontFamily: MONO, lineHeight: 1.45 }}>
                Benchmark: {benchDescription}
              </div>
            ) : null}

            <div
              style={{
                marginBottom: 12,
                padding: "8px 12px",
                borderRadius: 8,
                border:
                  results.rlEvalGloballyEnabled === true && results.rlEnabled
                    ? "1px solid rgba(167,243,208,0.25)"
                    : "1px solid rgba(148,163,184,0.25)",
                background:
                  results.rlEvalGloballyEnabled === true && results.rlEnabled
                    ? "rgba(34,197,94,0.06)"
                    : "rgba(148,163,184,0.06)",
                fontFamily: MONO,
                fontSize: 11,
                color:
                  results.rlEvalGloballyEnabled === true && results.rlEnabled ? "#a7f3d0" : "#94a3b8",
                letterSpacing: 0.5
              }}
            >
              {results.rlEvalGloballyEnabled === true && results.rlEnabled && results.rlAgentKind === "dqn" ? (
                <>
                  DQN active — 96 actions ·{" "}
                  {(Number(results.rlAgentStats?.totalUpdates ?? results.rlTotalUpdates) || 0).toLocaleString()} updates
                </>
              ) : results.rlEvalGloballyEnabled === true && results.rlEnabled && results.rlAgentKind !== "dqn" ? (
                <>
                  Q-learning active (
                  {results.rlUniverse === "sp500_top50"
                    ? "top50"
                    : results.rlUniverse === "sp500_top150"
                      ? "top150"
                      : results.rlUniverse || "—"}
                  ) — {results.rlAgentStats?.statesVisited ?? results.rlStatesVisited ?? 0} states ·{" "}
                  {(Number(results.rlAgentStats?.totalUpdates ?? results.rlTotalUpdates) || 0).toLocaleString()} updates
                </>
              ) : results.rlEvalGloballyEnabled === true &&
                rlAgentOn &&
                isCompositeFamily(settings.strategy) &&
                results.rlEnabled === false &&
                results.rlAgentLoaded === false &&
                (settings.universe === "sp500_top50" || settings.universe === "sp500_top150") ? (
                <>No agent trained for this universe</>
              ) : (
                <>
                  Rules-based ({results.adaptiveMode === "adaptive" ? "adaptive weights" : "fixed weights"})
                </>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <MetricCard 
                label="TOTAL RETURN" 
                value={formatValue(results.performance.totalReturn)}
                subValue={`${formatValue(results.performance.benchmarkReturn)} vs ${benchTag}`}
                compareColor={C_SUB_NEUTRAL}
                color={parseFloat(results.performance.totalReturn) >= parseFloat(results.performance.benchmarkReturn) ? C_VS_SPY_WIN : C_VS_SPY_LOSE}
              />
              <MetricCard 
                label="ANNUALIZED" 
                value={formatValue(results.performance.annualizedReturn)}
                subValue={`${formatValue(results.performance.benchmarkAnnualized)} vs ${benchTag}`}
                compareColor={C_SUB_NEUTRAL}
                color={parseFloat(results.performance.annualizedReturn) >= parseFloat(results.performance.benchmarkAnnualized) ? C_VS_SPY_WIN : C_VS_SPY_LOSE}
              />
              <MetricCard 
                label="ALPHA" 
                value={formatValue(results.performance.alpha)}
                subValue={`same window vs ${benchTag}`}
                compareColor={C_SUB_NEUTRAL}
                color={alphaVsBenchColor(results.performance.alpha)}
              />
              <MetricCard 
                label="SHARPE" 
                value={results.performance.sharpe}
                subValue={`${results.performance.benchmarkSharpe} vs ${benchTag}`}
                compareColor={C_SUB_NEUTRAL}
                color={parseFloat(results.performance.sharpe) >= parseFloat(results.performance.benchmarkSharpe) ? C_VS_SPY_WIN : C_VS_SPY_LOSE}
              />
            </div>
            
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <MetricCard 
                label="MAX DRAWDOWN" 
                value={results.performance.maxDrawdown + "%"}
                subValue={`${results.performance.benchmarkMaxDD}% vs ${benchTag}`}
                compareColor={C_SUB_NEUTRAL}
                color={parseFloat(results.performance.maxDrawdown) >= parseFloat(results.performance.benchmarkMaxDD) ? C_VS_SPY_WIN : C_VS_SPY_LOSE}
              />
              <MetricCard 
                label="VOLATILITY" 
                value={results.performance.annualizedVol + "%"}
                subValue={`${results.performance.benchmarkVol}% vs ${benchTag}`}
                compareColor={C_SUB_NEUTRAL}
                color={parseFloat(results.performance.annualizedVol) <= parseFloat(results.performance.benchmarkVol) ? C_VS_SPY_WIN : C_VS_SPY_LOSE}
              />
              <MetricCard 
                label="WIN RATE" 
                value={results.performance.winRate + "%"}
                color={parseFloat(results.performance.winRate) >= 50 ? C_VS_SPY_WIN : C_VS_SPY_LOSE}
              />
              <MetricCard 
                label="HIT RATE" 
                value={results.performance.hitRate + "%"}
                subValue={`mo beat vs ${benchTag}`}
                compareColor={C_SUB_NEUTRAL}
                color={parseFloat(results.performance.hitRate) >= 50 ? C_VS_SPY_WIN : C_VS_SPY_LOSE}
              />
            </div>

            {results.performance.oneMonthSellCount != null && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f0f0", marginBottom: 10, fontFamily: MONO, letterSpacing: 1 }}>
                  TURNOVER / CHURN
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <MetricCard
                    label="1-MO SELLS"
                    value={String(results.performance.oneMonthSellCount)}
                    subValue={`avg ${results.performance.oneMonthSellAvgReturnPct}% (≤35d holds)`}
                    color={results.performance.oneMonthSellCount <= 3 ? C_VS_SPY_WIN : "#f97316"}
                  />
                  <MetricCard
                    label="ROUND-TRIPS 60D"
                    value={String(results.performance.rebuyWithin60d)}
                    subValue="rebuy after SELL ≤60d"
                    color={results.performance.rebuyWithin60d === 0 ? C_VS_SPY_WIN : "#f97316"}
                  />
                  <MetricCard
                    label="AVG HOLD (EXITS)"
                    value={results.performance.avgHoldingPeriodDays != null ? `${results.performance.avgHoldingPeriodDays} d` : "—"}
                    subValue="target 90+ days"
                    color="#888"
                  />
                </div>
              </div>
            )}

            {results.performance.aggressiveMetrics && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f0f0", marginBottom: 10, fontFamily: MONO, letterSpacing: 1 }}>
                  AGGRESSIVE / TURBO RISK METRICS
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <MetricCard label="BETA VS BENCHMARK" value={String(results.performance.aggressiveMetrics.betaVsBenchmark)} subValue="1.00 = market" color="#60a5fa" />
                  <MetricCard label="UP CAPTURE" value={results.performance.aggressiveMetrics.captureRatioUp + "%"} subValue="vs up months" color={parseFloat(results.performance.aggressiveMetrics.captureRatioUp) >= 100 ? C_VS_SPY_WIN : C_VS_SPY_LOSE} />
                  <MetricCard label="DOWN CAPTURE" value={results.performance.aggressiveMetrics.captureRatioDown + "%"} subValue="vs down months" color={parseFloat(results.performance.aggressiveMetrics.captureRatioDown) <= 100 ? C_VS_SPY_WIN : C_VS_SPY_LOSE} />
                  <MetricCard label="TURNOVER" value={results.performance.aggressiveMetrics.turnoverPct + "%"} subValue="trades / (rebal × N)" color="#888" />
                  <MetricCard label="AVG HOLDING" value={results.performance.aggressiveMetrics.avgHoldingPeriod + " d"} subValue="exit trades" color="#888" />
                </div>
              </div>
            )}
          </Box>

          {compareSnaps.full_composite && compareSnaps.full_composite_aggressive
            && compareSnaps.full_composite.universe === compareSnaps.full_composite_aggressive.universe
            && compareSnaps.full_composite.period === compareSnaps.full_composite_aggressive.period && (
            <Box>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f0f0", marginBottom: 12, fontFamily: MONO, letterSpacing: 1 }}>
                STRATEGY COMPARISON (last conservative vs aggressive runs, same universe and period)
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: MONO, fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", color: "#888" }}>
                      <th style={{ textAlign: "left", padding: "8px 6px" }}>Metric</th>
                      <th style={{ textAlign: "right", padding: "8px 6px" }}>Conservative</th>
                      <th style={{ textAlign: "right", padding: "8px 6px" }}>Aggressive</th>
                      <th style={{ textAlign: "right", padding: "8px 6px" }}>Benchmark</th>
                    </tr>
                  </thead>
                  <tbody style={{ color: "#f0f0f0" }}>
                    {[
                      ["Total return %", "totalReturn", "totalReturn", "benchmarkReturn"],
                      ["Annualized %", "annualizedReturn", "annualizedReturn", "benchmarkAnnualized"],
                      ["Alpha %", "alpha", "alpha", null],
                      ["Sharpe", "sharpe", "sharpe", "benchmarkSharpe"],
                      ["Max DD %", "maxDrawdown", "maxDrawdown", "benchmarkMaxDD"],
                      ["Win rate %", "winRate", "winRate", null],
                      ["Hit rate %", "hitRate", "hitRate", null]
                    ].map(([label, cKey, aKey, bKey]) => {
                      const c = compareSnaps.full_composite.performance;
                      const a = compareSnaps.full_composite_aggressive.performance;
                      const benchVal = bKey != null ? c[bKey] : null;
                      return (
                        <tr key={label} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          <td style={{ padding: "6px" }}>{label}</td>
                          <td style={{ textAlign: "right", padding: "6px", color: colorMetricVsBench(label, c[cKey], benchVal) }}>{c[cKey]}{cKey !== "sharpe" ? "%" : ""}</td>
                          <td style={{ textAlign: "right", padding: "6px", color: colorMetricVsBench(label, a[aKey], benchVal) }}>{a[aKey]}{aKey !== "sharpe" ? "%" : ""}</td>
                          <td style={{ textAlign: "right", padding: "6px", color: C_SUB_NEUTRAL }}>{bKey ? `${c[bKey]}${bKey !== "benchmarkSharpe" ? "%" : ""}` : "—"}</td>
                        </tr>
                      );
                    })}
                    {compareSnaps.full_composite_aggressive.performance.aggressiveMetrics && (
                      <>
                        <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          <td style={{ padding: "6px" }}>Beta</td>
                          <td style={{ textAlign: "right", padding: "6px" }}>—</td>
                          <td style={{ textAlign: "right", padding: "6px" }}>{compareSnaps.full_composite_aggressive.performance.aggressiveMetrics.betaVsBenchmark}</td>
                          <td style={{ textAlign: "right", padding: "6px" }}>1.00</td>
                        </tr>
                        <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          <td style={{ padding: "6px" }}>Up capture %</td>
                          <td style={{ textAlign: "right", padding: "6px" }}>—</td>
                          <td style={{ textAlign: "right", padding: "6px" }}>{compareSnaps.full_composite_aggressive.performance.aggressiveMetrics.captureRatioUp}</td>
                          <td style={{ textAlign: "right", padding: "6px" }}>100</td>
                        </tr>
                        <tr>
                          <td style={{ padding: "6px" }}>Down capture %</td>
                          <td style={{ textAlign: "right", padding: "6px" }}>—</td>
                          <td style={{ textAlign: "right", padding: "6px" }}>{compareSnaps.full_composite_aggressive.performance.aggressiveMetrics.captureRatioDown}</td>
                          <td style={{ textAlign: "right", padding: "6px" }}>100</td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </Box>
          )}
          
          {/* Risk Management Summary */}
          {results.riskManagement && (results.riskManagement.regimeSummary || results.riskManagement.totalStopsTriggered > 0) && (
            <Box>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f0f0", marginBottom: 12, fontFamily: MONO, letterSpacing: 1 }}>
                RISK MANAGEMENT
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {results.riskManagement.regimeSummary && (
                  <>
                    <MetricCard
                      label="AVG EXPOSURE"
                      value={(results.riskManagement.regimeSummary.avgExposure * 100).toFixed(0) + "%"}
                      subValue={results.riskManagement.regimeSummary.totalPeriods + " rebalances"}
                      color={results.riskManagement.regimeSummary.avgExposure >= 0.9 ? "#22c55e" : "#eab308"}
                    />
                    {Object.entries(results.riskManagement.regimeSummary.regimes).map(([regime, count]) => (
                      <MetricCard
                        key={regime}
                        label={regime.toUpperCase().replace('_', ' ')}
                        value={count + "x"}
                        color={regime === 'strong_bull' ? "#22c55e" : regime === 'bear' ? "#ef4444" : regime === 'normal' ? "#888" : "#eab308"}
                      />
                    ))}
                  </>
                )}
                <MetricCard
                  label="STOP-LOSSES"
                  value={results.riskManagement.totalStopsTriggered}
                  subValue={results.performance.totalStops > 0 ? "positions exited early" : "none triggered"}
                  color={results.riskManagement.totalStopsTriggered === 0 ? "#22c55e" : "#eab308"}
                />
              </div>
              {results.riskManagement.stopsDetail.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 11, fontFamily: MONO, color: "#888" }}>
                  Stops: {results.riskManagement.stopsDetail.map(s => `${s.ticker} ${s.return}`).join(', ')}
                </div>
              )}
            </Box>
          )}

          {isCompositeFamily(results.strategy) && (results.initialPillarWeights || results.finalPillarWeights) && (
            <Box>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f0f0", marginBottom: 8, fontFamily: MONO, letterSpacing: 1 }}>
                RANKING PILLAR WEIGHTS (SIMULATION)
              </div>
              <div style={{ fontSize: 10, color: "#888", fontFamily: MONO, marginBottom: 12, lineHeight: 1.5, maxWidth: 720 }}>
                {results.cached ? (
                  <span style={{ color: "#eab308" }}>Served from server cache. </span>
                ) : null}
                Baseline is the mix at the start of the backtest; effective is the mix after the last rebalance (rolling IC, regime blend, momentum cap). Headline returns and holdings use this path. Factor attribution below labels the first percentage as the effective mix.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
                <div style={{ flex: "1 1 240px" }}>
                  <div style={{ fontSize: 10, color: "#a8a8a8", fontWeight: 700, letterSpacing: 1, marginBottom: 8, fontFamily: MONO }}>BASELINE (START)</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 14px" }}>
                    {PILLAR_ORDER.map((key) => (
                      <div key={key} style={{ minWidth: 88 }}>
                        <div style={{ fontSize: 9, color: "#888", fontFamily: MONO }}>{PILLAR_LABELS[key]}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#f0f0f0", fontFamily: MONO }}>
                          {fmtWeightPct((results.initialPillarWeights || results.activeWeights)?.[key])}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ flex: "1 1 240px" }}>
                  <div style={{ fontSize: 10, color: "#a8a8a8", fontWeight: 700, letterSpacing: 1, marginBottom: 8, fontFamily: MONO }}>EFFECTIVE (LAST REBALANCE)</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 14px" }}>
                    {PILLAR_ORDER.map((key) => (
                      <div key={key} style={{ minWidth: 88 }}>
                        <div style={{ fontSize: 9, color: "#888", fontFamily: MONO }}>{PILLAR_LABELS[key]}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#60a5fa", fontFamily: MONO }}>
                          {fmtWeightPct((results.finalPillarWeights || results.activeWeights)?.[key])}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {Array.isArray(results.rebalances) && results.rebalances.some((r) => r.pillarWeights) && (
                <div style={{ marginTop: 14, fontSize: 10, color: "#888", fontFamily: MONO, lineHeight: 1.45 }}>
                  Each rebalance row in the event log includes <span style={{ color: "#a8a8a8" }}>pillarWeights</span> and{" "}
                  <span style={{ color: "#a8a8a8" }}>adaptiveMeta</span> (rolling IC step, SPY momentum regime tag when applicable).
                </div>
              )}
            </Box>
          )}

          {isCompositeFamily(results.strategy) && results.factorAttribution && (
            <Box>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f0f0", marginBottom: 12, fontFamily: MONO, letterSpacing: 1 }}>
                FACTOR ATTRIBUTION — {results.factorAttribution.periodsAnalyzed} PERIODS ANALYZED
              </div>
              
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginBottom: 14 }}>
                {results.factorAttribution.factors.map(f => {
                  const icColor = f.ic > 0.05 ? "#22c55e" : f.ic > 0 ? "#eab308" : "#ef4444";
                  const spreadColor = f.spread > 0 ? "#22c55e" : "#ef4444";
                  const weightDelta = f.suggestedWeight - f.originalWeight;
                  const deltaColor = weightDelta > 0.02 ? "#22c55e" : weightDelta < -0.02 ? "#ef4444" : "#888";
                  return (
                    <div key={f.name} style={{
                      background: "rgba(255,255,255,0.02)",
                      borderRadius: 8,
                      padding: "12px 14px",
                      borderLeft: "3px solid rgba(255,255,255,0.15)"
                    }}>
                      <div style={{ fontSize: 10, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 8, fontFamily: MONO }}>
                        {f.label.toUpperCase()}
                      </div>
                      
                      <div style={{ display: "flex", gap: 16, marginBottom: 8 }}>
                        <div>
                          <div style={{ fontSize: 10, color: "#f0f0f0", fontFamily: MONO }}>IC</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: icColor, fontFamily: MONO }}>
                            {f.ic >= 0 ? "+" : ""}{f.ic.toFixed(3)}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: "#f0f0f0", fontFamily: MONO }}>SPREAD</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: spreadColor, fontFamily: MONO }}>
                            {f.spread >= 0 ? "+" : ""}{f.spread.toFixed(1)}%
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: "#f0f0f0", fontFamily: MONO }}>$ CONTRIB</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: f.contribution >= 0 ? "#22c55e" : "#ef4444", fontFamily: MONO }}>
                            ${Math.abs(f.contribution) >= 1000 ? (f.contribution / 1000).toFixed(1) + "k" : f.contribution.toFixed(0)}
                          </div>
                        </div>
                      </div>
                      
                      <div style={{ fontSize: 9, color: "#666", fontFamily: MONO, marginBottom: 4 }}>EFFECTIVE MIX → IC BLEND</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: MONO }}>
                        <span style={{ color: "#f0f0f0" }}>{(f.originalWeight * 100).toFixed(0)}%</span>
                        <span style={{ color: deltaColor, fontWeight: 700 }}>
                          {weightDelta > 0.005 ? "\u2192" : weightDelta < -0.005 ? "\u2192" : "="} {(f.suggestedWeight * 100).toFixed(0)}%
                        </span>
                        {Math.abs(weightDelta) > 0.005 && (
                          <span style={{ color: deltaColor, fontSize: 10 }}>
                            ({weightDelta > 0 ? "+" : ""}{(weightDelta * 100).toFixed(0)})
                          </span>
                        )}
                      </div>
                      
                      <div style={{ height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2, marginTop: 8, overflow: "hidden" }}>
                        <div style={{
                          height: "100%",
                          width: `${Math.min(Math.max(f.ic * 500 + 50, 5), 100)}%`,
                          background: "rgba(255,255,255,0.2)",
                          borderRadius: 2,
                          transition: "width 0.3s ease"
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              
              <div style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 6,
                padding: "10px 14px",
                fontSize: 12,
                color: "#f0f0f0",
                lineHeight: 1.6,
                fontFamily: SANS
              }}>
                {results.factorAttribution.insight}
                <span style={{ color: "#f0f0f0", fontSize: 11, display: "block", marginTop: 4 }}>
                  IC = rank correlation between factor score and realized return. Spread = avg return of top-half minus bottom-half stocks by factor. Based on {results.factorAttribution.avgStocksPerPeriod} eligible stocks per period.
                </span>
              </div>
            </Box>
          )}
          
          {/* Equity Curve */}
          <Box>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f0f0", marginBottom: 12, fontFamily: MONO, letterSpacing: 1 }}>
              EQUITY CURVE — $10,000 INVESTED
            </div>
            {results.inflationDetail ? (
              <div style={{ fontSize: 10, color: "#888", marginTop: -6, marginBottom: 10, fontFamily: MONO, lineHeight: 1.45, maxWidth: 720 }}>
                {results.inflationSource === "fred_cpiaucsl" && results.inflationPublisher ? (
                  <span style={{ color: "#a8a8a8" }}>{results.inflationPublisher} · {results.inflationSeriesId}. </span>
                ) : null}
                {results.inflationDetail}
              </div>
            ) : null}
            {(() => {
              const inflPct = results.inflationBaselineAnnualPct ?? 3;
              const usesFredCpi = results.inflationSource === "fred_cpiaucsl";
              const equitySegmented = buildSegmentedEquityChartData(
                results.equityCurve,
                results.initialCapital,
                inflPct
              );
              const showCash =
                Number.isFinite(Number(results.initialCapital)) &&
                Number(results.initialCapital) > 0 &&
                equitySegmented.some((d) => d.cashInflationAdjusted != null);
              const cashLabel = usesFredCpi
                ? "Cash baseline (U.S. CPI — FRED CPIAUCSL)"
                : `Cash baseline (~${inflPct}%/yr fallback)`;
              return (
                <>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={equitySegmented}>
                  <defs>
                    <linearGradient id="portfolioGradientSegGreen" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C_VS_SPY_WIN} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={C_VS_SPY_WIN} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="portfolioGradientSegRed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C_VS_SPY_LOSE} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={C_VS_SPY_LOSE} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis 
                    dataKey="date" 
                    tick={{ fill: "#f0f0f0", fontSize: 10, fontFamily: MONO }}
                    tickFormatter={(v) => {
                      const d = new Date(v + "T00:00:00");
                      const m = d.toLocaleString("en-US", { month: "short" });
                      return `${m} '${String(d.getFullYear()).slice(2)}`;
                    }}
                    minTickGap={60}
                  />
                  <YAxis 
                    tick={{ fill: "#f0f0f0", fontSize: 10, fontFamily: MONO }}
                    tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`}
                    domain={['dataMin - 1000', 'dataMax + 1000']}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="portfolioGreen"
                    stroke={C_VS_SPY_WIN}
                    fill="url(#portfolioGradientSegGreen)"
                    strokeWidth={2}
                    name={strategyAboveLabel}
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="portfolioRed"
                    stroke={C_VS_SPY_LOSE}
                    fill="url(#portfolioGradientSegRed)"
                    strokeWidth={2}
                    name={strategyBelowLabel}
                    isAnimationActive={false}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="benchmark" 
                    stroke={C_SPY_LINE} 
                    strokeWidth={1.5}
                    dot={false}
                    name={benchLineName}
                  />
                  {showCash ? (
                    <Line
                      type="monotone"
                      dataKey="cashInflationAdjusted"
                      stroke={C_CASH_LINE}
                      strokeWidth={1.5}
                      strokeDasharray="5 4"
                      dot={false}
                      name={cashLabel}
                      isAnimationActive={false}
                    />
                  ) : null}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 16, height: 3, background: C_VS_SPY_WIN, borderRadius: 2 }} />
                <span style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO }}>{strategyAboveLabel}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 16, height: 3, background: C_VS_SPY_LOSE, borderRadius: 2 }} />
                <span style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO }}>{strategyBelowLabel}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 16, height: 2, background: C_SPY_LINE, borderRadius: 1 }} />
                <span style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO }}>{benchLineName}</span>
              </div>
              {showCash ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div
                    style={{
                      width: 16,
                      height: 0,
                      borderTop: `2px dashed ${C_CASH_LINE}`,
                      borderRadius: 1
                    }}
                  />
                  <span style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO }}>
                    {usesFredCpi
                      ? "Cash baseline (CPI from FRED — same purchasing power)"
                      : `Cash baseline (~${inflPct}%/yr — same purchasing power)`}
                  </span>
                </div>
              ) : null}
            </div>
                </>
              );
            })()}
            {results.monthlyEventsSummary && results.monthlyEventsSummary.length > 0 && (
              <div style={{
                marginTop: 14,
                padding: "10px 12px",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 8,
                fontFamily: MONO,
                fontSize: 10
              }}>
                <div style={{ fontWeight: 700, letterSpacing: 1, color: "#f0f0f0", marginBottom: 8 }}>
                  MONTHLY EVENTS — rebalances vs stop exits
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", color: "#c8c8c8", lineHeight: 1.5 }}>
                  {results.monthlyEventsSummary.map((row) => (
                    <span key={row.month}>
                      <strong style={{ color: "#f0f0f0" }}>{row.month}</strong>
                      {": "}
                      {row.rebalances} rebalance{row.rebalances !== 1 ? "s" : ""}
                      {row.stops > 0 ? (
                        <span style={{ color: "#f97316" }}>{`, ${row.stops} STOP${row.stops !== 1 ? "s" : ""}`}</span>
                      ) : null}
                    </span>
                  ))}
                </div>
                <div style={{ marginTop: 8, color: "#888", fontSize: 9, lineHeight: 1.5 }}>
                  Sharp single-day steps on the curve often line up with <strong style={{ color: "#f0f0f0" }}>STOP</strong> rows in the trade log (especially composite aggressive/turbo), not only rebalance days. Expand the trade log and filter by type to verify.
                </div>
              </div>
            )}
          </Box>

          {Array.isArray(results.rlLog) && results.rlLog.length > 0 && (
            <Box>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f0f0", marginBottom: 12, fontFamily: MONO, letterSpacing: 1 }}>
                RL DECISIONS (rebalance dates)
              </div>
              <div style={{ overflowX: "auto", maxHeight: "min(50vh, 420px)", overflowY: "auto", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: MONO }}>
                  <thead>
                    <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Date</th>
                      <th style={{ textAlign: "right", padding: "8px 10px" }}>Exposure</th>
                      <th style={{ textAlign: "right", padding: "8px 10px" }}>Positions</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Sizing</th>
                      <th style={{ textAlign: "right", padding: "8px 10px" }}>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.rlLog.map((r) => (
                      <tr key={r.date} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                        <td style={{ padding: "6px 10px", color: "#e5e5e5" }}>{r.date}</td>
                        <td style={{ padding: "6px 10px", textAlign: "right", color: "#e5e5e5" }}>
                          {typeof r.exposure === "number" ? `${(r.exposure * 100).toFixed(0)}%` : "—"}
                        </td>
                        <td style={{ padding: "6px 10px", textAlign: "right", color: "#e5e5e5" }}>{r.positionCount ?? "—"}</td>
                        <td style={{ padding: "6px 10px", color: "#c4c4c4" }}>{r.sizingMethod ?? "—"}</td>
                        <td style={{ padding: "6px 10px", textAlign: "right", color: "#888" }}>{r.stateIdx ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Box>
          )}
          
          {/* Monthly Returns Heatmap */}
          <Box>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f0f0", marginBottom: 12, fontFamily: MONO, letterSpacing: 1 }}>
              MONTHLY RETURNS
            </div>
            <div style={{ overflowX: "auto" }}>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", minWidth: 600 }}>
                {results.monthlyReturns.map((m, i) => {
                  const portNum = parseFloat(m.portfolio);
                  const benchNum = parseFloat(m.benchmark);
                  const beatsSP = portNum >= benchNum;
                  const color = beatsSP ? C_VS_SPY_WIN : C_VS_SPY_LOSE;
                  const spread = portNum - benchNum;
                  const intensity = Math.min(Math.max(Math.abs(spread) / 8, 0.15), 1);
                  const bg = beatsSP
                    ? `rgba(34,197,94,${intensity * 0.32})`
                    : `rgba(239,68,68,${intensity * 0.32})`;
                  return (
                    <div
                      key={i}
                      style={{
                        width: 60,
                        padding: "6px 4px",
                        borderRadius: 4,
                        background: bg,
                        border: `1px solid ${color}40`,
                        textAlign: "center",
                        cursor: "default"
                      }}
                      title={`${m.month}: Strat ${portNum.toFixed(1)}% vs ${benchTag} ${benchNum.toFixed(1)}% (${beatsSP ? "beat" : "trailed"})`}
                    >
                      <div style={{ fontSize: 10, color: "#f0f0f0", fontFamily: MONO }}>{m.month.substring(5)}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color, fontFamily: MONO }}>
                        {portNum >= 0 ? "+" : ""}{portNum.toFixed(1)}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Box>
          
          {/* Trade Log */}
          <Box>
            <div 
              onClick={() => setShowTrades(!showTrades)}
              style={{ 
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: showTrades ? 12 : 0
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f0f0", fontFamily: MONO, letterSpacing: 1 }}>
                TRADE LOG — {results.trades.length} TRADES{results.performance.totalStops > 0 ? ` (${results.performance.totalStops} stops)` : ''}
              </div>
              <span style={{ color: "#f0f0f0", fontSize: 12 }}>{showTrades ? "▲" : "▼"}</span>
            </div>
            
            {showTrades && (
              <div
                style={{
                  overflowX: "auto",
                  maxHeight: "min(70vh, 640px)",
                  overflowY: "auto",
                  borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: MONO }}>
                  <thead>
                    <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                      <th style={{ ...TRADE_LOG_TH_STICKY, textAlign: "left" }}>Date</th>
                      <th style={{ ...TRADE_LOG_TH_STICKY, textAlign: "left" }}>Action</th>
                      <th style={{ ...TRADE_LOG_TH_STICKY, textAlign: "left" }}>Ticker</th>
                      <th style={{ ...TRADE_LOG_TH_STICKY, textAlign: "right" }}>Shares</th>
                      <th style={{ ...TRADE_LOG_TH_STICKY, textAlign: "right" }}>Price</th>
                      <th style={{ ...TRADE_LOG_TH_STICKY, textAlign: "right" }}>Value</th>
                      <th style={{ ...TRADE_LOG_TH_STICKY, textAlign: "right" }}>Return</th>
                      <th style={{ ...TRADE_LOG_TH_STICKY, textAlign: "right" }}>Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.trades.map((t, i) => (
                      <tr key={`${t.date}-${t.type}-${t.ticker}-${i}`} style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
                        <td style={{ padding: "8px 10px", color: "#f0f0f0" }}>{t.date}</td>
                        <td style={{ 
                          padding: "8px 10px", 
                          color: t.type === "BUY" ? "#60a5fa" : t.type === "STOP" ? "#f97316" : t.type === "REENTRY" ? "#a78bfa" : t.holdingReturn > 0 ? "#22c55e" : "#ef4444",
                          fontWeight: 700
                        }}>
                          {t.type}
                        </td>
                        <td style={{ padding: "8px 10px", color: "#f0f0f0", fontWeight: 600 }}>{t.ticker}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#f0f0f0" }}>{t.shares}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#f0f0f0" }}>${t.price?.toFixed(2)}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#f0f0f0" }}>
                          ${(t.cost || t.proceeds)?.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                        <td style={{ 
                          padding: "8px 10px", 
                          textAlign: "right",
                          color: t.holdingReturn > 0 ? "#22c55e" : t.holdingReturn < 0 ? "#ef4444" : "#888"
                        }}>
                          {t.holdingReturn != null ? `${(t.holdingReturn * 100).toFixed(1)}%` : "-"}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#f0f0f0" }}>
                          {t.holdingDays || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Box>
          
          {/* Disclaimer */}
          <Box style={{ background: "rgba(234,179,8,0.04)", borderColor: "rgba(234,179,8,0.15)" }}>
            <div style={{ fontSize: 11, color: "#eab308", fontWeight: 700, marginBottom: 8, fontFamily: MONO }}>
              DISCLAIMER
            </div>
            <div style={{ fontSize: 12, color: "#f0f0f0", lineHeight: 1.6, fontFamily: "sans-serif" }}>
              Past performance does not predict future results. This backtest uses historical data with adjusted prices 
              and simulated execution. Real trading involves slippage, commissions, taxes, and liquidity constraints 
              not modeled here. This is an educational tool for understanding strategy behavior, not a guarantee of 
              future returns.
            </div>
          </Box>
        </>
        </div>
      )}
      
      {!results && !loading && !error && (
        <Box style={{ textAlign: "center", padding: "60px 20px" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>Backtest</div>
          <div style={{ fontSize: 13, color: "#f0f0f0", marginBottom: 8 }}>Run a walk-forward backtest to measure strategy performance</div>
          <div style={{ fontSize: 12, color: "#f0f0f0" }}>Configure settings above and click "Run Backtest" to begin</div>
        </Box>
      )}

      {isCompositeFamily(settings.strategy) && (
        <Box style={{ background: "rgba(234,179,8,0.04)", marginTop: 16, borderColor: "rgba(234,179,8,0.15)" }}>
          <div style={{ fontSize: 11, color: "#eab308", fontWeight: 700, marginBottom: 6, fontFamily: MONO }}>
            FUNDAMENTAL DATA ASSUMPTION
          </div>
          <div style={{ fontSize: 12, color: "#f0f0f0", lineHeight: 1.6, fontFamily: "sans-serif" }}>
            {settings.strategy === "full_composite_turbo" ? (
              <>
                Turbo is maximum risk: almost no quality floor, wide volatility allowance, and faster stop/regime reactions.
                Fundamentals are still loaded for scoring weights where used, but filters are largely disabled. Not suitable
                for capital you cannot afford to lose.
              </>
            ) : (
              <>
                The Full Composite strategy uses fundamental scores (Buffett Quality, Moat, ROIC, Earnings Quality, Shareholder Yield)
                that are point-in-time approximations. For this backtest, fundamental data is fetched once at the start and held
                stable throughout the simulation period to prevent look-ahead bias. This is a conservative assumption — in reality,
                fundamentals evolve and quality signals shift over time.
              </>
            )}
          </div>
        </Box>
      )}
    </div>
  );
}
