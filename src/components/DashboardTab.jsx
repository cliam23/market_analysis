import { useState, useEffect, useRef, useMemo } from "react";
import { apiFetch, apiFetchBypassBrowserCache, safeJson } from "../lib/api.js";
import { fmtDate } from "../lib/formatters.js";
import { CongressSignalInline, InfoTip } from "./shared.jsx";
import { EDUCATION } from "../lib/education.js";
import { UNIVERSE_OPTIONS } from "../lib/constants.js";

/** Must match PaperTradeTab (`PAPER_TRADE_NAV_UNIVERSE_KEY`). */
const PAPER_TRADE_NAV_UNIVERSE_KEY = "ma-paper-trade-nav-universe";

const DASH_PAPER_UNIVERSES = ["sp500_top50", "sp500_top150"];

function clamp(n, a, b) {
  return Math.min(b, Math.max(a, n));
}

function useCountUp(target, enabled, durationMs = 700) {
  const [v, setV] = useState(0);
  const rafRef = useRef(0);
  useEffect(() => {
    if (!enabled || target == null || !Number.isFinite(Number(target))) {
      setV(Number(target) || 0);
      return;
    }
    const to = Number(target);
    const start = performance.now();
    const tick = (now) => {
      const t = clamp((now - start) / durationMs, 0, 1);
      const eased = 1 - (1 - t) ** 3;
      setV(to * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, enabled, durationMs]);
  return v;
}

const SPARK_W = 80;
const SPARK_H = 32;

function sparklinePath(data, width, height) {
  if (!data || data.length < 2) return "";
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  return data
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function Sparkline({ values, positive }) {
  const path = useMemo(() => sparklinePath(values, SPARK_W, SPARK_H), [values]);
  const up =
    positive != null
      ? positive
      : values?.length >= 2
        ? values[values.length - 1] >= values[0]
        : true;
  const stroke = up ? "#3fb950" : "#f85149";
  if (!path) {
    return <svg width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} className="ma-dash-spark" aria-hidden />;
  }
  return (
    <svg
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      fill="none"
      className="ma-dash-spark ma-dash-spark--draw"
      aria-hidden
    >
      <path d={path} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function fmtUsd(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const x = Number(n);
  if (Math.abs(x) >= 1e6) return `$${(x / 1e6).toFixed(2)}M`;
  if (Math.abs(x) >= 1e4) return `$${(x / 1e3).toFixed(1)}k`;
  return `$${x.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const s = n >= 0 ? "+" : "";
  return `${s}${Number(n).toFixed(2)}%`;
}

function relTime(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** One-line, jargon-free gloss for a raw regime string — shown next to the regime pill. */
function regimePlainText(raw) {
  const r = String(raw || "").toLowerCase();
  if (r === "strong_bull") return "healthy, strong market";
  if (r === "normal") return "steady, healthy market";
  if (r === "pullback" || r === "correction") return "mild dip after a run-up";
  if (r === "caution") return "shakier conditions — trimming risk";
  if (r === "bear") return "sustained downturn — playing defense";
  return "";
}

function regimeToneClass(tone) {
  if (tone === "bull") return "ma-dash-regime--bull";
  if (tone === "pullback") return "ma-dash-regime--pullback";
  if (tone === "caution") return "ma-dash-regime--caution";
  if (tone === "bear") return "ma-dash-regime--bear";
  return "ma-dash-regime--neutral";
}

function trendArrow(trend) {
  if (trend === "up") return "↑";
  if (trend === "down") return "↓";
  return "→";
}

/** Factor pulse: API sends decimal weights (0.353); legacy payloads may double-scale weightPct. */
function factorPulseBarPct(f) {
  const w = Number(f?.weight);
  const p = Number(f?.weightPct);
  if (Number.isFinite(w) && w >= 0 && w <= 1) return w * 100;
  if (Number.isFinite(p) && p > 100 && Number.isFinite(w) && w > 1) return Math.min(100, w);
  if (Number.isFinite(p) && p > 100) return Math.min(100, p / 100);
  if (Number.isFinite(p)) return Math.min(100, p);
  return 0;
}

export default function DashboardTab({ setTab }) {
  const [indices, setIndices] = useState(null);
  const [summary, setSummary] = useState(null);
  const [paperByUniverse, setPaperByUniverse] = useState({});
  const [posUniverse, setPosUniverse] = useState("sp500_top150");
  const [err, setErr] = useState(null);
  const [boot, setBoot] = useState(true);
  const [scoresSnapshot, setScoresSnapshot] = useState(null);
  const [scoresErr, setScoresErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const loadIndices = async () => {
      try {
        const iRes = await apiFetchBypassBrowserCache("/api/market/indices");
        const iData = await safeJson(iRes);
        if (!cancelled) setIndices(iData);
      } catch {
        /* keep last good indices */
      }
    };
    const loadSummary = async () => {
      setErr(null);
      try {
        const sRes = await apiFetchBypassBrowserCache("/api/dashboard/summary");
        const sData = await safeJson(sRes);
        if (!cancelled) setSummary(sData);
      } catch (e) {
        if (!cancelled) setErr(e.message);
      } finally {
        if (!cancelled) setBoot(false);
      }
    };
    loadIndices();
    loadSummary();
    const id = setInterval(loadIndices, 60000);
    const onVis = () => {
      if (document.visibilityState !== "visible" || cancelled) return;
      loadIndices();
      loadSummary();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = {};
      await Promise.all(
        DASH_PAPER_UNIVERSES.map(async (universe) => {
          try {
            const res = await apiFetch(
              `/api/paper-trade/portfolio?universe=${encodeURIComponent(universe)}`,
              { headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } }
            );
            let data;
            try {
              data = await res.json();
            } catch {
              next[universe] = null;
              return;
            }
            if (!res.ok || data.success === false) {
              next[universe] = null;
              return;
            }
            const port = data.portfolio ?? data;
            const holdingsRaw = port?.holdings ?? port?.positions;
            const holdings = Array.isArray(holdingsRaw) ? holdingsRaw : [];
            next[universe] = {
              success: true,
              portfolio: port && typeof port === "object" ? { ...port, holdings } : { holdings }
            };
          } catch {
            next[universe] = null;
          }
        })
      );
      if (!cancelled) setPaperByUniverse(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/scores");
        const data = await safeJson(res);
        if (!cancelled && data?.success) setScoresSnapshot(data);
        else if (!cancelled) setScoresErr("Snapshot not available yet.");
      } catch {
        if (!cancelled) setScoresErr("Snapshot not available yet.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const paperPos = paperByUniverse[posUniverse];

  const holdingsSorted = useMemo(() => {
    const h = paperPos?.portfolio?.holdings ?? paperPos?.portfolio?.positions;
    if (!Array.isArray(h)) return { winners: [], losers: [] };
    const sorted = [...h].sort((a, b) => (b.pnlPct ?? 0) - (a.pnlPct ?? 0));
    return {
      winners: sorted.slice(0, 5),
      losers: sorted.slice(-3).reverse()
    };
  }, [paperPos]);

  const p50 = summary?.portfolios?.sp500_top50;
  const p150 = summary?.portfolios?.sp500_top150;
  const badge = summary?.regimeBadge;
  const movers = summary?.topMovers;
  const sectors = summary?.sectorBreakdown ?? [];

  const anim = !boot;

  // True once the initial load has settled and /api/dashboard/summary never
  // came back — i.e. only the lightweight /api/scores backend is reachable
  // (the Vercel-only deploy). The full Express endpoints (positions, market
  // indices, performance, rebalance history) need server.js, which that
  // deploy intentionally doesn't run — see README § Live deployment.
  const liteMode = !boot && !summary;

  const goPaper = (uid) => {
    try {
      sessionStorage.setItem(PAPER_TRADE_NAV_UNIVERSE_KEY, uid);
    } catch {
      /* ignore */
    }
    setTab("papertrade");
  };

  const totalValAnim = useCountUp(p150?.totalValue ?? p50?.totalValue, anim);

  return (
    <div className="ma-dashboard">
      {err && !liteMode && (
        <div className="ma-dash-banner" role="alert">
          {err}
        </div>
      )}

      {(summary?.localSnapshot || indices?.localSnapshot) && (
        <div
          className="ma-dash-banner"
          style={{
            background: "rgba(88,166,255,0.06)",
            borderColor: "rgba(88,166,255,0.28)"
          }}
          role="status"
        >
          <span className="ma-dash-muted">
            Saved UI snapshot (fast local read). Age ~{Math.round((summary?.snapshotAgeMs ?? indices?.snapshotAgeMs ?? 0) / 1000)}s — refresh data with{" "}
            <span className="ma-mono">LOCAL_UI_SNAPSHOTS=0</span> or update files via <span className="ma-mono">npm run snapshot:ui</span>.
          </span>
        </div>
      )}

      {liteMode && (
        <div className="ma-dash-banner" style={{ background: "rgba(88,166,255,0.06)", borderColor: "rgba(88,166,255,0.28)" }} role="status">
          <span className="ma-dash-muted">
            No backend data available yet — this deploy runs a lightweight public API (<span className="ma-mono">/api/scores</span>{" "}
            and a read-only mirror of a few other routes) that's populated by a scheduled pipeline. Check back after
            its first run, or see <span className="ma-mono">README § Live deployment</span> to run the full backend.
          </span>
        </div>
      )}

      {liteMode && <TopPicksCard scoresSnapshot={scoresSnapshot} scoresErr={scoresErr} delay="0ms" />}

      {!liteMode && (
      <>
      <header className="ma-dash-indices">
        <div className="ma-dash-indices__grid">
          {(indices?.indices ?? []).map((ix) => {
            const ch = ix.change;
            const pos = ch == null ? null : ch >= 0;
            return (
              <div key={ix.symbol} className="ma-dash-index-cell">
                <div className="ma-dash-index-cell__top">
                  <div className="ma-dash-index-name">{ix.name}</div>
                  <div className="ma-dash-index-cell__spark" aria-hidden>
                    <Sparkline values={ix.sparkline} positive={pos} />
                  </div>
                </div>
                <div className="ma-dash-index-cell__mid ma-mono">
                  {ix.price != null ? ix.price.toLocaleString() : "—"}
                </div>
                <div
                  className={
                    "ma-dash-index-cell__chg ma-mono " +
                    (pos === true ? "ma-dash-pos" : pos === false ? "ma-dash-neg" : "")
                  }
                >
                  {ch != null ? fmtPct(ch) : "—"}
                </div>
              </div>
            );
          })}
        </div>
        <div className="ma-dash-indices__meta">
          {indices?.updatedAt ? (
            <span className="ma-dash-muted">Updated {relTime(indices.updatedAt)}</span>
          ) : null}
          {indices?.staleWarning ? (
            <span className="ma-dash-muted"> · {indices.staleWarning}</span>
          ) : null}
        </div>
      </header>

      <div className="ma-dash-layout">
        <div className="ma-dash-main">
          <section className="ma-dash-card ma-dash-card--a" style={{ animationDelay: "0ms" }}>
            <h2 className="ma-dash-h2" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Market regime & system
              <InfoTip title={EDUCATION.marketRegime.title}>{EDUCATION.marketRegime.content}</InfoTip>
            </h2>
            <p className="ma-dash-muted" style={{ marginTop: -6, marginBottom: 12 }}>
              How risky conditions look right now, and how the strategy is responding.
            </p>
            <div className="ma-dash-regime-row">
              <div className={"ma-dash-regime " + regimeToneClass(badge?.tone)}>
                {badge?.label ?? "—"}
              </div>
              <div className="ma-dash-system-lines">
                <div className="ma-dash-muted ma-dash-system-line">{regimePlainText(badge?.raw)}</div>
                {(summary?.systemStatus?.lines ?? []).map((ln) => (
                  <div key={ln} className="ma-dash-system-line">
                    {ln}
                  </div>
                ))}
                <div className="ma-dash-muted ma-dash-system-line">
                  Last rebalance:{" "}
                  {summary?.systemStatus?.lastRebalance
                    ? fmtDate(summary.systemStatus.lastRebalance)
                    : "—"}{" "}
                  · Next:{" "}
                  {summary?.systemStatus?.nextRebalance
                    ? fmtDate(summary.systemStatus.nextRebalance)
                    : "—"}
                </div>
              </div>
            </div>
            <p className="ma-dash-muted" style={{ marginTop: 12, marginBottom: 4 }}>
              How much each signal currently matters when picking stocks:
            </p>
            <AdaptiveWeightsBar weights={summary?.systemStatus?.adaptiveWeights} />
          </section>

          <section className="ma-dash-card" style={{ animationDelay: "50ms" }}>
            <h2 className="ma-dash-h2" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Performance overview
              <InfoTip title={EDUCATION.paperPortfolio.title}>{EDUCATION.paperPortfolio.content}</InfoTip>
            </h2>
            <p className="ma-dash-muted" style={{ marginTop: -6, marginBottom: 12 }}>
              Two practice portfolios (no real money) tracking how the strategy performs. Click either to see full detail.
            </p>
            <div className="ma-dash-perf-grid">
              {[
                { id: "sp500_top50", label: "S&P Top 50", card: p50 },
                { id: "sp500_top150", label: "S&P Top 150", card: p150 }
              ].map(({ id, label, card }) => (
                <button
                  key={id}
                  type="button"
                  className="ma-dash-perf-tile"
                  onClick={() => card && goPaper(id)}
                  disabled={!card}
                >
                  <div className="ma-dash-perf-tile__label">{label}</div>
                  <div className="ma-dash-perf-tile__value ma-mono">
                    {card ? fmtUsd(card.totalValue) : "—"}
                  </div>
                  <div
                    className={
                      "ma-dash-perf-tile__ret ma-mono " +
                      (card && card.returnPct >= 0 ? "ma-dash-pos" : "ma-dash-neg")
                    }
                  >
                    {card ? fmtPct(card.returnPct) : "—"}
                  </div>
                  <div className="ma-dash-muted">
                    {card ? `${card.positions} stocks` : "No data"}
                    {card ? ` · Auto-adjust: ${card.rlActive ? "On" : "Off"}` : ""}
                  </div>
                  <div className="ma-dash-muted">
                    Next: {card?.nextRebalance ? fmtDate(card.nextRebalance) : "—"}
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="ma-dash-card" style={{ animationDelay: "100ms" }}>
            <h2 className="ma-dash-h2">Recent signals</h2>
            <p className="ma-dash-muted" style={{ marginTop: -6, marginBottom: 12 }}>
              A plain-English log of what the strategy bought or sold at each rebalance.
            </p>
            <ul className="ma-dash-feed">
              {(summary?.recentSignals ?? []).length === 0 && (
                <li className="ma-dash-muted">No rebalance history yet.</li>
              )}
              {(summary?.recentSignals ?? []).map((sig) => (
                <li key={sig.date} className="ma-dash-feed__item">
                  <div className="ma-dash-feed__date">{fmtDate(sig.date)}</div>
                  <div className="ma-dash-feed__body">
                    {sig.buys?.length > 0 && (
                      <span className="ma-dash-pos">
                        Bought {sig.buys.slice(0, 8).join(", ")}
                        {sig.buys.length > 8 ? "…" : ""}.{" "}
                      </span>
                    )}
                    {sig.sells?.length > 0 && (
                      <span className="ma-dash-neg">
                        Sold {sig.sells.slice(0, 8).join(", ")}
                        {sig.sells.length > 8 ? "…" : ""}.{" "}
                      </span>
                    )}
                    {sig.stopTickers?.length > 0 && (
                      <span className="ma-dash-neg">Stops: {sig.stopTickers.join(", ")}. </span>
                    )}
                    {(!sig.buys?.length && !sig.sells?.length) && <span>Held positions. </span>}
                    <span className={"ma-dash-regime ma-dash-regime--inline " + regimeToneClass(dashboardRegimeTone(sig.regime))}>
                      {sig.regime?.replace(/_/g, " ") || "—"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="ma-dash-card" style={{ animationDelay: "150ms" }}>
            <h2 className="ma-dash-h2">Factor pulse</h2>
            <p className="ma-dash-muted" style={{ marginTop: -6, marginBottom: 12 }}>
              Whether each signal has been working better or worse lately.
            </p>
            {(summary?.factorPulse?.factors ?? []).length === 0 && (
              <p className="ma-dash-muted">No adaptive weight history yet (run a rebalance).</p>
            )}
            <ul className="ma-dash-factor-list">
              {(summary?.factorPulse?.factors ?? []).map((f) => {
                const barPct = clamp(factorPulseBarPct(f), 0, 100);
                const labelPct = (() => {
                  const w = Number(f?.weight);
                  if (Number.isFinite(w) && w >= 0 && w <= 1) return w * 100;
                  return barPct;
                })();
                return (
                  <li key={f.key} className="ma-dash-factor-row">
                    <div className="ma-dash-factor-name">{f.label}</div>
                    <div className="ma-dash-factor-bar-wrap">
                      <div className="ma-dash-factor-bar" style={{ width: `${barPct}%` }} />
                    </div>
                    <div className="ma-dash-factor-pct ma-mono">{labelPct.toFixed(1)}%</div>
                    <div className="ma-dash-factor-trend ma-mono">
                      {trendArrow(f.trend)} {f.pulseLabel}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <TopPicksCard scoresSnapshot={scoresSnapshot} scoresErr={scoresErr} delay="200ms" />
        </div>

        <aside className="ma-dash-side">
          <section className="ma-dash-card" style={{ animationDelay: "40ms" }}>
            <div className="ma-dash-side-head">
              <h2 className="ma-dash-h2">My positions</h2>
              <div className="ma-dash-tabs">
                {["sp500_top50", "sp500_top150"].map((u) => (
                  <button
                    key={u}
                    type="button"
                    className={
                      "ma-dash-tab " + (posUniverse === u ? "ma-dash-tab--on" : "")
                    }
                    onClick={() => setPosUniverse(u)}
                  >
                    {u === "sp500_top50" ? "Top 50" : "Top 150"}
                  </button>
                ))}
              </div>
            </div>
            <p className="ma-dash-muted" style={{ marginTop: -8, marginBottom: 10 }}>
              What the practice portfolio owns right now, best performers first.
            </p>
            <div className="ma-dash-pos-list">
              {holdingsSorted.winners.map((h) => (
                <div key={h.ticker} className="ma-dash-pos-row">
                  <span className="ma-dash-ticker-wrap" style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span className="ma-dash-ticker ma-mono">{h.ticker}</span>
                    <CongressSignalInline
                      variant="mini"
                      score={h.congressScore}
                      sentiment={h.congressSentiment}
                      politicians={h.congressPoliticians}
                      netBuys={h.congressNetBuys}
                    />
                  </span>
                  <span className="ma-mono">
                    {h.currentPrice != null ? `$${Number(h.currentPrice).toFixed(2)}` : "—"}
                  </span>
                  <span className={(h.pnlPct ?? 0) >= 0 ? "ma-dash-pos ma-mono" : "ma-dash-neg ma-mono"}>
                    {fmtPct(h.pnlPct ?? 0)} {(h.pnlPct ?? 0) >= 0 ? "▲" : "▼"}
                  </span>
                </div>
              ))}
              {holdingsSorted.losers.length > 0 && <div className="ma-dash-pos-divider" />}
              {holdingsSorted.losers.map((h) => (
                <div key={h.ticker} className="ma-dash-pos-row">
                  <span className="ma-dash-ticker-wrap" style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span className="ma-dash-ticker ma-mono">{h.ticker}</span>
                    <CongressSignalInline
                      variant="mini"
                      score={h.congressScore}
                      sentiment={h.congressSentiment}
                      politicians={h.congressPoliticians}
                      netBuys={h.congressNetBuys}
                    />
                  </span>
                  <span className="ma-mono">
                    {h.currentPrice != null ? `$${Number(h.currentPrice).toFixed(2)}` : "—"}
                  </span>
                  <span className="ma-dash-neg ma-mono">
                    {fmtPct(h.pnlPct ?? 0)} ▼
                  </span>
                </div>
              ))}
              {!holdingsSorted.winners.length && !holdingsSorted.losers.length && (
                <div className="ma-dash-muted">No open positions.</div>
              )}
            </div>
          </section>

          <section className="ma-dash-card" style={{ animationDelay: "90ms" }}>
            <h2 className="ma-dash-h2">Top movers (ranking)</h2>
            <p className="ma-dash-muted" style={{ marginTop: -6, marginBottom: 12 }}>
              Stocks whose score changed the most, or traded the most, in the current ranking.
            </p>
            <MoversPanel movers={movers} />
          </section>

          <section className="ma-dash-card" style={{ animationDelay: "130ms" }}>
            <h2 className="ma-dash-h2">Sector mix</h2>
            <p className="ma-dash-muted" style={{ marginTop: -6, marginBottom: 12 }}>
              How the practice portfolio is spread across industries.
            </p>
            {sectors.length === 0 ? (
              <p className="ma-dash-muted">No holdings to map.</p>
            ) : (
              <ul className="ma-dash-sector-list">
                {sectors.slice(0, 8).map((s) => (
                  <li key={s.name} className="ma-dash-sector-row">
                    <span>{s.name}</span>
                    <span className="ma-mono">{fmtUsd(s.value)}</span>
                    <span className="ma-mono">{s.pct.toFixed(1)}%</span>
                    <div className="ma-dash-sector-bar-wrap">
                      <div className="ma-dash-sector-bar" style={{ width: `${s.pct}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ma-dash-card ma-dash-card--mini" style={{ animationDelay: "170ms" }}>
            <div className="ma-dash-muted">Combined portfolio value (primary)</div>
            <div className="ma-dash-kpi ma-mono">{fmtUsd(totalValAnim)}</div>
          </section>
        </aside>
      </div>
      </>
      )}
    </div>
  );
}

function friendlyUniverseLabel(id) {
  return UNIVERSE_OPTIONS.find((u) => u.id === id)?.label || id || "—";
}

function sizingMethodPlain(method) {
  const m = String(method || "").toLowerCase();
  if (m === "invvol") return "weighted by stability";
  if (m === "score") return "weighted by score";
  if (m === "equal") return "equally";
  return method || "—";
}

/** Renamed from "Live snapshot (public API)" — see conversation with the user
 * about making the dashboard approachable for non-traders. Shown as the sole
 * lead content on the lite (Vercel-only) deploy, or lower in the page,
 * after the paper portfolios, once the full backend's own data has loaded. */
function TopPicksCard({ scoresSnapshot, scoresErr, delay }) {
  return (
    <section className="ma-dash-card" style={{ animationDelay: delay }}>
      <h2 className="ma-dash-h2" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        Today&apos;s top-ranked stocks
        <InfoTip title={EDUCATION.topPicks.title}>{EDUCATION.topPicks.content}</InfoTip>
      </h2>
      <p className="ma-dash-muted" style={{ marginTop: -6, marginBottom: 12 }}>
        The 5 highest-scoring stocks right now, out of the universe the model tracks — not a buy recommendation.
      </p>
      {scoresErr && !scoresSnapshot && <p className="ma-dash-muted">{scoresErr}</p>}
      {scoresSnapshot && (
        <>
          <div className="ma-dash-muted" style={{ marginBottom: 8 }}>
            {friendlyUniverseLabel(scoresSnapshot.universeId)} ·{" "}
            <span className={"ma-dash-regime ma-dash-regime--inline " + regimeToneClass(dashboardRegimeTone(scoresSnapshot.regime))}>
              {scoresSnapshot.regime?.replace(/_/g, " ") || "—"}
            </span>{" "}
            market ({regimePlainText(scoresSnapshot.regime)}) · updated {relTime(scoresSnapshot.generatedAt)}
            <br />
            Currently investing{" "}
            {scoresSnapshot.rl?.decision?.exposure != null
              ? `~${Math.round(scoresSnapshot.rl.decision.exposure * 100)}%`
              : "—"}{" "}
            of the portfolio across {scoresSnapshot.rl?.decision?.positionCount ?? "—"} stocks, {" "}
            {sizingMethodPlain(scoresSnapshot.rl?.decision?.sizingMethod)}
          </div>
          <ul className="ma-dash-factor-list">
            {(scoresSnapshot.topScores ?? []).slice(0, 5).map((r) => (
              <li key={r.ticker} className="ma-dash-factor-row">
                <div className="ma-dash-factor-name">
                  {r.rank}. {r.ticker}
                </div>
                <div className="ma-dash-factor-bar-wrap">
                  <div className="ma-dash-factor-bar" style={{ width: `${clamp(r.compositeScore, 0, 100)}%` }} />
                </div>
                <div className="ma-dash-factor-pct ma-mono">{r.compositeScore}</div>
                <div className="ma-dash-factor-trend ma-mono">{r.grade}</div>
              </li>
            ))}
          </ul>
          <div className="ma-dash-muted" style={{ marginTop: 6 }}>
            Score 0–100, recalculated once a day. Grade is the same score as a letter (A–F).
          </div>
        </>
      )}
    </section>
  );
}

function dashboardRegimeTone(raw) {
  const r = String(raw || "").toLowerCase();
  if (r === "strong_bull" || r === "normal") return "bull";
  if (r === "pullback" || r === "correction") return "pullback";
  if (r === "caution") return "caution";
  if (r === "bear") return "bear";
  return "neutral";
}

function AdaptiveWeightsBar({ weights }) {
  const parts = useMemo(() => {
    if (!weights || typeof weights !== "object") return [];
    const keys = Object.keys(weights);
    const sum = keys.reduce((s, k) => s + Math.max(0, Number(weights[k]) || 0), 0);
    if (sum <= 0) return [];
    return keys.map((k) => ({
      key: k,
      pct: ((Math.max(0, Number(weights[k]) || 0) / sum) * 100).toFixed(1)
    }));
  }, [weights]);
  if (!parts.length) return <p className="ma-dash-muted">Adaptive weights unavailable.</p>;
  const colors = {
    momentum: "#3fb950",
    value: "#58a6ff",
    fundamental: "#a371f7",
    dcf: "#79c0ff",
    valuation: "#d29922",
    earningsMomentum: "#f778ba"
  };
  return (
    <div className="ma-dash-stack">
      <div className="ma-dash-stack__bar">
        {parts.map((p) => (
          <div
            key={p.key}
            title={`${p.key}: ${p.pct}%`}
            className="ma-dash-stack__seg"
            style={{
              width: `${p.pct}%`,
              background: colors[p.key] || "#8b949e"
            }}
          />
        ))}
      </div>
      <div className="ma-dash-stack__legend">
        {parts.map((p) => (
          <span key={p.key} className="ma-dash-stack__lg">
            <span className="ma-mono">{p.key}</span> {p.pct}%
          </span>
        ))}
      </div>
    </div>
  );
}

function MoversPanel({ movers }) {
  const [tab, setTab] = useState("gainers");
  const g = movers?.gainers ?? [];
  const l = movers?.losers ?? [];
  const a = movers?.active ?? [];
  const list = tab === "gainers" ? g : tab === "losers" ? l : a;
  return (
    <div>
      <div className="ma-dash-tabs" style={{ marginBottom: 10 }}>
        {[
          { id: "gainers", label: "Gainers" },
          { id: "losers", label: "Losers" },
          { id: "active", label: "Active" }
        ].map((x) => (
          <button
            key={x.id}
            type="button"
            className={"ma-dash-tab " + (tab === x.id ? "ma-dash-tab--on" : "")}
            onClick={() => setTab(x.id)}
          >
            {x.label}
          </button>
        ))}
      </div>
      <ul className="ma-dash-movers">
        {list.length === 0 && <li className="ma-dash-muted">No ranking snapshot.</li>}
        {list.map((r) => (
          <li key={r.ticker} className="ma-dash-mover-row ma-mono">
            <span className="ma-dash-ticker">{r.ticker}</span>
            <span className="ma-dash-muted">{r.compositeScore?.toFixed?.(1) ?? "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
