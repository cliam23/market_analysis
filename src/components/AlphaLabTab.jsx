import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlaskConical } from "lucide-react";
import { MONO, SANS, TEXT, GREEN_LIGHT, RED_LIGHT, AMBER, AMBER_LIGHT, BORDER_LIGHT } from "../lib/theme.js";
import weightSweepCached from "../assets/weight-sweep-result.json";
import AlphaLabEquityCurves from "./AlphaLabEquityCurves.jsx";

const CARD_BORDER = "rgba(255,255,255,0.08)";
const CARD_BORDER_HOVER = "rgba(255,255,255,0.14)";

const DEFAULT_V2_WEIGHTS = {
  momentum: 0.4,
  value: 0.35,
  fundamental: 0,
  earningsMomentum: 0.25,
  dcf: 0,
  valuation: 0
};

const LEGACY_WEIGHTS = {
  momentum: 0.4,
  value: 0.4,
  fundamental: 0.2,
  earningsMomentum: 0,
  dcf: 0,
  valuation: 0
};

const WEIGHT_KEYS = ["momentum", "value", "fundamental", "earningsMomentum"];

const WEIGHT_COLORS = {
  momentum: "#6366f1",
  value: "#14b8a6",
  fundamental: "#a855f7",
  earningsMomentum: "#f59e0b",
  dcf: "#6b7280",
  valuation: "#9ca3af"
};

function fmtUsd(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function fmtPct2(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const x = Number(n);
  const sign = x > 0 ? "+" : "";
  return `${sign}${x.toFixed(2)}%`;
}

function fmtNum2(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toFixed(2);
}

function parseMetric(v) {
  if (v == null) return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function weightsMatchActive(w) {
  if (!w || typeof w !== "object") return false;
  const keys = ["momentum", "value", "fundamental", "earningsMomentum", "dcf", "valuation"];
  return keys.every((k) => Math.abs((Number(w[k]) || 0) - (Number(DEFAULT_V2_WEIGHTS[k]) || 0)) < 0.02);
}

function trendArrow(recentStrength) {
  const s = String(recentStrength || "").toLowerCase();
  if (s === "strengthening") return "↑";
  if (s === "decaying") return "↓";
  return "→";
}

function stabilityClass(consistency) {
  const c = String(consistency || "").toLowerCase();
  if (c === "stable") return "ma-alphalab-badge ma-alphalab-badge--stable";
  if (c === "unstable") return "ma-alphalab-badge ma-alphalab-badge--unstable";
  return "ma-alphalab-badge ma-alphalab-badge--mixed";
}

function CardShell({ title, subtitle, children, actions, className = "" }) {
  return (
    <section className={`ma-alphalab-card ${className}`.trim()}>
      <div className="ma-alphalab-card__head">
        <div>
          <div className="ma-alphalab-card__title">{title}</div>
          {subtitle ? <div className="ma-alphalab-card__sub">{subtitle}</div> : null}
        </div>
        {actions ? <div className="ma-alphalab-card__actions">{actions}</div> : null}
      </div>
      <div className="ma-alphalab-card__body">{children}</div>
    </section>
  );
}

function SkeletonBlock({ h = 14, w = "100%" }) {
  return <div className="ma-alphalab-skel" style={{ height: h, width: w, borderRadius: 6 }} />;
}

function WeightStackBar({ weights, label }) {
  const w = weights || {};
  const segs = WEIGHT_KEYS.map((k) => ({
    key: k,
    pct: Math.max(0, Math.min(1, Number(w[k]) || 0)) * 100,
    color: WEIGHT_COLORS[k] || "#666"
  })).filter((s) => s.pct > 0.05);
  const sum = segs.reduce((a, s) => a + s.pct, 0);
  return (
    <div style={{ marginTop: 8 }}>
      <div className="ma-mono" style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: "flex", height: 22, borderRadius: 6, overflow: "hidden", border: `1px solid ${CARD_BORDER}` }}>
        {sum < 99 && <div style={{ flex: 100 - sum, background: "rgba(255,255,255,0.04)" }} />}
        {segs.map((s) => (
          <div
            key={s.key}
            title={`${s.key} ${s.pct.toFixed(0)}%`}
            style={{
              flex: s.pct,
              background: s.color,
              minWidth: s.pct > 6 ? 4 : 0,
              transition: "flex 0.25s ease"
            }}
          />
        ))}
      </div>
      <div className="ma-mono" style={{ fontSize: 10, marginTop: 6, opacity: 0.85, display: "flex", flexWrap: "wrap", gap: "8px 14px" }}>
        {WEIGHT_KEYS.map((k) => {
          const lab = k === "earningsMomentum" ? "E" : k === "fundamental" ? "Q" : k === "momentum" ? "M" : k === "value" ? "V" : k;
          return (
            <span key={k}>
              <span style={{ color: WEIGHT_COLORS[k] }}>●</span> {lab}{" "}
              {((Number(w[k]) || 0) * 100).toFixed(0)}%
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function AlphaLabTab({ visible }) {
  const [universeId, setUniverseId] = useState("sp500_top150");
  const [period, setPeriod] = useState("3y");

  const [ucLoading, setUcLoading] = useState(true);
  const [ucData, setUcData] = useState(null);
  const [ucErr, setUcErr] = useState(null);

  const [facLoading, setFacLoading] = useState(true);
  const [facData, setFacData] = useState(null);
  const [facErr, setFacErr] = useState(null);

  const [rlStatus, setRlStatus] = useState(null);
  const [rlCompare, setRlCompare] = useState(null);
  const [rlLoading, setRlLoading] = useState(true);
  const [rlErr, setRlErr] = useState(null);

  const [hedgeLoading, setHedgeLoading] = useState(true);
  const [hedgeData, setHedgeData] = useState(null);
  const [hedgeErr, setHedgeErr] = useState(null);

  const [paperPf, setPaperPf] = useState(null);
  const [paperErr, setPaperErr] = useState(null);
  const [paperLoading, setPaperLoading] = useState(true);
  const [weightSweepRunning, setWeightSweepRunning] = useState(false);
  const [weightSweepElapsed, setWeightSweepElapsed] = useState(0);
  const [weightSweepResult, setWeightSweepResult] = useState(null);
  const [weightSweepErr, setWeightSweepErr] = useState(null);
  const sweepTimerRef = useRef(null);

  const loadUniverseCompare = useCallback(async () => {
    setUcLoading(true);
    setUcErr(null);
    try {
      const res = await fetch("/api/diagnostics/universe-compare");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setUcData(data);
    } catch (e) {
      setUcErr(e.message);
      setUcData(null);
    } finally {
      setUcLoading(false);
    }
  }, []);

  const loadFactors = useCallback(async () => {
    setFacLoading(true);
    setFacErr(null);
    try {
      const q = new URLSearchParams({ period, subperiods: "true" });
      const res = await fetch(`/api/diagnostics/factors/${encodeURIComponent(universeId)}?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setFacData(data);
    } catch (e) {
      setFacErr(e.message);
      setFacData(null);
    } finally {
      setFacLoading(false);
    }
  }, [universeId, period]);

  const loadRlBlock = useCallback(async () => {
    setRlLoading(true);
    setRlErr(null);
    try {
      const params = new URLSearchParams({
        universeId,
        period,
        topN: "15",
        strategy: "full_composite",
        rebalanceFreq: "bimonthly"
      });
      const [sRes, cRes] = await Promise.all([fetch("/api/rl/status"), fetch(`/api/rl/compare?${params}`)]);
      const sData = await sRes.json();
      const cData = await cRes.json();
      if (!sRes.ok) throw new Error(sData.error || "RL status failed");
      setRlStatus(sData);
      if (!cRes.ok) throw new Error(cData.error || "RL compare failed");
      setRlCompare(cData);
    } catch (e) {
      setRlErr(e.message);
      setRlStatus(null);
      setRlCompare(null);
    } finally {
      setRlLoading(false);
    }
  }, [universeId, period]);

  const loadHedge = useCallback(async () => {
    setHedgeLoading(true);
    setHedgeErr(null);
    try {
      const q = new URLSearchParams({ universeId, period });
      const res = await fetch(`/api/diagnostics/hedge-impact?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setHedgeData(data);
    } catch (e) {
      setHedgeErr(e.message);
      setHedgeData(null);
    } finally {
      setHedgeLoading(false);
    }
  }, [universeId, period]);

  const loadPaperWeights = useCallback(async () => {
    setPaperLoading(true);
    setPaperErr(null);
    try {
      const res = await fetch("/api/paper-trade/portfolio");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Portfolio failed");
      setPaperPf(data);
    } catch (e) {
      setPaperPf(null);
      setPaperErr(e.message);
    } finally {
      setPaperLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    loadUniverseCompare();
    loadPaperWeights();
  }, [visible, loadUniverseCompare, loadPaperWeights]);

  useEffect(() => {
    if (!visible) return;
    loadFactors();
    loadRlBlock();
    loadHedge();
  }, [visible, loadFactors, loadRlBlock, loadHedge]);

  useEffect(() => {
    return () => {
      if (sweepTimerRef.current) clearInterval(sweepTimerRef.current);
    };
  }, []);

  const ucRows = ucData?.comparison || [];
  const row50 = ucRows.find((r) => r.universe === "sp500_top50");
  const row150 = ucRows.find((r) => r.universe === "sp500_top150");

  const factorRows = useMemo(() => {
    const cfgs = facData?.configs || [];
    return cfgs.filter((c) => c.weights && c.consistency != null);
  }, [facData]);

  const maxSharpe = useMemo(() => {
    let m = 0.01;
    for (const r of factorRows) {
      const sh = Number(r.sharpe);
      if (Number.isFinite(sh) && Math.abs(sh) > m) m = Math.abs(sh);
    }
    return m;
  }, [factorRows]);

  const hedgeConfigs = hedgeData?.configs || [];
  const bestSharpe = useMemo(() => {
    let best = -Infinity;
    let name = null;
    for (const c of hedgeConfigs) {
      const sh = Number(c.sharpe);
      if (Number.isFinite(sh) && sh > best) {
        best = sh;
        name = c.name;
      }
    }
    return { name, sharpe: best };
  }, [hedgeConfigs]);

  const ddHedgeNote = useMemo(() => {
    const rules = hedgeConfigs.find((c) => c.name === "Rules only");
    const h = hedgeConfigs.find((c) => c.name === "Rules + Hedge");
    const d0 = rules != null ? Number(rules.maxDrawdown) : null;
    const d1 = h != null ? Number(h.maxDrawdown) : null;
    if (d0 == null || d1 == null || !Number.isFinite(d0) || !Number.isFinite(d1)) return null;
    const delta = d1 - d0;
    return { rulesDd: d0, hedgeDd: d1, delta };
  }, [hedgeConfigs]);

  const activeWeightsDisplay =
    paperPf?.portfolio?.activeWeights || paperPf?.portfolio?.config?.weights || DEFAULT_V2_WEIGHTS;

  const runWeightSweep = async () => {
    setWeightSweepRunning(true);
    setWeightSweepErr(null);
    setWeightSweepResult(null);
    setWeightSweepElapsed(0);
    if (sweepTimerRef.current) clearInterval(sweepTimerRef.current);
    sweepTimerRef.current = setInterval(() => setWeightSweepElapsed((t) => t + 1), 1000);
    try {
      const res = await fetch("/api/diagnostics/weight-sweep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          universeId,
          topN: 15,
          correlationFilter: false,
          trainPeriod: "3y",
          testPeriod: "1y"
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setWeightSweepResult(data);
    } catch (e) {
      setWeightSweepErr(e.message);
    } finally {
      if (sweepTimerRef.current) {
        clearInterval(sweepTimerRef.current);
        sweepTimerRef.current = null;
      }
      setWeightSweepRunning(false);
    }
  };

  const controls = (
    <div
      className="ma-alphalab-controls"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "12px 20px",
        marginBottom: 20,
        padding: "14px 18px",
        borderRadius: 12,
        border: `1px solid ${CARD_BORDER}`,
        background: "var(--color-surface-elevated)"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className="ma-mono" style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: AMBER_LIGHT }}>
          UNIVERSE
        </span>
        {["sp500_top50", "sp500_top150"].map((id) => (
          <button
            key={id}
            type="button"
            className={universeId === id ? "ma-alphalab-seg ma-alphalab-seg--on" : "ma-alphalab-seg"}
            onClick={() => setUniverseId(id)}
          >
            {id === "sp500_top50" ? "Top 50" : "Top 150"}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className="ma-mono" style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: AMBER_LIGHT }}>
          PERIOD
        </span>
        {["1y", "3y", "5y"].map((p) => (
          <button
            key={p}
            type="button"
            className={period === p ? "ma-alphalab-seg ma-alphalab-seg--on" : "ma-alphalab-seg"}
            onClick={() => setPeriod(p)}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: "8px 16px 48px",
        fontFamily: SANS,
        color: TEXT,
        boxSizing: "border-box"
      }}
    >
      <header style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <FlaskConical size={28} strokeWidth={1.75} color={AMBER_LIGHT} aria-hidden />
          <div>
            <div className="ma-mono" style={{ fontSize: 10, fontWeight: 800, letterSpacing: 4, color: AMBER_LIGHT }}>
              ALPHA LAB
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0, letterSpacing: -0.5 }}>V2 diagnostics dashboard</h1>
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.75, maxWidth: 720 }}>
          Compare universes, factor stability, RL vs rules, hedging, and pillar weights. Heavy requests may take several minutes.
        </p>
      </header>

      <AlphaLabEquityCurves visible={visible} universeId={universeId} period={period} />

      {controls}

      <div className="ma-alphalab-grid">
        {/* Card 1 */}
        <CardShell title="Universe comparison" subtitle="GET /api/diagnostics/universe-compare · 3y bimonthly (fixed)">
          {ucLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SkeletonBlock h={40} />
              <SkeletonBlock h={40} />
            </div>
          ) : ucErr ? (
            <div className="ma-mono" style={{ color: RED_LIGHT, fontSize: 12 }}>
              {ucErr}
            </div>
          ) : (
            <div className="ma-alphalab-uc">
              {[row50, row150].filter(Boolean).map((row) => (
                <div
                  key={row.universe}
                  className={"ma-alphalab-uc__col" + (universeId === row.universe ? " ma-alphalab-uc__col--focus" : "")}
                >
                  <div className="ma-mono" style={{ fontSize: 11, color: AMBER_LIGHT, marginBottom: 10 }}>
                    {row.universe === "sp500_top50" ? "S&P top 50" : "S&P top 150"} · {row.tickers} names
                  </div>
                  <table className="ma-alphalab-mini-table">
                    <tbody>
                      <tr>
                        <td>Return</td>
                        <td className="ma-mono ma-num" style={{ color: parseMetric(row.totalReturn) >= 0 ? GREEN_LIGHT : RED_LIGHT }}>
                          {fmtPct2(row.totalReturn)}
                        </td>
                      </tr>
                      <tr>
                        <td>Alpha</td>
                        <td className="ma-mono ma-num" style={{ color: parseMetric(row.alpha) >= 0 ? GREEN_LIGHT : RED_LIGHT }}>
                          {fmtPct2(row.alpha)}
                        </td>
                      </tr>
                      <tr>
                        <td>Sharpe</td>
                        <td className="ma-mono ma-num">{fmtNum2(row.sharpe)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))}
              {ucData?.improvement && row50 && row150 ? (
                <div
                  className="ma-mono ma-alphalab-delta-strip"
                  style={{ fontSize: 11, marginTop: 4, color: "var(--color-text-dim)", gridColumn: "1 / -1" }}
                >
                  Δ (150 vs 50): return{" "}
                  <span style={{ color: ucData.improvement.returnDelta >= 0 ? GREEN_LIGHT : RED_LIGHT }}>
                    {fmtPct2(ucData.improvement.returnDelta)}
                  </span>
                  · alpha{" "}
                  <span style={{ color: ucData.improvement.alphaDelta >= 0 ? GREEN_LIGHT : RED_LIGHT }}>
                    {fmtPct2(ucData.improvement.alphaDelta)}
                  </span>
                  · Sharpe{" "}
                  <span style={{ color: ucData.improvement.sharpeDelta >= 0 ? GREEN_LIGHT : RED_LIGHT }}>
                    {fmtNum2(ucData.improvement.sharpeDelta)}
                  </span>
                </div>
              ) : null}
            </div>
          )}
        </CardShell>

        {/* Card 2 */}
        <CardShell
          title="Factor strength"
          subtitle={`GET /api/diagnostics/factors/${universeId} · subperiods`}
          actions={
            <button type="button" className="ma-alphalab-btn" onClick={loadFactors} disabled={facLoading}>
              {facLoading ? "Running…" : "Run diagnostic"}
            </button>
          }
        >
          {facLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[1, 2, 3, 4, 5].map((i) => (
                <SkeletonBlock key={i} h={36} />
              ))}
            </div>
          ) : facErr ? (
            <div className="ma-mono" style={{ color: RED_LIGHT, fontSize: 12 }}>
              {facErr}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {factorRows.map((row) => {
                const sh = Number(row.sharpe);
                const tr = Number(row.totalReturn);
                const barW = maxSharpe > 0 ? (Math.abs(sh) / maxSharpe) * 100 : 0;
                const star = weightsMatchActive(row.weights) || row.name === "Current best";
                return (
                  <div key={row.name} style={{ borderBottom: `1px solid ${CARD_BORDER}`, paddingBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <div className="ma-mono" style={{ fontSize: 12, fontWeight: 700 }}>
                        {star ? <span style={{ color: AMBER }}>★ </span> : null}
                        {row.name}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span className={stabilityClass(row.consistency)}>{row.consistency || "—"}</span>
                        <span className="ma-mono ma-num" style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                          {trendArrow(row.recentStrength)} {row.recentStrength || "steady"}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                      <div style={{ flex: 1, height: 10, borderRadius: 5, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${Math.min(100, barW)}%`,
                            height: "100%",
                            borderRadius: 5,
                            background: sh >= 0 ? "var(--color-positive)" : "var(--color-negative)",
                            transition: "width 0.35s ease"
                          }}
                        />
                      </div>
                      <div className="ma-mono ma-num" style={{ fontSize: 11, minWidth: 120, textAlign: "right" }}>
                        <span style={{ color: sh >= 0 ? GREEN_LIGHT : RED_LIGHT }}>Sh {fmtNum2(sh)}</span>
                        {" · "}
                        <span style={{ color: tr >= 0 ? GREEN_LIGHT : RED_LIGHT }}>Ret {fmtPct2(tr)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardShell>

        {/* Card 3 */}
        <CardShell title="RL agent performance" subtitle="GET /api/rl/status · GET /api/rl/compare">
          {rlLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SkeletonBlock h={24} />
              <SkeletonBlock h={120} />
            </div>
          ) : rlErr ? (
            <div className="ma-mono" style={{ color: RED_LIGHT, fontSize: 12 }}>
              {rlErr}
            </div>
          ) : (
            <>
              <div className="ma-mono" style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 14 }}>
                <div>
                  Agent: <span style={{ color: GREEN_LIGHT }}>{rlStatus?.agentType ?? "—"}</span> · Action space:{" "}
                  <span className="ma-num">{rlStatus?.totalActions ?? "—"}</span> · States:{" "}
                  <span className="ma-num">
                    {(rlStatus?.statesVisited ?? 0).toLocaleString()} / {(rlStatus?.totalStates ?? 0).toLocaleString()}
                  </span>
                </div>
                <div>
                  Q-table params: <span className="ma-num">{(rlStatus?.qTableSize ?? 0).toLocaleString()}</span> · Updates:{" "}
                  <span className="ma-num">{(rlStatus?.totalUpdates ?? 0).toLocaleString()}</span>
                </div>
                {!rlStatus?.loaded ? (
                  <div style={{ color: AMBER_LIGHT, marginTop: 8 }}>
                    DQN not yet trained — using default actions (eval still runs; numbers may be noisy).
                  </div>
                ) : (
                  <div style={{ color: "var(--color-text-dim)", marginTop: 8, fontSize: 11 }}>
                    OOS Sharpe / overfitRatio: run <span style={{ color: AMBER_LIGHT }}>POST /api/rl/train</span> from RL Agent tab
                    for holdout metrics.
                  </div>
                )}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="ma-alphalab-table">
                  <thead>
                    <tr>
                      <th />
                      <th className="ma-num">Return</th>
                      <th className="ma-num">Alpha</th>
                      <th className="ma-num">Sharpe</th>
                      <th className="ma-num">Max DD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {["baseline", "rlEval"].map((key) => {
                      const row = rlCompare?.[key];
                      const label = key === "rlEval" ? "DQN (eval)" : "Rules";
                      return (
                        <tr key={key}>
                          <td className="ma-mono">{label}</td>
                          <td className="ma-num" style={{ color: parseMetric(row?.totalReturn) >= 0 ? GREEN_LIGHT : RED_LIGHT }}>
                            {fmtPct2(parseMetric(row?.totalReturn))}
                          </td>
                          <td className="ma-num" style={{ color: parseMetric(row?.alpha) >= 0 ? GREEN_LIGHT : RED_LIGHT }}>
                            {fmtPct2(parseMetric(row?.alpha))}
                          </td>
                          <td className="ma-num">{fmtNum2(parseMetric(row?.sharpe))}</td>
                          <td className="ma-num" style={{ color: RED_LIGHT }}>
                            {fmtPct2(parseMetric(row?.maxDrawdown))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 14 }}>
                <button
                  type="button"
                  className="ma-alphalab-btn ma-alphalab-btn--disabled"
                  disabled
                  title="Retrain is disabled until the DQN architecture is frozen."
                >
                  Retrain DQN
                </button>
                <span className="ma-mono" style={{ fontSize: 10, marginLeft: 10, color: "var(--color-text-muted)" }}>
                  Hover for tooltip
                </span>
              </div>
            </>
          )}
        </CardShell>

        {/* Card 4 */}
        <CardShell title="Hedging impact" subtitle="GET /api/diagnostics/hedge-impact">
          {hedgeLoading ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[1, 2, 3, 4].map((i) => (
                <SkeletonBlock key={i} h={80} />
              ))}
            </div>
          ) : hedgeErr ? (
            <div className="ma-mono" style={{ color: RED_LIGHT, fontSize: 12 }}>
              {hedgeErr}
            </div>
          ) : (
            <>
              <div className="ma-alphalab-hedge-grid">
                {["Rules only", "DQN only", "Rules + Hedge", "DQN + Hedge"].map((name) => {
                  const c = hedgeConfigs.find((x) => x.name === name);
                  const best = c && bestSharpe.name === c.name;
                  return (
                    <div
                      key={name}
                      className={"ma-alphalab-hedge-cell" + (best ? " ma-alphalab-hedge-cell--best" : "")}
                      style={{
                        border: `1px solid ${best ? "var(--color-positive)" : CARD_BORDER}`,
                        borderRadius: 10,
                        padding: 12,
                        background: best ? "rgba(34,197,94,0.08)" : "rgba(0,0,0,0.2)"
                      }}
                    >
                      <div className="ma-mono" style={{ fontSize: 11, fontWeight: 800, color: best ? GREEN_LIGHT : AMBER_LIGHT, marginBottom: 8 }}>
                        {c?.name ?? name}
                        {best ? " · best Sharpe" : ""}
                      </div>
                      <div className="ma-mono ma-num" style={{ fontSize: 11, lineHeight: 1.65 }}>
                        <div>
                          Ret{" "}
                          <span style={{ color: parseMetric(c?.totalReturn) >= 0 ? GREEN_LIGHT : RED_LIGHT }}>{fmtPct2(c?.totalReturn)}</span>
                        </div>
                        <div>Sh {fmtNum2(c?.sharpe)}</div>
                        <div style={{ color: RED_LIGHT }}>DD {fmtPct2(c?.maxDrawdown)}</div>
                        {c?.hedgeStats ? (
                          <div style={{ marginTop: 6, fontSize: 10, color: "var(--color-text-muted)" }}>
                            Hedges {c.hedgeStats.totalOpened} · net {fmtUsd(c.hedgeStats.netImpact)}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              {ddHedgeNote ? (
                <div className="ma-mono" style={{ fontSize: 11, marginTop: 12, color: "var(--color-text-dim)" }}>
                  Rules-only max DD {fmtPct2(ddHedgeNote.rulesDd)} vs Rules+Hedge {fmtPct2(ddHedgeNote.hedgeDd)} → Δ{" "}
                  <span style={{ color: ddHedgeNote.delta > 0 ? GREEN_LIGHT : ddHedgeNote.delta < 0 ? RED_LIGHT : TEXT }}>
                    {fmtPct2(ddHedgeNote.delta)}
                  </span>{" "}
                  (positive = drawdown less severe with hedge)
                </div>
              ) : null}
            </>
          )}
        </CardShell>

        {/* Card 5 */}
        <CardShell
          title="Weight configuration"
          subtitle="Paper config + cached sweep JSON"
          actions={
            <button type="button" className="ma-alphalab-btn" onClick={runWeightSweep} disabled={weightSweepRunning}>
              {weightSweepRunning ? `Sweep… ${weightSweepElapsed}s` : "Run weight sweep"}
            </button>
          }
        >
          {paperLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
              <SkeletonBlock h={22} />
              <SkeletonBlock h={22} />
            </div>
          ) : null}
          {paperErr ? (
            <div className="ma-mono" style={{ color: AMBER_LIGHT, fontSize: 11, marginBottom: 8 }}>
              Paper portfolio: {paperErr}
            </div>
          ) : null}
          {!paperLoading ? <WeightStackBar weights={activeWeightsDisplay} label="Active (paper / server default)" /> : null}
          {!paperLoading ? <WeightStackBar weights={LEGACY_WEIGHTS} label="Legacy reference M40/V40/Q20" /> : null}
          <div className="ma-mono" style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: paperLoading ? 0 : 12 }}>
            Cached sweep snapshot — top OOS Sharpe:{" "}
            <span className="ma-num" style={{ color: GREEN_LIGHT }}>
              {weightSweepCached?.recommendation?.oosSharpe != null
                ? fmtNum2(weightSweepCached.recommendation.oosSharpe)
                : "—"}
            </span>
            {weightSweepCached?.recommendation?.overfitRatio != null ? (
              <>
                {" "}
                · overfit {fmtNum2(weightSweepCached.recommendation.overfitRatio)}
              </>
            ) : null}
          </div>
          {weightSweepRunning ? (
            <div className="ma-alphalab-progress" style={{ marginTop: 12 }}>
              <div className="ma-alphalab-progress__bar" />
              <span className="ma-mono" style={{ fontSize: 10 }}>
                POST /api/diagnostics/weight-sweep — long-running
              </span>
            </div>
          ) : null}
          {weightSweepErr ? (
            <div className="ma-mono" style={{ color: RED_LIGHT, fontSize: 11, marginTop: 8 }}>
              {weightSweepErr}
            </div>
          ) : null}
          {weightSweepResult?.success ? (
            <div
              className="ma-mono"
              style={{
                marginTop: 10,
                fontSize: 11,
                padding: 10,
                borderRadius: 8,
                border: "1px solid var(--color-positive)",
                background: "rgba(34,197,94,0.06)"
              }}
            >
              Sweep done: {weightSweepResult.swept ?? "—"} configs · best OOS Sharpe{" "}
              {fmtNum2(weightSweepResult.recommendation?.oosSharpe)}
            </div>
          ) : null}
        </CardShell>
      </div>

      <style>{`
        .ma-alphalab-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
          gap: 16px;
          align-items: start;
        }
        .ma-alphalab-card {
          background: var(--color-surface);
          border: 1px solid ${CARD_BORDER};
          border-radius: 12px;
          padding: 18px 20px;
          transition: border-color 0.2s ease, background 0.2s ease;
        }
        .ma-alphalab-card:hover {
          border-color: ${CARD_BORDER_HOVER};
          background: var(--color-surface-elevated);
        }
        .ma-alphalab-card__head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 14px;
        }
        .ma-alphalab-card__title {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 2px;
          font-family: ${MONO};
          color: ${AMBER_LIGHT};
        }
        .ma-alphalab-card__sub {
          font-size: 11px;
          color: var(--color-text-muted);
          font-family: ${MONO};
          margin-top: 4px;
          opacity: 0.85;
        }
        .ma-alphalab-card__actions { flex-shrink: 0; }
        .ma-alphalab-skel {
          background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.09) 50%, rgba(255,255,255,0.04) 75%);
          background-size: 200% 100%;
          animation: ma-alphalab-pulse 1.4s ease-in-out infinite;
        }
        @keyframes ma-alphalab-pulse {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        .ma-alphalab-seg {
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 700;
          padding: 6px 12px;
          border-radius: 8px;
          border: 1px solid ${CARD_BORDER};
          background: rgba(0,0,0,0.2);
          color: var(--color-text-muted);
          cursor: pointer;
        }
        .ma-alphalab-seg--on {
          border-color: var(--color-accent);
          color: var(--color-text-primary);
          background: var(--color-sidebar-active-bg);
        }
        .ma-alphalab-btn {
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 700;
          padding: 8px 14px;
          border-radius: 8px;
          border: 1px solid ${BORDER_LIGHT};
          background: rgba(99,102,241,0.2);
          color: var(--color-text-primary);
          cursor: pointer;
        }
        .ma-alphalab-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .ma-alphalab-btn--disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .ma-alphalab-mini-table {
          width: 100%;
          font-family: var(--font-mono);
          font-size: 12px;
          border-collapse: collapse;
        }
        .ma-alphalab-mini-table td {
          padding: 4px 0;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .ma-alphalab-mini-table td:first-child {
          color: var(--color-text-muted);
          width: 44%;
        }
        .ma-alphalab-uc {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        @media (max-width: 520px) {
          .ma-alphalab-uc { grid-template-columns: 1fr; }
        }
        .ma-alphalab-uc__col--focus {
          outline: 1px solid var(--color-accent);
          outline-offset: 6px;
          border-radius: 8px;
        }
        .ma-alphalab-badge {
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 999px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .ma-alphalab-badge--stable {
          background: var(--pill-green-bg);
          color: var(--pill-green-text);
        }
        .ma-alphalab-badge--mixed {
          background: var(--pill-amber-bg);
          color: var(--pill-amber-text);
        }
        .ma-alphalab-badge--unstable {
          background: var(--pill-red-bg);
          color: var(--pill-red-text);
        }
        .ma-alphalab-table {
          width: 100%;
          border-collapse: collapse;
          font-family: var(--font-mono);
          font-size: 12px;
        }
        .ma-alphalab-table th,
        .ma-alphalab-table td {
          padding: 8px 10px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          text-align: left;
        }
        .ma-alphalab-table .ma-num { text-align: right; }
        .ma-alphalab-hedge-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        @media (max-width: 560px) {
          .ma-alphalab-hedge-grid { grid-template-columns: 1fr; }
        }
        .ma-alphalab-progress {
          height: 6px;
          border-radius: 3px;
          background: rgba(255,255,255,0.06);
          overflow: hidden;
          position: relative;
        }
        .ma-alphalab-progress__bar {
          height: 100%;
          width: 40%;
          border-radius: 3px;
          background: var(--color-accent);
          animation: ma-alphalab-indet 1.2s ease-in-out infinite;
        }
        @keyframes ma-alphalab-indet {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
      `}</style>
    </div>
  );
}
