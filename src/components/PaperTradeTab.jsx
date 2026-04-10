import { useState, useEffect } from "react";
import { useAbortableApi, isAbortError } from "../hooks/useAbortableApi.js";
import {
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
  Area,
  ComposedChart
} from "recharts";

import { Box, Pill, RUN_ACTION_BAR_STYLE } from "./shared.jsx";
import PaperRebalanceReportBody from "./PaperRebalanceReportBody.jsx";

const PILLAR_BAR_COLORS = {
  fundamental: "var(--color-accent)",
  dcf: "var(--color-gray-pillar)",
  valuation: "var(--color-purple)",
  momentum: "var(--color-teal)",
  value: "var(--color-amber)"
};

function weightToPctNumber(raw) {
  if (raw == null || Number.isNaN(raw)) return 0;
  const n = Number(raw);
  return n <= 1 && n >= 0 ? n * 100 : n;
}

function StatStripCell({ label, value, subLabel, subValue, valueTone = "neutral" }) {
  const valueColor =
    valueTone === "positive"
      ? "var(--color-positive)"
      : valueTone === "negative"
        ? "var(--color-negative)"
        : valueTone === "muted"
          ? "var(--color-text-muted)"
          : "var(--color-text-primary)";
  return (
    <div className="ma-stat-strip__cell">
      <div className="ma-stat-strip__label">{label}</div>
      <div className="ma-stat-strip__value ma-num ma-mono" style={{ color: valueColor }}>
        {value}
      </div>
      {subLabel != null && subValue != null && (
        <div className="ma-stat-strip__sub">
          {subLabel}: {subValue}
        </div>
      )}
    </div>
  );
}

function CaptureCard({ label, valueDisplay, rawPct, fillClass }) {
  const n = rawPct != null && Number.isFinite(Number(rawPct)) ? Number(rawPct) : null;
  const w = n == null ? 0 : Math.min(100, Math.max(0, n));
  return (
    <div className="ma-capture-card">
      <div className="ma-capture-card__value ma-num ma-mono" style={{ color: "var(--color-text-primary)" }}>
        {valueDisplay}
      </div>
      <div className="ma-capture-bar">
        <div className={fillClass} style={{ width: `${w}%` }} />
      </div>
      <div className="ma-capture-card__caption">{label}</div>
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
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
      <div style={{ color: "var(--color-text-muted)", marginBottom: 6 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: ${p.value?.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
        </div>
      ))}
    </div>
  );
}

function Select({ value, onChange, options, label, style }) {
  return (
    <div style={{ minWidth: 0, width: "100%", ...style }}>
      {label && <div className="ma-field-label">{label}</div>}
      <select className="ma-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const UNIVERSE_OPTIONS = [
  { id: "sp500_top50", label: "S&P 500 Top 50" },
  { id: "vgt", label: "VGT" },
  { id: "mag7", label: "Mag 7" },
  { id: "russell_growth", label: "Russell Growth" },
  { id: "dividend_aristocrats", label: "Dividend Aristocrats" }
];

const STRATEGY_OPTIONS = [
  { id: "full_composite", label: "Full Composite" },
  { id: "full_composite_aggressive", label: "Composite Aggressive" },
  { id: "full_composite_turbo", label: "Composite Turbo" },
  { id: "quality_momentum", label: "Quality + Momentum" },
  { id: "momentum_value", label: "Momentum + Value" },
  { id: "momentum", label: "Momentum Only" }
];

const TOP_N_OPTIONS = [
  { id: "5", label: "5" },
  { id: "10", label: "10" },
  { id: "15", label: "15" },
  { id: "20", label: "20" }
];

/** Pillar keys for composite adaptive weights (same order as backtest / server FACTOR_NAMES). */
const PILLAR_ORDER = ["fundamental", "dcf", "valuation", "momentum", "value"];
const PILLAR_LABELS = {
  fundamental: "Quality",
  dcf: "DCF",
  valuation: "Valuation",
  momentum: "Momentum",
  value: "Value"
};

function isCompositeStrategy(strategy) {
  return strategy === "full_composite" || strategy === "full_composite_aggressive" || strategy === "full_composite_turbo";
}

function formatWeightPct(raw) {
  if (raw == null || Number.isNaN(raw)) return "—";
  const n = Number(raw);
  const pct = n <= 1 && n >= 0 ? n * 100 : n;
  return `${pct.toFixed(1)}%`;
}

function fmtDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function regimePillVariant(reg) {
  const r = (reg || "").toLowerCase();
  if (/stress|bear|defensive|crash|panic/.test(r)) return "red";
  if (/cautious|elevated|high\s*vol/.test(r)) return "amber";
  return "green";
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

export default function PaperTradeTab() {
  const [portfolio, setPortfolio] = useState(null);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rebalancing, setRebalancing] = useState(false);
  const [error, setError] = useState(null);
  const [expandedRebalance, setExpandedRebalance] = useState(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const [initForm, setInitForm] = useState({
    initialCapital: "100000",
    strategy: "full_composite",
    universe: "sp500_top50",
    topN: "15",
    rlAgent: true,
    rlOnlineLearning: false
  });
  const [paperConfigSaving, setPaperConfigSaving] = useState(false);

  const [autoRebalanced, setAutoRebalanced] = useState(false);
  const [loadBtnHover, setLoadBtnHover] = useState(false);
  const [rebalBtnHover, setRebalBtnHover] = useState(false);
  const paperApi = useAbortableApi();

  useEffect(() => { fetchPortfolio(); }, []);

  useEffect(() => {
    if (!portfolio || autoRebalanced || rebalancing) return;
    const { lastRebalance, holdings, nextRebalance } = portfolio;
    if (holdings.length === 0 && portfolio.rebalanceCount === 0) return;
    if (!lastRebalance || !nextRebalance) return;
    const todayStr = new Date().toISOString().split("T")[0];
    if (todayStr >= nextRebalance) {
      setAutoRebalanced(true);
      rebalance();
    }
  }, [portfolio]);

  const safeJson = async (res) => {
    if (!res.ok) throw new Error(`Server error (${res.status}) — is the backend running?`);
    const text = await res.text();
    try { return JSON.parse(text); } catch { throw new Error("Server returned non-JSON — backend may be down"); }
  };

  const fetchPortfolio = async (showLoader = true) => {
    const ac = paperApi.beginRequest();
    if (showLoader) setLoading(true);
    setError(null);
    try {
      const [pRes, hRes] = await Promise.all([
        fetch("/api/paper-trade/portfolio", { signal: ac.signal }),
        fetch("/api/paper-trade/history", { signal: ac.signal })
      ]);
      const pData = await safeJson(pRes);
      const hData = await safeJson(hRes);
      setPortfolio(pData.portfolio);
      setHistory(hData.history);
    } catch (e) {
      if (!isAbortError(e)) setError(e.message);
    } finally {
      paperApi.clearIfCurrent(ac);
      if (showLoader) setLoading(false);
    }
  };

  const initPortfolio = async () => {
    setLoading(true);
    setError(null);
    const ac = paperApi.beginRequest();
    try {
      const res = await fetch("/api/paper-trade/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          initialCapital: parseFloat(initForm.initialCapital),
          strategy: initForm.strategy,
          universe: initForm.universe,
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
      await fetchPortfolio(true);
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
      const res = await fetch("/api/paper-trade/rebalance", { method: "POST", signal: ac.signal });
      const data = await safeJson(res);
      if (!data.success) {
        setError(data.error);
        paperApi.clearIfCurrent(ac);
        setRebalancing(false);
        return;
      }
      paperApi.clearIfCurrent(ac);
      await fetchPortfolio(false);
    } catch (e) {
      if (!isAbortError(e)) setError(e.message);
      paperApi.clearIfCurrent(ac);
    }
    setRebalancing(false);
  };

  const onRebalanceClick = () => {
    if (rebalancing) {
      paperApi.abortInFlight();
      setRebalancing(false);
      return;
    }
    rebalance();
  };

  const resetPortfolio = async () => {
    setShowResetConfirm(false);
    try {
      await fetch("/api/paper-trade/reset", { method: "DELETE" });
      setPortfolio(null);
      setHistory(null);
    } catch (e) { setError(e.message); }
  };

  const patchPaperConfig = async (updates) => {
    setPaperConfigSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/paper-trade/config", {
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

  if (loading) {
    return (
      <Box style={{ padding: "48px 20px 40px", boxSizing: "border-box" }}>
        <div
          className="ma-mono"
          style={{
            textAlign: "center",
            fontSize: 13,
            color: "var(--color-text-muted)",
            marginBottom: 16
          }}
        >
          Loading paper portfolio...
        </div>
        <div style={{ ...RUN_ACTION_BAR_STYLE, marginTop: 0 }}>
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
      </Box>
    );
  }

  if (!portfolio) {
    return (
      <div>
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
              <div
                style={{
                  gridColumn: "1 / -1",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "16px 24px",
                  alignItems: "center",
                  paddingTop: 4
                }}
              >
                <label
                  className="ma-mono"
                  style={{
                    fontSize: 12,
                    color: "var(--color-text-muted)",
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    cursor: "pointer"
                  }}
                >
                  <input
                    type="checkbox"
                    checked={initForm.rlAgent}
                    onChange={(e) => setInitForm((f) => ({ ...f, rlAgent: e.target.checked }))}
                  />
                  RL agent (when trained model is loaded)
                </label>
                <label
                  className="ma-mono"
                  style={{
                    fontSize: 12,
                    color: "var(--color-text-muted)",
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    cursor: "pointer"
                  }}
                >
                  <input
                    type="checkbox"
                    checked={initForm.rlOnlineLearning}
                    onChange={(e) => setInitForm((f) => ({ ...f, rlOnlineLearning: e.target.checked }))}
                  />
                  RL online learning
                </label>
              </div>
            )}
          </div>
          <div style={RUN_ACTION_BAR_STYLE}>
            <button type="button" className="ma-btn-primary" onClick={initPortfolio}>
              Create Paper Portfolio
            </button>
          </div>
          {error && (
            <div className="ma-mono" style={{ color: "var(--color-negative)", fontSize: 12, marginTop: 10 }}>
              {error}
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
    );
  }

  const {
    summary,
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

  const chartData = (navHistory || []).map(n => ({
    date: n.date,
    Portfolio: n.portfolioValue,
    "S&P 500": n.spyValue
  }));

  const stratLabel = STRATEGY_OPTIONS.find(s => s.id === config.strategy)?.label || config.strategy;
  const uniLabel = UNIVERSE_OPTIONS.find(u => u.id === config.universe)?.label || config.universe;

  const weightBarParts =
    isCompositeStrategy(config.strategy) && activeWeights
      ? PILLAR_ORDER.map((key) => ({
          key,
          pct: weightToPctNumber(activeWeights[key]),
          color: PILLAR_BAR_COLORS[key]
        }))
      : [];
  const weightBarTotal = weightBarParts.reduce((s, x) => s + x.pct, 0) || 1;

  const chartMetaRight = [
    lastRebalance && `Last: ${fmtDate(lastRebalance)}`,
    nextRebalance && `Next: ${fmtDate(nextRebalance)}`
  ]
    .filter(Boolean)
    .join("   ");

  return (
    <div>
      {showResetConfirm && (
        <ConfirmModal
          message="Are you sure? You will lose the results of the current paper trade."
          onConfirm={resetPortfolio}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}

      {rebalancing && autoRebalanced && (
        <Box>
          <div className="ma-mono" style={{ fontSize: 12, color: "var(--color-text-dim)" }}>
            Auto-rebalancing — calendar date reached the next scheduled rebalance (15th-aligned, same rule as backtest). Running the model on live data...
          </div>
        </Box>
      )}

      {error && (
        <Box style={{ background: "var(--color-danger-bg)", borderColor: "var(--color-danger-border)" }}>
          <div className="ma-mono" style={{ color: "var(--color-negative)", fontSize: 12 }}>
            {error}
          </div>
        </Box>
      )}

      <div className="ma-stat-strip">
        <StatStripCell
          label="Total value"
          value={`$${summary.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          valueTone="neutral"
        />
        <StatStripCell
          label="Total return"
          value={`${summary.totalReturn >= 0 ? "+" : ""}${summary.totalReturn.toFixed(1)}%`}
          subLabel="S&P"
          subValue={`${summary.spyReturn >= 0 ? "+" : ""}${summary.spyReturn.toFixed(1)}%`}
          valueTone={summary.totalReturn >= 0 ? "positive" : "negative"}
        />
        <StatStripCell
          label="Alpha"
          value={`${summary.alpha >= 0 ? "+" : ""}${summary.alpha.toFixed(1)}%`}
          valueTone={summary.alpha >= 0 ? "positive" : "negative"}
        />
        <StatStripCell
          label="Cash"
          value={`$${cash.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          valueTone="muted"
        />
        <StatStripCell label="Days active" value={String(summary.daysActive)} valueTone="neutral" />
      </div>

      <div className="ma-capture-grid">
        <CaptureCard
          label="Up capture · SPY-up days · mean port / mean SPY"
          valueDisplay={summary.upCapture != null ? `${summary.upCapture.toFixed(0)}%` : "—"}
          rawPct={summary.upCapture}
          fillClass="ma-capture-bar__fill--up"
        />
        <CaptureCard
          label="Down capture · SPY-down days · mean port / mean SPY"
          valueDisplay={summary.downCapture != null ? `${summary.downCapture.toFixed(0)}%` : "—"}
          rawPct={summary.downCapture}
          fillClass="ma-capture-bar__fill--down"
        />
      </div>

      {summary.rlEnabled && (
        <div className="ma-stat-strip" style={{ marginTop: 4 }}>
          <StatStripCell label="RL agent" value="Active" valueTone="positive" />
          <StatStripCell
            label="RL updates"
            value={(summary.rlAgentUpdates ?? 0).toLocaleString()}
            valueTone="neutral"
          />
          {summary.rlLastAction && (
            <>
              <StatStripCell
                label="RL exposure"
                value={`${((summary.rlLastAction.exposure ?? 0) * 100).toFixed(0)}%`}
                valueTone="neutral"
              />
              <StatStripCell
                label="RL positions"
                value={String(summary.rlLastAction.positionCount ?? "—")}
                valueTone="neutral"
              />
              <StatStripCell
                label="RL sizing"
                value={String(summary.rlLastAction.sizingMethod ?? "—")}
                valueTone="muted"
              />
            </>
          )}
          {summary.rlOnlineLearning && (
            <StatStripCell label="RL online learn" value="On" valueTone="positive" />
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "10px 12px",
          marginBottom: 14
        }}
      >
        <span className="ma-mono" style={{ fontSize: 11, color: "var(--color-text-muted)", marginRight: 4 }}>
          Regime / exposure
        </span>
        <Pill variant={regimePillVariant(summary.currentRegime)}>
          {(summary.currentRegime ?? "—").toString()}
        </Pill>
        <Pill variant="indigo">
          Adj. top N: {summary.adjustedTopN != null ? summary.adjustedTopN : "—"}
        </Pill>
        <Pill variant="indigo">
          Notional: {summary.notionalRegimeExposure != null ? `${summary.notionalRegimeExposure}%` : "—"}
        </Pill>
        <Pill variant="green">
          Cash %: {summary.cashPct != null ? `${summary.cashPct.toFixed(1)}%` : "—"}
        </Pill>
        <Pill variant="amber">
          Spread: {summary.weightSpread != null ? `${summary.weightSpread}×` : "—"}
        </Pill>
        {summary.largestPosition && (
          <span className="ma-ticker-chip ma-mono ma-num">
            {summary.largestPosition.ticker}
            <span>{summary.largestPosition.weight?.toFixed?.(1) ?? summary.largestPosition.weight}%</span>
          </span>
        )}
        {summary.smallestPosition && (
          <span className="ma-ticker-chip ma-mono ma-num">
            {summary.smallestPosition.ticker}
            <span>{summary.smallestPosition.weight?.toFixed?.(1) ?? summary.smallestPosition.weight}%</span>
          </span>
        )}
        {summary.cashDragRough != null && (
          <Pill variant="neutral" title="Rough heuristic: cash % × period SPY return">
            Cash drag: {summary.cashDragRough >= 0 ? "+" : ""}
            {summary.cashDragRough.toFixed(2)} pp
          </Pill>
        )}
      </div>

      {isCompositeStrategy(config.strategy) && activeWeights && (
        <Box>
          <div className="ma-section-title">Adaptive composite weights</div>
          <p
            className="ma-mono"
            style={{
              fontSize: 11,
              color: "var(--color-text-muted)",
              marginBottom: 14,
              lineHeight: 1.5,
              marginTop: 0
            }}
          >
            Current pillar weights used for ranking (backtest-style single-period IC updates from the third rebalance onward, with caps). Same engine as Full Composite backtest.
          </p>
          <div className="ma-weight-bar">
            {weightBarParts.map(({ key, pct, color }) => (
              <div
                key={key}
                className="ma-weight-bar__seg"
                style={{
                  width: `${(pct / weightBarTotal) * 100}%`,
                  background: color
                }}
              />
            ))}
          </div>
          <div className="ma-weight-legend">
            {PILLAR_ORDER.map((key) => (
              <span key={key} className="ma-weight-chip">
                <span className="ma-weight-chip__swatch" style={{ background: PILLAR_BAR_COLORS[key] }} />
                {PILLAR_LABELS[key]}{" "}
                <span style={{ color: "var(--color-text-primary)" }}>{formatWeightPct(activeWeights[key])}</span>
              </span>
            ))}
          </div>
          {weightHistory && weightHistory.length > 0 && (
            <>
              <div className="ma-section-title" style={{ marginTop: 8, marginBottom: 8 }}>
                Recent weight snapshots (last {weightHistory.length})
              </div>
              <div className="ma-table-wrap">
                <table className="ma-table ma-table--zebra ma-table--sticky-head ma-table--compact">
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
                                ? "var(--color-text-muted)"
                                : row.alpha >= 0
                                  ? "var(--color-positive)"
                                  : "var(--color-negative)"
                          }}
                        >
                          {row.alpha != null ? `${row.alpha >= 0 ? "+" : ""}${Number(row.alpha).toFixed(1)}%` : "—"}
                        </td>
                        {PILLAR_ORDER.map((key) => (
                          <td key={key} className="ma-mono ma-num" style={{ color: "var(--color-text-dim)" }}>
                            {row.weights?.[key] != null ? `${Number(row.weights[key]).toFixed(1)}%` : "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Box>
      )}

      <Box>
        <div className="ma-portfolio-head" style={{ gridTemplateColumns: "1fr auto", marginBottom: 8 }}>
          <div className="ma-portfolio-head__title">Portfolio vs S&amp;P 500</div>
          <div className="ma-portfolio-head__actions">
            <button
              type="button"
              className={rebalancing && rebalBtnHover ? "ma-btn-ghost" : rebalancing ? "ma-btn-secondary" : "ma-btn-primary"}
              onClick={onRebalanceClick}
              onMouseEnter={() => setRebalBtnHover(true)}
              onMouseLeave={() => setRebalBtnHover(false)}
              style={rebalancing && !rebalBtnHover ? { opacity: 0.85 } : undefined}
            >
              {rebalancing && rebalBtnHover
                ? "CANCEL"
                : rebalancing
                  ? "Running model..."
                  : "Rebalance Now"}
            </button>
            <button type="button" className="ma-btn-danger-outline" onClick={() => setShowResetConfirm(true)}>
              Reset
            </button>
          </div>
          <div className="ma-portfolio-head__meta ma-mono">
            Since {fmtDate(createdAt)} · {stratLabel} · {uniLabel} · Top {config.topN}
          </div>
          <div className="ma-portfolio-head__meta ma-mono" style={{ textAlign: "right" }}>
            {chartMetaRight}
          </div>
        </div>
        {isCompositeStrategy(config.strategy) && (
          <div
            className="ma-mono"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "12px 20px",
              alignItems: "center",
              marginBottom: 12,
              paddingBottom: 12,
              borderBottom: "1px solid var(--color-border)"
            }}
          >
            <span style={{ fontSize: 11, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              RL agent
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: summary.rlEnabled ? "var(--color-positive)" : "var(--color-text-muted)"
              }}
            >
              {summary.rlEnabled ? "ACTIVE" : "OFF"}
            </span>
            <label
              style={{
                fontSize: 12,
                color: "var(--color-text-dim)",
                display: "flex",
                gap: 8,
                alignItems: "center",
                cursor: paperConfigSaving ? "wait" : "pointer"
              }}
            >
              <input
                type="checkbox"
                disabled={paperConfigSaving || rebalancing}
                checked={config.rlAgent !== false && config.rlAgent !== "false" && config.rlAgent !== "0" && config.rlAgent !== 0}
                onChange={(e) => patchPaperConfig({ rlAgent: e.target.checked })}
              />
              Use on rebalance
            </label>
            <label
              style={{
                fontSize: 12,
                color: "var(--color-text-dim)",
                display: "flex",
                gap: 8,
                alignItems: "center",
                cursor: paperConfigSaving ? "wait" : "pointer"
              }}
            >
              <input
                type="checkbox"
                disabled={paperConfigSaving || rebalancing}
                checked={config.rlOnlineLearning === true || config.rlOnlineLearning === "true" || config.rlOnlineLearning === "1" || config.rlOnlineLearning === 1}
                onChange={(e) => patchPaperConfig({ rlOnlineLearning: e.target.checked })}
              />
              Online Q-update
            </label>
          </div>
        )}
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 28, bottom: 4, left: 4 }}>
              <CartesianGrid stroke="var(--color-chart-grid)" strokeDasharray="4 4" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--color-border)" }}
                tickFormatter={(v) => {
                  const d = new Date(v + "T00:00:00");
                  return `${d.toLocaleString("en-US", { month: "short" })} ${d.getDate()}`;
                }}
                minTickGap={40}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                domain={["dataMin - 500", "dataMax + 500"]}
              />
              <Tooltip content={<ChartTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 8, fontFamily: "var(--font-mono)" }}
                formatter={(val) => (
                  <span
                    style={{
                      color: val === "Portfolio" ? "var(--color-chart-portfolio)" : "var(--color-chart-benchmark)"
                    }}
                  >
                    {val}
                  </span>
                )}
              />
              <Area
                type="monotone"
                dataKey="Portfolio"
                stroke="var(--color-chart-portfolio)"
                fill="var(--color-chart-fill)"
                strokeWidth={2}
                dot={false}
                name="Portfolio"
              />
              <Line
                type="monotone"
                dataKey="S&P 500"
                stroke="var(--color-chart-benchmark)"
                strokeWidth={2}
                dot={false}
                strokeDasharray="5 4"
                name="S&P 500"
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ textAlign: "center", padding: "30px 0" }}>
            <div style={{ display: "flex", justifyContent: "center", gap: 24, marginBottom: 16, flexWrap: "wrap" }}>
              <div style={{ textAlign: "center" }}>
                <div className="ma-field-label" style={{ marginBottom: 6 }}>
                  Your return
                </div>
                <div
                  className="ma-mono ma-num"
                  style={{
                    fontSize: 20,
                    fontWeight: 800,
                    color: summary.totalReturn >= 0 ? "var(--color-positive)" : "var(--color-negative)"
                  }}
                >
                  {summary.totalReturn >= 0 ? "+" : ""}
                  {summary.totalReturn.toFixed(1)}%
                </div>
              </div>
              <div style={{ fontSize: 18, color: "var(--color-text-muted)", fontWeight: 300, alignSelf: "center" }}>
                vs
              </div>
              <div style={{ textAlign: "center" }}>
                <div className="ma-field-label" style={{ marginBottom: 6 }}>
                  S&amp;P 500
                </div>
                <div
                  className="ma-mono ma-num"
                  style={{
                    fontSize: 20,
                    fontWeight: 800,
                    color: summary.spyReturn >= 0 ? "var(--color-chart-benchmark)" : "var(--color-negative)"
                  }}
                >
                  {summary.spyReturn >= 0 ? "+" : ""}
                  {summary.spyReturn.toFixed(1)}%
                </div>
              </div>
              <div style={{ fontSize: 18, color: "var(--color-text-muted)", fontWeight: 300, alignSelf: "center" }}>
                =
              </div>
              <div style={{ textAlign: "center" }}>
                <div className="ma-field-label" style={{ marginBottom: 6 }}>
                  Alpha
                </div>
                <div
                  className="ma-mono ma-num"
                  style={{
                    fontSize: 20,
                    fontWeight: 800,
                    color: summary.alpha >= 0 ? "var(--color-positive)" : "var(--color-negative)"
                  }}
                >
                  {summary.alpha >= 0 ? "+" : ""}
                  {summary.alpha.toFixed(1)}%
                </div>
              </div>
            </div>
            <div className="ma-mono" style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
              Chart appears after 2+ data points (rebalance to begin tracking)
            </div>
          </div>
        )}
      </Box>

      {holdings.length > 0 && (
        <Box>
          <div className="ma-section-title">Current holdings ({holdings.length})</div>
          <div className="ma-table-wrap">
            <table className="ma-table">
              <thead>
                <tr>
                  {["Ticker", "Shares", "Entry", "Current", "Position", "P&L $", "P&L %", "Weight", "Composite"].map((h) => (
                    <th key={h} className={h !== "Ticker" ? "ma-num" : ""}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holdings.sort((a, b) => b.weight - a.weight).map((h) => (
                  <tr key={h.ticker}>
                    <td className="ma-mono" style={{ fontWeight: 600 }}>
                      {h.ticker}
                    </td>
                    <td className="ma-mono ma-num">{h.shares}</td>
                    <td className="ma-mono ma-num">${h.entryPrice.toFixed(2)}</td>
                    <td className="ma-mono ma-num">${h.currentPrice.toFixed(2)}</td>
                    <td className="ma-mono ma-num">
                      ${(h.shares * h.currentPrice).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td
                      className="ma-mono ma-num"
                      style={{ color: h.pnl >= 0 ? "var(--color-positive)" : "var(--color-negative)" }}
                    >
                      {h.pnl >= 0 ? "+" : ""}${h.pnl.toFixed(0)}
                    </td>
                    <td
                      className="ma-mono ma-num"
                      style={{ color: h.pnlPct >= 0 ? "var(--color-positive)" : "var(--color-negative)" }}
                    >
                      {h.pnlPct >= 0 ? "+" : ""}
                      {h.pnlPct.toFixed(1)}%
                    </td>
                    <td className="ma-mono ma-num">{h.weight}%</td>
                    <td className="ma-mono ma-num">{h.scores?.composite?.toFixed(1) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Box>
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
        <Box>
          <div className="ma-section-title" style={{ marginBottom: 10 }}>
            Monthly activity
          </div>
          <p className="ma-mono" style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
            Rebalances and stop exits by month — pairs with the chart above; detail lives in the rebalance log below.
          </p>
          <div
            className="ma-mono"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px 14px",
              color: "var(--color-text-dim)",
              lineHeight: 1.5,
              fontSize: 11
            }}
          >
            {monthlyEventsSummary.slice().reverse().map((row) => (
              <span key={row.month}>
                <strong style={{ color: "var(--color-text-primary)" }}>{row.month}</strong>
                {": "}
                {row.rebalances} rebalance{row.rebalances !== 1 ? "s" : ""}
                {row.stops > 0 ? (
                  <span style={{ color: "var(--color-orange)" }}>
                    {`, ${row.stops} stop exit${row.stops !== 1 ? "s" : ""}`}
                  </span>
                ) : null}
              </span>
            ))}
          </div>
          <div className="ma-mono" style={{ marginTop: 10, color: "var(--color-text-muted)", fontSize: 10, lineHeight: 1.5 }}>
            Stop exits count only sells tagged STOP (rotations use ROTATION). For deeper trade history vs benchmark, use{" "}
            <strong style={{ color: "var(--color-text-dim)" }}>Backtest</strong> → trade log.
          </div>
        </Box>
      )}

      {rebalanceHistory.length > 0 && (
        <Box>
          <div className="ma-section-title">Rebalance log ({rebalanceHistory.length})</div>
          {rebalanceHistory.slice().reverse().map((rb, idx) => {
            const isExpanded = expandedRebalance === idx;
            const chronoIndex = rebalanceHistory.length - 1 - idx;
            const sameDateIndices = rebalanceHistory
              .map((r, i) => (r.date === rb.date ? i : -1))
              .filter((i) => i >= 0);
            const occurrence = sameDateIndices.indexOf(chronoIndex);
            const occParam = sameDateIndices.length > 1 ? `&paperRebalanceOcc=${occurrence}` : "";
            const reportHref = `${window.location.origin}${window.location.pathname}?paperRebalance=${encodeURIComponent(rb.date)}${occParam}`;
            return (
              <div key={`${rb.date}-${chronoIndex}`} style={{ marginBottom: 6 }}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedRebalance(isExpanded ? null : idx)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedRebalance(isExpanded ? null : idx);
                    }
                  }}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 12px",
                    background: "var(--color-bg)",
                    borderRadius: 8,
                    cursor: "pointer",
                    border: "1px solid var(--color-border)",
                    gap: 12,
                    flexWrap: "wrap"
                  }}
                >
                  <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="ma-mono" style={{ fontSize: 12, color: "var(--color-text-primary)", fontWeight: 600 }}>
                      {fmtDate(rb.date)}
                    </span>
                    <span className="ma-mono" style={{ fontSize: 11, color: "var(--color-positive)" }}>
                      +{rb.buys.length} buys
                    </span>
                    <span className="ma-mono" style={{ fontSize: 11, color: "var(--color-negative)" }}>
                      -{rb.sells.length} sells
                    </span>
                    <a
                      href={reportHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="ma-mono"
                      style={{
                        fontSize: 11,
                        color: "var(--color-link)",
                        textDecoration: "underline",
                        cursor: "pointer"
                      }}
                    >
                      Open full report
                    </a>
                  </div>
                  <span className="ma-mono ma-num" style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                    ${rb.portfolioValue?.toLocaleString(undefined, { maximumFractionDigits: 0 })} {isExpanded ? "▲" : "▼"}
                  </span>
                </div>
                {isExpanded && (
                  <div
                    style={{
                      padding: "12px 14px",
                      background: "var(--color-surface-elevated)",
                      borderRadius: "0 0 8px 8px",
                      border: "1px solid var(--color-border)",
                      borderTop: "none"
                    }}
                  >
                    <PaperRebalanceReportBody rb={rb} variant="inline" />
                  </div>
                )}
              </div>
            );
          })}
        </Box>
      )}

      <Box>
        <div className="ma-mono" style={{ fontSize: 12, color: "var(--color-text-dim)", lineHeight: 1.8 }}>
          <strong style={{ color: "var(--color-text-primary)" }}>Forward paper trading</strong> — This tracks live model picks against the S&amp;P 500 with real market data. No real money is involved.
          Fundamental scores use current data (point-in-time approximation). This is the honest out-of-sample test: the model can&apos;t overfit to data it hasn&apos;t seen yet.
        </div>
      </Box>
    </div>
  );
}
