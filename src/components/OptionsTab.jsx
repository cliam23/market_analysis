import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch, safeJson } from "../lib/api.js";
import { MONO, SANS, TEXT, GREEN, RED, AMBER, BORDER_LIGHT } from "../lib/theme.js";
import { fmtMoney as _fmtMoney, fmtPctSigned as fmtPct } from "../lib/formatters.js";

const fmtMoney = (n) => _fmtMoney(n, 2);

const STRATEGY = {
  COVERED_CALL: { label: "COVERED CALL", shortLabel: "COVERED CALL" },
  CASH_SECURED_PUT: { label: "CASH-SECURED PUT", shortLabel: "CASH-SECURED PUT" },
  REGIME_HEDGE: { label: "REGIME HEDGE", shortLabel: "REGIME HEDGE" }
};

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

export default function OptionsTab({ visible = true }) {
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [scan, setScan] = useState(null);
  const [lastScanAt, setLastScanAt] = useState(null);

  const [pfLoading, setPfLoading] = useState(false);
  const [portfolioWrap, setPortfolioWrap] = useState(null);
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

  useEffect(() => {
    if (!visible) return;
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    fetchScan();
    fetchPortfolio();
  }, [visible, fetchScan, fetchPortfolio]);

  const handleRefresh = useCallback(() => {
    hasFetchedRef.current = false;
    fetchScan();
    fetchPortfolio();
  }, [fetchScan, fetchPortfolio]);

  const mockMode = scan?.mockMode ?? portfolioWrap?.summary?.mockMode ?? true;
  const regime = scan?.regime ?? "normal";
  const regimeInfo = regimeParts(regime);
  const opportunities = scan?.opportunities ?? [];

  const filteredOpportunities = useMemo(() => {
    if (strategyFilter === "all") return opportunities;
    return opportunities.filter((o) => o.strategy === strategyFilter);
  }, [opportunities, strategyFilter]);

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
            {filteredOpportunities.map((opp, idx) => {
              const meta = STRATEGY[opp.strategy] || STRATEGY.COVERED_CALL;
              const full = opp.strategy === "REGIME_HEDGE";
              const sc = opp.compositeScore != null ? Number(opp.compositeScore) : null;
              const y = opp.annualizedYield;
              const dteLow = opp.dte != null && Number(opp.dte) < 14;
              const yieldCls = yieldToneClass(y);
              const opening = openingKey && openingKey === oppKey(opp);
              const rationalePositive =
                opp.strategy === "CASH_SECURED_PUT" || (opp.rationale && /high score|discount|yield/i.test(opp.rationale));

              return (
                <div
                  key={`${opp.strategy}-${opp.ticker}-${idx}`}
                  className="ma-options-card ma-opt-opp-card--enter"
                  style={{
                    gridColumn: full ? "1 / -1" : undefined,
                    animationDelay: `${idx * 50}ms`
                  }}
                >
                  <div className="ma-opt-opp-head">
                    <div className="ma-opt-opp-head__left">
                      <span className={stratBadgeClass(opp.strategy)}>{meta.shortLabel}</span>
                      <span className="ma-opt-ticker">{opp.ticker}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {sc != null && Number.isFinite(sc) ? (
                        <span className={`ma-opt-score-pill ${scorePillClass(sc)}`}>Score {sc.toFixed(0)}</span>
                      ) : opp.strategy === "REGIME_HEDGE" ? (
                        <span className="ma-opt-score-pill ma-opt-score-pill--lo">Hedge</span>
                      ) : null}
                    </div>
                  </div>

                  {opp.strategy === "REGIME_HEDGE" && (
                    <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 10px", fontStyle: "italic" }}>
                      Bear/Caution regime — buying puts for portfolio protection.
                    </p>
                  )}

                  <div className="ma-opt-strike-row">
                    <span>Strike {fmtMoney(opp.strike)}</span>
                    <span>·</span>
                    <span>Exp {fmtExpiry(opp.expiration)}</span>
                    <span>·</span>
                    <span className={dteLow ? "ma-opt-dte-warn" : undefined}>{opp.dte != null ? `${opp.dte}d` : "—"}</span>
                  </div>

                  <div>
                    <div className="ma-opt-premium">{fmtMoney(opp.premium)}</div>
                    <div className="ma-opt-premium-label">premium</div>
                    <div className="ma-opt-bidask">
                      Bid {fmtMoney(opp.bid)} · Ask {fmtMoney(opp.ask)}
                    </div>
                  </div>

                  <div className="ma-opt-greeks-box">
                    <div>
                      Δ {opp.delta != null ? Number(opp.delta).toFixed(2) : "—"} · θ {opp.theta != null ? Number(opp.theta).toFixed(4) : "—"}
                      {y != null && (
                        <>
                          {" "}
                          · Yield{" "}
                          <span className={yieldCls}>{fmtPct(y)}</span>
                        </>
                      )}
                    </div>
                    <div style={{ marginTop: 4 }}>
                      IV {fmtIv(opp.iv)}
                      {opp.ivRank != null && <> · IVR {opp.ivRank}</>}
                    </div>
                  </div>

                  {opp.strategy === "CASH_SECURED_PUT" && (
                    <div className="ma-mono" style={{ fontSize: 11, marginTop: 8, color: "var(--text-secondary)" }}>
                      Effective cost {fmtMoney(opp.effectiveCost)} ({fmtPct(opp.discount)} discount) · Required cash {fmtMoney(opp.strike * 100 * 1)}
                    </div>
                  )}

                  {opp.strategy !== "REGIME_HEDGE" && (
                    <>
                      <div className="ma-opt-metric-line ma-opt-metric-line--profit">Max profit {fmtMoney(opp.maxProfit)}</div>
                      <div className="ma-opt-metric-line ma-opt-metric-line--neutral">Breakeven {fmtMoney(opp.breakeven)}</div>
                      <div className="ma-opt-metric-line ma-opt-metric-line--loss">Max loss {fmtMoney(opp.maxLoss)}</div>
                    </>
                  )}

                  <p className={"ma-opt-rationale" + (rationalePositive ? " ma-opt-rationale--pos" : "")}>{opp.rationale}</p>

                  {opp.strategy !== "REGIME_HEDGE" ? (
                    <button
                      type="button"
                      className="ma-btn-primary ma-opt-open-btn"
                      disabled={opening}
                      onClick={() => {
                        setOpenQty(1);
                        setOpenModal(opp);
                      }}
                    >
                      {opening ? (
                        <>
                          <Loader2 size={16} className="ma-alphalab-loadbtn__spin" style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }} />
                          Opening…
                        </>
                      ) : (
                        "Open position"
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ma-btn-primary ma-opt-open-btn"
                      disabled={opening}
                      onClick={() => {
                        setOpenQty(1);
                        setOpenModal(opp);
                      }}
                    >
                      {opening ? (
                        <>
                          <Loader2 size={16} className="ma-alphalab-loadbtn__spin" style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }} />
                          Opening…
                        </>
                      ) : (
                        "Open hedge"
                      )}
                    </button>
                  )}
                </div>
              );
            })}
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
        <h2 className="ma-opt-section-title">Open positions{openPositions.length > 0 ? ` (${openPositions.length})` : ""}</h2>
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

      <section style={{ marginTop: 36 }}>
        <h2 className="ma-opt-section-title">Trade history</h2>
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

            <div
              style={{
                borderTop: "1px solid var(--border-card)",
                margin: "20px 0 16px",
                paddingTop: 8
              }}
            />
            <h3 className="ma-opt-section-title" style={{ marginBottom: 12 }}>
              Summary
            </h3>
            <div className="ma-opt-stats-grid">
              <div
                className="ma-bt-stat"
                style={{ "--bt-accent": plTone === "positive" ? "var(--green)" : "var(--red)" }}
              >
                <div className="ma-bt-stat__label">P&amp;L</div>
                <div
                  className="ma-bt-stat__val"
                  style={{ color: historyStats.totalRealized >= 0 ? "var(--green)" : "var(--red)" }}
                >
                  {fmtMoney(historyStats.totalRealized)}
                </div>
              </div>
              <div className="ma-bt-stat">
                <div className="ma-bt-stat__label">Win rate</div>
                <div className="ma-bt-stat__val" style={{ fontSize: 22 }}>
                  {historyStats.winRate != null ? `${historyStats.winRate.toFixed(1)}%` : "—"}
                </div>
              </div>
              <div className="ma-bt-stat">
                <div className="ma-bt-stat__label">Avg win</div>
                <div className="ma-bt-stat__val" style={{ color: "var(--green)", fontSize: 22 }}>
                  {historyStats.avgWin != null ? fmtMoney(historyStats.avgWin) : "—"}
                </div>
              </div>
              <div className="ma-bt-stat">
                <div className="ma-bt-stat__label">Avg loss</div>
                <div className="ma-bt-stat__val" style={{ color: "var(--red)", fontSize: 22 }}>
                  {historyStats.avgLoss != null ? fmtMoney(historyStats.avgLoss) : "—"}
                </div>
              </div>
            </div>
            <div className="ma-mono" style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 12, lineHeight: 1.7 }}>
              Best: {historyStats.best != null ? fmtMoney(historyStats.best) : "—"} · Worst:{" "}
              {historyStats.worst != null ? fmtMoney(historyStats.worst) : "—"} · Avg DTE:{" "}
              {historyStats.avgDteOpen != null ? historyStats.avgDteOpen.toFixed(1) : "—"}
            </div>
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
