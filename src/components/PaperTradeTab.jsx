import { useState, useEffect } from "react";
import { useAbortableApi, isAbortError } from "../hooks/useAbortableApi.js";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

import { MONO, SANS } from "../lib/theme.js";
import { RUN_ACTION_BAR_STYLE } from "./shared.jsx";
import PaperRebalanceReportBody from "./PaperRebalanceReportBody.jsx";

function Box({ children, style: sx = {} }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 10,
      padding: 16,
      marginBottom: 12,
      ...sx
    }}>
      {children}
    </div>
  );
}

function MetricCard({ label, value, subLabel, subValue, color }) {
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
      <div style={{ fontSize: 22, fontWeight: 800, color: displayColor, fontFamily: MONO }}>{value}</div>
      {subLabel && (
        <div style={{ fontSize: 11, color: "#f0f0f0", marginTop: 4, fontFamily: MONO }}>{subLabel}: {subValue}</div>
      )}
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
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
      {label && <div style={{ fontSize: 10, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>{label}</div>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6,
          padding: "8px 10px",
          color: "#f0f0f0",
          fontSize: 12,
          fontFamily: MONO,
          cursor: "pointer",
          width: "100%",
          minWidth: 0,
          maxWidth: "100%",
          boxSizing: "border-box"
        }}
      >
        {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
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

function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)"
    }}>
      <div style={{
        background: "#14141c", border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 12, padding: "28px 32px", maxWidth: 380, textAlign: "center"
      }}>
        <div style={{ fontSize: 14, color: "#f0f0f0", fontWeight: 600, marginBottom: 20, lineHeight: 1.6 }}>
          {message}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button onClick={onCancel} style={{
            padding: "8px 20px", background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6,
            color: "#f0f0f0", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: MONO
          }}>Cancel</button>
          <button onClick={onConfirm} style={{
            padding: "8px 20px", background: "rgba(239,68,68,0.15)",
            border: "1px solid rgba(239,68,68,0.4)", borderRadius: 6,
            color: "#ef4444", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: MONO
          }}>Reset</button>
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
    topN: "10"
  });

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
          topN: parseInt(initForm.topN)
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

  if (loading) {
    return (
      <Box style={{ padding: "48px 20px 40px", boxSizing: "border-box" }}>
        <div style={{ textAlign: "center", fontSize: 13, color: "#f0f0f0", fontFamily: MONO, marginBottom: 16 }}>
          Loading paper portfolio...
        </div>
        <div style={{ ...RUN_ACTION_BAR_STYLE, marginTop: 0 }}>
          <button
            type="button"
            onClick={() => {
              paperApi.abortInFlight();
              setLoading(false);
            }}
            onMouseEnter={() => setLoadBtnHover(true)}
            onMouseLeave={() => setLoadBtnHover(false)}
            style={{
              padding: "8px 20px",
              flexShrink: 0,
              background: loadBtnHover ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.06)",
              border: loadBtnHover ? "1px solid rgba(239,68,68,0.45)" : "1px solid rgba(255,255,255,0.12)",
              borderRadius: 6,
              color: loadBtnHover ? "#fca5a5" : "#888",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: MONO
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
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#f0f0f0", marginBottom: 12, fontFamily: MONO }}>
            INITIALIZE PAPER PORTFOLIO
          </div>
          <p style={{ fontSize: 13, color: "#f0f0f0", marginBottom: 16, lineHeight: 1.6 }}>
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
              <div style={{ fontSize: 10, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>CAPITAL ($)</div>
              <input
                type="number"
                value={initForm.initialCapital}
                onChange={e => setInitForm(f => ({ ...f, initialCapital: e.target.value }))}
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 6,
                  padding: "8px 10px",
                  color: "#f0f0f0",
                  fontSize: 12,
                  fontFamily: MONO,
                  width: "100%",
                  minWidth: 0,
                  boxSizing: "border-box"
                }}
              />
            </div>
            <Select label="STRATEGY" value={initForm.strategy} onChange={v => setInitForm(f => ({ ...f, strategy: v }))} options={STRATEGY_OPTIONS} />
            <Select label="UNIVERSE" value={initForm.universe} onChange={v => setInitForm(f => ({ ...f, universe: v }))} options={UNIVERSE_OPTIONS} />
            <Select label="TOP N" value={initForm.topN} onChange={v => setInitForm(f => ({ ...f, topN: v }))} options={TOP_N_OPTIONS} />
          </div>
          <div style={RUN_ACTION_BAR_STYLE}>
            <button
              type="button"
              onClick={initPortfolio}
              style={{
                padding: "10px 24px",
                flexShrink: 0,
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 6,
                color: "#f0f0f0",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: MONO
              }}
            >
              Create Paper Portfolio
            </button>
          </div>
          {error && <div style={{ color: "#ef4444", fontSize: 12, marginTop: 10, fontFamily: MONO }}>{error}</div>}
        </Box>

        <Box>
          <div style={{ fontSize: 12, color: "#f0f0f0", fontFamily: MONO, lineHeight: 1.8 }}>
            <strong style={{ color: "#f0f0f0" }}>Why paper trade?</strong> The biggest risk isn't the model — it's overfitting. A backtest always looks better than reality.
            Forward paper trading is the ultimate test: live picks, tracked daily against S&P 500, with zero look-ahead bias.
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
          <div style={{ fontSize: 12, color: "#f0f0f0", fontFamily: MONO }}>
            Auto-rebalancing — calendar date reached the next scheduled rebalance (15th-aligned, same rule as backtest). Running the model on live data...
          </div>
        </Box>
      )}

      {error && (
        <Box style={{ background: "rgba(239,68,68,0.05)", borderColor: "rgba(239,68,68,0.2)" }}>
          <div style={{ color: "#ef4444", fontSize: 12, fontFamily: MONO }}>{error}</div>
        </Box>
      )}

      {/* Metric Cards */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <MetricCard
          label="TOTAL VALUE"
          value={`$${summary.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          color="#f0f0f0"
        />
        <MetricCard
          label="TOTAL RETURN"
          value={`${summary.totalReturn >= 0 ? "+" : ""}${summary.totalReturn.toFixed(1)}%`}
          subLabel="S&P"
          subValue={`${summary.spyReturn >= 0 ? "+" : ""}${summary.spyReturn.toFixed(1)}%`}
        />
        <MetricCard
          label="ALPHA"
          value={`${summary.alpha >= 0 ? "+" : ""}${summary.alpha.toFixed(1)}%`}
        />
        <MetricCard
          label="CASH"
          value={`$${cash.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          color="#888"
        />
        <MetricCard
          label="DAYS ACTIVE"
          value={summary.daysActive}
          color="#f0f0f0"
        />
      </div>

      {isCompositeStrategy(config.strategy) && activeWeights && (
        <Box>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#f0f0f0", marginBottom: 8, fontFamily: MONO }}>
            ADAPTIVE COMPOSITE WEIGHTS
          </div>
          <div style={{ fontSize: 10, color: "#888", fontFamily: MONO, marginBottom: 12, lineHeight: 1.5 }}>
            Current pillar weights used for ranking (backtest-style single-period IC updates from the third rebalance onward, with caps). Same engine as Full Composite backtest.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginBottom: weightHistory?.length ? 14 : 0 }}>
            {PILLAR_ORDER.map((key) => (
              <div key={key} style={{ minWidth: 100 }}>
                <div style={{ fontSize: 9, color: "#888", fontFamily: MONO, letterSpacing: 0.5 }}>{PILLAR_LABELS[key]}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#f0f0f0", fontFamily: MONO }}>{formatWeightPct(activeWeights[key])}</div>
              </div>
            ))}
          </div>
          {weightHistory && weightHistory.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 8, fontFamily: MONO }}>
                RECENT WEIGHT SNAPSHOTS (LAST {weightHistory.length})
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: MONO }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                      <th style={{ textAlign: "left", padding: "6px 8px", color: "#888" }}>Date</th>
                      <th style={{ textAlign: "left", padding: "6px 8px", color: "#888" }}>Alpha</th>
                      {PILLAR_ORDER.map((key) => (
                        <th key={key} style={{ textAlign: "right", padding: "6px 6px", color: "#888", whiteSpace: "nowrap" }}>{PILLAR_LABELS[key]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {weightHistory.slice().reverse().map((row) => (
                      <tr key={row.date} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <td style={{ padding: "6px 8px", color: "#f0f0f0" }}>{fmtDate(row.date)}</td>
                        <td style={{ padding: "6px 8px", color: row.alpha >= 0 ? "#22c55e" : "#ef4444" }}>
                          {row.alpha != null ? `${row.alpha >= 0 ? "+" : ""}${Number(row.alpha).toFixed(1)}%` : "—"}
                        </td>
                        {PILLAR_ORDER.map((key) => (
                          <td key={key} style={{ textAlign: "right", padding: "6px 6px", color: "#c8c8c8" }}>
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

      {/* S&P 500 Comparison */}
      <Box>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", rowGap: 4, columnGap: 16, alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#f0f0f0", fontFamily: MONO }}>
            PORTFOLIO vs S&P 500
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onRebalanceClick}
              onMouseEnter={() => setRebalBtnHover(true)}
              onMouseLeave={() => setRebalBtnHover(false)}
              style={{
                padding: "6px 14px",
                background:
                  rebalancing && rebalBtnHover
                    ? "rgba(239,68,68,0.15)"
                    : rebalancing
                      ? "rgba(255,255,255,0.04)"
                      : "rgba(255,255,255,0.08)",
                border:
                  rebalancing && rebalBtnHover
                    ? "1px solid rgba(239,68,68,0.45)"
                    : "1px solid rgba(255,255,255,0.12)",
                borderRadius: 5,
                color: rebalancing && rebalBtnHover ? "#fca5a5" : rebalancing ? "#888" : "#f0f0f0",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: MONO
              }}
            >
              {rebalancing && rebalBtnHover
                ? "CANCEL"
                : rebalancing
                  ? "Running model..."
                  : "Rebalance Now"}
            </button>
            <button onClick={() => setShowResetConfirm(true)} style={{
              padding: "6px 14px",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 5,
              color: "#ef4444",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: MONO
            }}>
              Reset
            </button>
          </div>
          <div style={{ fontSize: 10, color: "#f0f0f0", fontFamily: MONO, opacity: 0.7 }}>
            Since {fmtDate(createdAt)}&nbsp;&nbsp;{stratLabel}&nbsp;&nbsp;{uniLabel}&nbsp;&nbsp;Top {config.topN}
          </div>
          <div style={{ fontSize: 10, color: "#f0f0f0", fontFamily: MONO, opacity: 0.7, textAlign: "right" }}>
            {lastRebalance && <>Last: {fmtDate(lastRebalance)}</>}
            {nextRebalance && <>&nbsp;&nbsp;Next: {fmtDate(nextRebalance)}</>}
          </div>
        </div>
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 5, right: 30, bottom: 5, left: 5 }}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#f0f0f0", fontFamily: MONO }}
                tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.05)" }}
                tickFormatter={(v) => {
                  const d = new Date(v + "T00:00:00");
                  return `${d.toLocaleString("en-US", { month: "short" })} ${d.getDate()}`;
                }}
                minTickGap={40}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#f0f0f0", fontFamily: MONO }}
                tickLine={false}
                axisLine={false}
                tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                domain={["dataMin - 500", "dataMax + 500"]}
              />
              <Tooltip content={<ChartTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 11, fontFamily: MONO, paddingTop: 8 }}
                formatter={(val) => <span style={{ color: val === "Portfolio" ? "#f0f0f0" : "#f59e0b" }}>{val}</span>}
              />
              <Line type="monotone" dataKey="Portfolio" stroke="#f0f0f0" strokeWidth={2.5} dot={false} name="Portfolio" />
              <Line type="monotone" dataKey="S&P 500" stroke="#f59e0b" strokeWidth={2} dot={false} strokeDasharray="6 3" name="S&P 500" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ textAlign: "center", padding: "30px 0" }}>
            <div style={{ display: "flex", justifyContent: "center", gap: 24, marginBottom: 16 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>YOUR RETURN</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: summary.totalReturn >= 0 ? "#22c55e" : "#ef4444", fontFamily: MONO }}>
                  {summary.totalReturn >= 0 ? "+" : ""}{summary.totalReturn.toFixed(1)}%
                </div>
              </div>
              <div style={{ fontSize: 18, color: "#f0f0f0", fontWeight: 300, alignSelf: "center" }}>vs</div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>S&P 500</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: summary.spyReturn >= 0 ? "#f59e0b" : "#ef4444", fontFamily: MONO }}>
                  {summary.spyReturn >= 0 ? "+" : ""}{summary.spyReturn.toFixed(1)}%
                </div>
              </div>
              <div style={{ fontSize: 18, color: "#f0f0f0", fontWeight: 300, alignSelf: "center" }}>=</div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>ALPHA</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: summary.alpha >= 0 ? "#22c55e" : "#ef4444", fontFamily: MONO }}>
                  {summary.alpha >= 0 ? "+" : ""}{summary.alpha.toFixed(1)}%
                </div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO }}>
              Chart appears after 2+ data points (rebalance to begin tracking)
            </div>
          </div>
        )}
      </Box>

      {/* Holdings Table */}
      {holdings.length > 0 && (
        <Box>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#f0f0f0", marginBottom: 12, fontFamily: MONO }}>
            CURRENT HOLDINGS ({holdings.length})
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: MONO }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  {["Ticker", "Shares", "Entry", "Current", "Position", "P&L $", "P&L %", "Weight", "Composite"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: "#f0f0f0", fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holdings.sort((a, b) => b.weight - a.weight).map(h => (
                  <tr key={h.ticker} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                    <td style={{ padding: "8px", color: "#f0f0f0", fontWeight: 600 }}>{h.ticker}</td>
                    <td style={{ padding: "8px", color: "#f0f0f0" }}>{h.shares}</td>
                    <td style={{ padding: "8px", color: "#f0f0f0" }}>${h.entryPrice.toFixed(2)}</td>
                    <td style={{ padding: "8px", color: "#f0f0f0" }}>${h.currentPrice.toFixed(2)}</td>
                    <td style={{ padding: "8px", color: "#f0f0f0", fontWeight: 600 }}>${(h.shares * h.currentPrice).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td style={{ padding: "8px", color: h.pnl >= 0 ? "#22c55e" : "#ef4444" }}>
                      {h.pnl >= 0 ? "+" : ""}${h.pnl.toFixed(0)}
                    </td>
                    <td style={{ padding: "8px", color: h.pnlPct >= 0 ? "#22c55e" : "#ef4444" }}>
                      {h.pnlPct >= 0 ? "+" : ""}{h.pnlPct.toFixed(1)}%
                    </td>
                    <td style={{ padding: "8px", color: "#f0f0f0" }}>{h.weight}%</td>
                    <td style={{ padding: "8px", color: "#f0f0f0" }}>{h.scores?.composite?.toFixed(1) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Box>
      )}

      {holdings.length === 0 && portfolio.rebalanceCount === 0 && (
        <Box style={{ textAlign: "center", padding: 30 }}>
          <div style={{ fontSize: 14, color: "#f0f0f0", marginBottom: 8 }}>No holdings yet</div>
          <div style={{ fontSize: 12, color: "#f0f0f0", fontFamily: MONO }}>
            Click "Rebalance Now" to run the model and make initial picks.
          </div>
        </Box>
      )}

      {monthlyEventsSummary && monthlyEventsSummary.length > 0 && (
        <Box>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#f0f0f0", marginBottom: 10, fontFamily: MONO }}>
            MONTHLY ACTIVITY
          </div>
          <div style={{ fontSize: 10, color: "#888", fontFamily: MONO, marginBottom: 10, lineHeight: 1.5 }}>
            Rebalances and stop exits by month — pairs with the chart above; detail lives in the rebalance log below.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", color: "#c8c8c8", lineHeight: 1.5, fontFamily: MONO, fontSize: 10 }}>
            {monthlyEventsSummary.slice().reverse().map((row) => (
              <span key={row.month}>
                <strong style={{ color: "#f0f0f0" }}>{row.month}</strong>
                {": "}
                {row.rebalances} rebalance{row.rebalances !== 1 ? "s" : ""}
                {row.stops > 0 ? (
                  <span style={{ color: "#f97316" }}>{`, ${row.stops} stop exit${row.stops !== 1 ? "s" : ""}`}</span>
                ) : null}
              </span>
            ))}
          </div>
          <div style={{ marginTop: 10, color: "#888", fontSize: 9, lineHeight: 1.5, fontFamily: MONO }}>
            Stop exits count only sells tagged STOP (rotations use ROTATION). For deeper trade history vs benchmark, use{" "}
            <strong style={{ color: "#c8c8c8" }}>Backtest</strong> → trade log.
          </div>
        </Box>
      )}

      {/* Rebalance Log */}
      {rebalanceHistory.length > 0 && (
        <Box>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#f0f0f0", marginBottom: 12, fontFamily: MONO }}>
            REBALANCE LOG ({rebalanceHistory.length})
          </div>
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
                  onClick={() => setExpandedRebalance(isExpanded ? null : idx)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 10px",
                    background: "rgba(255,255,255,0.02)",
                    borderRadius: 6,
                    cursor: "pointer",
                    border: "1px solid rgba(255,255,255,0.04)",
                    gap: 12,
                    flexWrap: "wrap"
                  }}
                >
                  <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "#f0f0f0", fontFamily: MONO, fontWeight: 600 }}>{fmtDate(rb.date)}</span>
                    <span style={{ fontSize: 11, color: "#22c55e", fontFamily: MONO }}>
                      +{rb.buys.length} buys
                    </span>
                    <span style={{ fontSize: 11, color: "#ef4444", fontFamily: MONO }}>
                      -{rb.sells.length} sells
                    </span>
                    <a
                      href={reportHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        fontSize: 11,
                        color: "#818cf8",
                        fontFamily: MONO,
                        textDecoration: "underline",
                        cursor: "pointer"
                      }}
                    >
                      Open full report
                    </a>
                  </div>
                  <span style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO }}>
                    ${rb.portfolioValue?.toLocaleString(undefined, { maximumFractionDigits: 0 })} {isExpanded ? "▲" : "▼"}
                  </span>
                </div>
                {isExpanded && (
                  <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.01)", borderRadius: "0 0 6px 6px" }}>
                    <PaperRebalanceReportBody rb={rb} variant="inline" />
                  </div>
                )}
              </div>
            );
          })}
        </Box>
      )}

      {/* Disclaimer */}
      <Box>
        <div style={{ fontSize: 12, color: "#f0f0f0", fontFamily: MONO, lineHeight: 1.8 }}>
          <strong style={{ color: "#f0f0f0" }}>Forward Paper Trading</strong> — This tracks live model picks against the S&P 500 with real market data. No real money is involved.
          Fundamental scores use current data (point-in-time approximation). This is the honest out-of-sample test: the model can't overfit to data it hasn't seen yet.
        </div>
      </Box>
    </div>
  );
}
