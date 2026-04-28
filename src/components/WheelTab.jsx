import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch, safeJson } from "../lib/api.js";
import { fmtMoney as _fmtMoney } from "../lib/formatters.js";
import { SANS, TEXT, GREEN, RED, AMBER } from "../lib/theme.js";

const fmtMoney = (n) => _fmtMoney(n, 2);

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

export default function WheelTab({ visible = true }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/wheel/status?universeId=sp500_top50");
      const j = await safeJson(res);
      if (!j.success) throw new Error(j.error || "Wheel status failed");
      setStatus(j);
    } catch (e) {
      setError(e.message || String(e));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

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
        body: JSON.stringify({ universeId: "sp500_top50" })
      });
      const j = await safeJson(res);
      if (!j.success && j.mode !== "mock") throw new Error(j.error || "Wheel run failed");
      await load();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setRunning(false);
    }
  }, [load]);

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
    <div className="ma-page-container" style={{ fontFamily: SANS, color: TEXT, paddingBottom: 32 }}>
      <header>
        <p className="ma-opt-header-kicker">WHEEL</p>
        <h1 className="ma-opt-header-title">Options-Enhanced Wheel Portfolio</h1>
        <p className="ma-opt-header-sub">Equity alpha + covered call premium + cash-secured put premium</p>
      </header>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div className="ma-mono" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          Regime: <span style={{ color: regimeColor, fontWeight: 800 }}>{regime}</span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" className="ma-opt-refresh" onClick={load} disabled={loading || running}>
            Refresh
          </button>
          <button
            type="button"
            onClick={run}
            disabled={running}
            style={{
              background: running ? "#334155" : "#0EA5E9",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "10px 18px",
              cursor: running ? "not-allowed" : "pointer",
              fontWeight: 800,
              fontSize: 12
            }}
          >
            {running ? "Running…" : "Run Wheel"}
          </button>
        </div>
      </div>

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
              <StatCard label="Equity value" value={fmtMoney(summary.equityTotalValue)} />
              <StatCard label="Equity return" value={`${Number(summary.equityTotalReturnPct || 0).toFixed(2)}%`} />
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

