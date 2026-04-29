import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch, safeJson } from "../lib/api.js";
import { fmtMoney as _fmtMoney } from "../lib/formatters.js";
import { SANS, TEXT, GREEN, RED, AMBER } from "../lib/theme.js";

const fmtMoney = (n) => _fmtMoney(n, 2);

/** Matches server paper JSON files per `universeId` on GET /api/wheel/status */
export const WHEEL_EQUITY_BOOK = {
  sp500_top50: { label: "S&P 500 Top 50", file: "paper-portfolio-top50.json" },
  sp500_top150: { label: "S&P 500 Top 150", file: "paper-portfolio-top150.json" }
};

function equityBookMeta(universeId) {
  const id = String(universeId || "sp500_top50");
  return WHEEL_EQUITY_BOOK[id] || WHEEL_EQUITY_BOOK.sp500_top50;
}

function StatCard({ label, value, tone }) {
  const color = tone === "good" ? GREEN : tone === "bad" ? RED : TEXT;
  return (
    <div className="ma-bt-stat" style={{ "--bt-accent": color }}>
      <div className="ma-bt-stat__label">{label}</div>
      <div className="ma-bt-stat__val" style={{ fontSize: 20, color, fontFamily: "monospace" }}>
        {value}
      </div>
    </div>
  );
}

export default function WheelTab({
  visible = true,
  universeId = "sp500_top50",
  embedded = true
}) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState(null);

  const book = useMemo(() => equityBookMeta(universeId), [universeId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ universeId: String(universeId || "sp500_top50") });
      const res = await apiFetch(`/api/wheel/status?${q}`);
      const j = await safeJson(res);
      if (!j.success) throw new Error(j.error || "Wheel status failed");
      setStatus(j);
    } catch (e) {
      setError(e.message || String(e));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [universeId]);

  useEffect(() => {
    if (!visible) return;
    load();
  }, [visible, load]);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await apiFetch("/api/wheel/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ universeId: String(universeId || "sp500_top50") })
      });
      const j = await safeJson(res);
      if (!j.success && j.mode !== "mock") throw new Error(j.error || "Wheel run failed");
      await load();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setRunning(false);
    }
  }, [load, universeId]);

  const optimize = useCallback(async () => {
    setOptimizing(true);
    setError(null);
    try {
      const res = await apiFetch("/api/wheel/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ universeId: String(universeId || "sp500_top50") })
      });
      const j = await safeJson(res);
      if (!j.success) throw new Error(j.error || "Wheel optimize failed");
      await load();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setOptimizing(false);
    }
  }, [load, universeId]);

  const summary = status?.summary;
  const legs = status?.optionsLegs ?? [];
  const toneCombined = (summary?.combinedPnl ?? 0) >= 0 ? "good" : "bad";

  const regime = status?.equity?.regime ?? summary?.regime ?? "unknown";
  const regimeColor =
    regime === "strong_bull"
      ? GREEN
      : regime === "normal"
        ? "#0EA5E9"
        : regime === "pullback"
          ? AMBER
          : regime === "caution"
            ? "#F97316"
            : regime === "bear"
              ? RED
              : "#64748B";

  const openPnl = useMemo(() => {
    if (!legs.length) return 0;
    return legs.reduce((s, l) => s + (Number(l.currentPnL) || 0), 0);
  }, [legs]);

  return (
    <div
      className={embedded ? "ma-pt-wheel-embed" : "ma-page-container"}
      style={{ fontFamily: SANS, color: TEXT, paddingBottom: embedded ? 16 : 32 }}
    >
      <header>
        {!embedded && <p className="ma-opt-header-kicker">WHEEL</p>}
        <h1 className={embedded ? "ma-section-title" : "ma-opt-header-title"} style={{ marginBottom: embedded ? 8 : undefined }}>
          Options-Enhanced Wheel
        </h1>
        <p className="ma-opt-header-sub" style={{ marginBottom: 12 }}>
          Equity alpha + covered-call premium + cash-secured put premium
        </p>
      </header>

      <div
        className="ma-pt-wheel-equity-banner"
        role="status"
        style={{
          marginBottom: 16,
          padding: "12px 14px",
          borderRadius: 8,
          border: "1px solid var(--border-card)",
          background: "rgba(14, 165, 233, 0.08)",
          fontSize: 13,
          lineHeight: 1.55
        }}
      >
        <strong style={{ color: "var(--text-primary)" }}>Equity portfolio source</strong>
        <div style={{ marginTop: 6, color: "var(--text-secondary)" }}>
          This wheel reads holdings and NAV from the{" "}
          <strong style={{ color: "var(--text-primary)" }}>{book.label}</strong> paper trade book{" "}
          <span className="ma-mono" style={{ fontSize: 12, opacity: 0.9 }}>
            ({book.file})
          </span>
          . CC legs target stocks you already hold in that book; CSPs consider high-score names from the same universe scan.
        </div>
      </div>

      <div
        className="ma-pt-wheel-metrics-explainer"
        role="region"
        aria-label="What equity value means versus wheel profits"
        style={{
          marginBottom: 16,
          padding: "14px 16px",
          borderRadius: 8,
          border: "1px solid var(--border-card)",
          background: "rgba(251, 191, 36, 0.06)",
          fontSize: 13,
          lineHeight: 1.65,
          color: "var(--text-secondary)"
        }}
      >
        <div style={{ fontWeight: 800, color: "var(--text-primary)", marginBottom: 8, fontSize: 13 }}>
          Equity value is not your wheel “take-home”
        </div>
        <p style={{ margin: "0 0 10px" }}>
          <strong style={{ color: "var(--text-primary)" }}>Paper portfolio value</strong> (shown as{" "}
          <span className="ma-mono">Paper NAV</span> below) is the total market value of your Paper Trade account—stocks and
          cash. It moves with the market and rebalances;{" "}
          <strong style={{ color: "var(--text-primary)" }}>it is not the cumulative profit from selling options alone</strong>.
        </p>
        <p style={{ margin: "0 0 10px" }}>
          <strong style={{ color: "var(--text-primary)" }}>What comes from the wheel</strong> shows up in{" "}
          <span className="ma-mono">Premium collected</span>, <span className="ma-mono">Options P&amp;L</span>
          (realized / tracked on closed legs), and <span className="ma-mono">Open P&amp;L</span> on positions still open.
        </p>
        <p style={{ margin: 0 }}>
          <strong style={{ color: "var(--text-primary)" }}>Combined P&amp;L</strong> is an approximation: dollar move implied
          by your paper portfolio&apos;s return percentage, <em>plus</em> cumulative options P&amp;L—it mixes equity performance
          with the options overlay; use the options lines when you only care about premium selling results.
        </p>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <div className="ma-mono" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            Regime: <span style={{ color: regimeColor, fontWeight: 800 }}>{regime}</span>
          </div>
          {/* Auto-reload badge */}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px",
            borderRadius: 20, background: "rgba(16, 185, 129, 0.12)",
            border: "1px solid rgba(16, 185, 129, 0.35)", fontSize: 11
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
            <span className="ma-mono" style={{ color: "#10b981", fontWeight: 700 }}>Auto-reload ON</span>
          </div>
          {status?.equity != null && (
            <div className="ma-mono" style={{ fontSize: 10, color: "var(--text-secondary)" }}>
              {status.optionsLegs?.length ?? 0} / {5} legs · auto-replaces underperformers · refills after close
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="ma-opt-refresh" onClick={load} disabled={loading || running || optimizing}>
            Refresh
          </button>
          <button
            type="button"
            onClick={optimize}
            disabled={optimizing || running}
            style={{
              background: optimizing ? "#334155" : "rgba(14, 165, 233, 0.15)",
              color: optimizing ? "var(--text-secondary)" : "#0EA5E9",
              border: "1px solid #0EA5E9",
              borderRadius: 8,
              padding: "8px 14px",
              cursor: optimizing ? "not-allowed" : "pointer",
              fontWeight: 700,
              fontSize: 11,
              fontFamily: "var(--font-mono)"
            }}
          >
            {optimizing ? "Optimizing…" : "Optimize Now"}
          </button>
          <button
            type="button"
            onClick={run}
            disabled={running || optimizing}
            style={{
              background: running ? "#334155" : "#0EA5E9",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "8px 14px",
              cursor: running ? "not-allowed" : "pointer",
              fontWeight: 800,
              fontSize: 12
            }}
          >
            {running ? "Running…" : "Run Wheel"}
          </button>
        </div>
      </div>

      {/* Last optimized / last run timestamps */}
      {(status?.equity != null) && (
        <div className="ma-mono" style={{ fontSize: 10, color: "var(--text-secondary)", marginBottom: 10, lineHeight: 1.6 }}>
          {status?.lastOptimized && (
            <span style={{ marginRight: 12 }}>
              Last optimized: {new Date(status.lastOptimized).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </span>
          )}
          <span>Auto schedule: 9:35 AM + 2:45 PM ET every trading day</span>
        </div>
      )}

      {error && <div style={{ marginTop: 12, color: RED, fontSize: 13 }}>{error}</div>}

      <section style={{ marginTop: 16 }}>
        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-secondary)" }}>
            <Loader2 className="spin" size={18} />
            Loading wheel status…
          </div>
        )}

        {!loading && summary && (
          <>
            <div className="ma-opt-stats-grid">
              <StatCard label="Paper NAV (stocks + cash)" value={fmtMoney(summary.equityTotalValue)} />
              <StatCard label="Paper portfolio return" value={`${Number(summary.equityTotalReturnPct || 0).toFixed(2)}%`} />
              <StatCard label="Premium collected" value={fmtMoney(summary.premiumCollected)} tone="good" />
              <StatCard label="Options P&L" value={fmtMoney(summary.optionsPnl)} tone={summary.optionsPnl >= 0 ? "good" : "bad"} />
              <StatCard label="Combined P&L" value={fmtMoney(summary.combinedPnl)} tone={toneCombined} />
              <StatCard label="Open legs" value={String(summary.optionsOpenLegs ?? 0)} />
              <StatCard label="Open P&L" value={fmtMoney(openPnl)} tone={openPnl >= 0 ? "good" : "bad"} />
              <StatCard label="Win rate" value={summary.winRatePct != null ? `${summary.winRatePct.toFixed(1)}%` : "—"} />
            </div>
          </>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 className="ma-opt-section-title">Open wheel legs ({legs.length})</h2>
        {legs.length === 0 ? (
          <div className="ma-opt-empty-card">
            <div className="ma-mono" style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
              No open legs
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              Click “Run Wheel” to scan and open CC/CSP legs (regime-gated).
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {legs.map((leg) => {
              const pnl = Number(leg.currentPnL) || 0;
              return (
                <div
                  key={leg.optionSymbol || `${leg.ticker}-${leg.expiration}-${leg.strike}`}
                  className="ma-opt-pos-card"
                >
                  <div className="ma-opt-pos-card__main">
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span className="ma-opt-ticker" style={{ fontSize: 16 }}>
                        {leg.ticker}
                      </span>
                      <span className="ma-opt-strat-badge ma-opt-strat-badge--cc">
                        {leg.strategy === "CASH_SECURED_PUT" ? "CSP" : "CC"}
                      </span>
                      <span className="ma-mono" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                        {leg.optionSymbol}
                      </span>
                    </div>
                    <div className="ma-mono" style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                      Strike {fmtMoney(leg.strike)} · Exp {String(leg.expiration || "—")} · Credit {fmtMoney(leg.entryCredit)}
                    </div>
                    <div className="ma-mono" style={{ fontSize: 12, marginTop: 4 }}>
                      P&amp;L{" "}
                      <span style={{ color: pnl >= 0 ? GREEN : RED, fontWeight: 800 }}>
                        {fmtMoney(pnl)}
                      </span>
                      {leg.currentDTE != null && (
                        <span style={{ marginLeft: 10, color: leg.currentDTE <= 21 ? AMBER : "var(--text-secondary)" }}>
                          DTE {leg.currentDTE}
                        </span>
                      )}
                    </div>
                    {leg.reason && (
                      <div className="ma-mono" style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 6 }}>
                        {leg.reason}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

