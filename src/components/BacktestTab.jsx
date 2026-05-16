import { useState, useEffect, useRef, useMemo } from "react";
import { Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ComposedChart } from "recharts";

import { MONO, SANS } from "../lib/theme.js";
import { apiFetch, apiUrl } from "../lib/api.js";
import { useAbortableApi, isAbortError } from "../hooks/useAbortableApi.js";
import { Box, Select, CongressSignalInline } from "./shared.jsx";
import { PILLAR_ORDER, PILLAR_LABELS, isCompositeStrategy, UNIVERSE_OPTIONS, STRATEGY_OPTIONS, TOP_N_OPTIONS, PERIOD_OPTIONS } from "../lib/constants.js";
import { fmtWeightPct } from "../lib/formatters.js";

/** Factor colors aligned with Dashboard / spec */
const BT_PILLAR_COLORS = {
  fundamental: "#3fb950",
  dcf: "#8b949e",
  valuation: "#d29922",
  momentum: "#58a6ff",
  value: "#f0883e"
};

const REGIME_SEG_COLORS = {
  strong_bull: "#3fb950",
  normal: "#58a6ff",
  pullback: "#d29922",
  caution: "#d29922",
  correction: "#f0883e",
  bear: "#f85149",
  disabled: "#484f58"
};

function useStatCountUp(targetNum, duration = 300, enabled = true) {
  const [v, setV] = useState(() => (enabled ? 0 : targetNum));
  useEffect(() => {
    if (!Number.isFinite(targetNum)) {
      setV(0);
      return;
    }
    if (!enabled) {
      setV(targetNum);
      return;
    }
    setV(0);
    const t0 = performance.now();
    let raf;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - (1 - p) * (1 - p);
      setV(targetNum * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setV(targetNum);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [targetNum, duration, enabled]);
  return v;
}

function StatHero({ label, displayStr, animatedStr, subLine, accent }) {
  return (
    <div className="ma-bt-stat" style={{ ["--bt-accent"]: accent }}>
      <div className="ma-bt-stat__label">{label}</div>
      <div className="ma-bt-stat__val ma-mono" style={{ color: accent }}>
        {animatedStr ?? displayStr}
      </div>
      {subLine ? <div className="ma-bt-stat__sub">{subLine}</div> : null}
    </div>
  );
}

function BtSkeletonGrid() {
  return (
    <div className="ma-bt-skel-grid" aria-hidden>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="ma-bt-skel-cell" />
      ))}
    </div>
  );
}

function RegimeStackedBar({ regimes, totalPeriods }) {
  const entries = Object.entries(regimes || {}).filter(([, c]) => c > 0);
  if (entries.length === 0) return null;
  const tot = totalPeriods || entries.reduce((s, [, c]) => s + c, 0) || 1;
  return (
    <div className="ma-bt-regime-bar">
      {entries.map(([name, count]) => (
        <div
          key={name}
          className="ma-bt-regime-seg"
          style={{
            width: `${(count / tot) * 100}%`,
            background: REGIME_SEG_COLORS[name] || "#6b7280"
          }}
          title={`${name.replace(/_/g, " ")}: ${count}`}
        >
          {count >= 2 ? `${count}` : ""}
        </div>
      ))}
    </div>
  );
}

function AdaptiveWeightBars({ baseline, effective }) {
  const row = (label, weights) => (
    <div className="ma-bt-weight-stack">
      <div className="ma-bt-weight-stack__label">{label}</div>
      <div className="ma-bt-weight-bar">
        {PILLAR_ORDER.map((key) => {
          const w = Math.max(0, Number(weights?.[key]) || 0);
          const pct = w * 100;
          if (pct < 0.05) return null;
          return (
            <div
              key={key}
              style={{
                width: `${pct}%`,
                minWidth: pct > 0 ? 2 : 0,
                height: "100%",
                background: BT_PILLAR_COLORS[key] || "#888",
                transition: "width 0.85s ease",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9,
                fontFamily: MONO,
                fontWeight: 700,
                color: "rgba(0,0,0,0.78)"
              }}
              title={`${PILLAR_LABELS[key]} ${pct.toFixed(1)}%`}
            >
              {pct >= 10 ? `${pct.toFixed(0)}%` : ""}
            </div>
          );
        })}
      </div>
    </div>
  );
  const shifts = PILLAR_ORDER.map((key) => {
    const b = Number(baseline?.[key]) || 0;
    const e = Number(effective?.[key]) || 0;
    return { key, delta: (e - b) * 100 };
  }).filter((x) => Math.abs(x.delta) > 0.1);
  return (
    <div>
      {row("Baseline (start)", baseline)}
      {row("Effective (last rebalance)", effective)}
      {shifts.length > 0 && (
        <div className="ma-bt-shift">
          {shifts.map(({ key, delta }) => (
            <span key={key}>
              {PILLAR_LABELS[key]}{" "}
              <span className={delta >= 0 ? "up" : "down"}>
                {delta >= 0 ? "↑" : "↓"} {delta >= 0 ? "+" : ""}
                {delta.toFixed(1)}pp
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function factorAttributionColor(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("momentum") && !n.includes("earnings")) return BT_PILLAR_COLORS.momentum;
  if (n.includes("value")) return BT_PILLAR_COLORS.value;
  if (n.includes("quality")) return BT_PILLAR_COLORS.fundamental;
  if (n.includes("earnings")) return "#bc8cff";
  if (n.includes("dcf")) return BT_PILLAR_COLORS.dcf;
  if (n.includes("valuation")) return BT_PILLAR_COLORS.valuation;
  return "#8b949e";
}

function fmtFactorUsd(c) {
  const n = Number(c);
  if (!Number.isFinite(n)) return "$0";
  const sign = n >= 0 ? "+" : "";
  const abs = Math.abs(n);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function monthLabel(ym) {
  if (!ym || ym.length < 7) return ym || "";
  const d = new Date(`${ym}-01T12:00:00`);
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}

function sizingPillClass(method) {
  const m = (method || "").toLowerCase();
  if (m.includes("score")) return "ma-bt-pill ma-bt-pill--score";
  if (m.includes("equal")) return "ma-bt-pill ma-bt-pill--equal";
  if (m.includes("inv") || m.includes("vol")) return "ma-bt-pill ma-bt-pill--invvol";
  return "ma-bt-pill ma-bt-pill--equal";
}

function regimeExitBadgeClass(reg) {
  const r = (reg || "").toLowerCase();
  if (!r) return "ma-bt-reg ma-bt-reg--norm";
  if (r.includes("bear")) return "ma-bt-reg ma-bt-reg--bear";
  if (r.includes("bull")) return "ma-bt-reg ma-bt-reg--bull";
  if (r.includes("pull") || r.includes("caution") || r.includes("correction")) return "ma-bt-reg ma-bt-reg--pull";
  return "ma-bt-reg ma-bt-reg--norm";
}

function tradeActionClass(type) {
  const t = (type || "").toUpperCase();
  if (t === "BUY" || t === "REENTRY") return "ma-bt-action ma-bt-action--buy";
  if (t === "STOP") return "ma-bt-action ma-bt-action--stop";
  return "ma-bt-action ma-bt-action--sell";
}

/** Legacy shim — some sections still pass label/value/subValue */
function MetricCard({ label, value, subValue, color }) {
  return (
    <StatHero
      label={label}
      displayStr={String(value)}
      animatedStr={String(value)}
      subLine={subValue ? `vs ${subValue}` : undefined}
      accent={color || C_SUB_NEUTRAL}
    />
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
    const sv = stratGreen?.value ?? stratRed?.value;
    if (sv != null && bench.value != null) {
      const alpha = Number(sv) - Number(bench.value);
      rows.push({
        key: "alpha",
        color: alpha >= 0 ? C_VS_SPY_WIN : C_VS_SPY_LOSE,
        text: `Alpha (nominal): ${alpha >= 0 ? "+" : ""}$${alpha.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      });
    }
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

/** Omit query keys when they match server defaults so the browser request matches a minimal curl. See GET /api/backtest in server.js. */
const SERVER_DEFAULT_INITIAL_CAPITAL = 10000;
const SERVER_DEFAULT_ADAPTIVE_MODE = "fixed";

function buildBacktestQuery(settings, rlAgentOn) {
  const params = new URLSearchParams({
    period: settings.period,
    rebalanceFreq: settings.rebalanceFreq,
    topN: settings.topN,
    strategy: settings.strategy,
    fresh: "true",
    _t: String(Date.now())
  });
  const strat = (settings.strategy || "").toLowerCase().trim();
  const comp =
    strat === "full_composite" || strat === "full_composite_aggressive" || strat === "full_composite_turbo";
  if (comp) {
    params.set("rlAgent", rlAgentOn ? "true" : "false");
  }
  if (settings.adaptiveMode && settings.adaptiveMode !== SERVER_DEFAULT_ADAPTIVE_MODE) {
    params.set("adaptiveMode", settings.adaptiveMode);
  }
  const defaultPositionSizing = comp ? "invVol" : "equal";
  if (settings.positionSizing && settings.positionSizing !== defaultPositionSizing) {
    params.set("positionSizing", settings.positionSizing);
  }
  const cap = parseFloat(String(settings.initialCapital ?? ""));
  if (Number.isFinite(cap) && cap !== SERVER_DEFAULT_INITIAL_CAPITAL) {
    params.set("initialCapital", String(settings.initialCapital));
  }
  return params;
}

async function fetchBacktestJson(settings, rlAgentOn, signal) {
  const params = buildBacktestQuery(settings, rlAgentOn);
  const relativeUrl = `/api/backtest/${settings.universe}?${params.toString()}`;
  const response = await apiFetch(relativeUrl, {
    signal,
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache"
    }
  });
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
  if (data.cached === true) {
    console.error(
      "[backtest] Unexpected cached response: UI sent fresh=true — restart the API (node server.js), check VITE_API_BASE, or verify the proxy is not stripping query params."
    );
  }
  return data;
}

/** Green = beating benchmark, red = trailing benchmark (for headline metrics). */
const C_VS_SPY_WIN = "var(--green)";
const C_VS_SPY_LOSE = "var(--red)";
const C_SPY_LINE = "#e6edf3";
const C_CASH_LINE = "var(--text-secondary)";

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
const C_SUB_NEUTRAL = "var(--text-secondary)";

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
  const [showRL, setShowRL] = useState(false);
  const [showStops, setShowStops] = useState(false);
  const [showFinalBook, setShowFinalBook] = useState(true);
  const [showFundamentalNote, setShowFundamentalNote] = useState(false);
  const [tradePage, setTradePage] = useState(0);
  const TRADES_PER_PAGE = 50;
  const [compareSnaps, setCompareSnaps] = useState({ full_composite: null, full_composite_aggressive: null });

  const [settings, setSettings] = useState({
    universe: "sp500_top50",
    period: "3y",
    rebalanceFreq: "quarterly",
    topN: "15",
    strategy: "full_composite_quality",
    initialCapital: "10000",
    adaptiveMode: "fixed",
    positionSizing: "invVol"
  });
  /** Composite strategies: must match GET query rlAgent (Advanced → RL AGENT). */
  const [rlAgentOn, setRlAgentOn] = useState(false);
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

  useEffect(() => {
    setTradePage(0);
  }, [results?.universe, results?.period, results?.strategy]);

  useEffect(() => {
    setShowRL(false);
  }, [results]);

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
    { id: "fixed", label: "Fixed (server defaults)" },
    { id: "adaptive", label: "Adaptive" },
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

    setResults(null);
    setLoading(true);
    setError(null);

    try {
      const params = buildBacktestQuery(settings, rlAgentOn);
      const relativeUrl = `/api/backtest/${settings.universe}?${params.toString()}`;
      console.log("[BACKTEST] Fetching:", apiUrl(relativeUrl));
      const data = await fetchBacktestJson(settings, rlAgentOn, signal);
      console.log("[BACKTEST] URL:", apiUrl(relativeUrl), "| Response return:", data.performance?.totalReturn);

      setResults(data);
      const stratOut = (data.strategy || "").toLowerCase().trim();
      if (stratOut === "full_composite" || stratOut === "full_composite_aggressive") {
        setCompareSnaps((prev) => ({
          ...prev,
          [stratOut]: {
            performance: data.performance,
            strategy: stratOut,
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
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 13.5rem), 1fr))",
    gap: "8px 12px",
    alignItems: "end",
    flex: "1 1 26rem",
    minWidth: 0,
    maxWidth: "100%"
  };

  const btAdvancedPopoverGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 11.5rem), 1fr))",
    gap: "8px 10px",
    alignItems: "end"
  };

  const perf = results?.performance;
  const animOn = !!(results && perf);
  const trA = useStatCountUp(parseFloat(perf?.totalReturn ?? 0) || 0, 300, animOn);
  const arA = useStatCountUp(parseFloat(perf?.annualizedReturn ?? 0) || 0, 300, animOn);
  const alA = useStatCountUp(parseFloat(perf?.alpha ?? 0) || 0, 300, animOn);
  const shA = useStatCountUp(parseFloat(perf?.sharpe ?? 0) || 0, 300, animOn);
  const ddA = useStatCountUp(parseFloat(perf?.maxDrawdown ?? 0) || 0, 300, animOn);
  const voA = useStatCountUp(parseFloat(perf?.annualizedVol ?? 0) || 0, 300, animOn);
  const wrA = useStatCountUp(parseFloat(perf?.winRate ?? 0) || 0, 300, animOn);
  const hrA = useStatCountUp(parseFloat(perf?.hitRate ?? 0) || 0, 300, animOn);

  const sortedTradesDesc = useMemo(() => {
    if (!results?.trades) return [];
    return [...results.trades].sort((a, b) => b.date.localeCompare(a.date));
  }, [results?.trades]);

  const heatmapByYear = useMemo(() => {
    if (!results?.monthlyReturns?.length) return [];
    const m = new Map();
    for (const row of results.monthlyReturns) {
      const y = row.month.slice(0, 4);
      if (!m.has(y)) m.set(y, []);
      m.get(y).push(row);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [results?.monthlyReturns]);

  const tradePageCount = Math.max(1, Math.ceil(sortedTradesDesc.length / TRADES_PER_PAGE));
  const tradesPageSlice = useMemo(() => {
    const start = tradePage * TRADES_PER_PAGE;
    return sortedTradesDesc.slice(start, start + TRADES_PER_PAGE);
  }, [sortedTradesDesc, tradePage]);

  const finalHoldingsSorted = useMemo(() => {
    const rows = results?.currentHoldings;
    if (!Array.isArray(rows) || rows.length === 0) return [];
    return [...rows].sort((a, b) => (Number(b.return) || 0) - (Number(a.return) || 0));
  }, [results?.currentHoldings]);

  useEffect(() => {
    setTradePage((p) => Math.min(p, Math.max(0, tradePageCount - 1)));
  }, [tradePageCount]);

  const fmtAnimPct = (n) => {
    const sign = n >= 0 ? "+" : "";
    return `${sign}${n.toFixed(1)}%`;
  };

  return (
    <div className="ma-bt-page">
      <div className="ma-bt-controls">
        <div className="ma-bt-controls__row">
          <div className="ma-bt-controls__filters" style={btFilterGridStyle}>
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
                className="ma-bt-btn-advanced"
                onClick={() => setAdvancedOpen((o) => !o)}
                aria-expanded={advancedOpen}
                aria-haspopup="dialog"
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
                    minWidth: "min(92vw, 22rem)",
                    maxWidth: "min(92vw, 38rem)",
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
              className="ma-bt-run"
              disabled={loading}
              onClick={onRunBacktestClick}
            >
              {loading ? (
                <>
                  <span className="ma-bt-run__spin" aria-hidden />
                  Running…
                </>
              ) : (
                "RUN BACKTEST"
              )}
            </button>
          </div>
        </div>
      </div>

      {loading && results && (
        <div
          className="ma-bt-card"
          style={{ textAlign: "center", padding: "12px 16px", marginBottom: 16, borderColor: "var(--border-card)" }}
        >
          <div style={{ color: "var(--text-secondary)", fontFamily: MONO, fontSize: 12 }}>Updating backtest…</div>
        </div>
      )}
      {loading && !results && (
        <div style={{ marginBottom: 24 }}>
          <BtSkeletonGrid />
          <div style={{ textAlign: "center", color: "var(--text-secondary)", fontFamily: MONO, fontSize: 13 }}>
            Fetching historical data and running simulation…
            {loadSec > 0 ? (
              <span
                style={{
                  display: "block",
                  marginTop: 10,
                  fontSize: 12,
                  maxWidth: 560,
                  marginLeft: "auto",
                  marginRight: "auto",
                  lineHeight: 1.5
                }}
              >
                {loadSec}s elapsed —{" "}
                {settings.universe === "sp500_top150"
                  ? "S&P Top 150 pulls ~150 price histories per cold run."
                  : "Large universes pull many Yahoo charts when cache is cold."}{" "}
                Full Composite + <strong>fresh=true</strong>
                {isCompositeFamily(settings.strategy) && rlAgentOn ? " + RL policy" : ""} often needs{" "}
                <strong>1–6 min</strong> (server allows up to ~5 min). Charts reuse disk cache after the first run, so
                repeats are faster. Still spinning past ~6 min? Check the API terminal for errors / rate limits.
              </span>
            ) : null}
          </div>
        </div>
      )}
      
      {error && (
        <Box style={{ background: "rgba(239,68,68,0.05)", borderColor: "rgba(239,68,68,0.2)" }}>
          <div style={{ color: "#ef4444", fontSize: 13 }}>Error: {error}</div>
        </Box>
      )}

      {results?.cached === true && (
        <Box style={{ background: "rgba(234,179,8,0.08)", borderColor: "rgba(234,179,8,0.35)", marginBottom: 16 }}>
          <div style={{ color: "var(--yellow)", fontSize: 13, lineHeight: 1.5 }}>
            <strong>Stale cache response.</strong> This run was served from server memory cache even though a fresh simulation was requested.
            Restart <span className="ma-mono">node server.js</span>, confirm no <span className="ma-mono">VITE_API_BASE</span> mismatch, and hard-refresh the app.
          </div>
        </Box>
      )}
      
      {results && (
        <div style={{ opacity: loading ? 0.72 : 1, transition: "opacity 0.2s ease" }}>
        <>
          {/* Performance Summary */}
          <div className="ma-bt-card">
            <div className="ma-bt-hero__head">
              <p className="ma-bt-hero__kicker">
                Performance · {results.period} ({results.performance.years} years) · {disp?.short ?? benchShort}
              </p>
              {results.computedAt ? (
                <p
                  className="ma-mono"
                  style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 4, marginBottom: 0 }}
                  title="Server-computed simulation finish time (ISO)"
                >
                  Computed at {new Date(results.computedAt).toLocaleString()}
                </p>
              ) : null}
            </div>
            {benchDescription ? (
              <div style={{ fontSize: 10, color: "#888", marginTop: -8, marginBottom: 12, fontFamily: MONO, lineHeight: 1.45 }}>
                Benchmark: {benchDescription}
              </div>
            ) : null}

            <div
              className={
                results.rlEvalGloballyEnabled === true && results.rlEnabled ? "ma-bt-badge ma-bt-badge--rl" : "ma-bt-badge ma-bt-badge--rules"
              }
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

            {results.dataQuality?.bars ? (
              <div
                className="ma-bt-data-quality"
                style={{
                  marginBottom: 12,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(88,166,255,0.25)",
                  background: "rgba(88,166,255,0.06)",
                  fontFamily: MONO,
                  fontSize: 11,
                  color: "#94a3b8",
                  lineHeight: 1.45
                }}
                title={JSON.stringify(results.dataQuality.bars.validation?.warnings?.slice(0, 8) || [], null, 0)}
              >
                <span style={{ color: "#58a6ff" }}>Data</span> · bars{" "}
                {(() => {
                  const src = results.dataQuality.bars.sources || {};
                  const bits = [];
                  if (src.gold > 0) bits.push(`${src.gold} gold`);
                  if (src.diskFresh > 0) bits.push(`${src.diskFresh} disk`);
                  if (src.yahoo > 0) bits.push(`${src.yahoo} live`);
                  if (src.stale > 0) bits.push(`${src.stale} stale`);
                  return bits.length ? bits.join(" · ") : "—";
                })()}
                {results.dataQuality.bars.benchmarkStaleWarning ? (
                  <span style={{ color: "#d29922", marginLeft: 8 }}>· bench: {results.dataQuality.bars.benchmarkStaleWarning}</span>
                ) : null}
                {results.dataQuality.bars.validation?.warnCount > 0 ? (
                  <span style={{ color: "#d29922", marginLeft: 8 }}>
                    · {results.dataQuality.bars.validation.warnCount} validation warnings
                  </span>
                ) : null}
                {results.dataQuality.bars.validation?.errorCount > 0 ? (
                  <span style={{ color: "#f85149", marginLeft: 8 }}>
                    · {results.dataQuality.bars.validation.errorCount} errors
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="ma-bt-stat-grid">
              <StatHero
                label="Return"
                displayStr={formatValue(results.performance.totalReturn)}
                animatedStr={fmtAnimPct(trA)}
                subLine={`vs ${formatValue(results.performance.benchmarkReturn)} ${benchTag}`}
                accent={
                  parseFloat(results.performance.totalReturn) >= parseFloat(results.performance.benchmarkReturn)
                    ? C_VS_SPY_WIN
                    : C_VS_SPY_LOSE
                }
              />
              <StatHero
                label="Annual"
                displayStr={formatValue(results.performance.annualizedReturn)}
                animatedStr={fmtAnimPct(arA)}
                subLine={`vs ${formatValue(results.performance.benchmarkAnnualized)} ${benchTag}`}
                accent={
                  parseFloat(results.performance.annualizedReturn) >= parseFloat(results.performance.benchmarkAnnualized)
                    ? C_VS_SPY_WIN
                    : C_VS_SPY_LOSE
                }
              />
              <StatHero
                label="Alpha"
                displayStr={formatValue(results.performance.alpha)}
                animatedStr={fmtAnimPct(alA)}
                subLine={`vs ${benchTag}`}
                accent={alphaVsBenchColor(results.performance.alpha)}
              />
              <StatHero
                label="Sharpe"
                displayStr={String(results.performance.sharpe)}
                animatedStr={shA.toFixed(2)}
                subLine={`vs ${results.performance.benchmarkSharpe} ${benchTag}`}
                accent={
                  parseFloat(results.performance.sharpe) >= parseFloat(results.performance.benchmarkSharpe)
                    ? C_VS_SPY_WIN
                    : C_VS_SPY_LOSE
                }
              />
            </div>
            <div className="ma-bt-stat-grid" style={{ marginTop: 12 }}>
              <StatHero
                label="Max DD"
                displayStr={`${results.performance.maxDrawdown}%`}
                animatedStr={`${ddA.toFixed(2)}%`}
                subLine={`vs ${results.performance.benchmarkMaxDD}% ${benchTag}`}
                accent={
                  parseFloat(results.performance.maxDrawdown) >= parseFloat(results.performance.benchmarkMaxDD)
                    ? C_VS_SPY_WIN
                    : C_VS_SPY_LOSE
                }
              />
              <StatHero
                label="Volatility"
                displayStr={`${results.performance.annualizedVol}%`}
                animatedStr={`${voA.toFixed(2)}%`}
                subLine={`vs ${results.performance.benchmarkVol}% ${benchTag}`}
                accent={
                  parseFloat(results.performance.annualizedVol) <= parseFloat(results.performance.benchmarkVol)
                    ? C_VS_SPY_WIN
                    : C_VS_SPY_LOSE
                }
              />
              <StatHero
                label="Win rate"
                displayStr={`${results.performance.winRate}%`}
                animatedStr={`${wrA.toFixed(1)}%`}
                subLine="months"
                accent={parseFloat(results.performance.winRate) >= 50 ? C_VS_SPY_WIN : C_VS_SPY_LOSE}
              />
              <StatHero
                label="Hit rate"
                displayStr={`${results.performance.hitRate}%`}
                animatedStr={`${hrA.toFixed(1)}%`}
                subLine={`vs ${benchTag} monthly`}
                accent={parseFloat(results.performance.hitRate) >= 50 ? C_VS_SPY_WIN : C_VS_SPY_LOSE}
              />
            </div>

            {results.performance.aggressiveMetrics && (
              <div style={{ marginTop: 20 }}>
                <div className="ma-bt-hero__kicker" style={{ marginBottom: 10 }}>
                  Aggressive / turbo
                </div>
                <div className="ma-bt-stat-grid">
                  <StatHero
                    label="Beta vs bench"
                    displayStr={String(results.performance.aggressiveMetrics.betaVsBenchmark)}
                    animatedStr={String(results.performance.aggressiveMetrics.betaVsBenchmark)}
                    subLine="1.00 = market"
                    accent="#60a5fa"
                  />
                  <StatHero
                    label="Up capture"
                    displayStr={`${results.performance.aggressiveMetrics.captureRatioUp}%`}
                    animatedStr={`${results.performance.aggressiveMetrics.captureRatioUp}%`}
                    subLine="vs up months"
                    accent={
                      parseFloat(results.performance.aggressiveMetrics.captureRatioUp) >= 100 ? C_VS_SPY_WIN : C_VS_SPY_LOSE
                    }
                  />
                  <StatHero
                    label="Down capture"
                    displayStr={`${results.performance.aggressiveMetrics.captureRatioDown}%`}
                    animatedStr={`${results.performance.aggressiveMetrics.captureRatioDown}%`}
                    subLine="vs down months"
                    accent={
                      parseFloat(results.performance.aggressiveMetrics.captureRatioDown) <= 100 ? C_VS_SPY_WIN : C_VS_SPY_LOSE
                    }
                  />
                  <StatHero
                    label="Turnover"
                    displayStr={`${results.performance.aggressiveMetrics.turnoverPct}%`}
                    animatedStr={`${results.performance.aggressiveMetrics.turnoverPct}%`}
                    subLine="trades / (rebal × N)"
                    accent="var(--text-secondary)"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="ma-bt-split">
            {results.performance.oneMonthSellCount != null && (
              <div className="ma-bt-card">
                <div className="ma-bt-hero__kicker" style={{ marginBottom: 10 }}>
                  Turnover / churn
                </div>
                <div className="ma-bt-stat-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                  <StatHero
                    label="1-mo sells"
                    displayStr={String(results.performance.oneMonthSellCount)}
                    animatedStr={String(results.performance.oneMonthSellCount)}
                    subLine={`avg ${results.performance.oneMonthSellAvgReturnPct}% (≤35d)`}
                    accent={
                      results.performance.oneMonthSellCount <= 3
                        ? C_VS_SPY_WIN
                        : results.performance.oneMonthSellCount <= 5
                          ? "var(--yellow)"
                          : C_VS_SPY_LOSE
                    }
                  />
                  <StatHero
                    label="Round-trips 60d"
                    displayStr={String(results.performance.rebuyWithin60d)}
                    animatedStr={String(results.performance.rebuyWithin60d)}
                    subLine="rebuy ≤60d"
                    accent={
                      results.performance.rebuyWithin60d === 0
                        ? C_VS_SPY_WIN
                        : results.performance.rebuyWithin60d <= 2
                          ? "var(--yellow)"
                          : C_VS_SPY_LOSE
                    }
                  />
                  <StatHero
                    label="Avg hold"
                    displayStr={
                      results.performance.avgHoldingPeriodDays != null
                        ? `${results.performance.avgHoldingPeriodDays} d`
                        : "—"
                    }
                    animatedStr={
                      results.performance.avgHoldingPeriodDays != null
                        ? `${results.performance.avgHoldingPeriodDays} d`
                        : "—"
                    }
                    subLine="target 90+ d"
                    accent={
                      results.performance.avgHoldingPeriodDays == null
                        ? "var(--text-secondary)"
                        : results.performance.avgHoldingPeriodDays >= 180
                          ? C_VS_SPY_WIN
                          : results.performance.avgHoldingPeriodDays >= 90
                            ? "var(--yellow)"
                            : C_VS_SPY_LOSE
                    }
                  />
                </div>
              </div>
            )}
            {results.riskManagement && (results.riskManagement.regimeSummary || results.riskManagement.totalStopsTriggered > 0) && (
              <div className="ma-bt-card">
                <div className="ma-bt-hero__kicker" style={{ marginBottom: 10 }}>
                  Risk management
                </div>
                {results.riskManagement.regimeSummary?.regimes ? (
                  <RegimeStackedBar
                    regimes={results.riskManagement.regimeSummary.regimes}
                    totalPeriods={results.riskManagement.regimeSummary.totalPeriods}
                  />
                ) : null}
                <div className="ma-bt-stat-grid" style={{ marginTop: 12 }}>
                  {results.riskManagement.regimeSummary ? (
                    <StatHero
                      label="Avg exposure"
                      displayStr={`${(results.riskManagement.regimeSummary.avgExposure * 100).toFixed(0)}%`}
                      animatedStr={`${(results.riskManagement.regimeSummary.avgExposure * 100).toFixed(0)}%`}
                      subLine={`${results.riskManagement.regimeSummary.totalPeriods} rebalances`}
                      accent={results.riskManagement.regimeSummary.avgExposure >= 0.9 ? C_VS_SPY_WIN : "var(--yellow)"}
                    />
                  ) : null}
                  <StatHero
                    label="Stop-losses"
                    displayStr={String(results.riskManagement.totalStopsTriggered)}
                    animatedStr={String(results.riskManagement.totalStopsTriggered)}
                    subLine={results.performance.totalStops > 0 ? "positions exited early" : "none triggered"}
                    accent={results.riskManagement.totalStopsTriggered === 0 ? C_VS_SPY_WIN : "var(--yellow)"}
                  />
                  <StatHero
                    label="Max DD"
                    displayStr={`${results.performance.maxDrawdown}%`}
                    animatedStr={`${results.performance.maxDrawdown}%`}
                    subLine="portfolio"
                    accent="var(--text-secondary)"
                  />
                </div>
                {results.riskManagement.stopsDetail?.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <button type="button" className="ma-bt-collapsible__hdr" onClick={() => setShowStops((s) => !s)}>
                      <span className="ma-mono" style={{ fontSize: 11 }}>
                        STOP EXITS · {results.riskManagement.stopsDetail.length} positions
                      </span>
                      <span>{showStops ? "▲" : "▼"}</span>
                    </button>
                    {showStops && (
                      <div className="ma-bt-table-wrap" style={{ marginTop: 8 }}>
                        <table className="ma-bt-table">
                    <thead>
                      <tr>
                        <th>Ticker</th>
                        <th>Congress</th>
                        <th>Exit date</th>
                        <th style={{ textAlign: "right" }}>Loss %</th>
                        <th style={{ textAlign: "right" }}>Days held</th>
                        <th>Regime at exit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.riskManagement.stopsDetail.map((s, si) => {
                            const cMap = results.congressByTicker?.[s.ticker];
                            return (
                              <tr key={si}>
                                <td className="ma-mono">{s.ticker}</td>
                                <td>
                                  <CongressSignalInline
                                    score={s.congressScore ?? cMap?.score}
                                    sentiment={s.congressSentiment ?? cMap?.sentiment}
                                    politicians={cMap?.politicians}
                                    netBuys={cMap?.netBuys}
                                  />
                                </td>
                                <td>{s.date}</td>
                                <td style={{ textAlign: "right", color: "var(--red)" }}>{s.return}</td>
                                <td style={{ textAlign: "right" }}>{s.daysHeld != null ? s.daysHeld : "—"}</td>
                                <td>
                                  {s.regimeAtExit ? (
                                    <span className={regimeExitBadgeClass(s.regimeAtExit)}>
                                      {String(s.regimeAtExit).replace(/_/g, " ")}
                                    </span>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {compareSnaps.full_composite && compareSnaps.full_composite_aggressive
            && compareSnaps.full_composite.universe === compareSnaps.full_composite_aggressive.universe
            && compareSnaps.full_composite.period === compareSnaps.full_composite_aggressive.period && (
            <Box>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f0f0", marginBottom: 12, fontFamily: MONO, letterSpacing: 1 }}>
                STRATEGY COMPARISON (last conservative vs aggressive runs, same universe and period)
              </div>
              <div className="ma-table-wrap">
                <table className="ma-table data-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "8px 6px" }}>Metric</th>
                      <th style={{ textAlign: "right", padding: "8px 6px" }}>Conservative</th>
                      <th style={{ textAlign: "right", padding: "8px 6px" }}>Aggressive</th>
                      <th style={{ textAlign: "right", padding: "8px 6px" }}>Benchmark</th>
                    </tr>
                  </thead>
                  <tbody>
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

          {isCompositeFamily(results.strategy) && (results.initialPillarWeights || results.finalPillarWeights) && (
            <div className="ma-bt-card">
              <div className="ma-bt-hero__kicker" style={{ marginBottom: 8 }}>
                Adaptive weights
              </div>
              <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: "0 0 14px", lineHeight: 1.5, maxWidth: 720 }}>
                Baseline at start vs effective after last rebalance (IC, regime blend).
              </p>
              <AdaptiveWeightBars
                baseline={results.initialPillarWeights || results.activeWeights}
                effective={results.finalPillarWeights || results.activeWeights}
              />
            </div>
          )}

          {isCompositeFamily(results.strategy) && results.factorAttribution && (
            <div className="ma-bt-card">
              <div className="ma-bt-hero__kicker" style={{ marginBottom: 12 }}>
                Factor attribution · {results.factorAttribution.periodsAnalyzed} periods
              </div>
              <div className="ma-bt-factor-attribution-stack">
                {(() => {
                  const facs = [...results.factorAttribution.factors].sort((a, b) => b.ic - a.ic);
                  const maxIc = facs.length ? Math.max(...facs.map((x) => x.ic)) : 0;
                  return facs.map((f) => {
                    const facCol = factorAttributionColor(f.name);
                    const icCol = f.ic >= 0 ? C_VS_SPY_WIN : C_VS_SPY_LOSE;
                    const cCol = f.contribution > 0 ? C_VS_SPY_WIN : f.contribution < 0 ? C_VS_SPY_LOSE : "var(--text-secondary)";
                    const tag =
                      f.suggestedWeight < 0.02
                        ? "Disabled"
                        : f.ic === maxIc
                          ? "Best IC"
                          : (f.suggestedWeight || 0) >= 0.35
                            ? "Largest weight"
                            : null;
                    return (
                      <div
                        key={f.name}
                        className="ma-bt-factor-row ma-bt-factor-row--grid"
                        style={{ ["--bt-fac"]: facCol }}
                      >
                        <div className="ma-bt-factor-row__col1">
                          <div className="ma-bt-factor-row__headline">
                            <span className="ma-bt-factor-dot" style={{ background: facCol }} />
                            {f.label}
                          </div>
                          <div className="ma-bt-factor-row__sub">
                            Spread {f.spread >= 0 ? "+" : ""}
                            {f.spread.toFixed(1)}% · Weight {(f.suggestedWeight * 100).toFixed(0)}%
                            {tag ? <span style={{ color: "var(--yellow)" }}> · {tag}</span> : null}
                          </div>
                        </div>
                        <div className="ma-bt-factor-row__col2" style={{ color: icCol }}>
                          IC {f.ic >= 0 ? "+" : ""}
                          {f.ic.toFixed(3)}
                        </div>
                        <div className="ma-bt-factor-row__col3" style={{ color: cCol }}>
                          {fmtFactorUsd(f.contribution)}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
              <div
                style={{
                  marginTop: 14,
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--border-card)",
                  fontSize: 12,
                  color: "var(--text-primary)",
                  lineHeight: 1.55
                }}
              >
                {results.factorAttribution.insight}
              </div>
            </div>
          )}
          
          {/* Equity Curve */}
          <div className="ma-bt-card">
            <div className="ma-bt-hero__kicker" style={{ marginBottom: 8 }}>
              EQUITY CURVE · ${Number(results.initialCapital || 10000).toLocaleString()} invested
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
                  <div className="ma-bt-equity-wrap">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={equitySegmented} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                        <XAxis
                          dataKey="date"
                          tick={{ fill: "var(--text-secondary)", fontSize: 10, fontFamily: MONO }}
                          tickFormatter={(v) => {
                            const d = new Date(`${v}T00:00:00`);
                            const m = d.toLocaleString("en-US", { month: "short" });
                            return `${m} '${String(d.getFullYear()).slice(2)}`;
                          }}
                          minTickGap={60}
                        />
                        <YAxis
                          tick={{ fill: "var(--text-secondary)", fontSize: 10, fontFamily: MONO }}
                          tickFormatter={(v) =>
                            `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                          }
                          domain={["dataMin - 1000", "dataMax + 1000"]}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Line
                          type="monotone"
                          dataKey="portfolioGreen"
                          stroke={C_VS_SPY_WIN}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                          name={strategyAboveLabel}
                          isAnimationActive
                          animationDuration={850}
                        />
                        <Line
                          type="monotone"
                          dataKey="portfolioRed"
                          stroke={C_VS_SPY_LOSE}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                          name={strategyBelowLabel}
                          isAnimationActive
                          animationDuration={850}
                        />
                        <Line
                          type="monotone"
                          dataKey="benchmark"
                          stroke={C_SPY_LINE}
                          strokeWidth={1.25}
                          strokeDasharray="5 5"
                          dot={false}
                          name={benchLineName}
                          isAnimationActive
                          animationDuration={850}
                        />
                        {showCash ? (
                          <Line
                            type="monotone"
                            dataKey="cashInflationAdjusted"
                            stroke={C_CASH_LINE}
                            strokeWidth={1}
                            strokeDasharray="2 5"
                            dot={false}
                            name={cashLabel}
                            isAnimationActive
                            animationDuration={850}
                          />
                        ) : null}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="ma-bt-legend">
                    <div className="ma-bt-legend__item">
                      <span className="ma-bt-legend__dot" style={{ background: C_VS_SPY_WIN }} />
                      {strategyAboveLabel}
                    </div>
                    <div className="ma-bt-legend__item">
                      <span className="ma-bt-legend__dot" style={{ background: C_VS_SPY_LOSE }} />
                      {strategyBelowLabel}
                    </div>
                    <div className="ma-bt-legend__item">
                      <span
                        className="ma-bt-legend__dot"
                        style={{
                          background: "transparent",
                          border: `2px dashed ${C_SPY_LINE}`,
                          width: 10,
                          height: 10
                        }}
                      />
                      {benchLineName}
                    </div>
                    {showCash ? (
                      <div className="ma-bt-legend__item">
                        <span
                          className="ma-bt-legend__dot"
                          style={{
                            background: "transparent",
                            border: `2px dotted ${C_CASH_LINE}`,
                            width: 10,
                            height: 10
                          }}
                        />
                        {usesFredCpi
                          ? "Cash baseline (CPI — same purchasing power)"
                          : `Cash baseline (~${inflPct}%/yr — same purchasing power)`}
                      </div>
                    ) : null}
                  </div>
                </>
              );
            })()}
            {results.monthlyEventsSummary && results.monthlyEventsSummary.length > 0 && (
              <div className="ma-bt-events-strip">
                <div style={{ fontWeight: 700, letterSpacing: 0.8, color: "var(--text-primary)", marginBottom: 8 }}>
                  Monthly events — rebalances vs stop exits
                </div>
                <div style={{ display: "inline-flex", flexWrap: "nowrap", gap: "10px 18px" }}>
                  {results.monthlyEventsSummary.map((row) => (
                    <span key={row.month}>
                      <strong>{row.month}</strong>
                      {": "}
                      <span className="ma-ev-muted">{row.rebalances} rebalance{row.rebalances !== 1 ? "s" : ""}</span>
                      {row.stops > 0 ? (
                        <span className="stop">{`, ${row.stops} STOP${row.stops !== 1 ? "s" : ""}`}</span>
                      ) : null}
                    </span>
                  ))}
                </div>
                <div style={{ marginTop: 8, color: "var(--text-secondary)", fontSize: 9, lineHeight: 1.5 }}>
                  Sharp single-day steps on the curve often line up with <strong style={{ color: "var(--text-primary)" }}>STOP</strong> rows in the trade log (especially composite aggressive/turbo), not only rebalance days.
                </div>
              </div>
            )}
          </div>

          <div className="ma-bt-card">
            <div className="ma-bt-hero__kicker" style={{ marginBottom: 10 }}>
              Monthly returns
            </div>
            <div style={{ overflowX: "auto" }}>
              {heatmapByYear.map(([year, months], yi) => (
                <div key={year} className="ma-bt-heat-row">
                  <div className="ma-bt-heat-year">{year}</div>
                  <div className="ma-bt-heatmap">
                    {months.map((m, mi) => {
                      const portNum = parseFloat(m.portfolio);
                      const benchNum = parseFloat(m.benchmark);
                      const mag = Math.min(Math.abs(portNum) / 12, 1);
                      const alpha = 0.14 + mag * 0.62;
                      const bg =
                        portNum >= 0
                          ? `rgba(46, 160, 67, ${alpha})`
                          : `rgba(248, 81, 73, ${alpha})`;
                      const fg = portNum >= 0 ? "var(--green)" : "var(--red)";
                      const stagger = (yi * 16 + mi) * 35;
                      const shortM = m.month.length >= 7 ? m.month.slice(5) : m.month;
                      return (
                        <div
                          key={m.month}
                          className="ma-bt-heat-cell"
                          style={{
                            background: bg,
                            ["--h-stagger"]: `${stagger}ms`,
                            border: `1px solid ${portNum >= 0 ? "rgba(63,185,80,0.35)" : "rgba(248,81,73,0.35)"}`
                          }}
                          title={`${monthLabel(m.month)}: ${portNum >= 0 ? "+" : ""}${portNum.toFixed(1)}% (portfolio) vs ${benchNum >= 0 ? "+" : ""}${benchNum.toFixed(1)}% (${benchTag})`}
                        >
                          <span style={{ color: "var(--text-secondary)", fontSize: 10 }}>{shortM}</span>
                          <span style={{ fontWeight: 700, color: fg }}>
                            {portNum >= 0 ? "+" : ""}
                            {portNum.toFixed(1)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {Array.isArray(results.rlLog) && results.rlLog.length > 0 && (
            <div className="ma-bt-card">
              <button type="button" className="ma-bt-collapsible__hdr" onClick={() => setShowRL((s) => !s)}>
                <span className="ma-mono" style={{ fontSize: 11 }}>
                  RL DECISIONS · {results.rlLog.length} rebalance dates
                </span>
                <span>{showRL ? "▲" : "▼"}</span>
              </button>
              {showRL && (
                <div className="ma-bt-table-wrap" style={{ marginTop: 10 }}>
                  <table className="ma-bt-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th style={{ textAlign: "right" }}>Exposure</th>
                        <th style={{ textAlign: "right" }}>Positions</th>
                        <th>Sizing</th>
                        <th style={{ textAlign: "right" }}>State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.rlLog.map((r) => {
                        const ex = typeof r.exposure === "number" ? r.exposure : null;
                        const exCol =
                          ex == null
                            ? "var(--text-secondary)"
                            : ex >= 1
                              ? "var(--green)"
                              : ex >= 0.5
                                ? "var(--yellow)"
                                : "var(--text-secondary)";
                        const hl = !!(r.explored || r.fallback || r.rebalanceWait === "skip");
                        const tip = `stateIdx=${r.stateIdx ?? "—"}${r.explored ? " · explored" : ""}${r.fallback ? " · fallback" : ""}${r.rebalanceWait != null ? ` · wait=${r.rebalanceWait}` : ""}`;
                        return (
                          <tr key={r.date} className={hl ? "ma-bt-row--hl" : undefined}>
                            <td>{r.date}</td>
                            <td style={{ textAlign: "right", color: exCol, fontWeight: 600 }}>
                              {ex != null ? `${(ex * 100).toFixed(0)}%` : "—"}
                            </td>
                            <td style={{ textAlign: "right" }}>{r.positionCount ?? "—"}</td>
                            <td>
                              {r.sizingMethod ? (
                                <span className={sizingPillClass(r.sizingMethod)}>{r.sizingMethod}</span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td style={{ textAlign: "right" }} title={tip}>
                              <span className="ma-mono" style={{ cursor: "default" }}>
                                {r.stateIdx ?? "—"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {finalHoldingsSorted.length > 0 && (
            <div className="ma-bt-card">
              <button
                type="button"
                className="ma-bt-collapsible__hdr"
                onClick={() => setShowFinalBook((s) => !s)}
                style={{ marginBottom: showFinalBook ? 12 : 0 }}
              >
                <span className="ma-mono" style={{ fontSize: 11 }}>
                  FINAL BOOK (end of simulation) · {finalHoldingsSorted.length} positions
                </span>
                <span>{showFinalBook ? "▲" : "▼"}</span>
              </button>
              {showFinalBook && (
                <>
                  {results.congressMeta?.note && (
                    <p
                      style={{
                        fontSize: 11,
                        color: "var(--text-secondary)",
                        lineHeight: 1.5,
                        margin: "0 0 10px 0",
                        maxWidth: 720
                      }}
                    >
                      STOCK Act: {results.congressMeta.note}
                    </p>
                  )}
                  <div className="ma-bt-table-wrap">
                    <table className="ma-bt-table">
                      <thead>
                        <tr>
                          <th>Ticker</th>
                          <th style={{ textAlign: "right" }}>Return</th>
                          <th style={{ textAlign: "right" }}>Entry</th>
                          <th style={{ textAlign: "right" }}>Last (sim)</th>
                          <th style={{ textAlign: "right" }}>Shares</th>
                          <th>Congress</th>
                        </tr>
                      </thead>
                      <tbody>
                        {finalHoldingsSorted.map((h) => (
                          <tr key={h.ticker}>
                            <td className="ma-mono" style={{ fontWeight: 600 }}>
                              {h.ticker}
                            </td>
                            <td
                              className="ma-mono"
                              style={{
                                textAlign: "right",
                                color:
                                  (h.return ?? 0) >= 0 ? "var(--green)" : "var(--red)"
                              }}
                            >
                              {h.return != null ? `${(h.return >= 0 ? "+" : "")}${Number(h.return).toFixed(1)}%` : "—"}
                            </td>
                            <td className="ma-mono" style={{ textAlign: "right" }}>
                              {h.entryPrice != null ? `$${Number(h.entryPrice).toFixed(2)}` : "—"}
                            </td>
                            <td className="ma-mono" style={{ textAlign: "right" }}>
                              {h.currentPrice != null ? `$${Number(h.currentPrice).toFixed(2)}` : "—"}
                            </td>
                            <td className="ma-mono" style={{ textAlign: "right" }}>
                              {h.shares != null ? h.shares : "—"}
                            </td>
                            <td>
                              <CongressSignalInline
                                score={h.congressScore}
                                sentiment={h.congressSentiment}
                                politicians={h.congressPoliticians}
                                netBuys={h.congressNetBuys}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
          
          <div className="ma-bt-card">
            <button
              type="button"
              className="ma-bt-collapsible__hdr"
              onClick={() => setShowTrades(!showTrades)}
              style={{ marginBottom: showTrades ? 12 : 0 }}
            >
              <span className="ma-mono" style={{ fontSize: 11 }}>
                TRADE LOG · {results.trades.length} trades
                {results.performance.totalStops > 0 ? (
                  <>
                    {" "}
                    · <span style={{ color: "var(--red)" }}>{results.performance.totalStops} stops</span>
                  </>
                ) : null}
              </span>
              <span>{showTrades ? "▲" : "▼"}</span>
            </button>
            {showTrades && (
              <>
                <div className="ma-bt-table-wrap">
                  <table className="ma-bt-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Ticker</th>
                        <th>Congress</th>
                        <th>Action</th>
                        <th style={{ textAlign: "right" }}>Price</th>
                        <th style={{ textAlign: "right" }}>Shares</th>
                        <th style={{ textAlign: "right" }}>Return</th>
                        <th>Regime</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tradesPageSlice.map((t, i) => {
                        const cTr = results.congressByTicker?.[t.ticker];
                        return (
                        <tr key={`${t.date}-${t.type}-${t.ticker}-${tradePage}-${i}`}>
                          <td>{t.date}</td>
                          <td className="ma-mono" style={{ fontWeight: 600 }}>
                            {t.ticker}
                          </td>
                          <td>
                            <CongressSignalInline
                              score={cTr?.score}
                              sentiment={cTr?.sentiment}
                              politicians={cTr?.politicians}
                              netBuys={cTr?.netBuys}
                            />
                          </td>
                          <td>
                            <span className={tradeActionClass(t.type)}>{t.type}</span>
                          </td>
                          <td style={{ textAlign: "right" }}>${t.price?.toFixed(2)}</td>
                          <td style={{ textAlign: "right" }}>{t.shares}</td>
                          <td
                            style={{
                              textAlign: "right",
                              color:
                                t.holdingReturn > 0
                                  ? "var(--green)"
                                  : t.holdingReturn < 0
                                    ? "var(--red)"
                                    : "var(--text-secondary)"
                            }}
                          >
                            {t.holdingReturn != null ? `${(t.holdingReturn * 100).toFixed(1)}%` : "—"}
                          </td>
                          <td style={{ color: "var(--text-secondary)" }}>{t.regime ?? "—"}</td>
                        </tr>
                      );
                      })}
                    </tbody>
                  </table>
                </div>
                {tradePageCount > 1 ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 12,
                      marginTop: 12,
                      fontFamily: MONO,
                      fontSize: 11,
                      color: "var(--text-secondary)"
                    }}
                  >
                    <button
                      type="button"
                      className="ma-bt-btn-advanced"
                      disabled={tradePage <= 0}
                      onClick={() => setTradePage((p) => Math.max(0, p - 1))}
                    >
                      Prev
                    </button>
                    <span>
                      Page {tradePage + 1} / {tradePageCount}
                    </span>
                    <button
                      type="button"
                      className="ma-bt-btn-advanced"
                      disabled={tradePage >= tradePageCount - 1}
                      onClick={() => setTradePage((p) => Math.min(tradePageCount - 1, p + 1))}
                    >
                      Next
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>

          {isCompositeFamily(results.strategy) && (
            <div className="ma-bt-card">
              <button
                type="button"
                className="ma-bt-collapsible__hdr"
                onClick={() => setShowFundamentalNote((s) => !s)}
              >
                <span className="ma-mono" style={{ fontSize: 11, color: "var(--yellow)" }}>
                  Fundamental data assumption
                </span>
                <span>{showFundamentalNote ? "▲" : "▼"}</span>
              </button>
              {showFundamentalNote && (
                <div style={{ fontSize: 12, color: "var(--text-primary)", lineHeight: 1.65, marginTop: 10 }}>
                  {results.strategy === "full_composite_turbo" ? (
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
              )}
            </div>
          )}
          
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
        <div className="ma-bt-empty">
          <div className="ma-bt-empty__title">BACKTEST ENGINE</div>
          <div className="ma-bt-empty__sub">Configure settings above and run a walk-forward simulation</div>
          <div className="ma-bt-empty__chips">
            <div className="ma-bt-empty__chip">Top 150 · 148 names</div>
            <div className="ma-bt-empty__chip">Adaptive weights</div>
            <div className="ma-bt-empty__chip">Q-learning ready</div>
          </div>
        </div>
      )}
    </div>
  );
}
