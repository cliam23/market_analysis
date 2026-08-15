import { useCallback, useEffect, useMemo, useRef, useState } from "react";
/** @returns {AbortSignal | undefined} */
function longDiagSignal() {
  try {
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      return AbortSignal.timeout(300000);
    }
  } catch {
    /* ignore */
  }
  return undefined;
}
import { FlaskConical } from "lucide-react";
import { SANS, TEXT, GREEN_LIGHT, RED_LIGHT, AMBER, AMBER_LIGHT } from "../lib/theme.js";
import { apiFetch, apiFetchNoStore } from "../lib/api.js";
import { fmtMoney as _fmtMoney, fmtPctSigned } from "../lib/formatters.js";
import weightSweepCached from "../assets/weight-sweep-result.json";
import AlphaLabEquityCurves from "./AlphaLabEquityCurves.jsx";
import { useBackendMode } from "../hooks/useBackendMode.js";

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

const WEIGHT_KEYS = ["momentum", "value", "fundamental", "earningsMomentum"];

const WEIGHT_COLORS = {
  momentum: "#58a6ff",
  value: "#f0883e",
  fundamental: "#3fb950",
  earningsMomentum: "#bc8cff",
  dcf: "#6b7280",
  valuation: "#9ca3af"
};

const REGIME_SHORT = {
  strong_bull: "bull",
  normal: "normal",
  pullback: "pullback",
  caution: "caution",
  bear: "bear"
};

const fmtUsd = (n) => _fmtMoney(n, 2);
const fmtPct2 = fmtPctSigned;

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

function rlModeLabel(agentType) {
  const t = String(agentType || "").toLowerCase();
  if (t === "dqn") return "DQN";
  return "Q-learning";
}

function universeShortLabel(id) {
  if (id === "sp500_top50") return "top 50";
  if (id === "sp500_top150") return "top 150";
  return id || "";
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

function WeightStackBar({ weights, label, variant = "active" }) {
  const w = weights || {};
  const dim = variant === "anchor";
  const barH = dim ? 14 : 22;
  const segs = WEIGHT_KEYS.map((k) => ({
    key: k,
    pct: Math.max(0, Math.min(1, Number(w[k]) || 0)) * 100,
    color: WEIGHT_COLORS[k] || "#666"
  })).filter((s) => s.pct > 0.05);
  const sum = segs.reduce((a, s) => a + s.pct, 0);
  return (
    <div style={{ marginTop: dim ? 10 : 8, opacity: dim ? 0.82 : 1 }}>
      <div
        className="ma-mono"
        style={{ fontSize: dim ? 9 : 10, color: "var(--color-text-muted)", marginBottom: 4 }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          height: barH,
          borderRadius: 6,
          overflow: "hidden",
          border: `1px solid ${CARD_BORDER}`
        }}
      >
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
      <div
        className="ma-mono"
        style={{
          fontSize: dim ? 9 : 10,
          marginTop: 6,
          opacity: dim ? 0.75 : 0.9,
          display: "flex",
          flexWrap: "wrap",
          gap: "8px 14px"
        }}
      >
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
  const backendMode = useBackendMode();
  const lite = backendMode === "lite";
  const [universeId, setUniverseId] = useState("sp500_top150");
  const [period, setPeriod] = useState("3y");

  // Only period=3y is mirrored on the read-only deploy (see
  // scripts/lib/diagnostics-mirror.mjs) — steer there if something set
  // period to 1y/5y before lite mode resolved.
  useEffect(() => {
    if (lite && period !== "3y") setPeriod("3y");
  }, [lite, period]);

  const [ucLoading, setUcLoading] = useState(false);
  const [ucData, setUcData] = useState(null);
  const [ucErr, setUcErr] = useState(null);

  const [facLoading, setFacLoading] = useState(false);
  const [facData, setFacData] = useState(null);
  const [facErr, setFacErr] = useState(null);

  const [rlStatus, setRlStatus] = useState(null);
  const [rlCompare, setRlCompare] = useState(null);
  const [rlErr, setRlErr] = useState(null);

  const [hedgeLoading, setHedgeLoading] = useState(false);
  const [hedgeData, setHedgeData] = useState(null);
  const [hedgeErr, setHedgeErr] = useState(null);

  const [paperPf, setPaperPf] = useState(null);
  const [paperErr, setPaperErr] = useState(null);
  const [paperLoading, setPaperLoading] = useState(false);
  const [weightSweepRunning, setWeightSweepRunning] = useState(false);
  const [weightSweepElapsed, setWeightSweepElapsed] = useState(0);
  const [weightSweepResult, setWeightSweepResult] = useState(null);
  const [weightSweepErr, setWeightSweepErr] = useState(null);
  const sweepTimerRef = useRef(null);
  /** Avoid re-running heavy bulk loads when tab becomes visible again with same universe + period. */
  const alphaLabPrevVisibleRef = useRef(false);
  const alphaLabBulkKeyRef = useRef(null);
  const forwardConfPrevVisibleRef = useRef(false);
  const forwardConfKeyRef = useRef(null);

  const [fcData, setFcData] = useState(null);
  const [fcLoading, setFcLoading] = useState(false);
  const [fcErr, setFcErr] = useState(null);
  const [fwRec, setFwRec] = useState(null);
  const [fwLoading, setFwLoading] = useState(false);
  const [retrainBusy, setRetrainBusy] = useState(false);
  const [retrainMsg, setRetrainMsg] = useState(null);
  const [rlInitLoading, setRlInitLoading] = useState(false);
  const [rlCompareLoading, setRlCompareLoading] = useState(false);
  const [rlCompareErr, setRlCompareErr] = useState(null);

  const loadForwardConfidence = useCallback(async () => {
    setFcLoading(true);
    setFcErr(null);
    try {
      // The lite deploy's mirror is GET-only (nothing under api/ accepts
      // writes) and always reflects the portfolio's actual current
      // weights — there's no way to submit custom weights there anyway,
      // so a query-string request for the same universeId/period gets the
      // same answer the POST body would have.
      const res = lite
        ? await apiFetchNoStore(`/api/diagnostics/forward-confidence?${new URLSearchParams({ universeId, period })}`)
        : await apiFetchNoStore("/api/diagnostics/forward-confidence", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ universeId, period, weights: paperPf?.portfolio?.config?.weights || DEFAULT_V2_WEIGHTS })
          });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setFcData(data);
    } catch (e) {
      setFcErr(e.message);
      setFcData(null);
    } finally {
      setFcLoading(false);
    }
  }, [universeId, period, paperPf, lite]);

  const loadForwardWeightRec = useCallback(async () => {
    setFwLoading(true);
    try {
      const res = await apiFetchNoStore("/api/diagnostics/forward-weight-recommendation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ universeId, period })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setFwRec(data);
    } catch {
      setFwRec(null);
    } finally {
      setFwLoading(false);
    }
  }, [universeId, period]);

  const loadUniverseCompare = useCallback(async () => {
    setUcLoading(true);
    setUcErr(null);
    try {
      const res = await apiFetchNoStore("/api/diagnostics/universe-compare", { signal: longDiagSignal() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setUcData(data);
    } catch (e) {
      setUcErr(e.name === "AbortError" ? "Request timed out (5 min) — try again." : e.message);
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
      const res = await apiFetchNoStore(`/api/diagnostics/factors/${encodeURIComponent(universeId)}?${q}`);
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

  const loadRlStatus = useCallback(async () => {
    setRlInitLoading(true);
    setRlErr(null);
    try {
      const sRes = await apiFetchNoStore("/api/rl/status");
      const sData = await sRes.json();
      if (!sRes.ok) throw new Error(sData.error || "RL status failed");
      setRlStatus(sData);
    } catch (e) {
      setRlErr(e.message);
      setRlStatus(null);
    } finally {
      setRlInitLoading(false);
    }
  }, []);

  const loadRlCompare = useCallback(async () => {
    setRlCompareLoading(true);
    setRlCompareErr(null);
    try {
      const params = new URLSearchParams({
        universeId,
        period,
        topN: "15",
        strategy: "full_composite",
        rebalanceFreq: "bimonthly",
        fresh: "true"
      });
      const cRes = await apiFetchNoStore(`/api/rl/compare?${params}`);
      const cData = await cRes.json();
      if (!cRes.ok) throw new Error(cData.error || "RL compare failed");
      setRlCompare(cData);
    } catch (e) {
      setRlCompareErr(e.message);
      setRlCompare(null);
    } finally {
      setRlCompareLoading(false);
    }
  }, [universeId, period]);

  const loadHedge = useCallback(async () => {
    setHedgeLoading(true);
    setHedgeErr(null);
    try {
      const q = new URLSearchParams({ universeId, period });
      const res = await apiFetchNoStore(`/api/diagnostics/hedge-impact?${q}`);
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
      const res = await apiFetchNoStore(`/api/paper-trade/portfolio?universe=${encodeURIComponent(universeId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Portfolio failed");
      setPaperPf(data);
    } catch (e) {
      setPaperPf(null);
      setPaperErr(e.message);
    } finally {
      setPaperLoading(false);
    }
  }, [universeId]);

  useEffect(() => {
    setUcData(null);
    setUcErr(null);
    setUcLoading(true);
    setFacData(null);
    setFacErr(null);
    setFacLoading(true);
    setHedgeData(null);
    setHedgeErr(null);
    setHedgeLoading(true);
    setFcData(null);
    setFcErr(null);
    setFcLoading(true);
    setFwRec(null);
    setFwLoading(true);
    setRlCompare(null);
    setRlCompareErr(null);
    setRlCompareLoading(true);
    setRlInitLoading(true);
  }, [universeId, period]);

  useEffect(() => {
    if (!visible) {
      alphaLabPrevVisibleRef.current = false;
      return;
    }
    const bulkKey = `${universeId}|${period}`;
    const becameVisible = !alphaLabPrevVisibleRef.current;
    alphaLabPrevVisibleRef.current = true;
    if (becameVisible && alphaLabBulkKeyRef.current === bulkKey) {
      return;
    }
    alphaLabBulkKeyRef.current = bulkKey;
    // universe-compare/factors/hedge-impact/rl-compare are all mirrored on
    // the read-only deploy for period=3y on S&P Top 50/150 (the controls
    // are restricted to that combo in lite mode below, so these calls
    // always land on a mirrored combo there). forward-weight-recommendation
    // is genuinely expensive (weight-sweep shaped) and isn't mirrored —
    // its trigger button is hidden entirely in lite mode instead of shown
    // disabled, so there's nothing to call for it here.
    const calls = [loadRlStatus(), loadPaperWeights(), loadUniverseCompare(), loadFactors(), loadHedge(), loadRlCompare()];
    if (lite) {
      setFwRec(null);
      setFwLoading(false);
    } else {
      calls.push(loadForwardWeightRec());
    }
    void Promise.all(calls);
  }, [
    visible,
    universeId,
    period,
    lite,
    loadRlStatus,
    loadPaperWeights,
    loadUniverseCompare,
    loadFactors,
    loadHedge,
    loadForwardWeightRec,
    loadRlCompare
  ]);

  useEffect(() => {
    if (!visible) {
      forwardConfPrevVisibleRef.current = false;
      return;
    }
    const w = paperPf?.portfolio?.config?.weights;
    const fcKey = `${universeId}|${period}|${w ? JSON.stringify(w) : "na"}`;
    const becameVisible = !forwardConfPrevVisibleRef.current;
    forwardConfPrevVisibleRef.current = true;
    if (becameVisible && forwardConfKeyRef.current === fcKey) {
      return;
    }
    forwardConfKeyRef.current = fcKey;
    loadForwardConfidence();
  }, [visible, universeId, period, paperPf, loadForwardConfidence, lite]);

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
    const rows = cfgs.filter((c) => c.weights && c.consistency != null);
    return [...rows].sort((a, b) => parseMetric(b.sharpe) - parseMetric(a.sharpe));
  }, [facData]);

  const maxFactorRet = useMemo(() => {
    let m = 0.01;
    for (const r of factorRows) {
      const tr = Math.abs(Number(r.totalReturn));
      if (Number.isFinite(tr) && tr > m) m = tr;
    }
    return m;
  }, [factorRows]);

  const ucWinnerUniverse = useMemo(() => {
    const r50 = parseMetric(row50?.totalReturn);
    const r150 = parseMetric(row150?.totalReturn);
    if (r50 == null || r150 == null) return null;
    if (r150 > r50) return "sp500_top150";
    if (r50 > r150) return "sp500_top50";
    return null;
  }, [row50, row150]);

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

  const rlPanelStats = useMemo(() => {
    const at = String(rlStatus?.agentType ?? rlStatus?.defaultAgentType ?? "").toLowerCase();
    const isDqn = at === "dqn";
    const uni = rlStatus?.agents?.[universeId];
    return {
      statesVisited: isDqn ? rlStatus?.statesVisited ?? 0 : uni?.statesVisited ?? rlStatus?.statesVisited ?? 0,
      totalUpdates: isDqn ? rlStatus?.totalUpdates ?? 0 : uni?.totalUpdates ?? rlStatus?.totalUpdates ?? 0,
      loaded: isDqn ? !!(rlStatus?.agentLoaded ?? rlStatus?.loaded) : !!(uni?.loaded ?? false)
    };
  }, [rlStatus, universeId]);

  const rlStateCoveragePct = useMemo(() => {
    const tot = Number(rlStatus?.totalStates) || 0;
    const vis = Number(rlPanelStats.statesVisited) || 0;
    if (tot <= 0) return 0;
    return Math.min(100, (vis / tot) * 100);
  }, [rlStatus, rlPanelStats]);

  const anchorWeightsDisplay =
    paperPf?.portfolio?.config?.weights || paperPf?.portfolio?.activeWeights || DEFAULT_V2_WEIGHTS;
  const wh = paperPf?.portfolio?.weightHistory;
  const lastAdaptiveFromHistory =
    Array.isArray(wh) && wh.length > 0 ? wh[wh.length - 1]?.weights : null;
  const activeWeightsDisplay = lastAdaptiveFromHistory || paperPf?.portfolio?.activeWeights || anchorWeightsDisplay;

  const postRlTrainSmoke = async () => {
    setRetrainBusy(true);
    setRetrainMsg(null);
    try {
      const body = {
        universeId,
        period: "5y",
        episodes: 120,
        skipPostTrainEval: true,
        rebalanceFreq: "bimonthly",
        topN: 15,
        strategy: "full_composite",
        agentType: "qlearning",
        ...(anchorWeightsDisplay && typeof anchorWeightsDisplay === "object" ? { weights: anchorWeightsDisplay } : {})
      };
      const res = await apiFetchNoStore("/api/rl/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setRetrainMsg(`Training finished (${data.episodes ?? "?"} episodes). Refreshing stats…`);
      await loadRlStatus();
      await loadRlCompare();
      setRetrainMsg(null);
    } catch (e) {
      setRetrainMsg(e.message || String(e));
    } finally {
      setRetrainBusy(false);
    }
  };

  const runWeightSweep = async () => {
    setWeightSweepRunning(true);
    setWeightSweepErr(null);
    setWeightSweepResult(null);
    setWeightSweepElapsed(0);
    if (sweepTimerRef.current) clearInterval(sweepTimerRef.current);
    sweepTimerRef.current = setInterval(() => setWeightSweepElapsed((t) => t + 1), 1000);
    try {
      const res = await apiFetchNoStore("/api/diagnostics/weight-sweep", {
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
        gap: "12px 20px"
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
        {(lite ? ["3y"] : ["1y", "3y", "5y"]).map((p) => (
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
    <div className="ma-page-container ma-alphalab-page" style={{ fontFamily: SANS, color: TEXT }}>
      <header style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 14 }}>
          <FlaskConical size={28} strokeWidth={1.75} color={AMBER_LIGHT} aria-hidden />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ma-mono" style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: AMBER_LIGHT }}>
              ALPHA LAB
            </div>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--color-text-muted)", maxWidth: 560 }}>
              Research & diagnostics dashboard
            </p>
            <div style={{ marginTop: 16 }}>{controls}</div>
          </div>
        </div>
      </header>

      <AlphaLabEquityCurves visible={visible} universeId={universeId} period={period} />

      <div className="ma-alphalab-grid">
        {/* Row 1: RL + weights */}
        <CardShell title={`${rlModeLabel(rlStatus?.agentType ?? rlStatus?.defaultAgentType)} agent (${universeShortLabel(universeId)})`}>
          {rlInitLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SkeletonBlock h={24} />
              <SkeletonBlock h={100} />
            </div>
          ) : rlErr && !rlStatus ? (
            <div className="ma-mono" style={{ color: RED_LIGHT, fontSize: 12 }}>
              {rlErr}
            </div>
          ) : (
            <div className="ma-alphalab-fadein">
              <div className="ma-mono" style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 12 }}>
                <div>
                  Agent: <span style={{ color: GREEN_LIGHT }}>{rlModeLabel(rlStatus?.agentType ?? rlStatus?.defaultAgentType)}</span>
                  {" · "}
                  Action space: <span className="ma-num">{rlStatus?.totalActions ?? "—"}</span>
                </div>
                <div style={{ marginTop: 6 }}>
                  States:{" "}
                  <span className="ma-num">
                    {rlPanelStats.statesVisited.toLocaleString()} / {(rlStatus?.totalStates ?? 0).toLocaleString()}
                  </span>
                  {" · "}
                  Updates: <span className="ma-num">{rlPanelStats.totalUpdates.toLocaleString()}</span>
                </div>
                <div style={{ marginTop: 10, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${rlStateCoveragePct}%`,
                      height: "100%",
                      borderRadius: 3,
                      background: rlStateCoveragePct >= 99 ? GREEN_LIGHT : AMBER_LIGHT,
                      transition: "width 0.4s ease"
                    }}
                  />
                </div>
                {!rlPanelStats.loaded ? (
                  <div style={{ color: AMBER_LIGHT, marginTop: 8, fontSize: 11 }}>
                    No trained agent for this universe — run training or check the on-disk policy file.
                  </div>
                ) : null}
              </div>
              <div className="ma-mono" style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: AMBER_LIGHT, margin: "16px 0 8px" }}>
                BACKTEST COMPARISON
              </div>
              {rlCompareLoading ? (
                <SkeletonBlock h={100} />
              ) : rlCompareErr ? (
                <div className="ma-mono" style={{ color: RED_LIGHT, fontSize: 11, padding: "8px 0" }}>
                  {rlCompareErr}
                </div>
              ) : rlCompare ? (
                <div style={{ overflowX: "auto" }} className="ma-alphalab-fadein">
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
                        const rlLbl = `${rlModeLabel(rlStatus?.agentType ?? rlStatus?.defaultAgentType)} (eval)`;
                        const label = key === "rlEval" ? rlLbl : "Rules";
                        const baseSh = parseMetric(rlCompare?.baseline?.sharpe);
                        const evSh = parseMetric(rlCompare?.rlEval?.sharpe);
                        const rowBest =
                          key === "rlEval"
                            ? Number.isFinite(evSh) && Number.isFinite(baseSh) && evSh > baseSh
                            : Number.isFinite(baseSh) && Number.isFinite(evSh) && baseSh > evSh;
                        return (
                          <tr
                            key={key}
                            style={
                              rowBest
                                ? {
                                    borderLeft: "3px solid rgba(34,197,94,0.85)",
                                    background: "rgba(34,197,94,0.06)"
                                  }
                                : { borderLeft: "3px solid transparent" }
                            }
                          >
                            <td className="ma-mono">{label}</td>
                            <td className="ma-num" style={{ color: parseMetric(row?.totalReturn) >= 0 ? GREEN_LIGHT : RED_LIGHT }}>
                              {fmtPct2(parseMetric(row?.totalReturn))}
                            </td>
                            <td className="ma-num" style={{ color: parseMetric(row?.alpha) >= 0 ? GREEN_LIGHT : RED_LIGHT }}>
                              {fmtPct2(parseMetric(row?.alpha))}
                            </td>
                            <td className="ma-num">{fmtNum2(parseMetric(row?.sharpe))}</td>
                            <td className="ma-num" style={{ color: RED_LIGHT }}>{fmtPct2(parseMetric(row?.maxDrawdown))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <SkeletonBlock h={100} />
              )}
              {!lite && (
                <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                  <button
                    type="button"
                    className="ma-alphalab-btn"
                    disabled={retrainBusy}
                    onClick={() => postRlTrainSmoke()}
                  >
                    {retrainBusy ? "Training…" : `Retrain ${rlModeLabel("qlearning")}`}
                  </button>
                  {retrainMsg ? (
                    <span className="ma-mono" style={{ fontSize: 11, color: retrainMsg.includes("finished") ? GREEN_LIGHT : RED_LIGHT }}>
                      {retrainMsg}
                    </span>
                  ) : (
                    <span className="ma-mono" style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                      Smoke train (120 ep) — use RL Agent tab for full runs.
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </CardShell>

        <CardShell
          title="Weight configuration"
          actions={
            !lite && (
              <button
                type="button"
                className="ma-alphalab-btn"
                onClick={runWeightSweep}
                disabled={weightSweepRunning}
              >
                {weightSweepRunning ? `Sweep… ${weightSweepElapsed}s` : "Run weight sweep"}
              </button>
            )
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
          {!paperLoading ? (
            <WeightStackBar weights={activeWeightsDisplay} label="Active (adaptive, last rebalance)" variant="active" />
          ) : null}
          {!paperLoading ? (
            <div style={{ marginTop: 14 }}>
              <WeightStackBar weights={anchorWeightsDisplay} label="Anchor (config)" variant="anchor" />
            </div>
          ) : null}
          <div className="ma-mono" style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: paperLoading ? 0 : 12 }}>
            Cached sweep snapshot — top OOS Sharpe:{" "}
            <span className="ma-num" style={{ color: GREEN_LIGHT }}>
              {weightSweepCached?.recommendation?.oosSharpe != null ? fmtNum2(weightSweepCached.recommendation.oosSharpe) : "—"}
            </span>
            {weightSweepCached?.recommendation?.overfitRatio != null ? (
              <>
                {" "}
                · overfit {fmtNum2(weightSweepCached.recommendation.overfitRatio)}
              </>
            ) : null}
          </div>
          <div className="ma-mono" style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 8 }}>
            Long run: ~2 hours · tests 50+ weight combos
          </div>
          {weightSweepRunning ? (
            <div className="ma-alphalab-progress" style={{ marginTop: 12 }}>
              <div className="ma-alphalab-progress__bar" />
              <span className="ma-mono" style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                Running weight sweep…
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
              Sweep done: {weightSweepResult.swept ?? "—"} configs · best OOS Sharpe {fmtNum2(weightSweepResult.recommendation?.oosSharpe)}
            </div>
          ) : null}
        </CardShell>

        <CardShell title="Universe comparison">
          {ucLoading || (!ucData && !ucErr) ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SkeletonBlock h={40} />
              <SkeletonBlock h={40} />
            </div>
          ) : ucErr ? (
            <div className="ma-mono" style={{ color: RED_LIGHT, fontSize: 12 }}>
              {ucErr}
            </div>
          ) : ucData && row50 && row150 ? (
            <div className="ma-alphalab-uc ma-alphalab-fadein">
              {[row50, row150].filter(Boolean).map((row) => (
                <div
                  key={row.universe}
                  className={
                    "ma-alphalab-uc__col" +
                    (ucWinnerUniverse === row.universe ? " ma-alphalab-uc__col--winner" : "")
                  }
                >
                  <div className="ma-mono" style={{ fontSize: 11, color: AMBER_LIGHT, marginBottom: 10 }}>
                    {row.universe === "sp500_top50" ? "Top 50" : "Top 150"} · {row.tickers} names
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
                  Δ:{" "}
                  <span style={{ color: ucData.improvement.returnDelta >= 0 ? GREEN_LIGHT : RED_LIGHT }}>
                    {fmtPct2(ucData.improvement.returnDelta)} return
                  </span>
                  {" · "}
                  <span style={{ color: ucData.improvement.alphaDelta >= 0 ? GREEN_LIGHT : RED_LIGHT }}>
                    {fmtPct2(ucData.improvement.alphaDelta)} alpha
                  </span>
                  {ucWinnerUniverse === "sp500_top150" ? (
                    <span style={{ display: "block", marginTop: 6, color: GREEN_LIGHT }}>Top 150 is the stronger universe on this window.</span>
                  ) : ucWinnerUniverse === "sp500_top50" ? (
                    <span style={{ display: "block", marginTop: 6, color: "var(--color-text-muted)" }}>Top 50 leads on this window.</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </CardShell>

        <CardShell title="Factor strength">
          {facLoading || (!facData && !facErr) ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[1, 2, 3, 4, 5].map((i) => (
                <SkeletonBlock key={i} h={36} />
              ))}
            </div>
          ) : facErr ? (
            <div className="ma-mono" style={{ color: RED_LIGHT, fontSize: 12 }}>
              {facErr}
            </div>
          ) : facData ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }} className="ma-alphalab-fadein">
              {factorRows.length === 0 ? (
                <div className="ma-mono" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                  No factor rows returned.
                </div>
              ) : null}
              {factorRows.map((row) => {
                const sh = Number(row.sharpe);
                const tr = Number(row.totalReturn);
                const barW = maxFactorRet > 0 ? (Math.abs(tr) / maxFactorRet) * 100 : 0;
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
          ) : null}
        </CardShell>

        <CardShell title="Hedging impact">
          {hedgeLoading || (!hedgeData && !hedgeErr) ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[1, 2, 3, 4].map((i) => (
                <SkeletonBlock key={i} h={80} />
              ))}
            </div>
          ) : hedgeErr ? (
            <div className="ma-mono" style={{ color: RED_LIGHT, fontSize: 12 }}>
              {hedgeErr}
            </div>
          ) : hedgeData ? (
            <>
              <div className="ma-alphalab-hedge-grid ma-alphalab-fadein">
                {hedgeConfigs.map((c) => {
                  const name = c.name;
                  const best = bestSharpe.name === c.name;
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
              {bestSharpe.name != null && Number.isFinite(bestSharpe.sharpe) ? (
                <div className="ma-mono" style={{ fontSize: 11, marginTop: 10, color: "var(--color-text-muted)" }}>
                  Best Sharpe: <span style={{ color: GREEN_LIGHT }}>{bestSharpe.name}</span> ({fmtNum2(bestSharpe.sharpe)})
                </div>
              ) : null}
            </>
          ) : null}
        </CardShell>

        <CardShell
          title="Forward confidence"
          actions={
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="ma-alphalab-btn"
                onClick={loadForwardConfidence}
                disabled={fcLoading}
              >
                {fcLoading ? "…" : "Refresh"}
              </button>
              {!lite && (
                <button
                  type="button"
                  className="ma-alphalab-btn"
                  onClick={loadForwardWeightRec}
                  disabled={fwLoading}
                >
                  {fwLoading ? "…" : "Weight rec"}
                </button>
              )}
            </div>
          }
        >
          {(fcLoading && !fcData) || (!fcData && !fcErr && fwLoading && !fwRec) ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SkeletonBlock h={36} />
              <SkeletonBlock h={120} />
            </div>
          ) : fcErr && !fcData ? (
            <div className="ma-mono" style={{ color: RED_LIGHT, fontSize: 12 }}>
              {fcErr}
            </div>
          ) : fcData?.scores ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }} className="ma-alphalab-fadein">
              <div>
                <div className="ma-mono" style={{ fontSize: 12, marginBottom: 8 }}>
                  Forward confidence{" "}
                  <span style={{ color: GREEN_LIGHT }}>{((fcData.scores?.forwardConfidence ?? 0) * 100).toFixed(0)}%</span>
                </div>
                <div className="ma-alphalab-conf-bar" style={{ position: "relative" }}>
                  <div
                    className="ma-alphalab-conf-bar__fill"
                    style={{ transform: `scaleX(${1 - (fcData.scores?.forwardConfidence ?? 0)})` }}
                  />
                </div>
              </div>
              <div className="ma-mono" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                Est. annual alpha:{" "}
                <span style={{ color: GREEN_LIGHT }}>~{fcData.forwardEstimate?.estimatedAnnualAlpha ?? "—"}%</span>
                <div style={{ marginTop: 6 }}>
                  Range: {fcData.forwardEstimate?.confidenceBand?.low ?? "—"}% – {fcData.forwardEstimate?.confidenceBand?.high ?? "—"}%
                </div>
              </div>
              {["stability", "robustness", "simplicity", "recencyDiscount"].map((k) => {
                const lab =
                  k === "recencyDiscount" ? "Recency disc" : k === "stability" ? "Stability" : k === "robustness" ? "Robustness" : "Simplicity";
                const v = fcData.scores?.[k] ?? 0;
                return (
                  <div key={k}>
                    <div className="ma-mono" style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 4 }}>
                      {lab}{" "}
                      <span style={{ color: TEXT }}>{(v * 100).toFixed(0)}%</span>
                    </div>
                    <div className="ma-alphalab-score-bar">
                      <div className="ma-alphalab-score-bar__fill" style={{ width: `${Math.min(100, v * 100)}%` }} />
                    </div>
                  </div>
                );
              })}
              <WeightStackBar weights={fcData.weights} label="Weights (paper config)" variant="anchor" />
              {fcData.subperiodAnalysis && Object.keys(fcData.subperiodAnalysis).length > 0 ? (
                <div>
                  <div className="ma-mono" style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 6 }}>
                    Sub-periods
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {["1y", "2y", "3y", "5y"].map((k) => {
                      const v = fcData.subperiodAnalysis[k];
                      if (!v) return null;
                      return (
                        <div key={k} className="ma-mono" style={{ fontSize: 11 }}>
                          {k}:{" "}
                          <span style={{ color: v.alpha >= 0 ? GREEN_LIGHT : RED_LIGHT }}>{fmtPct2(v.alpha)}</span> α
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {fcData.regimeSplit ? (
                <div>
                  <div className="ma-mono" style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 6 }}>
                    Regimes
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {["strong_bull", "normal", "pullback", "caution", "bear"].map((k) => {
                      const r = fcData.regimeSplit[k];
                      if (!r || r.daysInRegime < 5) return null;
                      const pos = r.alpha >= 0;
                      return (
                        <div
                          key={k}
                          className="ma-mono"
                          style={{
                            fontSize: 10,
                            padding: "6px 8px",
                            borderRadius: 6,
                            background: pos ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                            border: `1px solid ${pos ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)"}`
                          }}
                        >
                          {REGIME_SHORT[k] ?? k}{" "}
                          <span style={{ color: pos ? GREEN_LIGHT : RED_LIGHT }}>{fmtPct2(r.alpha)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {fcData.interpretation ? (
                <p style={{ margin: 0, fontSize: 12, lineHeight: 1.65, opacity: 0.85 }}>{fcData.interpretation}</p>
              ) : null}
            </div>
          ) : null}
          {fwRec?.recommendation?.weights && (
            <div className="ma-mono" style={{ marginTop: 12, fontSize: 11, lineHeight: 1.6 }}>
              <strong>Recommendation</strong> ({fwRec.recommendation.reason}):{" "}
              <WeightStackBar weights={fwRec.recommendation.weights} label="Recommended weights" />
            </div>
          )}
          {fwRec?.previousRecommendation && (
            <div style={{ marginTop: 8, fontSize: 11, opacity: 0.75 }}>
              Legacy OOS-Sharpe pick: OOS Sharpe {fwRec.previousRecommendation.oosSharpe?.toFixed?.(2) ?? fwRec.previousRecommendation.oosSharpe} · forward{" "}
              {((fwRec.previousRecommendation.forwardConfidence ?? 0) * 100).toFixed(0)}%
            </div>
          )}
        </CardShell>
      </div>

    </div>
  );
}
