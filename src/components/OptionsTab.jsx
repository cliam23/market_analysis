import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch, safeJson } from "../lib/api.js";
import { MONO, SANS, TEXT, GREEN, RED, AMBER, BORDER_LIGHT } from "../lib/theme.js";
import { fmtMoney as _fmtMoney, fmtPctSigned as fmtPct } from "../lib/formatters.js";

const fmtMoney = (n) => _fmtMoney(n, 2);

const PLAIN_ENGLISH = {
  COVERED_CALL: "Covered Call",
  CASH_SECURED_PUT: "Cash-Secured Put",
  REGIME_HEDGE: "Hedge (Protective Put)",

  COVERED_CALL_desc:
    "You own the stock and sell someone the right to buy it from you at the strike price. " +
    "You collect the premium upfront. Best when the stock stays flat or rises slightly.",
  CASH_SECURED_PUT_desc:
    "You sell someone the right to sell you the stock at the strike price. " +
    "You collect premium and agree to buy the shares if they fall that far. " +
    "Good way to get paid to wait to buy a stock you want anyway.",
  REGIME_HEDGE_desc:
    "You buy the right to sell the market at the strike price. " +
    "Acts as insurance — costs a small premium, pays out if the market drops hard.",

  delta: "Price sensitivity",
  theta: "Daily time decay ($ lost per day from time)",
  iv: "Implied volatility (option market's expected move)",
  ivRank: "IV Rank — how expensive the option is vs its own history (0–100)",
  dte: "Days until expiration",
  premium: "Premium collected (per share)",
  strike: "Strike price",
  bid: "Buyer's price",
  ask: "Seller's price",
  mid: "Fair value (midpoint between bid and ask)",
  volume: "Contracts traded today",
  openInt: "Open interest (total active contracts)",

  delta_explain:
    "How much the option price moves for every $1 move in the stock. " +
    "0.25 means the option gains $0.25 when the stock rises $1.",
  theta_explain:
    "Options lose value every day just from the passage of time. " +
    "This is the daily dollar cost of holding the option.",
  ivRank_explain:
    "If IV Rank is 80, the option is more expensive than 80% of the time over the past year. " +
    "High IV Rank = good time to SELL options (collect more premium).",
  ev_explain:
    "Expected Value: the average dollar outcome if you made this exact trade 1,000 times. " +
    "Positive EV = edge in your favor over time. This is a rough estimate based on delta."
};

const STRATEGY = {
  COVERED_CALL: { label: "COVERED CALL", shortLabel: "COVERED CALL" },
  CASH_SECURED_PUT: { label: "CASH-SECURED PUT", shortLabel: "CASH-SECURED PUT" },
  REGIME_HEDGE: { label: "REGIME HEDGE", shortLabel: "REGIME HEDGE" }
};

function OpportunityCard({ opp, onOpen }) {
  const stratColor =
    {
      COVERED_CALL: "#0EA5E9",
      CASH_SECURED_PUT: "#8B5CF6",
      REGIME_HEDGE: "#EF4444"
    }[opp.strategy] ?? "#64748B";

  const cp = opp.currentPrice != null ? Number(opp.currentPrice) : null;
  const strike = opp.strike != null ? Number(opp.strike) : null;
  const premPerShare = Number(opp.premium ?? opp.mid ?? 0);

  const evNum = Number(opp.ev);
  const evOk = Number.isFinite(evNum);
  const evColor = evOk && evNum > 0 ? "#22C55E" : "#EF4444";
  const evSign = evOk && evNum > 0 ? "+" : "";

  return (
    <div
      style={{
        background: "#1E293B",
        borderRadius: 10,
        border: "1px solid #334155",
        marginBottom: 12,
        overflow: "hidden"
      }}
    >
      <div
        style={{
          background: stratColor,
          padding: "8px 14px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}
      >
        <div>
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>{opp.ticker}</span>
          <span
            style={{
              marginLeft: 10,
              background: "rgba(255,255,255,0.2)",
              padding: "2px 8px",
              borderRadius: 99,
              color: "#fff",
              fontSize: 11
            }}
          >
            {PLAIN_ENGLISH[opp.strategy] ?? opp.strategy}
          </span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>
            ${cp != null && Number.isFinite(cp) ? cp.toFixed(2) : "—"}
          </div>
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 10 }}>Current price</div>
        </div>
      </div>

      <div
        style={{
          padding: "10px 14px 6px",
          color: "#94A3B8",
          fontSize: 11,
          lineHeight: 1.5,
          borderBottom: "1px solid #334155"
        }}
      >
        {PLAIN_ENGLISH[opp.strategy + "_desc"] ?? ""}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, background: "#334155" }}>
        {[
          {
            label: "Strike price",
            value: strike != null && Number.isFinite(strike) ? `$${strike.toFixed(2)}` : "—",
            sub:
              strike != null && cp != null && Number.isFinite(strike) && Number.isFinite(cp) && cp > 0
                ? `${((strike / cp - 1) * 100).toFixed(1)}% from current`
                : null
          },
          {
            label: `${PLAIN_ENGLISH.premium} (per share)`,
            value: `$${Number.isFinite(premPerShare) ? premPerShare.toFixed(2) : "0.00"}`,
            sub: `$${(Number.isFinite(premPerShare) ? premPerShare * 100 : 0).toFixed(0)} per contract`
          },
          {
            label: PLAIN_ENGLISH.dte,
            value: opp.dte != null ? `${opp.dte} days` : "—",
            sub: opp.expiration ?? null
          },
          {
            label: `${PLAIN_ENGLISH.delta} (Δ)`,
            value: opp.delta != null ? Number(opp.delta).toFixed(2) : "—",
            sub: PLAIN_ENGLISH.delta_explain,
            subSmall: true
          },
          {
            label: `${PLAIN_ENGLISH.ivRank} (IVR)`,
            value: opp.ivRank != null ? `${Number(opp.ivRank).toFixed(0)}%` : "—",
            sub: Number(opp.ivRank) > 50 ? "✓ Good time to sell (high IV)" : "IV below average — lower premium",
            subColor: Number(opp.ivRank) > 50 ? "#22C55E" : "#F59E0B"
          },
          {
            label: "Expected Value (EV)",
            value: evOk ? `${evSign}$${Math.abs(evNum).toFixed(0)}` : "—",
            valueColor: evOk ? evColor : "#E2E8F0",
            sub: PLAIN_ENGLISH.ev_explain,
            subSmall: true
          }
        ].map(({ label, value, valueColor, sub, subColor, subSmall }, i) => (
          <div key={i} style={{ background: "#1E293B", padding: "10px 12px" }}>
            <div style={{ color: "#64748B", fontSize: 10, marginBottom: 3 }}>{label}</div>
            <div
              style={{
                color: valueColor ?? "#E2E8F0",
                fontWeight: 700,
                fontSize: 15,
                fontFamily: "monospace"
              }}
            >
              {value}
            </div>
            {sub && (
              <div
                style={{
                  color: subColor ?? "#64748B",
                  fontSize: subSmall ? 9 : 10,
                  marginTop: 2,
                  lineHeight: 1.3
                }}
              >
                {sub}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 0, borderTop: "1px solid #334155" }}>
        {[
          { label: "Bid (buyer's price)", value: opp.bid, color: "#EF4444" },
          { label: "Mid (fair value)", value: opp.mid ?? opp.premium, color: "#E2E8F0" },
          { label: "Ask (seller's price)", value: opp.ask, color: "#22C55E" }
        ].map(({ label, value, color }, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              padding: "8px 12px",
              textAlign: "center",
              borderRight: i < 2 ? "1px solid #334155" : "none"
            }}
          >
            <div style={{ color: "#64748B", fontSize: 9 }}>{label}</div>
            <div style={{ color, fontWeight: 600, fontSize: 13, fontFamily: "monospace" }}>
              ${value != null && Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "—"}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          padding: "10px 14px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: "1px solid #334155"
        }}
      >
        <div style={{ color: "#64748B", fontSize: 10 }}>
          Score:{" "}
          <span style={{ color: "#E2E8F0", fontWeight: 600 }}>
            {opp.compositeScore?.toFixed?.(0) ?? (opp.compositeScore != null ? String(opp.compositeScore) : "—")}
          </span>
          {opp.regime && (
            <span style={{ marginLeft: 10 }}>
              Regime: <span style={{ color: "#F59E0B" }}>{opp.regime}</span>
            </span>
          )}
        </div>
        <button
          onClick={() => onOpen(opp)}
          style={{
            background: stratColor,
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "6px 16px",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 12
          }}
        >
          Open Trade →
        </button>
      </div>
    </div>
  );
}

function oppKey(o) {
  if (!o) return "";
  return `${o.strategy}-${o.ticker}-${o.expiration}-${o.strike}`;
}

function fmtExpiry(iso) {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric" });
}

function fmtIv(iv) {
  if (iv == null || Number.isNaN(Number(iv))) return "—";
  const x = Number(iv);
  const pct = x <= 2 ? x * 100 : x;
  return `${pct.toFixed(0)}%`;
}

function formatScanAgo(ts) {
  if (ts == null) return "just now";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function regimeParts(regime) {
  const r = String(regime || "normal").toLowerCase();
  if (r === "strong_bull") {
    return {
      pill: "STRONG BULL",
      pillClass: "ma-opt-regime-pill--green",
      desc: "Premium selling conditions are favorable."
    };
  }
  if (r === "bear") {
    return {
      pill: "BEAR",
      pillClass: "ma-opt-regime-pill--red",
      desc: "Bear regime — hedge candidates surfaced when applicable."
    };
  }
  if (r === "caution" || r === "pullback") {
    return {
      pill: r === "pullback" ? "PULLBACK" : "CAUTION",
      pillClass: "ma-opt-regime-pill--yellow",
      desc: "Elevated caution — selective premium selling; review hedges."
    };
  }
  return {
    pill: "NORMAL",
    pillClass: "ma-opt-regime-pill--green",
    desc: "Selective premium selling."
  };
}

function scorePillClass(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "ma-opt-score-pill--lo";
  if (n >= 80) return "ma-opt-score-pill--hi";
  if (n >= 60) return "ma-opt-score-pill--mid";
  return "ma-opt-score-pill--lo";
}

function yieldToneClass(y) {
  const n = Number(y);
  if (!Number.isFinite(n)) return "ma-opt-yield--lo";
  if (n > 25) return "ma-opt-yield--hi";
  if (n >= 15) return "ma-opt-yield--mid";
  return "ma-opt-yield--lo";
}

function stratBadgeClass(strat) {
  if (strat === "COVERED_CALL") return "ma-opt-strat-badge ma-opt-strat-badge--cc";
  if (strat === "CASH_SECURED_PUT") return "ma-opt-strat-badge ma-opt-strat-badge--csp";
  return "ma-opt-strat-badge ma-opt-strat-badge--hedge";
}

function reasonBadgeClass(reason) {
  const s = String(reason || "manual").toLowerCase();
  if (s.includes("profit") || s.includes("50")) return "ma-opt-reason-badge ma-opt-reason-badge--profit";
  if (s.includes("roll") || s.includes("dte")) return "ma-opt-reason-badge ma-opt-reason-badge--roll";
  return "ma-opt-reason-badge ma-opt-reason-badge--manual";
}

function computeStreak(closed) {
  if (!closed?.length) return null;
  const sorted = [...closed].sort((a, b) => String(b.closeDate).localeCompare(String(a.closeDate)));
  const firstWin = Number(sorted[0].pnl) > 0;
  let n = 0;
  for (const p of sorted) {
    const w = Number(p.pnl) > 0;
    if (w === firstWin) n++;
    else break;
  }
  return { wins: firstWin, count: n };
}

function AutoTraderPanel({ scanRegime }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [portfolio, setPortfolio] = useState(null);

  const fetchPortfolio = useCallback(async () => {
    try {
      const res = await apiFetch("/api/options/auto-trader/portfolio");
      const j = await safeJson(res);
      if (!j.success) throw new Error(j.error || "Auto portfolio failed");
      setPortfolio(j.portfolio);
    } catch (e) {
      setError(e.message || String(e));
    }
  }, []);

  useEffect(() => {
    fetchPortfolio();
  }, [fetchPortfolio]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await apiFetch("/api/options/auto-trader/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regime: scanRegime, includeManual: true })
      });
      const j = await safeJson(res);
      if (!j.success && j.mode !== "mock") throw new Error(j.error || "Auto trader run failed");
      setStatus(j);
      await fetchPortfolio();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setRunning(false);
    }
  }, [fetchPortfolio, scanRegime]);

  const panelStyle = {
    background: "#0D1B2A",
    border: "1px solid #1E3A5F",
    borderRadius: 12,
    padding: 18,
    marginTop: 28
  };

  const pf = portfolio || {};
  const stats = pf.stats || {};
  const positions = Array.isArray(pf.positions) ? pf.positions : [];
  const closed = Array.isArray(pf.closedTrades) ? pf.closedTrades : [];
  const autoOpenPnl = useMemo(() => {
    if (!positions.length) return 0;
    return positions.reduce((s, p) => s + (Number(p.currentPnL) || 0), 0);
  }, [positions]);

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <div style={{ color: "#E2E8F0", fontWeight: 800, fontSize: 15 }}>Auto Trader</div>
            <span style={{ fontSize: 10, background: "#0EA5E9", color: "#fff", padding: "2px 8px", borderRadius: 999 }}>
              SANDBOX
            </span>
          </div>
          <div style={{ color: "#64748B", fontSize: 11, lineHeight: 1.5, maxWidth: 760 }}>
            Uses Tradier sandbox when <span className="ma-mono">TRADIER_SANDBOX_TOKEN</span> is set. Opens the highest
            positive-EV short-premium trades and auto-manages: 50% profit close + 21-DTE close. Dry-run if token is missing.
          </div>
          <div className="ma-mono" style={{ marginTop: 10, fontSize: 11, color: "#94A3B8", lineHeight: 1.7 }}>
            Open {positions.length} · Open P&amp;L {fmtMoney(autoOpenPnl)} · Realized P&amp;L {fmtMoney(Number(stats.totalPnl) || 0)} ·
            Closed {closed.length}
          </div>
        </div>
        <button
          type="button"
          onClick={handleRun}
          disabled={running}
          style={{
            background: running ? "#334155" : "#0EA5E9",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "10px 18px",
            cursor: running ? "not-allowed" : "pointer",
            fontWeight: 800,
            fontSize: 12,
            whiteSpace: "nowrap"
          }}
        >
          {running ? "Running…" : "Run Auto Trader"}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 12, background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.35)", color: "#FCA5A5", padding: "10px 12px", borderRadius: 10, fontSize: 12 }}>
          {error}
        </div>
      )}

      {status && (
        <div style={{ marginTop: 14, background: "#162033", border: "1px solid #1E3A5F", borderRadius: 10, padding: "12px 12px" }}>
          <div style={{ color: "#94A3B8", fontSize: 11, marginBottom: 10 }}>
            Last run: {status.mode === "mock" ? "DRY RUN (no token)" : "SANDBOX"} · Regime: {status.regime ?? "—"}
          </div>
          {status.mode === "mock" && status.dryRun && (
            <div style={{ color: "#E2E8F0", fontSize: 12 }}>
              Would open {status.dryRun.wouldOpen?.length ?? 0} trade(s).
            </div>
          )}
          {status.actions && (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12 }}>
              <div style={{ color: "#22C55E" }}>Opened: {status.actions.opened?.length ?? 0}</div>
              <div style={{ color: "#F59E0B" }}>Closed: {status.actions.closed?.length ?? 0}</div>
              <div style={{ color: "#EF4444" }}>Errors: {status.actions.errors?.length ?? 0}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OptionsBacktest() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState("3y");
  const [error, setError] = useState(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/options/backtest?period=${encodeURIComponent(period)}&universe=sp500_top50&topN=5`);
      const j = await safeJson(res);
      if (!j.success) throw new Error(j.error || "Backtest failed");
      setResult(j);
    } catch (e) {
      setError(e.message || String(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [period]);

  return (
    <div style={{ background: "#1E293B", borderRadius: 10, padding: 16, marginTop: 14, border: "1px solid #334155" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14, color: "#E2E8F0" }}>Options Strategy Backtest</div>
          <div style={{ color: "#64748B", fontSize: 11, marginTop: 2, lineHeight: 1.5 }}>
            Simplified simulation of selling covered calls + cash-secured puts on top-scored names.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {["1y", "2y", "3y"].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              style={{
                background: period === p ? "#0EA5E9" : "#334155",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "4px 12px",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700
              }}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            onClick={run}
            disabled={loading}
            style={{
              background: loading ? "#334155" : "#22C55E",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "6px 16px",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 800,
              fontSize: 12
            }}
          >
            {loading ? "Running..." : "Run Backtest"}
          </button>
        </div>
      </div>

      {error && <div style={{ marginTop: 10, color: RED, fontSize: 12 }}>{error}</div>}

      {result && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8, marginTop: 12 }}>
            {[
              { label: "Equity only", value: `${result.performance.equityOnlyReturnPct.toFixed(2)}%`, color: "#94A3B8" },
              { label: "Premium collected", value: fmtMoney(result.performance.totalPremiumCollected), color: "#22C55E" },
              { label: "Premium yield/yr", value: `${result.performance.annualizedPremiumYieldPct.toFixed(2)}%`, color: "#0EA5E9" },
              { label: "Enhanced return", value: `${result.performance.enhancedReturnPct.toFixed(2)}%`, color: "#22C55E" },
              { label: "Options lift", value: `${result.performance.liftFromOptionsPct.toFixed(2)}%`, color: "#F59E0B" }
            ].map((x) => (
              <div key={x.label} style={{ background: "#162033", border: "1px solid #1E3A5F", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ color: "#64748B", fontSize: 10 }}>{x.label}</div>
                <div style={{ color: x.color, fontWeight: 800, fontSize: 16, fontFamily: "monospace" }}>{x.value}</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 10, background: "#0D1B2A", borderRadius: 8, padding: "10px 12px", color: "#94A3B8", fontSize: 11, lineHeight: 1.5 }}>
            {result.interpretation?.whatThisMeans ?? "—"}
          </div>

          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 64, minWidth: 640 }}>
              {result.monthlyPnl.map((m, i) => {
                const maxVal = Math.max(1, ...result.monthlyPnl.map((x) => Number(x.totalPnl) || 0));
                const h = Math.max(4, ((Number(m.totalPnl) || 0) / maxVal) * 60);
                const color = m.regime === "bear" ? "#334155" : Number(m.totalPnl) >= 0 ? "#22C55E" : "#EF4444";
                return (
                  <div
                    key={i}
                    title={`${m.date}: $${Number(m.totalPnl).toFixed(0)} (${m.regime})`}
                    style={{ flex: 1, background: color, height: h, borderRadius: "2px 2px 0 0", minWidth: 4 }}
                  />
                );
              })}
            </div>
            <div style={{ color: "#64748B", fontSize: 10, marginTop: 6 }}>
              Monthly premium estimate (green=positive, gray=bear/no trades).
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function OptionsTab({ visible = true }) {
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [scan, setScan] = useState(null);
  const [lastScanAt, setLastScanAt] = useState(null);

  const [pfLoading, setPfLoading] = useState(false);
  const [portfolioWrap, setPortfolioWrap] = useState(null);
  const [autoPf, setAutoPf] = useState(null);
  const [autoPfError, setAutoPfError] = useState(null);
  const hasFetchedRef = useRef(false);

  const [flash, setFlash] = useState(null);
  const [openModal, setOpenModal] = useState(null);
  const [openQty, setOpenQty] = useState(1);
  const [openSubmitting, setOpenSubmitting] = useState(false);
  const [openingKey, setOpeningKey] = useState("");

  const [closeModal, setCloseModal] = useState(null);
  const [closePremium, setClosePremium] = useState("");
  const [closeReason, setCloseReason] = useState("manual");
  const [closeSubmitting, setCloseSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [strategyFilter, setStrategyFilter] = useState("all");
  const [sortBy, setSortBy] = useState("ev");

  const fetchScan = useCallback(async () => {
    setScanLoading(true);
    setScanError(null);
    try {
      const res = await apiFetch("/api/options/scan");
      const j = await res.json();
      if (!j.success) throw new Error(j.error || "Scan failed");
      setScan(j);
      setLastScanAt(Date.now());
    } catch (e) {
      setScanError(e.message || String(e));
      setScan(null);
    } finally {
      setScanLoading(false);
    }
  }, []);

  const fetchPortfolio = useCallback(async (opts) => {
    const quiet = opts?.quiet === true;
    if (!quiet) setPfLoading(true);
    try {
      const res = await apiFetch("/api/options/paper/portfolio");
      const j = await safeJson(res);
      if (!j.success) throw new Error(j.error || "Portfolio failed");
      setPortfolioWrap(j.portfolio);
    } catch (e) {
      console.error("[OPTIONS] portfolio GET failed:", e);
      // Do not clear portfolio on refresh failure — would hide open positions after a successful POST.
    } finally {
      if (!quiet) setPfLoading(false);
    }
  }, []);

  const fetchAutoPortfolio = useCallback(async () => {
    try {
      setAutoPfError(null);
      const res = await apiFetch("/api/options/auto-trader/portfolio");
      const j = await safeJson(res);
      if (!j.success) throw new Error(j.error || "Auto portfolio failed");
      setAutoPf(j.portfolio);
    } catch (e) {
      setAutoPfError(e.message || String(e));
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    fetchScan();
    fetchPortfolio();
    fetchAutoPortfolio();
  }, [visible, fetchScan, fetchPortfolio, fetchAutoPortfolio]);

  const handleRefresh = useCallback(() => {
    hasFetchedRef.current = false;
    fetchScan();
    fetchPortfolio();
    fetchAutoPortfolio();
  }, [fetchScan, fetchPortfolio, fetchAutoPortfolio]);

  const mockMode = scan?.mockMode ?? portfolioWrap?.summary?.mockMode ?? true;
  const regime = scan?.regime ?? "normal";
  const regimeInfo = regimeParts(regime);
  const opportunities = scan?.opportunities ?? [];

  const filteredOpportunities = useMemo(() => {
    if (strategyFilter === "all") return opportunities;
    return opportunities.filter((o) => o.strategy === strategyFilter);
  }, [opportunities, strategyFilter]);

  const sortedOpportunities = useMemo(() => {
    const sorted = [...filteredOpportunities];
    sorted.sort((a, b) => {
      if (sortBy === "ev") return (Number(b.ev) || -Infinity) - (Number(a.ev) || -Infinity);
      if (sortBy === "ivRank") return (Number(b.ivRank) || 0) - (Number(a.ivRank) || 0);
      if (sortBy === "dte") return (Number(a.dte) || 999) - (Number(b.dte) || 999);
      return 0;
    });
    return sorted;
  }, [filteredOpportunities, sortBy]);

  const closedSorted = useMemo(() => {
    const c = portfolioWrap?.closedPositions ?? [];
    return [...c].sort((a, b) => String(b.closeDate).localeCompare(String(a.closeDate)));
  }, [portfolioWrap]);

  const streak = useMemo(() => computeStreak(portfolioWrap?.closedPositions ?? []), [portfolioWrap]);

  const historyStats = useMemo(() => {
    const closed = portfolioWrap?.closedPositions ?? [];
    if (!closed.length) {
      return {
        totalRealized: 0,
        winRate: null,
        avgWin: null,
        avgLoss: null,
        best: null,
        worst: null,
        avgDteOpen: null
      };
    }
    const wins = closed.filter((p) => Number(p.pnl) > 0);
    const losses = closed.filter((p) => Number(p.pnl) <= 0);
    const totalRealized = closed.reduce((s, p) => s + (Number(p.pnl) || 0), 0);
    const winRate = (wins.length / closed.length) * 100;
    const avgWin = wins.length > 0 ? wins.reduce((s, p) => s + Number(p.pnl), 0) / wins.length : null;
    const avgLoss = losses.length > 0 ? losses.reduce((s, p) => s + Number(p.pnl), 0) / losses.length : null;
    const pnls = closed.map((p) => Number(p.pnl));
    const best = Math.max(...pnls);
    const worst = Math.min(...pnls);
    const dtes = closed.map((p) => Number(p.dteAtOpen)).filter((n) => Number.isFinite(n));
    const avgDteOpen = dtes.length ? dtes.reduce((a, b) => a + b, 0) / dtes.length : null;
    return { totalRealized, winRate, avgWin, avgLoss, best, worst, avgDteOpen };
  }, [portfolioWrap]);

  const confirmOpen = async () => {
    if (!openModal) return;
    const opp = openModal;
    setOpenSubmitting(true);
    setOpeningKey(oppKey(opp));
    try {
      const premRaw = opp.premium ?? opp.mid ?? opp.bid ?? opp.ask;
      const premium = premRaw != null && Number.isFinite(Number(premRaw)) ? Number(premRaw) : null;
      if (premium == null) {
        throw new Error("Missing premium — refresh the scan and try again.");
      }
      const body = {
        strategy: opp.strategy,
        ticker: opp.ticker,
        strike: opp.strike,
        expiration:
          opp.expiration != null
            ? String(opp.expiration).includes("T")
              ? String(opp.expiration).split("T")[0]
              : String(opp.expiration).trim()
            : "",
        optionType: opp.strategy === "COVERED_CALL" ? "call" : "put",
        quantity: openQty,
        contracts: openQty,
        premium,
        currentPrice: opp.currentPrice,
        rationale: opp.rationale,
        osiSymbol: opp.osiSymbol,
        dte: opp.dte,
        delta: opp.delta,
        theta: opp.theta,
        iv: opp.iv,
        ivRank: opp.ivRank
      };
      console.log("[OPTIONS] Confirm clicked, sending:", body);
      const res = await apiFetch("/api/options/paper/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const j = await safeJson(res);
      console.log("[OPTIONS] Response:", res.status, j);
      if (!j.success) throw new Error(j.error || "Open failed");
      setFlash("Position opened");
      setTimeout(() => setFlash(null), 4000);
      setOpenModal(null);
      if (j.position) {
        setPortfolioWrap((prev) => {
          const positions = [...(prev?.positions ?? [])];
          if (!positions.some((p) => p.id === j.position.id)) positions.push(j.position);
          return {
            positions,
            closedPositions: prev?.closedPositions ?? [],
            history: prev?.history ?? [],
            cashReserved: prev?.cashReserved ?? 0,
            createdAt: prev?.createdAt,
            summary: {
              ...(prev?.summary ?? {}),
              openPositions: positions.length,
              mockMode: prev?.summary?.mockMode ?? mockMode
            }
          };
        });
      }
      await fetchPortfolio({ quiet: true });
    } catch (e) {
      console.error("[OPTIONS] Open error:", e);
      setFlash(e.message || String(e));
      setTimeout(() => setFlash(null), 5000);
    } finally {
      setOpenSubmitting(false);
      setOpeningKey("");
    }
  };

  const confirmClose = async () => {
    if (!closeModal) return;
    setCloseSubmitting(true);
    try {
      const res = await apiFetch("/api/options/paper/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positionId: closeModal.id,
          closePremium: parseFloat(closePremium),
          reason: closeReason
        })
      });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || "Close failed");
      setFlash("Position closed");
      setTimeout(() => setFlash(null), 4000);
      setCloseModal(null);
      await fetchPortfolio({ quiet: true });
    } catch (e) {
      setFlash(e.message || String(e));
      setTimeout(() => setFlash(null), 5000);
    } finally {
      setCloseSubmitting(false);
    }
  };

  const deleteOpenPosition = async (pos) => {
    if (
      !window.confirm(
        `Remove open ${pos.strategy} on ${pos.ticker}? This discards the row and does not add a closed trade to history.`
      )
    ) {
      return;
    }
    setDeletingId(pos.id);
    try {
      const res = await apiFetch("/api/options/paper/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionId: pos.id })
      });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || "Delete failed");
      setFlash("Position removed");
      setTimeout(() => setFlash(null), 3500);
      await fetchPortfolio({ quiet: true });
    } catch (e) {
      setFlash(e.message || String(e));
      setTimeout(() => setFlash(null), 5000);
    } finally {
      setDeletingId(null);
    }
  };

  const openPositions = portfolioWrap?.positions ?? [];
  const summary = portfolioWrap?.summary;
  const autoPositions = Array.isArray(autoPf?.positions) ? autoPf.positions : [];
  const autoStats = autoPf?.stats || {};
  const autoOpenPnl = useMemo(() => {
    if (!autoPositions.length) return 0;
    return autoPositions.reduce((s, p) => s + (Number(p.currentPnL) || 0), 0);
  }, [autoPositions]);
  const overall = useMemo(() => {
    const manualOpen = Number(summary?.openPnl ?? 0) || 0;
    const manualRealized = Number(historyStats.totalRealized) || 0;
    const autoRealized = Number(autoStats.totalPnl) || 0;
    const realized = manualRealized + autoRealized;
    const openPnl = manualOpen + autoOpenPnl;
    const manualClosedCount = (portfolioWrap?.closedPositions ?? []).length;
    const autoClosedCount = Array.isArray(autoPf?.closedTrades) ? autoPf.closedTrades.length : 0;
    const closedCount = manualClosedCount + autoClosedCount;
    const manualWins = (portfolioWrap?.closedPositions ?? []).filter((p) => Number(p.pnl) > 0).length;
    const manualLosses = (portfolioWrap?.closedPositions ?? []).filter((p) => Number(p.pnl) <= 0).length;
    const autoWins = Number(autoStats.wins) || 0;
    const autoLosses = Number(autoStats.losses) || 0;
    const wins = manualWins + autoWins;
    const losses = manualLosses + autoLosses;
    const totalTrades = wins + losses;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : null;
    return {
      openPositions: openPositions.length + autoPositions.length,
      openPnl,
      realizedPnl: realized,
      winRate,
      closedCount
    };
  }, [summary, historyStats, autoStats, autoOpenPnl, openPositions.length, autoPositions.length, portfolioWrap, autoPf]);

  const closePnlPreview = useMemo(() => {
    if (!closeModal) return { pnl: 0, pnlPct: 0 };
    const cp = parseFloat(closePremium);
    if (!Number.isFinite(cp)) return { pnl: null, pnlPct: null };
    const isSeller = closeModal.strategy !== "REGIME_HEDGE";
    const mult = closeModal.quantity * 100;
    const pnl = isSeller
      ? (closeModal.openPremium - cp) * mult
      : (cp - closeModal.openPremium) * mult;
    const pnlPct = isSeller
      ? (closeModal.openPremium - cp) / closeModal.openPremium
      : (cp - closeModal.openPremium) / closeModal.openPremium;
    return { pnl, pnlPct };
  }, [closeModal, closePremium]);

  const plTone = Number(historyStats.totalRealized) >= 0 ? "positive" : "negative";

  return (
    <div className="ma-page-container ma-opt-page" style={{ fontFamily: SANS, color: TEXT, paddingBottom: 32 }}>
      {flash && (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 14px",
            borderRadius: 8,
            background: flash.startsWith("Position") ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)",
            border: `1px solid ${flash.startsWith("Position") ? GREEN : RED}`,
            fontSize: 13
          }}
        >
          {flash}
        </div>
      )}

      <header>
        <p className="ma-opt-header-kicker">OPTIONS</p>
        <h1 className="ma-opt-header-title">Portfolio dashboard</h1>
        <p className="ma-opt-header-sub">P&amp;L · Open positions · Scanner</p>
      </header>

      <section style={{ marginTop: 14 }}>
        <div className="ma-opt-stats-grid">
          <div className="ma-bt-stat" style={{ "--bt-accent": "var(--blue)" }}>
            <div className="ma-bt-stat__label">Open positions</div>
            <div className="ma-bt-stat__val" style={{ fontSize: 22 }}>
              {overall.openPositions}
            </div>
          </div>
          <div className="ma-bt-stat" style={{ "--bt-accent": "var(--amber)" }}>
            <div className="ma-bt-stat__label">Open P&amp;L</div>
            <div
              className="ma-bt-stat__val"
              style={{ color: Number(overall.openPnl ?? 0) >= 0 ? GREEN : RED, fontSize: 22 }}
            >
              {fmtMoney(overall.openPnl ?? 0)}
            </div>
          </div>
          <div className="ma-bt-stat" style={{ "--bt-accent": plTone === "positive" ? "var(--green)" : "var(--red)" }}>
            <div className="ma-bt-stat__label">Realized P&amp;L</div>
            <div className="ma-bt-stat__val" style={{ color: plTone === "positive" ? GREEN : RED, fontSize: 22 }}>
              {fmtMoney(overall.realizedPnl)}
            </div>
          </div>
          <div className="ma-bt-stat">
            <div className="ma-bt-stat__label">Win rate</div>
            <div className="ma-bt-stat__val" style={{ fontSize: 22 }}>
              {overall.winRate != null ? `${overall.winRate.toFixed(1)}%` : "—"}
            </div>
          </div>
        </div>
        <div className="ma-mono" style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 10, lineHeight: 1.7 }}>
          Manual open {openPositions.length} · Auto open {autoPositions.length} · Closed trades {overall.closedCount} · Est. θ{" "}
          {fmtMoney(summary?.dailyTheta ?? 0)}/day · Mock mode: {mockMode ? "on" : "off"} · Regime:{" "}
          <span style={{ color: AMBER }}>{regime}</span>
        </div>
        {autoPfError && (
          <div style={{ marginTop: 10, color: RED, fontSize: 12 }}>
            Auto Trader portfolio unavailable: {autoPfError}
          </div>
        )}
      </section>

      <OptionsBacktest />

      <AutoTraderPanel scanRegime={regime} />

      <section style={{ marginTop: 36 }}>
        <h2 className="ma-opt-section-title">Manual positions{openPositions.length > 0 ? ` (${openPositions.length})` : ""}</h2>
        {pfLoading && (
          <div className="ma-skeleton" style={{ height: 100, borderRadius: 10, width: "100%" }} />
        )}
        {!pfLoading && (!portfolioWrap || openPositions.length === 0) && (
          <div className="ma-opt-empty-card">
            <div className="ma-mono" style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>No active options positions</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Use the scanner above to find opportunities.</div>
          </div>
        )}
        {!pfLoading && portfolioWrap && openPositions.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="ma-mono" style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
              Open P&amp;L {fmtMoney(summary?.openPnl ?? 0)} · Est. θ {fmtMoney(summary?.dailyTheta ?? 0)}/day
            </div>
            {openPositions.map((pos) => {
              const dte = pos.dteRemaining ?? 0;
              const pnl = Number(pos.pnl) || 0;
              const pnlColor = pnl >= 0 ? "var(--green)" : "var(--red)";
              const strat = STRATEGY[pos.strategy]?.shortLabel || pos.strategy;
              const targetPrem = pos.openPremium != null ? pos.openPremium * 0.5 : null;
              const meta = STRATEGY[pos.strategy] || STRATEGY.COVERED_CALL;
              return (
                <div key={pos.id} className="ma-opt-pos-card">
                  <div className="ma-opt-pos-card__main">
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span className="ma-opt-ticker" style={{ fontSize: 16 }}>
                        {pos.ticker}
                      </span>
                      <span className={stratBadgeClass(pos.strategy)}>{meta.shortLabel}</span>
                    </div>
                    <div className="ma-mono" style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                      Strike {fmtMoney(pos.strike)} · Exp {fmtExpiry(pos.expiration)} · Opened {pos.openDate ?? "—"}
                    </div>
                    <div className="ma-mono" style={{ fontSize: 12, marginTop: 4 }}>
                      Premium {fmtMoney(pos.openPremium)} · Current {fmtMoney(pos.currentPremium)} · DTE {dte}
                    </div>
                    <div className="ma-mono" style={{ fontSize: 12, marginTop: 4 }}>
                      P&amp;L{" "}
                      <span style={{ color: pnlColor }}>
                        {fmtMoney(pnl)} ({fmtPct((Number(pos.pnlPct) || 0) * 100)})
                      </span>
                    </div>
                    {targetPrem != null && (
                      <div className="ma-mono" style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 6 }}>
                        Target: close near 50% decay (~{fmtMoney(targetPrem)} premium)
                      </div>
                    )}
                  </div>
                  <div className="ma-opt-pos-card__actions">
                    <button
                      type="button"
                      className="ma-opt-close-btn"
                      onClick={() => {
                        setCloseModal(pos);
                        setClosePremium(String(pos.currentPremium ?? pos.openPremium));
                        setCloseReason("manual");
                      }}
                    >
                      Close position
                    </button>
                    <button
                      type="button"
                      className="ma-btn-danger-outline"
                      disabled={deletingId === pos.id}
                      title="Remove from open positions without recording P&L"
                      onClick={() => deleteOpenPosition(pos)}
                    >
                      {deletingId === pos.id ? "…" : "Delete"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {autoPositions.length > 0 && (
        <section style={{ marginTop: 18 }}>
          <h2 className="ma-opt-section-title">Auto Trader positions ({autoPositions.length})</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {autoPositions.map((pos) => {
              const pnl = Number(pos.currentPnL) || 0;
              const pnlColor = pnl >= 0 ? "var(--green)" : "var(--red)";
              return (
                <div key={pos.optionSymbol || pos.entryOrderId || `${pos.ticker}-${pos.strike}-${pos.expiration}`} className="ma-opt-pos-card">
                  <div className="ma-opt-pos-card__main">
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span className="ma-opt-ticker" style={{ fontSize: 16 }}>
                        {pos.ticker}
                      </span>
                      <span className={stratBadgeClass(pos.strategy)}>{STRATEGY[pos.strategy]?.shortLabel || pos.strategy}</span>
                      <span style={{ fontSize: 10, background: "#0EA5E9", color: "#fff", padding: "2px 8px", borderRadius: 999 }}>
                        AUTO
                      </span>
                    </div>
                    <div className="ma-mono" style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                      Strike {fmtMoney(pos.strike)} · Exp {fmtExpiry(pos.expiration)} · Opened {pos.entryDate ?? "—"}
                    </div>
                    <div className="ma-mono" style={{ fontSize: 12, marginTop: 4 }}>
                      Credit {fmtMoney(pos.entryCredit)} · Current mark{" "}
                      {pos.currentMark != null ? fmtMoney(pos.currentMark) : "—"} · DTE{" "}
                      {pos.currentDTE ?? pos.dte ?? "—"}
                    </div>
                    <div className="ma-mono" style={{ fontSize: 12, marginTop: 4 }}>
                      P&amp;L{" "}
                      <span style={{ color: pnlColor }}>
                        {fmtMoney(pnl)}
                      </span>
                    </div>
                    <div className="ma-mono" style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 6 }}>
                      Managed by Auto Trader (closes at 50% profit, closes/rolls near 21 DTE).
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <header style={{ marginTop: 36 }}>
        <p className="ma-opt-header-kicker">SCANNER</p>
        <h1 className="ma-opt-header-title">Opportunity scanner</h1>
        <p className="ma-opt-header-sub">Covered calls · Cash-secured puts · Regime hedges</p>
      </header>

      <section className="ma-opt-status" aria-label="Scanner status">
        <div className="ma-opt-status__row">
          <div className="ma-opt-status__mid">
            <span className={`ma-opt-regime-pill ${regimeInfo.pillClass}`}>{regimeInfo.pill}</span>
            <span className="ma-opt-regime-desc">{regimeInfo.desc}</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            {mockMode ? (
              <span className="ma-opt-mock">Mock mode</span>
            ) : (
              <span className="ma-opt-live">
                <span className="ma-opt-live__dot" aria-hidden />
                Live
              </span>
            )}
            <button type="button" className="ma-opt-refresh" onClick={handleRefresh} disabled={scanLoading || pfLoading}>
              {scanLoading ? "Scanning…" : "Refresh"}
            </button>
          </div>
        </div>
        <div className="ma-opt-meta">
          {scan?.count != null ? `${scan.count} opportunities found` : "—"}
          {lastScanAt != null ? ` · Last scan: ${formatScanAgo(lastScanAt)}` : ""}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
          <select
            className="ma-input"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{ maxWidth: 300, fontFamily: SANS }}
            aria-label="Sort opportunities"
          >
            <option value="ev">Sort by EV (best edge first)</option>
            <option value="ivRank">Sort by IV Rank (most premium)</option>
            <option value="dte">Sort by DTE (closest expiry first)</option>
          </select>
        </div>
        <div className="ma-opt-filters" role="tablist" aria-label="Filter by strategy">
          {[
            { id: "all", label: "All" },
            { id: "COVERED_CALL", label: "Covered calls" },
            { id: "CASH_SECURED_PUT", label: "Cash-secured puts" },
            { id: "REGIME_HEDGE", label: "Hedges" }
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={strategyFilter === f.id}
              className={"ma-opt-filter" + (strategyFilter === f.id ? " ma-opt-filter--on" : "")}
              onClick={() => setStrategyFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 28 }}>
        <h2 className="ma-opt-section-title">Opportunities</h2>
        {scanError && <div style={{ color: RED, fontSize: 13, marginBottom: 8 }}>{scanError}</div>}
        {scanLoading && (
          <div className="ma-options-grid">
            {[1, 2, 3, 4, 5, 6].map((k) => (
              <div key={k} className="ma-skeleton ma-options-skel" style={{ minHeight: 220, width: "100%" }} />
            ))}
          </div>
        )}
        {!scanLoading && !scanError && (
          <div className="ma-options-grid">
            <div style={{ gridColumn: "1 / -1" }}>
              {sortedOpportunities.map((opp, i) => (
                <OpportunityCard
                  key={oppKey(opp) || `${opp.strategy}-${opp.ticker}-${i}`}
                  opp={opp}
                  onOpen={(o) => {
                    setOpenQty(1);
                    setOpenModal(o);
                  }}
                />
              ))}
            </div>
          </div>
        )}
        {!scanLoading && !scanError && filteredOpportunities.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 12 }}>
            {opportunities.length === 0
              ? "No opportunities matched the current filters."
              : "No opportunities for this filter — try All."}
          </p>
        )}
      </section>

      <section style={{ marginTop: 36 }}>
        <h2 className="ma-opt-section-title">Manual trade history</h2>
        {streak && (
          <div style={{ fontSize: 12, marginBottom: 12, color: "var(--text-secondary)" }}>
            Current streak:{" "}
            <strong style={{ color: streak.wins ? GREEN : RED }}>
              {streak.count} {streak.wins ? "wins" : "losses"}
            </strong>
          </div>
        )}
        {closedSorted.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>No closed trades yet.</p>
        ) : (
          <>
            {closedSorted.map((p, hi) => (
              <div
                key={`${p.id}-closed`}
                className="ma-opt-trade-card"
                style={{ animationDelay: `${Math.min(hi, 12) * 40}ms` }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span className="ma-opt-ticker" style={{ fontSize: 15 }}>
                    {p.ticker}
                  </span>
                  <span className={stratBadgeClass(p.strategy)}>{STRATEGY[p.strategy]?.shortLabel || p.strategy}</span>
                  <span className="ma-mono" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {fmtMoney(p.strike)} · {fmtExpiry(p.expiration)}
                  </span>
                </div>
                <div className="ma-mono" style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6 }}>
                  Opened {p.openDate ?? "—"} → Closed {p.closeDate ?? "—"}
                  <span className={reasonBadgeClass(p.closeReason)}>{p.closeReason ?? "manual"}</span>
                </div>
                <div className="ma-mono" style={{ fontSize: 12 }}>
                  Open {fmtMoney(p.openPremium)} → Close {fmtMoney(p.closePremium)} · P&amp;L{" "}
                  <span style={{ color: Number(p.pnl) >= 0 ? GREEN : RED }}>{fmtMoney(Number(p.pnl) || 0)}</span> (
                  {fmtPct((Number(p.pnlPct) || 0) * 100)}) · DTE @ open {p.dteAtOpen ?? "—"}
                </div>
              </div>
            ))}
          </>
        )}
      </section>

      <p className="ma-opt-footnote">Educational tool · Not financial advice</p>

      {openModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16
          }}
          onClick={() => !openSubmitting && setOpenModal(null)}
        >
          <div
            className="ma-card"
            style={{
              maxWidth: 520,
              width: "100%",
              marginBottom: 0,
              border: `1px solid ${BORDER_LIGHT}`
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 800, marginBottom: 12 }}>
              Open {openModal.strategy} — {openModal.ticker}
            </div>
            <table className="ma-table ma-table--compact" style={{ marginBottom: 12 }}>
              <tbody>
                <tr>
                  <td>Strategy</td>
                  <td className="ma-mono">{openModal.strategy}</td>
                </tr>
                <tr>
                  <td>Ticker</td>
                  <td className="ma-mono">{openModal.ticker}</td>
                </tr>
                <tr>
                  <td>Strike</td>
                  <td className="ma-mono">{fmtMoney(openModal.strike)}</td>
                </tr>
                <tr>
                  <td>Expiration</td>
                  <td className="ma-mono">{openModal.expiration}</td>
                </tr>
                <tr>
                  <td>Type</td>
                  <td className="ma-mono">{openModal.strategy === "COVERED_CALL" ? "call" : "put"}</td>
                </tr>
                <tr>
                  <td>Quantity</td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      className="ma-input"
                      value={openQty}
                      onChange={(e) => setOpenQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      style={{ width: 80, fontFamily: MONO }}
                    />
                  </td>
                </tr>
                <tr>
                  <td>Premium</td>
                  <td className="ma-mono">{fmtMoney(openModal.premium)}</td>
                </tr>
                <tr>
                  <td>Max profit</td>
                  <td className="ma-mono">{openModal.maxProfit != null ? fmtMoney(openModal.maxProfit) : "—"}</td>
                </tr>
                <tr>
                  <td>Max loss</td>
                  <td className="ma-mono">{openModal.maxLoss != null ? fmtMoney(openModal.maxLoss) : "—"}</td>
                </tr>
                <tr>
                  <td>Breakeven</td>
                  <td className="ma-mono">{openModal.breakeven != null ? fmtMoney(openModal.breakeven) : "—"}</td>
                </tr>
              </tbody>
            </table>
            <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 6 }}>OSI symbol</div>
            <div
              className="ma-mono"
              style={{
                fontSize: 12,
                padding: "8px 10px",
                background: "rgba(0,0,0,0.35)",
                borderRadius: 6,
                marginBottom: 12,
                wordBreak: "break-all"
              }}
            >
              {openModal.osiSymbol ||
                `${openModal.ticker}${String(openModal.expiration).replace(/-/g, "").slice(2)}${
                  openModal.strategy === "COVERED_CALL" ? "C" : "P"
                }${String(Math.round(Number(openModal.strike) * 1000)).padStart(8, "0")}`}
            </div>
            <p style={{ fontSize: 12, opacity: 0.8, margin: "0 0 8px" }}>Paper trade only — no real money at risk.</p>
            {mockMode && <p style={{ fontSize: 12, color: AMBER, margin: "0 0 12px" }}>⚠ Mock mode — no API connection</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="ma-btn-ghost" disabled={openSubmitting} onClick={() => setOpenModal(null)}>
                Cancel
              </button>
              <button type="button" className="ma-btn-primary" disabled={openSubmitting} onClick={confirmOpen}>
                {openSubmitting ? (
                  <>
                    <Loader2 size={16} className="ma-alphalab-loadbtn__spin" style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />
                    Opening…
                  </>
                ) : (
                  "Confirm"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {closeModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16
          }}
          onClick={() => !closeSubmitting && setCloseModal(null)}
        >
          <div
            className="ma-card"
            style={{ maxWidth: 420, width: "100%", marginBottom: 0, border: `1px solid ${BORDER_LIGHT}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 800, marginBottom: 12 }}>Close position — {closeModal.ticker}</div>
            <label className="ma-sh" style={{ display: "block", marginBottom: 4 }}>
              Current premium
            </label>
            <input
              type="number"
              step="0.01"
              className="ma-input"
              value={closePremium}
              onChange={(e) => setClosePremium(e.target.value)}
              style={{ width: "100%", fontFamily: MONO, marginBottom: 10 }}
            />
            <div className="ma-mono" style={{ fontSize: 12, marginBottom: 10 }}>
              Est. P&amp;L: {closePnlPreview.pnl == null ? "—" : fmtMoney(closePnlPreview.pnl)} · Est. P&amp;L%:{" "}
              {closePnlPreview.pnlPct == null ? "—" : fmtPct(closePnlPreview.pnlPct * 100)}
            </div>
            <label className="ma-sh" style={{ display: "block", marginBottom: 4 }}>
              Close reason
            </label>
            <select
              className="ma-input"
              value={closeReason}
              onChange={(e) => setCloseReason(e.target.value)}
              style={{ width: "100%", marginBottom: 14, fontFamily: SANS }}
            >
              <option value="profit target">profit target</option>
              <option value="roll">roll</option>
              <option value="stop loss">stop loss</option>
              <option value="expiration">expiration</option>
              <option value="manual">manual</option>
            </select>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="ma-btn-ghost" disabled={closeSubmitting} onClick={() => setCloseModal(null)}>
                Cancel
              </button>
              <button type="button" className="ma-btn-primary" disabled={closeSubmitting} onClick={confirmClose}>
                {closeSubmitting ? "…" : "Confirm close"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
