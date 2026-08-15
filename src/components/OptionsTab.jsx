import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch, safeJson } from "../lib/api.js";
import { MONO, SANS, TEXT, GREEN, RED, AMBER, BORDER_LIGHT } from "../lib/theme.js";
import { fmtMoney as _fmtMoney, fmtPctSigned as fmtPct } from "../lib/formatters.js";
import { useBackendMode } from "../hooks/useBackendMode.js";

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
          },
          // ── Three-paper academic signal section ──────────────────────────
          {
            label: "Academic Sell Score",
            value: opp.sellScore != null
              ? `${(opp.sellScore * 100).toFixed(0)}/100`
              : "—",
            valueColor: opp.sellScore == null   ? "#64748B"
              : opp.sellScore >= 0.65           ? "#22C55E"
              : opp.sellScore >= 0.45           ? "#0EA5E9"
              : opp.sellScore >= 0.30           ? "#F59E0B"
              : "#EF4444",
            sub: opp.signalCount != null
              ? `${opp.signalCount}/3 papers aligned · ${opp.academicSellEdge ? "Strong sell edge" : "Weak signal"}`
              : "Composite of G&S + C&H + B&K signals",
            bold: true
          },
          {
            label: "Mispricing Signal (G&S)",
            value: opp.gsSignal != null ? opp.gsSignal.toFixed(3) : "—",
            valueColor: opp.gsSignal == null ? "#64748B"
              : opp.gsSignal < -0.5            ? "#22C55E"
              : opp.gsSignal < -0.2            ? "#0EA5E9"
              : opp.gsSignal < 0.1             ? "#F59E0B"
              : "#EF4444",
            sub: opp.rv252 != null && opp.ivProxy != null
              ? `RV(1Y): ${opp.rv252}%  ·  IV: ${opp.ivProxy}%${opp.overpricingRatio != null ? `  ·  IV ${((opp.overpricingRatio - 1) * 100).toFixed(0)}% above realized` : ""}`
              : (opp.gsInterpretation ?? "log(RV 12m) − log(IV ATM) — negative = overpriced"),
            subSmall: true
          },
          {
            label: "Idiosyncratic Vol Rank (C&H)",
            value: opp.ivolPct != null ? `${Number(opp.ivolPct).toFixed(0)}th pct` : "—",
            valueColor: opp.ivolPct == null    ? "#64748B"
              : Number(opp.ivolPct) >= 70      ? "#22C55E"
              : Number(opp.ivolPct) >= 40      ? "#F59E0B"
              : "#94A3B8",
            sub: opp.ivolRaw != null
              ? `CAPM residual vol: ${opp.ivolRaw}% ann. Dealers charge more on high-IVOL names.`
              : "Idiosyncratic vol percentile within current scan universe",
            subSmall: true
          },
          {
            label: "VRP Intensity (B&K)",
            value: opp.vrpIntensity != null
              ? `${(opp.vrpIntensity * 100).toFixed(0)}%`
              : "—",
            valueColor: opp.vrpIntensity == null ? "#64748B"
              : opp.vrpIntensity > 0.3           ? "#22C55E"
              : opp.vrpIntensity > 0.1           ? "#F59E0B"
              : opp.vrpIntensity > 0             ? "#94A3B8"
              : "#EF4444",
            sub: opp.regimeBoost != null
              ? `IV prem over HV30: ${opp.ivPremium != null ? (opp.ivPremium * 100).toFixed(0) + "%" : "—"}  ·  Vol regime boost: ${opp.regimeBoost}×`
              : "IV premium over 30-day realized vol, scaled by vol regime",
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

/** Parse server / UI closeReason into compact chips (REGIME_*, DTE_*, profit, etc.) */
function closeReasonChips(reason) {
  const raw = String(reason ?? "manual").trim();
  const lower = raw.toLowerCase().replace(/\s+/g, "_");
  const out = [];

  const regimeM = /^regime_(.+)$/.exec(lower);
  if (regimeM) {
    out.push({
      kind: "regime",
      label: `REGIME_${regimeM[1].replace(/_/g, "_").toUpperCase()}`
    });
  }

  const dteM = /\bdte_(\d+)\b/.exec(lower) || /^dte(\d+)$/.exec(lower);
  if (dteM) {
    out.push({ kind: "dte", label: `DTE_${dteM[1]}` });
  }

  if (/profit/.test(lower) || /target/.test(lower)) {
    const pm = lower.match(/profit_target_(\d+)/) || lower.match(/(\d+)\s*pct/);
    out.push({
      kind: "profit",
      label: pm ? `PT_${pm[1]}PCT` : "PROFIT_TARGET"
    });
  }

  if (out.length === 0) {
    const cleaned = raw.replace(/[^\w\s-]/g, "").trim();
    const lab =
      cleaned.length > 0 && cleaned.length <= 28
        ? cleaned.replace(/\s+/g, "_").toUpperCase()
        : cleaned.length > 28
          ? `${cleaned.slice(0, 22).replace(/\s+/g, "_").toUpperCase()}…`
          : "MANUAL";
    out.push({ kind: "other", label: lab });
  }

  return out;
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
    <div className="ma-auto-trader-card">
      <div className="ma-auto-trader-card__head">
        <div>
          <div className="ma-auto-trader-card__title-row">
            <span className="ma-auto-trader-card__title">Auto Trader</span>
            <span className="ma-auto-trader-card__badge">SANDBOX</span>
          </div>
          <p className="ma-auto-trader-card__desc">
            Uses Tradier sandbox when <span className="ma-mono">TRADIER_SANDBOX_TOKEN</span> is set.
            Opens highest positive-EV short-premium trades and auto-manages: 50% profit close + 21-DTE close.
            Dry-run if token is missing.
          </p>
        </div>
        <button
          type="button"
          className="ma-pro-btn ma-pro-btn--primary"
          onClick={handleRun}
          disabled={running}
        >
          {running ? (
            <><span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.7s linear infinite", marginRight: 6 }} />Running…</>
          ) : (
            "Run Auto Trader"
          )}
        </button>
      </div>

      {/* Status bar */}
      <div className="ma-auto-trader-card__status-bar">
        <div className="ma-auto-trader-card__stat">
          <span className="ma-auto-trader-card__stat-label">Open</span>
          <span className="ma-auto-trader-card__stat-val">{positions.length}</span>
        </div>
        <div className="ma-auto-trader-card__stat">
          <span className="ma-auto-trader-card__stat-label">Open P&L</span>
          <span className="ma-auto-trader-card__stat-val" style={{ color: autoOpenPnl >= 0 ? "var(--green)" : "var(--red)" }}>
            {fmtMoney(autoOpenPnl)}
          </span>
        </div>
        <div className="ma-auto-trader-card__stat">
          <span className="ma-auto-trader-card__stat-label">Realized P&L</span>
          <span className="ma-auto-trader-card__stat-val" style={{ color: Number(stats.totalPnl) >= 0 ? "var(--green)" : "var(--red)" }}>
            {fmtMoney(Number(stats.totalPnl) || 0)}
          </span>
        </div>
        <div className="ma-auto-trader-card__stat">
          <span className="ma-auto-trader-card__stat-label">Closed</span>
          <span className="ma-auto-trader-card__stat-val">{closed.length}</span>
        </div>
      </div>

      {error && <div className="ma-pro-error" style={{ marginTop: 10 }}>{error}</div>}

      {status && (
        <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(14,26,46,0.8)", border: "1px solid #1e3a5f", borderRadius: 10 }}>
          <div style={{ fontFamily: "var(--font-mono)", color: "#64748B", fontSize: 11, marginBottom: 8 }}>
            Last run: <span style={{ color: "#94A3B8" }}>{status.mode === "mock" ? "DRY RUN (no token)" : "SANDBOX"}</span>
            {status.regime && <span> · Regime: <span style={{ color: "var(--text-secondary)" }}>{status.regime}</span></span>}
          </div>
          {status.mode === "mock" && status.dryRun && (
            <div style={{ fontSize: 12, color: "var(--text-primary)" }}>
              Would open {status.dryRun.wouldOpen?.length ?? 0} trade(s)
            </div>
          )}
          {status.actions && (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {[
                { label: "Opened", val: status.actions.opened?.length ?? 0, color: "var(--green)" },
                { label: "Closed", val: status.actions.closed?.length ?? 0, color: "var(--yellow)" },
                { label: "Errors", val: status.actions.errors?.length ?? 0, color: "var(--red)" }
              ].map(({ label, val, color }) => (
                <div key={label} style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                  <span style={{ color: "#475569" }}>{label}: </span>
                  <span style={{ color, fontWeight: 700 }}>{val}</span>
                </div>
              ))}
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
    <div className="ma-backtest-card">
      <div className="ma-backtest-card__head">
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text-primary)", marginBottom: 4 }}>Options Strategy Backtest</div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            Simplified simulation of selling covered calls + cash-secured puts on top-scored names.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          {["1y", "2y", "3y"].map((p) => (
            <button
              key={p}
              type="button"
              className={`ma-backtest-period-btn ${period === p ? "ma-backtest-period-btn--on" : "ma-backtest-period-btn--off"}`}
              onClick={() => setPeriod(p)}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            className="ma-pro-btn ma-pro-btn--green"
            onClick={run}
            disabled={loading}
            style={{ padding: "6px 16px" }}
          >
            {loading ? "Running…" : "Run Backtest"}
          </button>
        </div>
      </div>

      {error && <div className="ma-pro-error">{error}</div>}

      {result && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8, marginTop: 4 }}>
            {[
              { label: "Equity only", value: `${result.performance.equityOnlyReturnPct.toFixed(2)}%`, color: "var(--text-secondary)" },
              { label: "Premium collected", value: fmtMoney(result.performance.totalPremiumCollected), color: "var(--green)" },
              { label: "Premium yield/yr", value: `${result.performance.annualizedPremiumYieldPct.toFixed(2)}%`, color: "#38bdf8" },
              { label: "Enhanced return", value: `${result.performance.enhancedReturnPct.toFixed(2)}%`, color: "var(--green)" },
              { label: "Options lift", value: `${result.performance.liftFromOptionsPct.toFixed(2)}%`, color: "var(--yellow)" }
            ].map((x) => (
              <div key={x.label} className="ma-bt-result-cell">
                <div className="ma-bt-result-cell__label">{x.label}</div>
                <div className="ma-bt-result-cell__val" style={{ color: x.color }}>{x.value}</div>
              </div>
            ))}
          </div>

          {result.interpretation?.whatThisMeans && (
            <div style={{ marginTop: 10, padding: "10px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid var(--border-card)", fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {result.interpretation.whatThisMeans}
            </div>
          )}

          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 80, minWidth: 640 }}>
              {(() => {
                const maxVal = Math.max(1, ...result.monthlyPnl.map((x) => Number(x.totalPnl) || 0));
                return result.monthlyPnl.map((m, i) => {
                  const val = Number(m.totalPnl) || 0;
                  const h = m.regime === "bear" ? 6 : Math.max(6, (val / maxVal) * 76);
                  const color = m.regime === "bear" ? "#1E293B"
                    : m.bkRegimeBoost >= 1.5 ? "#10b981"
                    : m.bkRegimeBoost >= 1.2 ? "#22C55E"
                    : val >= 0 ? "#4ADE80"
                    : "#EF4444";
                  const cc = Number(m.ccPremium || 0).toFixed(0);
                  const csp = Number(m.cspPremium || 0).toFixed(0);
                  const boost = m.bkRegimeBoost ? `· B&K ${m.bkRegimeBoost}×` : "";
                  return (
                    <div
                      key={i}
                      title={`${m.date}: $${val.toFixed(0)} total (CC $${cc} + CSP $${csp}) · ${m.regime} ${boost}${m.vrpSkipped ? ` · ${m.vrpSkipped} G&S-skipped` : ""}`}
                      style={{ flex: 1, background: color, height: h, borderRadius: "2px 2px 0 0", minWidth: 4, opacity: m.regime === "bear" ? 0.4 : 1, cursor: "default" }}
                    />
                  );
                });
              })()}
            </div>
            <div style={{ fontFamily: "var(--font-mono)", color: "#64748B", fontSize: 10, marginTop: 6 }}>
              Monthly premium — hover for detail · Dark = bear (no trades) · Bright green = high-vol B&K boost
              {result.walkForward && (
                <span> · Walk-forward: H1 avg ${result.walkForward.firstHalf.avgMonthly}/mo · H2 avg ${result.walkForward.secondHalf.avgMonthly}/mo</span>
              )}
            </div>
          </div>

          {result.walkForward && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
              {[
                { label: "First half (in-sample)", data: result.walkForward.firstHalf },
                { label: "Second half (forward estimate)", data: result.walkForward.secondHalf }
              ].map(({ label, data }) => (
                <div key={label} style={{ background: "rgba(14,26,46,0.8)", border: "1px solid #1e3a5f", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ color: "#64748B", fontSize: 10, marginBottom: 6, fontFamily: "var(--font-mono)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "var(--green)" }}>${data.avgMonthly}/mo avg</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#64748B" }}>{data.bearMonths} bear mo · {data.vrpSkipped} G&S-skipped</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}


export default function OptionsTab({ visible = true }) {
  const backendMode = useBackendMode();
  const lite = backendMode === "lite";
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
  const [sortBy, setSortBy] = useState("sellScore");

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
    if (!visible || lite) return;
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    fetchScan();
    fetchPortfolio();
    fetchAutoPortfolio();
  }, [visible, lite, fetchScan, fetchPortfolio, fetchAutoPortfolio]);

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
      if (sortBy === "ev")        return (Number(b.ev) || -Infinity) - (Number(a.ev) || -Infinity);
      if (sortBy === "ivRank")    return (Number(b.ivRank) || 0) - (Number(a.ivRank) || 0);
      if (sortBy === "dte")       return (Number(a.dte) || 999) - (Number(b.dte) || 999);
      if (sortBy === "sellScore") return (Number(b.sellScore) || 0) - (Number(a.sellScore) || 0);
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

  const optRegimePillClass = regime === "strong_bull" || regime === "normal"
    ? "ma-pro-regime-pill--bull"
    : regime === "pullback" || regime === "caution"
      ? "ma-pro-regime-pill--caution"
      : regime === "bear"
        ? "ma-pro-regime-pill--bear"
        : "ma-pro-regime-pill--neutral";

  // Options scanning, paper positions, and the auto-trader are all live/
  // stateful — chains change constantly and trades mutate state, so unlike
  // Backtest there's no fixed matrix worth mirroring here. Show one clear
  // notice instead of a page full of failed-fetch banners.
  if (lite) {
    return (
      <div className="ma-page-container ma-opt-page ma-pro-page" style={{ fontFamily: SANS, color: TEXT, paddingBottom: 32 }}>
        <div className="ma-pro-header">
          <div className="ma-pro-header__left">
            <p className="ma-pro-kicker">Options</p>
            <h1 className="ma-pro-title">Portfolio Dashboard</h1>
          </div>
        </div>
        <div
          style={{
            marginTop: 16,
            padding: 20,
            borderRadius: 8,
            background: "rgba(88,166,255,0.06)",
            border: "1px solid rgba(88,166,255,0.28)",
            fontSize: 13,
            lineHeight: 1.6
          }}
        >
          Not available on this read-only deploy. The options scanner, paper positions, and auto-trader all need
          live options chains and mutable state that this deploy doesn't run — see{" "}
          <span className="ma-mono">README § Live deployment</span> to run the full backend locally.
        </div>
      </div>
    );
  }

  return (
    <div className="ma-page-container ma-opt-page ma-pro-page" style={{ fontFamily: SANS, color: TEXT, paddingBottom: 32 }}>
      {flash && (
        <div style={{
          marginBottom: 14,
          padding: "10px 16px",
          borderRadius: 8,
          background: flash.startsWith("Position") ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
          border: `1px solid ${flash.startsWith("Position") ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)"}`,
          fontSize: 13,
          color: flash.startsWith("Position") ? "var(--green)" : "var(--red)",
          fontWeight: 600
        }}>
          {flash}
        </div>
      )}

      {/* ── Page header ── */}
      <div className="ma-pro-header">
        <div className="ma-pro-header__left">
          <p className="ma-pro-kicker">Options</p>
          <h1 className="ma-pro-title">Portfolio Dashboard</h1>
          <p className="ma-pro-sub">P&L · Open positions · Opportunity scanner</p>
        </div>
        <div className="ma-pro-header__right">
          <span className={`ma-pro-regime-pill ${optRegimePillClass}`}>
            {regime.replace(/_/g, " ")}
          </span>
          {mockMode ? (
            <span className="ma-opt-mock">Mock mode</span>
          ) : (
            <span className="ma-opt-live">
              <span className="ma-opt-live__dot" aria-hidden />
              Live
            </span>
          )}
          <button
            type="button"
            className="ma-pro-btn ma-pro-btn--ghost"
            onClick={handleRefresh}
            disabled={scanLoading || pfLoading}
          >
            {scanLoading ? "Scanning…" : "Refresh all"}
          </button>
        </div>
      </div>

      {/* ── KPI cards ── */}
      <section style={{ marginTop: 4 }}>
        <div className="ma-pro-stats">
          <div className="ma-pro-stat" style={{ "--pro-stat-accent": "var(--blue)" }}>
            <div className="ma-pro-stat__label">Open positions</div>
            <div className="ma-pro-stat__val" style={{ color: "var(--blue)", fontSize: 26 }}>{overall.openPositions}</div>
            <div className="ma-pro-stat__sub">manual + auto</div>
          </div>
          <div className="ma-pro-stat" style={{ "--pro-stat-accent": Number(overall.openPnl ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>
            <div className="ma-pro-stat__label">Open P&L</div>
            <div className="ma-pro-stat__val" style={{ color: Number(overall.openPnl ?? 0) >= 0 ? "var(--green)" : "var(--red)", fontSize: 26 }}>
              {fmtMoney(overall.openPnl ?? 0)}
            </div>
          </div>
          <div className="ma-pro-stat" style={{ "--pro-stat-accent": plTone === "positive" ? "var(--green)" : "var(--red)" }}>
            <div className="ma-pro-stat__label">Realized P&L</div>
            <div className="ma-pro-stat__val" style={{ color: plTone === "positive" ? "var(--green)" : "var(--red)", fontSize: 26 }}>
              {fmtMoney(overall.realizedPnl)}
            </div>
          </div>
          <div className="ma-pro-stat" style={{ "--pro-stat-accent": "var(--text-secondary)" }}>
            <div className="ma-pro-stat__label">Win rate</div>
            <div className="ma-pro-stat__val" style={{ fontSize: 26 }}>
              {overall.winRate != null ? `${overall.winRate.toFixed(1)}%` : "—"}
            </div>
            <div className="ma-pro-stat__sub">{overall.closedCount} closed trades</div>
          </div>
        </div>
        <div className="ma-pro-meta-bar" style={{ marginTop: 10, marginBottom: 0 }}>
          <span>Manual open {openPositions.length}</span>
          <span className="ma-pro-meta-sep">·</span>
          <span>Auto open {autoPositions.length}</span>
          <span className="ma-pro-meta-sep">·</span>
          <span>Closed {overall.closedCount}</span>
          {summary?.dailyTheta != null && (
            <>
              <span className="ma-pro-meta-sep">·</span>
              <span>Est. θ {fmtMoney(summary.dailyTheta)}/day</span>
            </>
          )}
        </div>
        {autoPfError && (
          <div className="ma-pro-error" style={{ marginTop: 8 }}>Auto Trader portfolio unavailable: {autoPfError}</div>
        )}
      </section>

      <OptionsBacktest />
      <AutoTraderPanel scanRegime={regime} />

      {/* ── Manual positions ── */}
      <section style={{ marginTop: 32 }}>
        <div className="ma-pro-section-head">
          <h2 className="ma-pro-section-title" style={{ margin: 0 }}>
            Manual positions{openPositions.length > 0 ? ` (${openPositions.length})` : ""}
          </h2>
          {summary?.openPnl != null && openPositions.length > 0 && (
            <div className="ma-pro-meta-bar" style={{ marginBottom: 0 }}>
              <span>P&L {fmtMoney(summary.openPnl)}</span>
              {summary.dailyTheta != null && (
                <><span className="ma-pro-meta-sep">·</span><span>θ {fmtMoney(summary.dailyTheta)}/day</span></>
              )}
            </div>
          )}
        </div>
        {pfLoading && (
          <div className="ma-skeleton" style={{ height: 100, borderRadius: 12, width: "100%" }} />
        )}
        {!pfLoading && (!portfolioWrap || openPositions.length === 0) && (
          <div className="ma-opt-empty-card">
            <div className="ma-mono" style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>No active options positions</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Use the scanner below to find opportunities.</div>
          </div>
        )}
        {!pfLoading && portfolioWrap && openPositions.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {openPositions.map((pos) => {
              const dte = pos.dteRemaining ?? 0;
              const pnl = Number(pos.pnl) || 0;
              const targetPrem = pos.openPremium != null ? pos.openPremium * 0.5 : null;
              const isCC = pos.strategy === "COVERED_CALL";
              const isHedge = pos.strategy === "REGIME_HEDGE";
              const posAccent = isHedge ? "var(--red)" : isCC ? "var(--blue)" : "#a78bfa";
              const meta = STRATEGY[pos.strategy] || STRATEGY.COVERED_CALL;
              return (
                <div key={pos.id} className="ma-opt-pos-card-v2" style={{ "--pos-accent": posAccent }}>
                  <div className="ma-opt-pos-card-v2__main">
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span className="ma-opt-pos-card-v2__ticker">{pos.ticker}</span>
                      <span className={stratBadgeClass(pos.strategy)}>{meta.shortLabel}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", gap: "4px 20px", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)", width: "fit-content" }}>
                      <span>Strike {fmtMoney(pos.strike)}</span>
                      <span>Exp {fmtExpiry(pos.expiration)}</span>
                      <span>DTE {dte}d</span>
                      <span>Open {fmtMoney(pos.openPremium)}</span>
                      <span>Current {fmtMoney(pos.currentPremium)}</span>
                      <span>Opened {pos.openDate ?? "—"}</span>
                    </div>
                    {targetPrem != null && (
                      <div className="ma-mono" style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 6 }}>
                        Target: close ~50% decay (~{fmtMoney(targetPrem)})
                      </div>
                    )}
                  </div>
                  <div className="ma-opt-pos-card-v2__actions">
                    <div className="ma-opt-pos-card-v2__pnl" style={{ color: pnl >= 0 ? "var(--green)" : "var(--red)" }}>
                      {fmtMoney(pnl)}
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: pnl >= 0 ? "var(--green)" : "var(--red)", textAlign: "right", opacity: 0.75, marginBottom: 8 }}>
                      {fmtPct((Number(pos.pnlPct) || 0) * 100)}
                    </div>
                    <button
                      type="button"
                      className="ma-opt-close-btn"
                      onClick={() => {
                        setCloseModal(pos);
                        setClosePremium(String(pos.currentPremium ?? pos.openPremium));
                        setCloseReason("manual");
                      }}
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      className="ma-btn-danger-outline"
                      disabled={deletingId === pos.id}
                      title="Remove without recording P&L"
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

      {/* ── Auto Trader positions ── */}
      {autoPositions.length > 0 && (
        <section style={{ marginTop: 20 }}>
          <h2 className="ma-pro-section-title">Auto Trader positions ({autoPositions.length})</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {autoPositions.map((pos) => {
              const pnl = Number(pos.currentPnL) || 0;
              const isCSP = pos.strategy === "CASH_SECURED_PUT";
              const posAccent = isCSP ? "#a78bfa" : "var(--blue)";
              return (
                <div key={pos.optionSymbol || pos.entryOrderId || `${pos.ticker}-${pos.strike}-${pos.expiration}`}
                  className="ma-opt-pos-card-v2" style={{ "--pos-accent": posAccent }}>
                  <div className="ma-opt-pos-card-v2__main">
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span className="ma-opt-pos-card-v2__ticker">{pos.ticker}</span>
                      <span className={stratBadgeClass(pos.strategy)}>{STRATEGY[pos.strategy]?.shortLabel || pos.strategy}</span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 800, background: "rgba(14,165,233,0.15)", border: "1px solid rgba(14,165,233,0.35)", color: "#38bdf8", padding: "2px 8px", borderRadius: 6, letterSpacing: "0.1em" }}>
                        AUTO
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", gap: "4px 20px", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)", width: "fit-content" }}>
                      <span>Strike {fmtMoney(pos.strike)}</span>
                      <span>Exp {fmtExpiry(pos.expiration)}</span>
                      <span>DTE {pos.currentDTE ?? pos.dte ?? "—"}d</span>
                      <span>Credit {fmtMoney(pos.entryCredit)}</span>
                      <span>Mark {pos.currentMark != null ? fmtMoney(pos.currentMark) : "—"}</span>
                      <span>Opened {pos.entryDate ?? "—"}</span>
                    </div>
                    <div className="ma-mono" style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 6 }}>
                      Managed: closes at 50% profit or 21 DTE
                    </div>
                  </div>
                  <div className="ma-opt-pos-card-v2__actions">
                    <div className="ma-opt-pos-card-v2__pnl" style={{ color: pnl >= 0 ? "var(--green)" : "var(--red)" }}>
                      {fmtMoney(pnl)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Scanner ── */}
      <hr className="ma-pro-divider" style={{ marginTop: 32 }} />
      <div className="ma-pro-header" style={{ marginBottom: 14 }}>
        <div className="ma-pro-header__left">
          <p className="ma-pro-kicker">Scanner</p>
          <h2 className="ma-pro-title" style={{ fontSize: 20 }}>Opportunity Scanner</h2>
          <p className="ma-pro-sub">Covered calls · Cash-secured puts · Regime hedges</p>
        </div>
        <div className="ma-pro-header__right">
          <span className={`ma-opt-regime-pill ${regimeInfo.pillClass}`}>{regimeInfo.pill}</span>
          <span className="ma-opt-regime-desc" style={{ fontSize: 12, maxWidth: 300 }}>{regimeInfo.desc}</span>
        </div>
      </div>

      <section className="ma-opt-status" aria-label="Scanner status">
        <div className="ma-opt-status__row">
          <div className="ma-opt-status__mid">
            <div className="ma-opt-filters" role="tablist" aria-label="Filter by strategy" style={{ marginTop: 0 }}>
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
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <select
              className="ma-input"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{ maxWidth: 260, fontFamily: SANS, fontSize: 11 }}
              aria-label="Sort opportunities"
            >
              <option value="sellScore">Sort: Academic score</option>
              <option value="ev">Sort: Expected value</option>
              <option value="ivRank">Sort: IV Rank</option>
              <option value="dte">Sort: DTE</option>
            </select>
            <div className="ma-opt-meta" style={{ margin: 0, fontSize: 11 }}>
              {scan?.count != null ? `${scan.count} found` : "—"}
              {lastScanAt != null ? ` · ${formatScanAgo(lastScanAt)}` : ""}
            </div>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 20 }}>
        <h2 className="ma-pro-section-title">Opportunities</h2>
        {scanError && <div className="ma-pro-error">{scanError}</div>}
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

      {/* ── Manual trade history (summary + ledger) ── */}
      <section className="ma-hist-section">
        <h2 className="ma-pro-section-title">Manual trade history</h2>

        {closedSorted.length > 0 && (
          <div className="ma-hist-stats" aria-label="Closed trade summary">
            <div className="ma-hist-stat">
              <div className="ma-hist-stat__label">Total realized</div>
              <div
                className="ma-hist-stat__val"
                style={{ color: historyStats.totalRealized >= 0 ? "var(--green)" : "var(--red)" }}
              >
                {fmtMoney(historyStats.totalRealized)}
              </div>
            </div>
            <div className="ma-hist-stat">
              <div className="ma-hist-stat__label">Win rate</div>
              <div className="ma-hist-stat__val">
                {historyStats.winRate != null ? `${historyStats.winRate.toFixed(1)}%` : "—"}
              </div>
            </div>
            <div className="ma-hist-stat">
              <div className="ma-hist-stat__label">Avg loss</div>
              <div className="ma-hist-stat__val" style={{ color: "var(--red)" }}>
                {historyStats.avgLoss != null ? fmtMoney(historyStats.avgLoss) : fmtMoney(0)}
              </div>
            </div>
            <div className="ma-hist-stat">
              <div className="ma-hist-stat__label">Avg DTE@open</div>
              <div className="ma-hist-stat__val">
                {historyStats.avgDteOpen != null ? `${historyStats.avgDteOpen.toFixed(0)}d` : "—"}
              </div>
            </div>
            <div className="ma-hist-stat">
              <div className="ma-hist-stat__label">Streak</div>
              <div
                className="ma-hist-stat__val"
                style={{ color: streak ? (streak.wins ? "var(--green)" : "var(--red)") : "var(--text-secondary)" }}
              >
                {streak ? `${streak.count} ${streak.wins ? "W" : "L"}` : "—"}
              </div>
            </div>
          </div>
        )}

        {closedSorted.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>No closed trades yet.</p>
        ) : (
          <>
            {closedSorted.map((p, hi) => {
              const chips = closeReasonChips(p.closeReason);
              return (
                <div
                  key={`${p.id}-closed`}
                  className="ma-hist-card"
                  style={{
                    "--hist-accent": Number(p.pnl) >= 0 ? "rgba(63,185,80,0.55)" : "rgba(248,81,73,0.45)",
                    animationDelay: `${Math.min(hi, 12) * 40}ms`
                  }}
                >
                  <div className="ma-hist-card__top">
                    <span className="ma-opt-ticker" style={{ fontSize: 16, fontWeight: 800 }}>{p.ticker}</span>
                    <span className={stratBadgeClass(p.strategy)}>{STRATEGY[p.strategy]?.shortLabel || p.strategy}</span>
                    <span className="ma-mono" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {fmtMoney(p.strike)} · {fmtExpiry(p.expiration)}
                    </span>
                    <span
                      className="ma-mono"
                      style={{
                        fontSize: 15,
                        fontWeight: 800,
                        marginLeft: "auto",
                        color: Number(p.pnl) >= 0 ? "var(--green)" : "var(--red)"
                      }}
                    >
                      {fmtMoney(Number(p.pnl) || 0)}
                    </span>
                  </div>
                  <div className="ma-hist-card__dates">
                    <span>
                      Opened {p.openDate ?? "—"} → Closed {p.closeDate ?? "—"}
                    </span>
                    <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
                      {chips.map((c) => (
                        <span key={`${p.id}-${c.label}`} className={`ma-hist-badge ma-hist-badge--${c.kind}`}>
                          {c.label}
                        </span>
                      ))}
                    </span>
                  </div>
                  <div className="ma-hist-card__data">
                    Open {fmtMoney(p.openPremium)} → Close {fmtMoney(p.closePremium)}
                    {" · "}
                    <span style={{ color: Number(p.pnl) >= 0 ? "var(--green)" : "var(--red)" }}>
                      {fmtPct((Number(p.pnlPct) || 0) * 100)}
                    </span>
                    {p.dteAtOpen != null && ` · DTE@open ${p.dteAtOpen}`}
                  </div>
                </div>
              );
            })}
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
