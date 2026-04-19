import { useState, useEffect, useCallback, useMemo } from "react";
import { Box, Pill, RUN_ACTION_BAR_STYLE } from "./shared.jsx";
import { apiFetch } from "../lib/api.js";
import { MONO, SANS, TEXT, GREEN, RED, AMBER, BORDER_LIGHT } from "../lib/theme.js";
import { fmtMoney as _fmtMoney, fmtPctSigned as fmtPct } from "../lib/formatters.js";

const fmtMoney = (n) => _fmtMoney(n, 2);

const CARD_BORDER = "1px solid rgba(255,255,255,0.08)";
const STRATEGY = {
  COVERED_CALL: { label: "COVERED CALL", border: "#22c55e", bg: "rgba(34,197,94,0.15)", fg: "#22c55e" },
  CASH_SECURED_PUT: { label: "CASH-SECURED PUT", border: "#3b82f6", bg: "rgba(59,130,246,0.15)", fg: "#3b82f6" },
  REGIME_HEDGE: { label: "REGIME HEDGE", border: "#ef4444", bg: "rgba(239,68,68,0.15)", fg: "#ef4444" }
};

function fmtIv(iv) {
  if (iv == null || Number.isNaN(Number(iv))) return "—";
  const x = Number(iv);
  const pct = x <= 2 ? x * 100 : x;
  return `${pct.toFixed(0)}%`;
}

function regimeBanner(regime) {
  const r = String(regime || "normal").toLowerCase();
  if (r === "strong_bull") {
    return {
      bg: "rgba(22,101,52,0.55)",
      text: "STRONG BULL — Premium selling conditions optimal"
    };
  }
  if (r === "caution" || r === "bear") {
    return {
      bg: "rgba(127,29,29,0.55)",
      text: "CAUTION/BEAR — Hedge mode active — regime hedges surfaced"
    };
  }
  return {
    bg: "rgba(161,98,7,0.35)",
    text: "NORMAL — Selective premium selling"
  };
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

function StatCard({ label, value, tone = "neutral" }) {
  const color =
    tone === "positive"
      ? "var(--color-positive)"
      : tone === "negative"
        ? "var(--color-negative)"
        : tone === "theta"
          ? "var(--color-positive)"
          : "var(--color-text-primary)";
  return (
    <div className="ma-card" style={{ marginBottom: 0, padding: "12px 14px" }}>
      <div className="ma-sh ma-sh--compact">{label}</div>
      <div className="ma-num ma-mono" style={{ fontSize: 15, fontWeight: 700, color, marginTop: 6 }}>
        {value}
      </div>
    </div>
  );
}

function OpportunitySkeleton() {
  return (
    <div
      className="ma-options-skel"
      style={{
        border: CARD_BORDER,
        borderRadius: 10,
        padding: 16,
        minHeight: 200,
        background: "var(--color-surface)"
      }}
    />
  );
}

export default function OptionsTab({ visible = true }) {
  const [scanLoading, setScanLoading] = useState(true);
  const [scanError, setScanError] = useState(null);
  const [scan, setScan] = useState(null);

  const [pfLoading, setPfLoading] = useState(true);
  const [portfolioWrap, setPortfolioWrap] = useState(null);

  const [flash, setFlash] = useState(null);
  const [openModal, setOpenModal] = useState(null);
  const [openQty, setOpenQty] = useState(1);
  const [openSubmitting, setOpenSubmitting] = useState(false);

  const [closeModal, setCloseModal] = useState(null);
  const [closePremium, setClosePremium] = useState("");
  const [closeReason, setCloseReason] = useState("manual");
  const [closeSubmitting, setCloseSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const fetchScan = useCallback(async () => {
    setScanLoading(true);
    setScanError(null);
    try {
      const res = await apiFetch("/api/options/scan");
      const j = await res.json();
      if (!j.success) throw new Error(j.error || "Scan failed");
      setScan(j);
    } catch (e) {
      setScanError(e.message || String(e));
      setScan(null);
    } finally {
      setScanLoading(false);
    }
  }, []);

  const fetchPortfolio = useCallback(async () => {
    setPfLoading(true);
    try {
      const res = await apiFetch("/api/options/paper/portfolio");
      const j = await res.json();
      if (!j.success) throw new Error(j.error || "Portfolio failed");
      setPortfolioWrap(j.portfolio);
    } catch {
      setPortfolioWrap(null);
    } finally {
      setPfLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    fetchScan();
    fetchPortfolio();
  }, [visible, fetchScan, fetchPortfolio]);

  const mockMode = scan?.mockMode ?? portfolioWrap?.summary?.mockMode ?? true;
  const regime = scan?.regime ?? "normal";
  const banner = regimeBanner(regime);
  const opportunities = scan?.opportunities ?? [];

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
    const avgWin =
      wins.length > 0 ? wins.reduce((s, p) => s + Number(p.pnl), 0) / wins.length : null;
    const avgLoss =
      losses.length > 0 ? losses.reduce((s, p) => s + Number(p.pnl), 0) / losses.length : null;
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
    try {
      const body = {
        strategy: opp.strategy,
        ticker: opp.ticker,
        strike: opp.strike,
        expiration: opp.expiration,
        optionType: opp.strategy === "COVERED_CALL" ? "call" : "put",
        quantity: openQty,
        premium: opp.premium,
        currentPrice: opp.currentPrice,
        rationale: opp.rationale,
        osiSymbol: opp.osiSymbol,
        dte: opp.dte,
        delta: opp.delta,
        theta: opp.theta,
        iv: opp.iv,
        ivRank: opp.ivRank
      };
      const res = await apiFetch("/api/options/paper/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || "Open failed");
      setFlash("Position opened");
      setTimeout(() => setFlash(null), 4000);
      setOpenModal(null);
      await fetchPortfolio();
    } catch (e) {
      setFlash(e.message || String(e));
      setTimeout(() => setFlash(null), 5000);
    } finally {
      setOpenSubmitting(false);
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
      await fetchPortfolio();
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
      await fetchPortfolio();
    } catch (e) {
      setFlash(e.message || String(e));
      setTimeout(() => setFlash(null), 5000);
    } finally {
      setDeletingId(null);
    }
  };

  const openPositions = portfolioWrap?.positions ?? [];
  const summary = portfolioWrap?.summary;

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

  return (
    <div style={{ fontFamily: SANS, color: TEXT, paddingBottom: 48 }}>
      <style>{`
        @keyframes ma-options-pulse {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 0.7; }
        }
        .ma-options-skel {
          animation: ma-options-pulse 1.2s ease-in-out infinite;
        }
        .ma-options-grid {
          display: grid;
          gap: 12px;
          grid-template-columns: 1fr;
        }
        @media (min-width: 900px) {
          .ma-options-grid { grid-template-columns: repeat(3, 1fr); }
        }
        .ma-options-card {
          border: ${CARD_BORDER};
          border-radius: 10px;
          padding: 14px 16px;
          background: var(--color-surface);
          transition: border-color 0.15s ease;
        }
        .ma-options-card:hover {
          border-color: rgba(255,255,255,0.14);
        }
      `}</style>

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

      {/* Section A */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div className="ma-section-title" style={{ marginBottom: 6 }}>
            OPTIONS
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>
            Options opportunity scanner
          </h1>
          <p style={{ margin: "8px 0 0", opacity: 0.75, fontSize: 13 }}>
            Covered calls · Cash-secured puts · Regime hedges
          </p>
          <div
            style={{
              marginTop: 12,
              padding: "10px 14px",
              borderRadius: 8,
              background: banner.bg,
              fontSize: 12,
              fontWeight: 600,
              maxWidth: 720,
              lineHeight: 1.45
            }}
          >
            {banner.text}
          </div>
        </div>
        <div style={{ ...RUN_ACTION_BAR_STYLE, marginTop: 0, flexShrink: 0 }}>
          {mockMode ? (
            <Pill variant="amber" style={{ marginRight: 4 }}>
              MOCK MODE
            </Pill>
          ) : (
            <Pill variant="green" style={{ marginRight: 4 }}>
              LIVE
            </Pill>
          )}
          <button type="button" className="ma-btn-primary" onClick={fetchScan} disabled={scanLoading}>
            {scanLoading ? "Scanning…" : "Scan Now"}
          </button>
        </div>
      </div>

      {/* Section B */}
      <Box style={{ marginTop: 28 }}>
        <div className="ma-sh">Opportunity scanner</div>
        {scanError && (
          <div style={{ color: RED, fontSize: 13, marginTop: 8 }}>{scanError}</div>
        )}
        {scanLoading && (
          <div className="ma-options-grid" style={{ marginTop: 12 }}>
            {[1, 2, 3, 4, 5, 6].map((k) => (
              <OpportunitySkeleton key={k} />
            ))}
          </div>
        )}
        {!scanLoading && !scanError && (
          <div className="ma-options-grid" style={{ marginTop: 12 }}>
            {opportunities.map((opp, idx) => {
              const meta = STRATEGY[opp.strategy] || STRATEGY.COVERED_CALL;
              const full = opp.strategy === "REGIME_HEDGE";
              return (
                <div
                  key={`${opp.strategy}-${opp.ticker}-${idx}`}
                  className="ma-options-card"
                  style={{
                    borderLeft: `4px solid ${meta.border}`,
                    gridColumn: full ? "1 / -1" : undefined
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: "0.06em",
                        padding: "4px 8px",
                        borderRadius: 6,
                        background: meta.bg,
                        color: meta.fg
                      }}
                    >
                      {meta.label}
                    </span>
                    <span className="ma-mono" style={{ fontWeight: 800, fontSize: 16 }}>
                      {opp.ticker}
                    </span>
                    {opp.compositeScore != null && (
                      <Pill variant="neutral" title="Composite score">
                        Score {Number(opp.compositeScore).toFixed(0)}
                      </Pill>
                    )}
                    {opp.strategy === "REGIME_HEDGE" && (
                      <span style={{ fontSize: 12, opacity: 0.85 }}>Portfolio protection</span>
                    )}
                  </div>

                  {opp.strategy === "REGIME_HEDGE" && (
                    <p style={{ fontSize: 12, opacity: 0.8, margin: "0 0 10px", fontStyle: "italic" }}>
                      Bear/Caution regime detected. Buying puts to protect portfolio against downside.
                    </p>
                  )}

                  <div
                    className="ma-mono"
                    style={{ fontSize: 11, opacity: 0.9, display: "flex", flexWrap: "wrap", gap: "6px 14px" }}
                  >
                    <span>Strike {fmtMoney(opp.strike)}</span>
                    <span>Exp {opp.expiration}</span>
                    <span>DTE {opp.dte}</span>
                    <span>IV {fmtIv(opp.iv)}</span>
                    {opp.ivRank != null && <span>IVR {opp.ivRank}</span>}
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <div className="ma-mono" style={{ fontSize: 20, fontWeight: 800 }}>
                      {fmtMoney(opp.premium)} premium
                    </div>
                    <div className="ma-mono" style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>
                      Bid {fmtMoney(opp.bid)} · Ask {fmtMoney(opp.ask)}
                    </div>
                  </div>

                  <div className="ma-mono" style={{ fontSize: 11, marginTop: 8, opacity: 0.9 }}>
                    Δ {opp.delta != null ? Number(opp.delta).toFixed(2) : "—"} | Θ{" "}
                    {opp.theta != null ? Number(opp.theta).toFixed(4) : "—"}
                    {opp.annualizedYield != null && (
                      <>
                        {" "}
                        | Yield {fmtPct(opp.annualizedYield)} ann.
                      </>
                    )}
                  </div>

                  {opp.strategy === "CASH_SECURED_PUT" && (
                    <div className="ma-mono" style={{ fontSize: 11, marginTop: 6 }}>
                      Effective cost {fmtMoney(opp.effectiveCost)} ({fmtPct(opp.discount)} discount) · Required cash{" "}
                      {fmtMoney(opp.strike * 100 * 1)}
                    </div>
                  )}

                  <p style={{ fontSize: 11, fontStyle: "italic", opacity: 0.75, margin: "10px 0 8px" }}>
                    {opp.rationale}
                  </p>

                  {opp.strategy !== "REGIME_HEDGE" && (
                    <div className="ma-mono" style={{ fontSize: 11, opacity: 0.85 }}>
                      Max profit {fmtMoney(opp.maxProfit)} · Breakeven {fmtMoney(opp.breakeven)} · Max loss{" "}
                      {fmtMoney(opp.maxLoss)}
                    </div>
                  )}

                  <div style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="ma-btn-primary"
                      onClick={() => {
                        setOpenQty(1);
                        setOpenModal(opp);
                      }}
                    >
                      {opp.strategy === "REGIME_HEDGE" ? "Open Hedge" : "Open Position"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!scanLoading && !scanError && opportunities.length === 0 && (
          <p style={{ fontSize: 13, opacity: 0.7, marginTop: 12 }}>No opportunities matched the current filters.</p>
        )}
      </Box>

      {/* Section C */}
      <Box style={{ marginTop: 32 }}>
        <div className="ma-sh">Open positions</div>
        {!pfLoading && (!portfolioWrap || openPositions.length === 0) && (
          <p style={{ fontSize: 13, opacity: 0.7, marginTop: 12 }}>
            No open options positions. Run the scanner to find opportunities.
          </p>
        )}
        {!pfLoading && portfolioWrap && openPositions.length > 0 && (
          <>
            <div
              style={{
                display: "grid",
                gap: 10,
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                marginTop: 14
              }}
            >
              <StatCard
                label="Open P&L"
                value={fmtMoney(summary?.openPnl ?? 0)}
                tone={Number(summary?.openPnl) >= 0 ? "positive" : "negative"}
              />
              <StatCard
                label="Daily theta (est.)"
                value={`${fmtMoney(summary?.dailyTheta ?? 0)}/day`}
                tone="theta"
              />
              <StatCard label="Open positions" value={String(summary?.openPositions ?? 0)} />
              <StatCard
                label="Win rate (closed)"
                value={summary?.winRate != null ? `${summary.winRate.toFixed(2)}%` : "—"}
              />
            </div>

            <div className="ma-table-wrap" style={{ marginTop: 16 }}>
              <table className="ma-table ma-table--compact ma-table--zebra">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Strategy</th>
                    <th className="ma-num">Strike</th>
                    <th>Exp</th>
                    <th className="ma-num">DTE</th>
                    <th className="ma-num">Open $</th>
                    <th className="ma-num">Current $</th>
                    <th className="ma-num">P&amp;L</th>
                    <th className="ma-num">P&amp;L%</th>
                    <th className="ma-num">Δ</th>
                    <th className="ma-num">Θ</th>
                    <th>Alerts</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {openPositions.map((pos) => {
                    const dte = pos.dteRemaining ?? 0;
                    const dteColor =
                      dte <= 7 ? "var(--color-negative)" : dte <= 21 ? "var(--color-amber)" : undefined;
                    const pnl = Number(pos.pnl) || 0;
                    const pnlColor = pnl >= 0 ? "var(--color-positive)" : "var(--color-negative)";
                    return (
                      <tr key={pos.id}>
                        <td className="ma-mono">{pos.ticker}</td>
                        <td>{pos.strategy}</td>
                        <td className="ma-num ma-mono">{fmtMoney(pos.strike)}</td>
                        <td className="ma-mono">{pos.expiration}</td>
                        <td className="ma-num ma-mono" style={{ color: dteColor }}>
                          {dte}
                        </td>
                        <td className="ma-num ma-mono">{fmtMoney(pos.openPremium)}</td>
                        <td className="ma-num ma-mono">{fmtMoney(pos.currentPremium)}</td>
                        <td className="ma-num ma-mono" style={{ color: pnlColor }}>
                          {fmtMoney(pnl)}
                        </td>
                        <td className="ma-num ma-mono" style={{ color: pnlColor }}>
                          {fmtPct((Number(pos.pnlPct) || 0) * 100)}
                        </td>
                        <td className="ma-num ma-mono">
                          {pos.delta != null ? Number(pos.delta).toFixed(2) : "—"}
                        </td>
                        <td className="ma-num ma-mono">
                          {pos.theta != null ? Number(pos.theta).toFixed(4) : "—"}
                        </td>
                        <td>
                          {(pos.alerts || []).map((a) => (
                            <span key={a.type} title={a.message} style={{ marginRight: 4, cursor: "default" }}>
                              {a.type === "PROFIT_TARGET" ? "🎯" : a.type === "ROLL_ALERT" ? "⏰" : "❗"}
                            </span>
                          ))}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="ma-btn-ghost"
                            style={{ marginRight: 6 }}
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
                            style={{ marginRight: 6 }}
                            disabled={deletingId === pos.id}
                            title="Remove from open positions without recording P&L"
                            onClick={() => deleteOpenPosition(pos)}
                          >
                            {deletingId === pos.id ? "…" : "Delete"}
                          </button>
                          <button type="button" className="ma-btn-ghost" disabled title="Coming soon">
                            Roll
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Box>

      {/* Section D */}
      <Box style={{ marginTop: 32 }}>
        <div className="ma-sh">Trade history</div>
        {streak && (
          <div style={{ fontSize: 12, marginTop: 8, opacity: 0.85 }}>
            Current streak:{" "}
            <strong style={{ color: streak.wins ? GREEN : RED }}>
              {streak.count} {streak.wins ? "wins" : "losses"}
            </strong>
          </div>
        )}
        <div className="ma-table-wrap" style={{ marginTop: 12 }}>
          <table className="ma-table ma-table--compact ma-table--zebra">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Strategy</th>
                <th className="ma-num">Strike</th>
                <th>Exp</th>
                <th>Open date</th>
                <th>Close date</th>
                <th className="ma-num">Open $</th>
                <th className="ma-num">Close $</th>
                <th className="ma-num">P&amp;L</th>
                <th className="ma-num">P&amp;L%</th>
                <th className="ma-num">DTE @ open</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {closedSorted.map((p) => {
                const pnl = Number(p.pnl) || 0;
                const c = pnl >= 0 ? "var(--color-positive)" : "var(--color-negative)";
                return (
                  <tr key={`${p.id}-closed`}>
                    <td className="ma-mono">{p.ticker}</td>
                    <td>{p.strategy}</td>
                    <td className="ma-num ma-mono">{fmtMoney(p.strike)}</td>
                    <td className="ma-mono">{p.expiration}</td>
                    <td>{p.openDate}</td>
                    <td>{p.closeDate}</td>
                    <td className="ma-num ma-mono">{fmtMoney(p.openPremium)}</td>
                    <td className="ma-num ma-mono">{fmtMoney(p.closePremium)}</td>
                    <td className="ma-num ma-mono" style={{ color: c }}>
                      {fmtMoney(pnl)}
                    </td>
                    <td className="ma-num ma-mono" style={{ color: c }}>
                      {fmtPct((Number(p.pnlPct) || 0) * 100)}
                    </td>
                    <td className="ma-num ma-mono">{p.dteAtOpen ?? "—"}</td>
                    <td>{p.closeReason ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {closedSorted.length === 0 && (
          <p style={{ fontSize: 13, opacity: 0.6, marginTop: 8 }}>No closed trades yet.</p>
        )}
        <div
          className="ma-mono"
          style={{
            marginTop: 14,
            fontSize: 11,
            lineHeight: 1.7,
            opacity: 0.9,
            display: "grid",
            gap: 4,
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))"
          }}
        >
          <div>Total realized P&amp;L: {fmtMoney(historyStats.totalRealized)}</div>
          <div>
            Win rate: {historyStats.winRate != null ? `${historyStats.winRate.toFixed(2)}%` : "—"}
          </div>
          <div>Avg winner: {historyStats.avgWin != null ? fmtMoney(historyStats.avgWin) : "—"}</div>
          <div>Avg loser: {historyStats.avgLoss != null ? fmtMoney(historyStats.avgLoss) : "—"}</div>
          <div>Best trade: {historyStats.best != null ? fmtMoney(historyStats.best) : "—"}</div>
          <div>Worst trade: {historyStats.worst != null ? fmtMoney(historyStats.worst) : "—"}</div>
          <div>
            Avg DTE at open:{" "}
            {historyStats.avgDteOpen != null ? historyStats.avgDteOpen.toFixed(2) : "—"}
          </div>
        </div>
      </Box>

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
                  <td className="ma-mono">
                    {openModal.strategy === "COVERED_CALL" ? "call" : "put"}
                  </td>
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
            <p style={{ fontSize: 12, opacity: 0.8, margin: "0 0 8px" }}>
              Paper trade only — no real money at risk.
            </p>
            {mockMode && (
              <p style={{ fontSize: 12, color: AMBER, margin: "0 0 12px" }}>⚠ Mock mode — no API connection</p>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="ma-btn-ghost" disabled={openSubmitting} onClick={() => setOpenModal(null)}>
                Cancel
              </button>
              <button type="button" className="ma-btn-primary" disabled={openSubmitting} onClick={confirmOpen}>
                {openSubmitting ? "…" : "Confirm"}
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
            <div style={{ fontWeight: 800, marginBottom: 12 }}>
              Close position — {closeModal.ticker}
            </div>
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
              Est. P&amp;L:{" "}
              {closePnlPreview.pnl == null
                ? "—"
                : fmtMoney(closePnlPreview.pnl)}{" "}
              · Est. P&amp;L%:{" "}
              {closePnlPreview.pnlPct == null
                ? "—"
                : fmtPct(closePnlPreview.pnlPct * 100)}
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
              <button
                type="button"
                className="ma-btn-ghost"
                disabled={closeSubmitting}
                onClick={() => setCloseModal(null)}
              >
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
