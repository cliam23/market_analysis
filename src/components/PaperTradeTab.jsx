import { useState, useEffect, useMemo, useRef } from "react";
import { useAbortableApi, isAbortError } from "../hooks/useAbortableApi.js";
import { useBackendMode } from "../hooks/useBackendMode.js";
import {
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ComposedChart
} from "recharts";

import { Box, Select, RUN_ACTION_BAR_STYLE } from "./shared.jsx";
import { apiFetch, safeJson } from "../lib/api.js";
import { PILLAR_ORDER, PILLAR_LABELS, isCompositeStrategy, UNIVERSE_OPTIONS, STRATEGY_OPTIONS, TOP_N_OPTIONS } from "../lib/constants.js";
import { fmtDate, fmtWeightPct, weightToPct } from "../lib/formatters.js";
import PaperRebalanceReportBody from "./PaperRebalanceReportBody.jsx";
import WheelTab from "./WheelTab.jsx";

const PAPER_TRADE_SESSION_KEY = "ma-paper-trade-session-v1";
const PAPER_TRADE_SUBTAB_KEY = "ma-paper-trade-subtab-v1";

/** Set by Dashboard when navigating to Trading with a universe. */
const PAPER_TRADE_NAV_UNIVERSE_KEY = "ma-paper-trade-nav-universe";

function readPaperTradeSessionCache() {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PAPER_TRADE_SESSION_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object") return null;
    return { portfolio: o.portfolio ?? null, history: o.history ?? null };
  } catch {
    return null;
  }
}

function writePaperTradeSessionCache(portfolio, history) {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (!portfolio) {
      sessionStorage.removeItem(PAPER_TRADE_SESSION_KEY);
      return;
    }
    sessionStorage.setItem(PAPER_TRADE_SESSION_KEY, JSON.stringify({ portfolio, history }));
  } catch {
    /* quota / private mode */
  }
}

function clearPaperTradeSessionCache() {
  try {
    sessionStorage.removeItem(PAPER_TRADE_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function readPaperTradeSubTab() {
  if (typeof sessionStorage === "undefined") return "portfolio";
  try {
    const v = sessionStorage.getItem(PAPER_TRADE_SUBTAB_KEY);
    return v === "wheel" ? "wheel" : "portfolio";
  } catch {
    return "portfolio";
  }
}

function writePaperTradeSubTab(tab) {
  try {
    sessionStorage.setItem(PAPER_TRADE_SUBTAB_KEY, tab);
  } catch {
    /* ignore */
  }
}

const PT_PILLAR_COLORS = {
  fundamental: "#3fb950",
  dcf: "#8b949e",
  valuation: "#d29922",
  momentum: "#58a6ff",
  value: "#f0883e"
};

function useCountUpDollars(target, duration = 750, resetKey) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!Number.isFinite(target)) {
      setV(0);
      return;
    }
    setV(0);
    const t0 = performance.now();
    let raf;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - (1 - p) * (1 - p);
      setV(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setV(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, resetKey]);
  return v;
}

function regimePillClassPt(regime) {
  const s = String(regime || "").toLowerCase();
  if (/bear|crash|panic|stress/.test(s)) return "ma-pt-regime-pill ma-pt-regime-pill--bear";
  if (/caution|pullback|correction/.test(s)) return "ma-pt-regime-pill ma-pt-regime-pill--caution";
  if (/strong_bull|bull/.test(s)) return "ma-pt-regime-pill ma-pt-regime-pill--bull";
  return "ma-pt-regime-pill ma-pt-regime-pill--norm";
}

function compositeTierColor(score) {
  if (score == null || Number.isNaN(Number(score))) return "var(--text-secondary)";
  const n = Number(score);
  if (n >= 90) return "#3fb950";
  if (n >= 80) return "var(--green)";
  if (n >= 70) return "var(--yellow)";
  return "var(--red)";
}

function PtToggle({ on, onChange, disabled, label, title }) {
  return (
    <div className="ma-pt-toggle-row">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        title={title}
        className={`ma-pt-toggle ${on ? "ma-pt-toggle--on" : ""}`}
        onClick={() => !disabled && onChange(!on)}
      />
    </div>
  );
}

function PaperSlotLoadingBanner({ show }) {
  if (!show) return null;
  return (
    <div className="ma-pt-slot-loading" role="status" aria-live="polite">
      <span className="ma-pt-spin" aria-hidden />
      <span className="ma-mono">Loading portfolio slot…</span>
    </div>
  );
}

function PaperTradeSubTabs({ active, disabled, onPick, lite }) {
  return (
    <div className="ma-pt-segmented ma-pt-subtabs" style={{ width: "100%", maxWidth: lite ? 160 : 320, marginTop: 12 }}>
      <button
        type="button"
        className={`ma-pt-seg ${active === "portfolio" ? "ma-pt-seg--active" : ""}`}
        disabled={disabled}
        onClick={() => onPick("portfolio")}
      >
        Portfolio
      </button>
      {!lite && (
        <button
          type="button"
          className={`ma-pt-seg ${active === "wheel" ? "ma-pt-seg--active" : ""}`}
          disabled={disabled}
          onClick={() => onPick("wheel")}
        >
          Wheel
        </button>
      )}
    </div>
  );
}

function PaperSlotSegmented({ activeId, disabled, onPick }) {
  return (
    <div className="ma-pt-segmented" style={{ width: "100%", maxWidth: 440 }}>
      {PAPER_DUAL_UNIVERSES.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`ma-pt-seg ${activeId === t.id ? "ma-pt-seg--active" : ""}`}
          disabled={disabled}
          onClick={() => onPick(t.id)}
        >
          {t.id === "sp500_top50" ? "Top 50" : "Top 150"}
        </button>
      ))}
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const labelStr =
    typeof label === "number"
      ? new Date(label).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : label;
  const isReal = payload[0]?.payload?.isReal !== false;
  return (
    <div
      className="ma-mono"
      style={{
        background: "var(--color-tooltip-bg)",
        border: "1px solid var(--color-tooltip-border)",
        borderRadius: 8,
        padding: 12,
        fontSize: 12,
        boxShadow: "none"
      }}
    >
      <div style={{ color: "var(--color-text-muted)", marginBottom: 6 }}>
        {labelStr}
        {!isReal && <span style={{ opacity: 0.7 }}> (estimated)</span>}
      </div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: ${p.value?.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
        </div>
      ))}
    </div>
  );
}

/**
 * navHistory only gains a point when the server actually ticks (a daily
 * job, or whenever a dev happens to have it running) — real gaps of days
 * or weeks exist between recorded snapshots. Recharts' hover snaps to the
 * nearest actual data point, so without this, hovering anywhere in a large
 * gap only ever shows one of its two endpoints. Filling in one linearly
 * interpolated point per day between real snapshots (flagged isReal:false)
 * makes hover work smoothly across the whole chart while keeping the
 * visual line identical — the interpolated points fall exactly on the
 * straight segment already being drawn between the two real points.
 */
function densifyChartData(sparse) {
  if (!sparse || sparse.length === 0) return [];
  const sorted = [...sparse].sort((a, b) => a.dateTs - b.dateTs);
  if (sorted.length < 2) return sorted.map((p) => ({ ...p, isReal: true }));
  const DAY_MS = 86400000;
  const out = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    out.push({ ...a, isReal: true });
    const days = Math.round((b.dateTs - a.dateTs) / DAY_MS);
    for (let d = 1; d < days; d++) {
      const t = d / days;
      out.push({
        date: new Date(a.dateTs + d * DAY_MS).toISOString().slice(0, 10),
        dateTs: a.dateTs + d * DAY_MS,
        Portfolio: a.Portfolio + (b.Portfolio - a.Portfolio) * t,
        "S&P 500": a["S&P 500"] + (b["S&P 500"] - a["S&P 500"]) * t,
        isReal: false
      });
    }
  }
  out.push({ ...sorted[sorted.length - 1], isReal: true });
  return out;
}

/**
 * Fixed calendar reference points (1st and 15th of every month spanned by
 * the data) instead of ticks at whatever days a NAV snapshot happened to
 * land on — sparse/irregular rebalance dates otherwise made the x-axis
 * timeline confusing to read at a glance.
 */
function monthlyTicks(minMs, maxMs) {
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs) || minMs > maxMs) return [];
  const ticks = [];
  const start = new Date(minMs);
  let y = start.getFullYear();
  let m = start.getMonth();
  for (let guard = 0; guard < 600; guard++) {
    const first = new Date(y, m, 1).getTime();
    if (first > maxMs) break;
    const fifteenth = new Date(y, m, 15).getTime();
    if (first >= minMs) ticks.push(first);
    if (fifteenth >= minMs && fifteenth <= maxMs) ticks.push(fifteenth);
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }
  return ticks;
}

/** Paper trade dual portfolios (server: paper-portfolio-top50.json / paper-portfolio-top150.json). */
const PAPER_DUAL_UNIVERSES = [
  { id: "sp500_top50", label: "S&P 500 Top 50" },
  { id: "sp500_top150", label: "S&P 500 Top 150" }
];

/** API puts metrics on `portfolio.summary`; older caches may omit it or use flat fields. */
function effectivePaperSummary(portfolio) {
  if (!portfolio) return null;
  const s = portfolio.summary || {};
  const leg = portfolio;
  const num = (a, b, def = 0) => {
    const x =
      a != null && Number.isFinite(Number(a))
        ? Number(a)
        : b != null && Number.isFinite(Number(b))
          ? Number(b)
          : null;
    return x != null ? x : def;
  };
  const numOrNull = (a, b) => {
    const x =
      a != null && Number.isFinite(Number(a))
        ? Number(a)
        : b != null && Number.isFinite(Number(b))
          ? Number(b)
          : null;
    return x;
  };
  const hc =
    s.holdingsCount != null && Number.isFinite(Number(s.holdingsCount))
      ? Number(s.holdingsCount)
      : Array.isArray(leg.holdings)
        ? leg.holdings.length
        : 0;
  return {
    ...s,
    totalValue: num(s.totalValue, leg.totalValue, 0),
    totalReturn: num(s.totalReturn, leg.totalReturn, 0),
    spyReturn: num(s.spyReturn, leg.spyReturn, 0),
    alpha: num(s.alpha, leg.alpha, 0),
    daysActive: Math.max(0, Math.floor(num(s.daysActive, leg.daysActive, 0))),
    holdingsCount: hc,
    upCapture: numOrNull(s.upCapture, leg.upCapture),
    downCapture: numOrNull(s.downCapture, leg.downCapture),
    currentRegime: s.currentRegime ?? leg.currentRegime ?? null,
    cashPct: s.cashPct != null ? num(s.cashPct, leg.cashPct, 0) : s.cashPct,
    weightSpread: s.weightSpread ?? leg.weightSpread ?? null,
    largestPosition: s.largestPosition ?? leg.largestPosition ?? null,
    smallestPosition: s.smallestPosition ?? leg.smallestPosition ?? null,
    adjustedTopN: s.adjustedTopN ?? leg.adjustedTopN ?? null,
    notionalRegimeExposure: s.notionalRegimeExposure ?? leg.notionalRegimeExposure ?? null,
    cashDragRough: s.cashDragRough ?? leg.cashDragRough ?? null
  };
}

/** Implied starting capital from live NAV and return % (replaces unreliable flat `initialCapital` on some payloads). */
function deriveInitialCapitalFromSummary(summary, config) {
  if (!summary) {
    const ic = config?.initialCapital;
    if (ic != null && Number.isFinite(Number(ic))) return Number(ic);
    return 100000;
  }
  const tv = summary.totalValue;
  const tr = summary.totalReturn;
  if (Number.isFinite(Number(tv)) && Number.isFinite(Number(tr))) {
    const denom = 1 + Number(tr) / 100;
    if (Math.abs(denom) > 1e-12) return Number(tv) / denom;
  }
  const ic = config?.initialCapital;
  if (ic != null && Number.isFinite(Number(ic))) return Number(ic);
  return 100000;
}

function paperRlConfigOn(config) {
  return config.rlAgent !== false && config.rlAgent !== "false" && config.rlAgent !== "0" && config.rlAgent !== 0;
}

function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-overlay)"
      }}
    >
      <div
        className="ma-card"
        style={{ maxWidth: 380, textAlign: "center", marginBottom: 0 }}
      >
        <div
          style={{
            fontSize: 14,
            color: "var(--color-text-primary)",
            fontWeight: 600,
            marginBottom: 20,
            lineHeight: 1.6
          }}
        >
          {message}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button type="button" className="ma-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="ma-btn-danger-outline" onClick={onConfirm}>
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PaperTradeTab({ visible = false, onOpenTicker }) {
  const backendMode = useBackendMode();
  const lite = backendMode === "lite";
  const sessionSnapshot = useMemo(() => readPaperTradeSessionCache(), []);
  const [paperUniverseView, setPaperUniverseView] = useState(() => {
    const u = sessionSnapshot?.portfolio?.config?.universeId ?? sessionSnapshot?.portfolio?.config?.universe;
    return u === "sp500_top50" || u === "sp500_top150" ? u : "sp500_top150";
  });
  const [portfolio, setPortfolio] = useState(() => sessionSnapshot?.portfolio ?? null);
  const [history, setHistory] = useState(() => sessionSnapshot?.history ?? null);
  const [loading, setLoading] = useState(() => !(sessionSnapshot?.portfolio));
  const [rebalancing, setRebalancing] = useState(false);
  const [error, setError] = useState(null);
  const [expandedRebalanceKey, setExpandedRebalanceKey] = useState(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const [initForm, setInitForm] = useState({
    initialCapital: "100000",
    strategy: "full_composite",
    universe: "sp500_top150",
    topN: "15",
    rlAgent: false,
    rlOnlineLearning: false
  });
  const [paperConfigSaving, setPaperConfigSaving] = useState(false);
  /** True while a fetch keyed by an explicit universe (slot picker / nav) is in flight. */
  const [paperSlotFetchPending, setPaperSlotFetchPending] = useState(false);

  const [autoRebalanced, setAutoRebalanced] = useState(false);
  const [loadBtnHover, setLoadBtnHover] = useState(false);
  const [toast, setToast] = useState(null);
  const [showWeightHistory, setShowWeightHistory] = useState(false);
  const [showPositionDetails, setShowPositionDetails] = useState(false);
  const [holdingsSort, setHoldingsSort] = useState("weight");
  const [paperSubTab, setPaperSubTab] = useState(readPaperTradeSubTab);
  const [autoOptimizing, setAutoOptimizing] = useState(false);
  const [autoOptResult, setAutoOptResult] = useState(null);
  const paperApi = useAbortableApi();
  /** Monotonic id so an older in-flight paper fetch cannot apply after a newer one. */
  const paperFetchGenRef = useRef(0);
  /** Skip one "tab became visible" refresh when Trading is the initial tab (bootstrap already loads). */
  const skipVisibleRefreshOnce = useRef(visible);

  // Load (or revalidate) as soon as the app mounts so data is ready before the user opens Trading.
  useEffect(() => {
    fetchPortfolio(!sessionSnapshot?.portfolio);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- session snapshot is stable for the tab lifetime
  }, []);

  // When switching to Trading, refresh quietly; honor Dashboard navigation intent first.
  useEffect(() => {
    if (!visible) return;
    try {
      const u = sessionStorage.getItem(PAPER_TRADE_NAV_UNIVERSE_KEY);
      if (u === "sp500_top50" || u === "sp500_top150") {
        sessionStorage.removeItem(PAPER_TRADE_NAV_UNIVERSE_KEY);
        setPaperUniverseView(u);
        fetchPortfolio(true, u);
        return;
      }
    } catch {
      /* ignore */
    }
    if (skipVisibleRefreshOnce.current) {
      skipVisibleRefreshOnce.current = false;
      return;
    }
    fetchPortfolio(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to tab visibility
  }, [visible]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    writePaperTradeSubTab(paperSubTab);
  }, [paperSubTab]);

  // Wheel sub-tab isn't mirrored on the read-only deploy (needs live options
  // chains + mutable paper-trade state) — its toggle is hidden entirely in
  // lite mode, so steer away from a stale "wheel" choice restored from
  // sessionStorage instead of stranding the user on a hidden panel.
  useEffect(() => {
    if (lite && paperSubTab === "wheel") setPaperSubTab("portfolio");
  }, [lite, paperSubTab]);

  const runAutoOptimize = async () => {
    setAutoOptimizing(true);
    setAutoOptResult(null);
    try {
      const res = await apiFetch("/api/paper-trade/auto-optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ universe: paperUniverseView })
      });
      const data = await safeJson(res);
      setAutoOptResult(data);
      if (Object.values(data.results || {}).some((r) => r.rebalanced)) {
        await fetchPortfolio(true, paperUniverseView);
      }
    } catch (e) {
      setAutoOptResult({ error: e.message });
    } finally {
      setAutoOptimizing(false);
    }
  };

  useEffect(() => {
    if (lite || !portfolio || autoRebalanced || rebalancing) return;
    const { lastRebalance, holdings, nextRebalance } = portfolio;
    if (holdings.length === 0 && portfolio.rebalanceCount === 0) return;
    if (!lastRebalance || !nextRebalance) return;
    const todayStr = new Date().toISOString().split("T")[0];
    if (todayStr >= nextRebalance) {
      setAutoRebalanced(true);
      rebalance();
    }
  }, [portfolio, lite]);

  const paperUniverseQs = `?universe=${encodeURIComponent(paperUniverseView)}`;

  const summary = useMemo(() => effectivePaperSummary(portfolio), [portfolio]);
  const derivedInitialCapital = useMemo(
    () => deriveInitialCapitalFromSummary(summary, portfolio?.config),
    [summary, portfolio?.config]
  );

  /** Tie count-up resets to loaded portfolio slot, not the tab selection (avoids 0→flash while a slot fetch is in flight). */
  const loadedSlotIdForAnim = portfolio?.config?.universeId ?? portfolio?.config?.universe;
  const animNavKey = portfolio
    ? `${loadedSlotIdForAnim ?? "na"}-${portfolio.createdAt}-${portfolio.rebalanceCount ?? 0}-${summary?.totalValue ?? 0}`
    : "idle";
  const animatedNavTotal = useCountUpDollars(summary?.totalValue ?? 0, 750, animNavKey);

  const sortedHoldings = useMemo(() => {
    const h = portfolio?.holdings;
    if (!h?.length) return [];
    const copy = [...h];
    if (holdingsSort === "pnl") copy.sort((a, b) => (b.pnlPct ?? 0) - (a.pnlPct ?? 0));
    else if (holdingsSort === "score") copy.sort((a, b) => (b.scores?.composite ?? 0) - (a.scores?.composite ?? 0));
    else copy.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
    return copy;
  }, [portfolio?.holdings, holdingsSort]);

  const holdingsTierSets = useMemo(() => {
    const h = portfolio?.holdings;
    if (!h?.length) return { top: new Set(), bottom: new Set() };
    const byPnL = [...h].sort((a, b) => (b.pnlPct ?? 0) - (a.pnlPct ?? 0));
    return {
      top: new Set(byPnL.slice(0, 3).map((x) => x.ticker)),
      bottom: new Set(byPnL.slice(-3).map((x) => x.ticker))
    };
  }, [portfolio?.holdings]);

  const fetchPortfolio = async (showLoader = true, universeOverride = null) => {
    const thisFetchGen = ++paperFetchGenRef.current;
    const ac = paperApi.beginRequest();
    const uid = universeOverride ?? paperUniverseView;
    const qs = `?universe=${encodeURIComponent(uid)}`;
    const slotKeyedFetch = universeOverride != null;
    if (slotKeyedFetch) setPaperSlotFetchPending(true);
    // Full-page skeleton only when nothing is on screen; slot switches keep prior data until swap.
    const useFullPageLoader = Boolean(showLoader && !portfolio);
    if (useFullPageLoader) setLoading(true);
    setError(null);
    try {
      const [pRes, hRes] = await Promise.all([
        apiFetch(`/api/paper-trade/portfolio${qs}`, { signal: ac.signal }),
        apiFetch(`/api/paper-trade/history${qs}`, { signal: ac.signal })
      ]);
      const pData = await safeJson(pRes);
      const hData = await safeJson(hRes);
      if (thisFetchGen !== paperFetchGenRef.current) return;
      setPortfolio(pData.portfolio);
      setHistory(hData.history);
      const cfgU = pData.portfolio?.config?.universeId ?? pData.portfolio?.config?.universe;
      if ((cfgU === "sp500_top50" || cfgU === "sp500_top150") && cfgU === uid) {
        setPaperUniverseView(cfgU);
      }
      if (pData.portfolio) writePaperTradeSessionCache(pData.portfolio, hData.history);
      else clearPaperTradeSessionCache();
    } catch (e) {
      if (!isAbortError(e)) setError(e.message);
    } finally {
      if (slotKeyedFetch) setPaperSlotFetchPending(false);
      paperApi.clearIfCurrent(ac);
      if (useFullPageLoader) setLoading(false);
    }
  };

  const initPortfolio = async () => {
    setLoading(true);
    setError(null);
    const ac = paperApi.beginRequest();
    try {
      const res = await apiFetch("/api/paper-trade/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          initialCapital: parseFloat(initForm.initialCapital),
          strategy: initForm.strategy,
          universe: initForm.universe,
          universeId: initForm.universe,
          topN: parseInt(initForm.topN, 10),
          adaptiveMode: "fixed",
          positionSizing: "invVol",
          regimeEnabled: true,
          rlAgent: initForm.rlAgent,
          rlOnlineLearning: initForm.rlOnlineLearning
        })
      });
      const data = await safeJson(res);
      if (!data.success) {
        setError(data.error);
        setLoading(false);
        paperApi.clearIfCurrent(ac);
        return;
      }
      paperApi.clearIfCurrent(ac);
      setPaperUniverseView(
        initForm.universe === "sp500_top50" || initForm.universe === "sp500_top150" ? initForm.universe : "sp500_top150"
      );
      await fetchPortfolio(true, initForm.universe);
    } catch (e) {
      if (isAbortError(e)) {
        setLoading(false);
        paperApi.clearIfCurrent(ac);
        return;
      }
      setError(e.message);
      setLoading(false);
      paperApi.clearIfCurrent(ac);
    }
  };

  const rebalance = async () => {
    const ac = paperApi.beginRequest();
    setRebalancing(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/paper-trade/rebalance${paperUniverseQs}`, { method: "POST", signal: ac.signal });
      const data = await safeJson(res);
      if (!data.success) {
        setError(data.error);
        paperApi.clearIfCurrent(ac);
        setRebalancing(false);
        return;
      }
      paperApi.clearIfCurrent(ac);
      const nb = data.buys?.length ?? 0;
      const ns = data.sells?.length ?? 0;
      setToast(`Rebalance complete · ${nb} buy${nb !== 1 ? "s" : ""} · ${ns} sell${ns !== 1 ? "s" : ""}`);
      await fetchPortfolio(false);
    } catch (e) {
      if (!isAbortError(e)) setError(e.message);
      paperApi.clearIfCurrent(ac);
    }
    setRebalancing(false);
  };

  const onRebalanceClick = () => {
    if (rebalancing) return;
    rebalance();
  };

  const resetPortfolio = async () => {
    setShowResetConfirm(false);
    try {
      await apiFetch(`/api/paper-trade/reset${paperUniverseQs}`, { method: "DELETE" });
      setPortfolio(null);
      setHistory(null);
      clearPaperTradeSessionCache();
    } catch (e) { setError(e.message); }
  };

  const patchPaperConfig = async (updates) => {
    setPaperConfigSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/paper-trade/config${paperUniverseQs}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });
      const data = await safeJson(res);
      if (!data.success) throw new Error(data.error || "Config update failed");
      await fetchPortfolio(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setPaperConfigSaving(false);
    }
  };

  if (loading && !portfolio) {
    return (
      <div className="ma-pt-page">
        <PaperSlotSegmented
          activeId={paperUniverseView}
          disabled
          onPick={() => {}}
        />
        <PaperTradeSubTabs active={paperSubTab} disabled={false} onPick={setPaperSubTab} lite={lite} />
        {!lite && paperSubTab === "wheel" ? (
          <WheelTab
            visible={visible && paperSubTab === "wheel"}
            universeId={paperUniverseView}
            embedded
          />
        ) : (
          <>
            <div className="ma-pt-skel" style={{ height: 100, marginTop: 16, marginBottom: 12 }} />
            <div className="ma-pt-skel" style={{ height: 280, marginBottom: 12 }} />
            <div className="ma-pt-skel" style={{ height: 160 }} />
            <div
              className="ma-mono"
              style={{
                textAlign: "center",
                fontSize: 12,
                color: "var(--text-secondary)",
                marginTop: 16
              }}
            >
              Loading paper portfolio…
            </div>
            <div style={{ ...RUN_ACTION_BAR_STYLE, marginTop: 16 }}>
              <button
                type="button"
                className="ma-btn-ghost"
                onClick={() => {
                  paperApi.abortInFlight();
                  setLoading(false);
                }}
                onMouseEnter={() => setLoadBtnHover(true)}
                onMouseLeave={() => setLoadBtnHover(false)}
                style={{
                  minWidth: "auto",
                  color: loadBtnHover ? "var(--color-negative)" : undefined
                }}
              >
                {loadBtnHover ? "CANCEL" : "STOP LOADING"}
              </button>
            </div>
          </>
        )}
        <div className="ma-pt-foot">Paper trading · No real money · Educational purposes</div>
      </div>
    );
  }

  if (!portfolio) {
    return (
      <div className="ma-pt-page">
        <PaperSlotSegmented
          activeId={paperUniverseView}
          disabled={loading || paperSlotFetchPending}
          onPick={(id) => {
            if (id === paperUniverseView) return;
            setPaperUniverseView(id);
            setInitForm((f) => ({ ...f, universe: id }));
            fetchPortfolio(true, id);
          }}
        />
        <PaperTradeSubTabs active={paperSubTab} disabled={paperSlotFetchPending} onPick={setPaperSubTab} lite={lite} />
        <PaperSlotLoadingBanner show={paperSlotFetchPending && paperSubTab === "portfolio"} />
        {showResetConfirm && (
          <ConfirmModal
            message={`Reset portfolio to $${Number(initForm.initialCapital || 100000).toLocaleString()}? This cannot be undone.`}
            onConfirm={resetPortfolio}
            onCancel={() => setShowResetConfirm(false)}
          />
        )}
        {!lite && paperSubTab === "wheel" && (
          <WheelTab
            visible={visible && paperSubTab === "wheel"}
            universeId={paperUniverseView}
            embedded
          />
        )}
        {paperSubTab === "portfolio" && (
        <div
          style={{
            opacity: paperSlotFetchPending ? 0.55 : 1,
            transition: "opacity 0.2s ease",
            pointerEvents: paperSlotFetchPending ? "none" : undefined
          }}
        >
          <Box>
            <div className="ma-section-title" style={{ marginBottom: 12 }}>
              Initialize paper portfolio
            </div>
          <p
            style={{
              fontSize: 13,
              color: "var(--color-text-dim)",
              marginBottom: 16,
              lineHeight: 1.6
            }}
          >
            Start a forward paper trade to test your model out-of-sample. The model runs on live market data — no overfitting possible.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(9.25rem, 1fr))",
              gap: "12px 10px",
              marginBottom: 16,
              alignItems: "end"
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div className="ma-field-label">Capital ($)</div>
              <input
                type="number"
                className="ma-input"
                value={initForm.initialCapital}
                onChange={(e) => setInitForm((f) => ({ ...f, initialCapital: e.target.value }))}
              />
            </div>
            <Select label="STRATEGY" value={initForm.strategy} onChange={(v) => setInitForm((f) => ({ ...f, strategy: v }))} options={STRATEGY_OPTIONS} />
            <Select label="UNIVERSE" value={initForm.universe} onChange={(v) => setInitForm((f) => ({ ...f, universe: v }))} options={UNIVERSE_OPTIONS} />
            <Select label="TOP N" value={initForm.topN} onChange={(v) => setInitForm((f) => ({ ...f, topN: v }))} options={TOP_N_OPTIONS} />
            {isCompositeStrategy(initForm.strategy) && (
              <div style={{ gridColumn: "1 / -1", paddingTop: 4, maxWidth: 360 }}>
                <PtToggle
                  label="RL agent (when trained)"
                  on={initForm.rlAgent}
                  onChange={(v) => setInitForm((f) => ({ ...f, rlAgent: v }))}
                />
                <PtToggle
                  label="RL online learning"
                  on={initForm.rlOnlineLearning}
                  onChange={(v) => setInitForm((f) => ({ ...f, rlOnlineLearning: v }))}
                />
              </div>
            )}
          </div>
          <div style={RUN_ACTION_BAR_STYLE}>
            {!lite && (
              <button
                type="button"
                className="ma-btn-primary"
                onClick={initPortfolio}
              >
                Create Paper Portfolio
              </button>
            )}
            <button
              type="button"
              className="ma-btn-ghost"
              style={{ fontSize: 13 }}
              onClick={() => { setError(null); fetchPortfolio(true); }}
            >
              Reload existing
            </button>
          </div>
          {error && (
            <div className="ma-mono" style={{ color: "var(--color-negative)", fontSize: 12, marginTop: 10 }}>
              {error}
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="ma-btn-ghost"
                  style={{ fontSize: 12 }}
                  onClick={() => {
                    setError(null);
                    fetchPortfolio(true);
                  }}
                >
                  Reload portfolio
                </button>
                {!lite && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="ma-btn-danger-outline"
                      style={{ fontSize: 12 }}
                      onClick={() => setShowResetConfirm(true)}
                    >
                      Reset and start over
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          </Box>

          <Box>
            <div className="ma-mono" style={{ fontSize: 12, color: "var(--color-text-dim)", lineHeight: 1.8 }}>
              <strong style={{ color: "var(--color-text-primary)" }}>Why paper trade?</strong> The biggest risk isn&apos;t the model — it&apos;s overfitting. A backtest always looks better than reality.
              Forward paper trading is the ultimate test: live picks, tracked daily against S&amp;P 500, with zero look-ahead bias.
            </div>
          </Box>
        </div>
        )}
        <div className="ma-pt-foot">Paper trading · No real money · Educational purposes</div>
      </div>
    );
  }

  const {
    holdings,
    config,
    createdAt,
    lastRebalance,
    nextRebalance,
    cash,
    navHistory,
    monthlyEventsSummary,
    activeWeights,
    weightHistory
  } = portfolio;
  const rebalanceHistory = history?.rebalanceHistory || [];

  const chartData = densifyChartData(
    (navHistory || []).map(n => ({
      date: n.date,
      dateTs: new Date(n.date + "T00:00:00").getTime(),
      Portfolio: n.portfolioValue,
      "S&P 500": n.spyValue
    }))
  );
  const chartXTicks =
    chartData.length > 1
      ? monthlyTicks(
          Math.min(...chartData.map((d) => d.dateTs)),
          Math.max(...chartData.map((d) => d.dateTs))
        )
      : [];

  const stratLabel = STRATEGY_OPTIONS.find(s => s.id === config.strategy)?.label || config.strategy;
  const configSlotId = config.universeId ?? config.universe;
  const uniLabel =
    UNIVERSE_OPTIONS.find((u) => u.id === configSlotId)?.label || configSlotId;
  const slotDataStale = Boolean(configSlotId && configSlotId !== paperUniverseView);
  const displayUniLabel = slotDataStale
    ? UNIVERSE_OPTIONS.find((u) => u.id === paperUniverseView)?.label || paperUniverseView
    : uniLabel;

  const weightBarParts =
    isCompositeStrategy(config.strategy) && activeWeights
      ? PILLAR_ORDER.map((key) => ({
          key,
          pct: weightToPct(activeWeights[key]),
          color: PT_PILLAR_COLORS[key]
        }))
      : [];
  const weightBarTotal = weightBarParts.reduce((s, x) => s + x.pct, 0) || 1;

  const chartSubtitle = `Since ${fmtDate(createdAt)} · ${stratLabel} · ${displayUniLabel} · Top ${config.topN}`;
  const cashPctOfNav = summary && summary.totalValue > 0 ? ((cash / summary.totalValue) * 100).toFixed(1) : "0";
  const captureRatiosMeaningful = (summary?.daysActive ?? 0) >= 30;
  const rlConfigOn = paperRlConfigOn(config);
  const slotUiPending = paperSlotFetchPending || slotDataStale;

  return (
    <div className="ma-pt-page" style={{ position: "relative" }}>
      <PaperSlotSegmented
        activeId={paperUniverseView}
        disabled={loading || slotUiPending}
        onPick={(id) => {
          if (id === paperUniverseView) return;
          setPaperUniverseView(id);
          setInitForm((f) => ({ ...f, universe: id }));
          fetchPortfolio(true, id);
        }}
      />
      <PaperTradeSubTabs active={paperSubTab} disabled={loading || slotUiPending} onPick={setPaperSubTab} lite={lite} />
      <PaperSlotLoadingBanner show={slotUiPending && paperSubTab === "portfolio"} />
      {showResetConfirm && (
        <ConfirmModal
          message={`Reset portfolio (implied start ~$${Math.round(derivedInitialCapital).toLocaleString()})? This cannot be undone.`}
          onConfirm={resetPortfolio}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}

      {error && (
        <Box style={{ background: "var(--color-danger-bg)", borderColor: "var(--color-danger-border)" }}>
          <div className="ma-mono" style={{ color: "var(--color-negative)", fontSize: 12 }}>
            {error}
          </div>
        </Box>
      )}

      {paperSubTab === "portfolio" && (
        <div className="ma-pt-portfolio-panel">
          <div className="ma-pt-slot-summary">
            {displayUniLabel} · {holdings.length} positions · ${summary.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} · Since{" "}
            {fmtDate(createdAt)}
          </div>

          {rebalancing && autoRebalanced && (
            <Box>
              <div className="ma-mono" style={{ fontSize: 12, color: "var(--color-text-dim)" }}>
                Auto-rebalancing — calendar date reached the next scheduled rebalance (15th-aligned, same rule as backtest). Running the model on live data...
              </div>
            </Box>
          )}

          <div
            style={{
              opacity: slotUiPending ? 0.55 : 1,
              transition: "opacity 0.2s ease",
              pointerEvents: slotUiPending ? "none" : undefined
            }}
          >
        <div className="ma-pt-hero">
        <div className="ma-pt-hero__grid">
          <div>
            <div className="ma-pt-hero__label">Total value</div>
            <div className="ma-pt-hero__val ma-pt-hero__val--xl ma-mono">
              ${Math.round(animatedNavTotal).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <div className="ma-pt-hero__cash">
              Cash: ${cash.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({cashPctOfNav}%)
            </div>
          </div>
          <div>
            <div className="ma-pt-hero__label">Return</div>
            <div
              className="ma-pt-hero__val ma-pt-hero__val--lg ma-mono"
              style={{ color: summary.totalReturn >= 0 ? "var(--green)" : "var(--red)" }}
            >
              {summary.totalReturn >= 0 ? "+" : ""}
              {summary.totalReturn.toFixed(1)}%
            </div>
            <div className="ma-pt-hero__spy">
              S&amp;P: {summary.spyReturn >= 0 ? "+" : ""}
              {summary.spyReturn.toFixed(1)}%
            </div>
          </div>
          <div>
            <div className="ma-pt-hero__label">Alpha</div>
            <div
              className="ma-pt-hero__val ma-pt-hero__val--lg ma-mono"
              style={{ color: summary.alpha >= 0 ? "var(--green)" : "var(--red)" }}
            >
              {summary.alpha >= 0 ? "+" : ""}
              {summary.alpha.toFixed(1)}%
            </div>
            <div className="ma-pt-hero__spy">vs benchmark</div>
          </div>
          <div>
            <div className="ma-pt-hero__label">Active</div>
            <div className="ma-pt-hero__val ma-pt-hero__val--lg ma-mono" style={{ color: "var(--text-primary)" }}>
              {summary.daysActive} days
            </div>
          </div>
        </div>
        <div className="ma-pt-capture-row">
          <div className="ma-pt-capture">
            <div className="ma-pt-capture__label">Up capture</div>
            <div className="ma-pt-capture__val ma-mono">
              {captureRatiosMeaningful && summary.upCapture != null ? `${summary.upCapture.toFixed(0)}%` : "—"}
            </div>
            <div className="ma-pt-capture__bar">
              <div
                className="ma-pt-capture__fill--up"
                style={{
                  width: `${
                    captureRatiosMeaningful && summary.upCapture != null
                      ? Math.min(100, Math.max(0, summary.upCapture))
                      : 0
                  }%`
                }}
              />
            </div>
          </div>
          <div className="ma-pt-capture">
            <div className="ma-pt-capture__label">Down capture</div>
            <div className="ma-pt-capture__val ma-mono">
              {captureRatiosMeaningful && summary.downCapture != null ? `${summary.downCapture.toFixed(0)}%` : "—"}
            </div>
            <div className="ma-pt-capture__bar">
              <div
                className="ma-pt-capture__fill--down"
                style={{
                  width: `${
                    captureRatiosMeaningful && summary.downCapture != null
                      ? Math.min(100, Math.max(0, summary.downCapture))
                      : 0
                  }%`
                }}
              />
            </div>
            {captureRatiosMeaningful && summary.downCapture == null && (
              <div className="ma-pt-capture__muted">No down days yet</div>
            )}
          </div>
        </div>
        {!captureRatiosMeaningful && (
          <div className="ma-pt-capture__muted" style={{ marginTop: 10, textAlign: "center" }}>
            Collecting data — capture ratios need 30+ days of history.
          </div>
        )}
      </div>

      <div className="ma-pt-chart-row">
        <div className="ma-pt-chart-card">
          <div className="ma-pt-chart-head">
            <div className="ma-pt-chart-title">PORTFOLIO vs S&amp;P 500</div>
            <div className="ma-pt-chart-sub">{chartSubtitle}</div>
          </div>
          {chartData.length > 1 ? (
            <>
              <div className="ma-pt-chart-area">
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={chartData} margin={{ top: 8, right: 20, bottom: 4, left: 4 }}>
                    <CartesianGrid stroke="var(--color-chart-grid)" strokeDasharray="4 4" vertical={false} />
                    <XAxis
                      dataKey="dateTs"
                      type="number"
                      scale="time"
                      domain={["dataMin", "dataMax"]}
                      ticks={chartXTicks}
                      interval={0}
                      tick={{ fontSize: 10, fill: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--border-card)" }}
                      tickFormatter={(v) => {
                        const d = new Date(v);
                        return `${d.toLocaleString("en-US", { month: "short" })} ${d.getDate()}`;
                      }}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                      domain={["dataMin - 500", "dataMax + 500"]}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="Portfolio"
                      stroke="var(--green)"
                      strokeWidth={2}
                      dot={false}
                      name="Portfolio"
                      isAnimationActive
                      animationDuration={850}
                    />
                    <Line
                      type="monotone"
                      dataKey="S&P 500"
                      stroke="var(--text-secondary)"
                      strokeWidth={1.5}
                      dot={false}
                      strokeDasharray="5 5"
                      name="S&P 500"
                      isAnimationActive
                      animationDuration={850}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="ma-pt-legend">
                <div className="ma-pt-legend__item">
                  <span className="ma-pt-legend__dot" style={{ background: "var(--green)" }} />
                  Portfolio
                </div>
                <div className="ma-pt-legend__item">
                  <span
                    className="ma-pt-legend__dot"
                    style={{
                      background: "transparent",
                      border: "2px dashed var(--text-secondary)",
                      width: 10,
                      height: 10
                    }}
                  />
                  S&amp;P 500
                </div>
              </div>
            </>
          ) : (
            <div className="ma-mono" style={{ textAlign: "center", padding: "40px 12px", color: "var(--text-secondary)", fontSize: 12 }}>
              Chart appears after 2+ NAV points — run a rebalance to begin tracking.
            </div>
          )}
        </div>

        <div className="ma-pt-quick">
          <div className="ma-pt-quick__title">REGIME &amp; STATUS</div>
          <div className={regimePillClassPt(summary.currentRegime)}>
            {(summary.currentRegime ?? "—").toString().replace(/_/g, " ")}
          </div>
          <div className="ma-pt-rl-row">
            <span className="ma-mono" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
              RL agent
            </span>
            <span className={`ma-pt-rl-pill ${rlConfigOn ? "ma-pt-rl-pill--on" : "ma-pt-rl-pill--off"}`}>
              {rlConfigOn ? "ON" : "OFF"}
            </span>
          </div>
          {isCompositeStrategy(config.strategy) && !lite && (
            <>
              <PtToggle
                label="Use on rebalance"
                disabled={paperConfigSaving || rebalancing}
                on={rlConfigOn}
                onChange={(v) => patchPaperConfig({ rlAgent: v })}
              />
              <PtToggle
                label="Online Q-update"
                disabled={paperConfigSaving || rebalancing}
                on={
                  config.rlOnlineLearning === true ||
                  config.rlOnlineLearning === "true" ||
                  config.rlOnlineLearning === "1" ||
                  config.rlOnlineLearning === 1
                }
                onChange={(v) => patchPaperConfig({ rlOnlineLearning: v })}
              />
            </>
          )}
          <div className="ma-pt-dates">
            {lastRebalance && <div>Last: {fmtDate(lastRebalance)}</div>}
            {nextRebalance && <div>Next: {fmtDate(nextRebalance)}</div>}
          </div>
          {isCompositeStrategy(config.strategy) && activeWeights && (
            <>
              <div className="ma-pt-quick__title" style={{ marginTop: 4 }}>
                ADAPTIVE WEIGHTS
              </div>
              <div className="ma-pt-weight-bar">
                {weightBarParts.map(({ key, pct, color }) => (
                  <div
                    key={key}
                    className="ma-pt-weight-seg"
                    style={{
                      width: `${(pct / weightBarTotal) * 100}%`,
                      background: color,
                      minWidth: pct > 0.5 ? 2 : 0
                    }}
                    title={`${PILLAR_LABELS[key]} ${pct.toFixed(1)}%`}
                  >
                    {pct >= 8 ? `${PILLAR_LABELS[key].slice(0, 1)} ${pct.toFixed(0)}%` : ""}
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="ma-pt-quick__title" style={{ marginTop: 8 }}>
            AUTO-OPTIMIZER
          </div>
          <div className="ma-pt-rl-row">
            <span className="ma-mono" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
              Score check
            </span>
            <span className="ma-pt-rl-pill ma-pt-rl-pill--on">ON</span>
          </div>
          <div className="ma-mono" style={{ fontSize: 10, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 6 }}>
            Mon · Wed · Fri at 9:50 AM ET. Triggers rebalance if &gt;30% of holdings have degraded composite score or portfolio is &gt;20 days stale.
          </div>
          {autoOptResult && (
            <div className="ma-mono" style={{ fontSize: 10, color: "var(--text-secondary)", marginBottom: 4 }}>
              {autoOptResult.error
                ? <span style={{ color: "var(--red)" }}>{autoOptResult.error}</span>
                : Object.entries(autoOptResult.results || {}).map(([uid, r]) => (
                  <div key={uid}>
                    {uid === paperUniverseView
                      ? r.rebalanced
                        ? <span style={{ color: "var(--green)" }}>✓ Rebalanced — {r.triggerReason}</span>
                        : <span>{r.reason ?? r.triggerReason ?? "healthy"}</span>
                      : null}
                  </div>
                ))}
            </div>
          )}
          {!lite && (
            <button
              type="button"
              disabled={autoOptimizing || rebalancing}
              onClick={runAutoOptimize}
              style={{
                background: "transparent",
                border: "1px solid var(--border-card)",
                color: autoOptimizing ? "var(--text-secondary)" : "var(--text-primary)",
                borderRadius: 6,
                padding: "6px 10px",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                cursor: autoOptimizing ? "not-allowed" : "pointer",
                width: "100%",
                marginBottom: 8
              }}
            >
              {autoOptimizing ? "Checking…" : "Run Optimizer Now"}
            </button>
          )}
          <div className="ma-pt-actions">
            {!lite && (
              <button
                type="button"
                className="ma-pt-btn-primary"
                disabled={rebalancing}
                onClick={onRebalanceClick}
              >
                {rebalancing ? (
                  <>
                    <span className="ma-pt-spin" aria-hidden />
                    Rebalancing…
                  </>
                ) : (
                  "REBALANCE NOW"
                )}
              </button>
            )}
            <button
              type="button"
              className="ma-pt-btn-secondary"
              disabled={loading || rebalancing}
              onClick={() => fetchPortfolio(false)}
            >
              RELOAD
            </button>
            {!lite && (
            <button
                type="button"
                className="ma-pt-btn-danger"
                onClick={() => setShowResetConfirm(true)}
              >
                RESET
              </button>
            )}
          </div>
        </div>
      </div>
      </div>

      {(summary.weightSpread != null || summary.largestPosition || summary.smallestPosition) && (
        <div className="ma-bt-card" style={{ marginBottom: "var(--section-gap)" }}>
          <button
            type="button"
            className="ma-bt-collapsible__hdr"
            onClick={() => setShowPositionDetails((s) => !s)}
            style={{ width: "100%" }}
          >
            <span className="ma-mono" style={{ fontSize: 11 }}>
              Position details
            </span>
            <span>{showPositionDetails ? "▲" : "▼"}</span>
          </button>
          {showPositionDetails && (
            <div className="ma-mono" style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 10 }}>
              {summary.adjustedTopN != null && <div>Adj. top N: {summary.adjustedTopN}</div>}
              {summary.notionalRegimeExposure != null && <div>Notional exposure: {summary.notionalRegimeExposure}%</div>}
              {summary.cashPct != null && <div>Cash %: {summary.cashPct.toFixed(1)}%</div>}
              {summary.weightSpread != null && <div>Spread: {summary.weightSpread}×</div>}
              {summary.largestPosition && (
                <div>
                  Largest: {summary.largestPosition.ticker}{" "}
                  {summary.largestPosition.weight?.toFixed?.(1) ?? summary.largestPosition.weight}%
                </div>
              )}
              {summary.smallestPosition && (
                <div>
                  Smallest: {summary.smallestPosition.ticker}{" "}
                  {summary.smallestPosition.weight?.toFixed?.(1) ?? summary.smallestPosition.weight}%
                </div>
              )}
              {summary.cashDragRough != null && (
                <div>
                  Cash drag (heuristic): {summary.cashDragRough >= 0 ? "+" : ""}
                  {summary.cashDragRough.toFixed(2)} pp
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {isCompositeStrategy(config.strategy) && activeWeights && weightHistory && weightHistory.length > 0 && (
        <div className="ma-bt-card" style={{ marginBottom: "var(--section-gap)" }}>
          <button
            type="button"
            className="ma-bt-collapsible__hdr"
            onClick={() => setShowWeightHistory((s) => !s)}
            style={{ width: "100%" }}
          >
            <span className="ma-mono" style={{ fontSize: 11 }}>
              Weight history ({weightHistory.length} snapshots)
            </span>
            <span>{showWeightHistory ? "▲" : "▼"}</span>
          </button>
          {showWeightHistory && (
            <div className="ma-table-wrap" style={{ marginTop: 10 }}>
              <table className="ma-table data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Alpha</th>
                    {PILLAR_ORDER.map((key) => (
                      <th key={key} className="ma-num">
                        {PILLAR_LABELS[key]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weightHistory.slice().reverse().map((row) => (
                    <tr key={row.date}>
                      <td className="ma-mono">{fmtDate(row.date)}</td>
                      <td
                        className="ma-mono ma-num"
                        style={{
                          color:
                            row.alpha == null
                              ? "var(--text-secondary)"
                              : row.alpha >= 0
                                ? "var(--green)"
                                : "var(--red)"
                        }}
                      >
                        {row.alpha != null ? `${row.alpha >= 0 ? "+" : ""}${Number(row.alpha).toFixed(1)}%` : "—"}
                      </td>
                      {PILLAR_ORDER.map((key) => (
                        <td key={key} className="ma-mono ma-num" style={{ color: "var(--text-secondary)" }}>
                          {row.weights?.[key] != null ? `${Number(row.weights[key]).toFixed(1)}%` : "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {holdings.length > 0 && (
        <div className="ma-bt-card" style={{ marginBottom: "var(--section-gap)" }}>
          <div className="ma-bt-hero__kicker" style={{ marginBottom: 12 }}>
            CURRENT HOLDINGS ({holdings.length})
          </div>
          <div className="ma-pt-holdings-sort">
            <button
              type="button"
              className={`ma-pt-sort-btn ${holdingsSort === "pnl" ? "ma-pt-sort-btn--on" : ""}`}
              onClick={() => setHoldingsSort("pnl")}
            >
              By P&amp;L
            </button>
            <button
              type="button"
              className={`ma-pt-sort-btn ${holdingsSort === "weight" ? "ma-pt-sort-btn--on" : ""}`}
              onClick={() => setHoldingsSort("weight")}
            >
              By weight
            </button>
            <button
              type="button"
              className={`ma-pt-sort-btn ${holdingsSort === "score" ? "ma-pt-sort-btn--on" : ""}`}
              onClick={() => setHoldingsSort("score")}
            >
              By score
            </button>
          </div>
          <div className="ma-table-wrap">
            <table className="ma-table data-table ma-pt-holdings-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th className="ma-num ma-pt-col-hide-sm">Shares</th>
                  <th className="ma-num ma-pt-col-hide-sm">Entry</th>
                  <th className="ma-num ma-pt-col-hide-sm">Current</th>
                  <th className="ma-num">Position</th>
                  <th className="ma-num">P&amp;L $</th>
                  <th className="ma-num">P&amp;L %</th>
                  <th className="ma-num">Weight</th>
                  <th className="ma-num">Composite</th>
                  <th className="ma-num ma-pt-col-hide-sm">Congress</th>
                </tr>
              </thead>
              <tbody>
                {sortedHoldings.map((h, hi) => {
                  const pos = (h.shares || 0) * (h.currentPrice || 0);
                  const wfrac = (Number(h.weight) || 0) / 100;
                  const tier = compositeTierColor(h.scores?.composite);
                  const rowClass = holdingsTierSets.top.has(h.ticker)
                    ? "ma-pt-row--top"
                    : holdingsTierSets.bottom.has(h.ticker)
                      ? "ma-pt-row--bot"
                      : "";
                  return (
                    <tr
                      key={h.ticker}
                      className={rowClass}
                      style={{ animationDelay: `${hi * 30}ms` }}
                    >
                      <td className="ma-mono">
                        {onOpenTicker ? (
                          <button
                            type="button"
                            className="ma-pt-ticker-btn"
                            style={{ fontWeight: 700 }}
                            onClick={() => onOpenTicker(h.ticker)}
                          >
                            {h.ticker}
                          </button>
                        ) : (
                          <span style={{ fontWeight: 700 }}>{h.ticker}</span>
                        )}
                      </td>
                      <td className="ma-mono ma-num ma-pt-col-hide-sm">{h.shares}</td>
                      <td className="ma-mono ma-num ma-pt-col-hide-sm">${h.entryPrice.toFixed(2)}</td>
                      <td className="ma-mono ma-num ma-pt-col-hide-sm">${h.currentPrice.toFixed(2)}</td>
                      <td className="ma-mono ma-num">${pos.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                      <td
                        className="ma-mono ma-num"
                        style={{ color: h.pnl >= 0 ? "var(--green)" : "var(--red)" }}
                      >
                        {h.pnl >= 0 ? "+" : ""}${h.pnl.toFixed(0)}
                      </td>
                      <td
                        className="ma-mono ma-num"
                        style={{ color: h.pnlPct >= 0 ? "var(--green)" : "var(--red)" }}
                      >
                        {h.pnlPct >= 0 ? "+" : ""}
                        {h.pnlPct.toFixed(1)}%
                      </td>
                      <td className="ma-num">
                        <div className="ma-pt-weight-cell">
                          <div className="ma-pt-weight-mini">
                            <span style={{ width: `${Math.min(100, wfrac * 100)}%` }} />
                          </div>
                          <span className="ma-mono">{h.weight}%</span>
                        </div>
                      </td>
                      <td className="ma-mono ma-num" style={{ color: tier, fontWeight: 600 }}>
                        {h.scores?.composite?.toFixed(1) || "—"}
                      </td>
                      <td className="ma-mono ma-num ma-pt-col-hide-sm">
                        {(h.congressScore ?? 0) > 0 ? (
                          <span
                            title={`Score: ${h.congressScore}/10 · ${h.congressSentiment}\nNet buys: ${h.congressNetBuys ?? 0}\n${(h.congressPoliticians ?? []).join(", ")}`}
                            style={{
                              color: h.congressSentiment === "bullish" ? "var(--green)"
                                   : h.congressSentiment === "mild"    ? "#38bdf8"
                                   : h.congressSentiment === "bearish" ? "var(--red)"
                                   : "var(--color-text-muted)",
                              fontWeight: 600, cursor: "help",
                            }}
                          >
                            {h.congressSentiment === "bullish" ? "▲" : h.congressSentiment === "bearish" ? "▼" : "●"} {(h.congressScore ?? 0).toFixed(1)}
                          </span>
                        ) : (
                          <span style={{ color: "var(--color-text-muted)" }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {holdings.length === 0 && portfolio.rebalanceCount === 0 && (
        <Box style={{ textAlign: "center", padding: 30 }}>
          <div style={{ fontSize: 14, color: "var(--color-text-primary)", marginBottom: 8 }}>No holdings yet</div>
          <div className="ma-mono" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            Click &quot;Rebalance Now&quot; to run the model and make initial picks.
          </div>
        </Box>
      )}

      {monthlyEventsSummary && monthlyEventsSummary.length > 0 && (
        <div className="ma-bt-card" style={{ marginBottom: "var(--section-gap)" }}>
          <div className="ma-bt-hero__kicker" style={{ marginBottom: 14 }}>
            MONTHLY ACTIVITY
          </div>
          {monthlyEventsSummary
            .slice()
            .reverse()
            .map((row) => {
              const inMonth = rebalanceHistory.filter((r) => r.date && r.date.startsWith(row.month));
              const labelMonth = row.month.length >= 7 ? new Date(`${row.month}-01T12:00:00`).toLocaleString("en-US", { month: "long", year: "numeric" }) : row.month;
              return (
                <div key={row.month} style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>{labelMonth}</div>
                  <div className="ma-mono" style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>
                    {row.rebalances} rebalance{row.rebalances !== 1 ? "s" : ""} · {row.stops} stop exit{row.stops !== 1 ? "s" : ""}
                  </div>
                  {inMonth
                    .slice()
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map((rb) => {
                      const chronoIndex = rebalanceHistory.indexOf(rb);
                      const sameDateIndices = rebalanceHistory.map((r, i) => (r.date === rb.date ? i : -1)).filter((i) => i >= 0);
                      const occurrence = sameDateIndices.indexOf(chronoIndex);
                      const occParam = sameDateIndices.length > 1 ? `&paperRebalanceOcc=${occurrence}` : "";
                      const reportHref = `${window.location.origin}${window.location.pathname}?paperRebalance=${encodeURIComponent(rb.date)}${occParam}`;
                      const buys = rb.buys?.length ?? 0;
                      const sells = rb.sells?.length ?? 0;
                      let note = "Portfolio update.";
                      if (buys === 0 && sells === 0) note = "Portfolio held steady. No changes.";
                      else if (buys > 0 && sells === 0) note = `Added: ${rb.buys.map((b) => b.ticker).join(", ")}`;
                      else note = `${buys} buys · ${sells} sells`;
                      return (
                        <div key={`${rb.date}-${chronoIndex}`} className="ma-pt-month-card">
                          <div className="ma-mono" style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6 }}>
                            {fmtDate(rb.date)} ·{" "}
                            <span style={{ color: "var(--green)" }}>+{buys} buys</span> ·{" "}
                            <span style={{ color: sells ? "var(--red)" : "var(--text-secondary)" }}>-{sells} sells</span>
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text-primary)", marginBottom: 8 }}>{note}</div>
                          <a href={reportHref} target="_blank" rel="noopener noreferrer" className="ma-mono" style={{ fontSize: 11, color: "var(--blue)" }}>
                            Open full report →
                          </a>
                        </div>
                      );
                    })}
                </div>
              );
            })}
        </div>
      )}

      {rebalanceHistory.length > 0 && (
        <div className="ma-bt-card" style={{ marginBottom: "var(--section-gap)" }}>
          <div className="ma-bt-hero__kicker" style={{ marginBottom: 12 }}>
            REBALANCE LOG ({rebalanceHistory.length})
          </div>
          {rebalanceHistory.slice().reverse().map((rb, idx) => {
            const chronoIndex = rebalanceHistory.length - 1 - idx;
            const ek = `${rb.date}#${chronoIndex}`;
            const isExpanded = expandedRebalanceKey === ek;
            const sameDateIndices = rebalanceHistory
              .map((r, i) => (r.date === rb.date ? i : -1))
              .filter((i) => i >= 0);
            const occurrence = sameDateIndices.indexOf(chronoIndex);
            const occParam = sameDateIndices.length > 1 ? `&paperRebalanceOcc=${occurrence}` : "";
            const reportHref = `${window.location.origin}${window.location.pathname}?paperRebalance=${encodeURIComponent(rb.date)}${occParam}`;
            const buys = rb.buys?.length ?? 0;
            const sells = rb.sells?.length ?? 0;
            const narrative =
              buys === 0 && sells === 0 ? "No changes — all positions within thresholds" : "Expand for trade details";
            return (
              <div key={ek} className="ma-pt-rebal-card">
                <button
                  type="button"
                  className="ma-pt-rebal-card__head"
                  onClick={() => setExpandedRebalanceKey(isExpanded ? null : ek)}
                >
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div className="ma-mono" style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
                      {fmtDate(rb.date)}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                      <span className="ma-pt-badge-buy">+{buys} buys</span>
                      <span className={`ma-pt-badge-sell ${sells === 0 ? "ma-pt-badge--zero" : ""}`}>{sells} sells</span>
                      {rb.regime ? (
                        <span className={regimePillClassPt(rb.regime)} style={{ fontSize: 10, padding: "4px 8px" }}>
                          {String(rb.regime).replace(/_/g, " ")}
                        </span>
                      ) : null}
                    </div>
                    <div className="ma-mono" style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 8 }}>
                      {narrative}
                    </div>
                    <a
                      href={reportHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="ma-mono"
                      style={{ fontSize: 11, color: "var(--blue)", marginTop: 8, display: "inline-block" }}
                    >
                      Open full report
                    </a>
                  </div>
                  <div className="ma-mono ma-num" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    ${rb.portfolioValue?.toLocaleString(undefined, { maximumFractionDigits: 0 })} {isExpanded ? "▲" : "▼"}
                  </div>
                </button>
                {isExpanded && (
                  <div
                    style={{
                      padding: "12px 14px 14px",
                      borderTop: "1px solid var(--border-card)",
                      background: "rgba(0,0,0,0.15)"
                    }}
                  >
                    <PaperRebalanceReportBody rb={rb} variant="inline" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
        </div>
      )}

      {!lite && paperSubTab === "wheel" && (
        <WheelTab
          visible={visible && paperSubTab === "wheel"}
          universeId={paperUniverseView}
          embedded
        />
      )}

      <div className="ma-pt-foot">Paper trading · No real money · Educational purposes</div>
      {toast ? <div className="ma-pt-toast">{toast}</div> : null}
    </div>
  );
}
