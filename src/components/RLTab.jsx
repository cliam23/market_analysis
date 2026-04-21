import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Loader2 } from "lucide-react";
import { decodeState, TOTAL_ACTIONS, TOTAL_STATES } from "../../q-learning-agent.js";
import { apiFetch } from "../lib/api.js";
import { MONO, SANS, TEXT, GREEN, GREEN_LIGHT, RED, RED_LIGHT, AMBER, AMBER_LIGHT, BORDER_LIGHT } from "../lib/theme.js";
import { fmtMoney, fmtPctSigned as fmtPct } from "../lib/formatters.js";

const REGIME_LABELS = ["strong_bull", "normal", "pullback", "caution", "bear"];

function formatAgentMtime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    }).format(d);
  } catch {
    return iso;
  }
}

function formatCalendarDate(isoDate) {
  if (!isoDate || typeof isoDate !== "string") return "—";
  try {
    const d = new Date(`${isoDate.slice(0, 10)}T12:00:00`);
    if (Number.isNaN(d.getTime())) return isoDate;
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
  } catch {
    return isoDate;
  }
}

function actionLabel(a) {
  if (!a) return "—";
  return `exp=${a.exposure} · pos=${a.positionCount} · ${a.sizingMethod}`;
}

function topQPolicyRows(policy, limit = 10) {
  if (!Array.isArray(policy)) return [];
  return [...policy]
    .map((row) => ({ ...row, _q: Number(row.qValue) }))
    .sort((a, b) => b._q - a._q)
    .slice(0, limit)
    .map((row) => {
      const d = decodeState(row.stateIdx);
      const regime = REGIME_LABELS[d.regimeBucket] ?? "—";
      return { ...row, regime };
    });
}

function qStatsFromPolicy(policy) {
  if (!Array.isArray(policy)) return null;
  const qs = policy.map((p) => Number(p.qValue)).filter((x) => Number.isFinite(x));
  if (!qs.length) return null;
  const min = Math.min(...qs);
  const max = Math.max(...qs);
  return { min, max, spread: max - min };
}

function spreadHealth(spread) {
  if (spread == null || !Number.isFinite(spread)) return { barPct: 0, label: "—", tone: "lo" };
  if (spread >= 3) return { barPct: 100, label: "healthy", tone: "hi" };
  if (spread >= 1) return { barPct: Math.min(100, (spread / 3) * 100), label: "learning", tone: "mid" };
  return { barPct: Math.min(100, Math.max(8, spread * 33)), label: "undertrained", tone: "lo" };
}

function regimeTextColor(reg) {
  const r = String(reg || "").toLowerCase();
  if (r.includes("bull")) return GREEN_LIGHT;
  if (r === "bear") return RED_LIGHT;
  if (r === "caution" || r === "pullback") return AMBER_LIGHT;
  return TEXT;
}

function weightsShort(w) {
  if (!w) return "—";
  const q = Math.round((Number(w.fundamental) || 0) * 100);
  const v = Math.round((Number(w.value) || 0) * 100);
  const m = Math.round((Number(w.momentum) || 0) * 100);
  const e = Math.round((Number(w.earningsMomentum) || 0) * 100);
  return `M${m}/V${v}/Q${q}/E${e}`;
}

/** Set by About / Dashboard when navigating to RL Agent with a universe. */
const RL_NAV_UNIVERSE_KEY = "ma-rl-nav-universe";

export default function RLTab() {
  const [rlStatus, setRlStatus] = useState(null);
  const [statusErr, setStatusErr] = useState(null);
  const [universeId, setUniverseId] = useState("sp500_top150");

  useEffect(() => {
    try {
      const u = sessionStorage.getItem(RL_NAV_UNIVERSE_KEY);
      if (u === "sp500_top50" || u === "sp500_top150") {
        sessionStorage.removeItem(RL_NAV_UNIVERSE_KEY);
        setUniverseId(u);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const [trainBody, setTrainBody] = useState({
    period: "5y",
    episodes: 50000,
    topN: 15,
    strategy: "full_composite",
    rlRandomAgent: false,
    weights: {
      fundamental: 0.12,
      value: 0.35,
      momentum: 0.35,
      earningsMomentum: 0.18,
      dcf: 0,
      valuation: 0
    }
  });
  const [trainResult, setTrainResult] = useState(null);
  const [trainErr, setTrainErr] = useState(null);
  const [trainLoading, setTrainLoading] = useState(false);
  const [trainElapsedSec, setTrainElapsedSec] = useState(0);
  const trainTimerRef = useRef(null);

  const [policyJson, setPolicyJson] = useState(null);
  const [policyErr, setPolicyErr] = useState(null);
  const [policyLoading, setPolicyLoading] = useState(false);

  const [paperPf, setPaperPf] = useState(null);
  const [paperPfErr, setPaperPfErr] = useState(null);
  const [paperLoading, setPaperLoading] = useState(false);
  const [previewHealth, setPreviewHealth] = useState(null);
  const [previewErr, setPreviewErr] = useState(null);
  const [scheduleInfo, setScheduleInfo] = useState(null);
  const [previewModal, setPreviewModal] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [comparePeriod, setComparePeriod] = useState("3y");
  const [compareTopN, setCompareTopN] = useState(15);
  const [compareFreq, setCompareFreq] = useState("bimonthly");
  const [compareResult, setCompareResult] = useState(null);
  const [compareErr, setCompareErr] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);

  const compareSectionRef = useRef(null);

  const weightSum =
    (Number(trainBody.weights.fundamental) || 0) +
    (Number(trainBody.weights.value) || 0) +
    (Number(trainBody.weights.momentum) || 0) +
    (Number(trainBody.weights.earningsMomentum) || 0) +
    (Number(trainBody.weights.dcf) || 0) +
    (Number(trainBody.weights.valuation) || 0);
  const sumOk = Math.abs(weightSum - 1) < 0.02;

  const isDqn = useMemo(() => String(rlStatus?.agentType ?? "").toLowerCase() === "dqn", [rlStatus]);

  const uniAgent = useMemo(() => {
    if (!rlStatus) return null;
    if (isDqn) return null;
    return rlStatus.agents?.[universeId] ?? null;
  }, [rlStatus, universeId, isDqn]);

  const displayAgent = useMemo(() => {
    if (!rlStatus) return { loaded: false, statesVisited: 0, totalUpdates: 0, coveragePct: 0, agentFile: "—", agentFileMtime: null };
    if (isDqn) {
      const loaded = !!(rlStatus.agentLoaded ?? rlStatus.loaded);
      const sv = Number(rlStatus.statesVisited) || 0;
      const tu = Number(rlStatus.totalUpdates) || 0;
      const ts = Number(rlStatus.totalStates) || TOTAL_STATES;
      const cov = ts > 0 ? (sv / ts) * 100 : 0;
      return {
        loaded,
        statesVisited: sv,
        totalUpdates: tu,
        coveragePct: parseFloat(cov.toFixed(1)),
        agentFile: rlStatus.agentFile ?? "—",
        agentFileMtime: rlStatus.agentFileMtime,
        totalStates: ts,
        actionSpace: rlStatus.actionSpaceSize ?? TOTAL_ACTIONS
      };
    }
    const u = uniAgent;
    const loaded = !!(u?.loaded);
    const sv = Number(u?.statesVisited) || 0;
    const tu = Number(u?.totalUpdates) || 0;
    const ts = Number(rlStatus.totalStates) || TOTAL_STATES;
    const cov = ts > 0 ? (sv / ts) * 100 : 0;
    return {
      loaded,
      statesVisited: sv,
      totalUpdates: tu,
      coveragePct: parseFloat(cov.toFixed(1)),
      agentFile: u?.agentFile ?? "—",
      agentFileMtime: u?.agentFileMtime ?? null,
      totalStates: ts,
      actionSpace: rlStatus.totalActions ?? TOTAL_ACTIONS
    };
  }, [rlStatus, universeId, isDqn, uniAgent]);

  const loadStatus = useCallback(async () => {
    try {
      const res = await apiFetch("/api/rl/status");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setRlStatus(data);
      setStatusErr(null);
    } catch (e) {
      setStatusErr(e.message);
    }
  }, []);

  const loadPaperBlock = useCallback(async () => {
    setPaperLoading(true);
    setPaperPfErr(null);
    setPreviewErr(null);
    try {
      const [pRes, sRes] = await Promise.all([apiFetch("/api/paper-trade/portfolio"), apiFetch("/api/paper-trade/schedule")]);
      const pData = await pRes.json().catch(() => ({}));
      const sData = await sRes.json().catch(() => ({}));
      if (!pRes.ok) throw new Error(pData.error || "Portfolio request failed");
      setPaperPf(pData.portfolio ?? null);
      if (sRes.ok && sData.success) setScheduleInfo(sData);
      else setScheduleInfo(null);

      if (pData.portfolio) {
        try {
          const pr = await apiFetch("/api/paper-trade/preview");
          const prev = await pr.json();
          if (pr.ok && prev.health) setPreviewHealth(prev.health);
          else setPreviewHealth(null);
        } catch {
          setPreviewHealth(null);
        }
      } else {
        setPreviewHealth(null);
      }
    } catch (e) {
      setPaperPf(null);
      setPaperPfErr(e.message);
      setPreviewHealth(null);
      setScheduleInfo(null);
    } finally {
      setPaperLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, 30000);
    return () => clearInterval(t);
  }, [loadStatus]);

  useEffect(() => {
    loadPaperBlock();
    const t = setInterval(loadPaperBlock, 60000);
    return () => clearInterval(t);
  }, [loadPaperBlock]);

  useEffect(() => {
    return () => {
      if (trainTimerRef.current) clearInterval(trainTimerRef.current);
    };
  }, []);

  const runTrain = useCallback(async () => {
    if (!sumOk) {
      setTrainErr("Weights must sum to 1.0 (±0.02) before training.");
      return;
    }
    setTrainLoading(true);
    setTrainErr(null);
    setTrainResult(null);
    setTrainElapsedSec(0);
    if (trainTimerRef.current) clearInterval(trainTimerRef.current);
    trainTimerRef.current = setInterval(() => setTrainElapsedSec((s) => s + 1), 1000);
    const clientStart = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      const res = await apiFetch("/api/rl/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          universeId,
          period: trainBody.period,
          episodes: Math.min(50000, Math.max(1, parseInt(String(trainBody.episodes), 10) || 1)),
          topN: Number(trainBody.topN),
          strategy: trainBody.strategy,
          rlRandomAgent: trainBody.rlRandomAgent,
          weights: trainBody.weights,
          agentType: "qlearning"
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      const clientTotalMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - clientStart;
      setTrainResult({ ...data, clientTotalMs: parseFloat(clientTotalMs.toFixed(1)) });
      loadStatus();
      loadPaperBlock();
    } catch (e) {
      setTrainErr(e.message);
    } finally {
      if (trainTimerRef.current) {
        clearInterval(trainTimerRef.current);
        trainTimerRef.current = null;
      }
      setTrainLoading(false);
    }
  }, [trainBody, sumOk, universeId, loadStatus, loadPaperBlock]);

  const loadPolicy = useCallback(async () => {
    setPolicyLoading(true);
    setPolicyErr(null);
    try {
      const q = isDqn ? "" : `?universeId=${encodeURIComponent(universeId)}`;
      const res = await apiFetch(`/api/rl/policy${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setPolicyJson(data);
    } catch (e) {
      setPolicyJson(null);
      setPolicyErr(e.message);
    } finally {
      setPolicyLoading(false);
    }
  }, [universeId, isDqn]);

  useEffect(() => {
    setPolicyJson(null);
    setPolicyErr(null);
  }, [universeId, isDqn]);

  const runCompare = useCallback(async () => {
    setCompareLoading(true);
    setCompareErr(null);
    setCompareResult(null);
    try {
      const params = new URLSearchParams({
        universeId,
        period: comparePeriod,
        topN: String(compareTopN),
        strategy: "full_composite",
        rebalanceFreq: compareFreq
      });
      const res = await apiFetch(`/api/rl/compare?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setCompareResult(data);
    } catch (e) {
      setCompareErr(e.message);
    } finally {
      setCompareLoading(false);
    }
  }, [universeId, comparePeriod, compareTopN, compareFreq]);

  const openPreviewModal = async () => {
    setPreviewLoading(true);
    setPreviewErr(null);
    try {
      const res = await apiFetch("/api/paper-trade/preview");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setPreviewModal(data);
    } catch (e) {
      setPreviewErr(e.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const scrollToCompare = () => {
    compareSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const topQRows = policyJson?.policy ? topQPolicyRows(policyJson.policy, 10) : [];
  const qStats = policyJson?.policy ? qStatsFromPolicy(policyJson.policy) : null;
  const spreadH = qStats ? spreadHealth(qStats.spread) : null;
  const spreadFillColor =
    spreadH?.tone === "hi" ? "var(--green)" : spreadH?.tone === "mid" ? "var(--yellow)" : "var(--red)";

  const sum = paperPf?.summary;
  const cfg = paperPf?.config;
  const rlCfgOn =
    cfg &&
    cfg.rlAgent !== false &&
    cfg.rlAgent !== "false" &&
    cfg.rlAgent !== "0" &&
    cfg.rlAgent !== 0;
  const rlOnlineCfgOn =
    cfg &&
    (cfg.rlOnlineLearning === true || cfg.rlOnlineLearning === "true" || cfg.rlOnlineLearning === "1" || cfg.rlOnlineLearning === 1);
  const nextReb = scheduleInfo?.nextRebalance || paperPf?.nextRebalance;
  const daysAway = scheduleInfo?.daysUntilNext;

  const base = compareResult?.baseline;
  const rl = compareResult?.rlEval;
  const parseN = (x) => (x == null ? null : parseFloat(String(x), 10));
  const hasCompare = base && rl;
  const baseSh = parseN(base?.sharpe);
  const rlSh = parseN(rl?.sharpe);
  const winner =
    baseSh != null && rlSh != null && Number.isFinite(baseSh) && Number.isFinite(rlSh)
      ? rlSh > baseSh
        ? "rl"
        : baseSh > rlSh
          ? "rules"
          : "tie"
      : null;

  const estTrain = universeId === "sp500_top150" ? "~3 hours (top 150)" : "~80 min (top 50)";

  return (
    <div className="ma-page-container ma-rl-page" style={{ fontFamily: SANS, color: TEXT }}>
      <header className="ma-rl-stagger">
        <p className="ma-rl-kicker">RL AGENT</p>
        <h1 className="ma-rl-title">Q-learning portfolio policy</h1>
        <p className="ma-rl-sub">Train tabular Q, inspect greedy policy, and compare vs rules.</p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
          {["sp500_top50", "sp500_top150"].map((id) => (
            <button
              key={id}
              type="button"
              className={"ma-rl-seg" + (universeId === id ? " ma-rl-seg--on" : "")}
              onClick={() => setUniverseId(id)}
            >
              {id === "sp500_top50" ? "Top 50" : "Top 150"}
            </button>
          ))}
        </div>

        <div className="ma-rl-status-card">
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <span className={"ma-rl-trained-pill " + (displayAgent.loaded ? "ma-rl-trained-pill--ok" : "ma-rl-trained-pill--bad")}>
              <span className="ma-rl-trained-pill__dot" aria-hidden />
              {displayAgent.loaded ? "Trained" : "No agent"}
            </span>
            <span className="ma-mono" style={{ fontSize: 13, color: TEXT }}>
              {displayAgent.statesVisited.toLocaleString()} / {displayAgent.totalStates?.toLocaleString?.() ?? displayAgent.totalStates} states
            </span>
            <div className="ma-rl-cov-bar" title="Coverage">
              <div
                className="ma-rl-cov-bar__fill"
                style={{ width: `${Math.min(100, displayAgent.coveragePct || 0)}%` }}
              />
            </div>
            <span className="ma-mono" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              {displayAgent.coveragePct}% coverage
            </span>
          </div>
          <div className="ma-mono" style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
            {(displayAgent.totalUpdates ?? 0).toLocaleString()} updates
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
            Last trained: <span style={{ color: GREEN_LIGHT }}>{formatAgentMtime(displayAgent.agentFileMtime)}</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Action space: {displayAgent.actionSpace ?? TOTAL_ACTIONS} · Agent file:{" "}
            <span className="ma-mono">{displayAgent.agentFile}</span>
          </div>
          {statusErr && (
            <div style={{ color: RED_LIGHT, fontSize: 12, marginTop: 8 }}>Status error: {statusErr}</div>
          )}
        </div>

        {rlStatus?.loaded && rlStatus?.rlEvalGloballyEnabled === false && (
          <p style={{ margin: "14px 0 0", fontSize: 12, color: AMBER_LIGHT, lineHeight: 1.55, maxWidth: 720 }}>
            RL eval may be gated server-side. Check <span className="ma-mono">RL_ENABLED</span> / deployment notes if eval is disabled.
          </p>
        )}
      </header>

      <div className="ma-rl-grid-2" style={{ marginTop: 28 }}>
        <section className="ma-rl-card">
          <h2 className="ma-rl-card__title">Train agent</h2>
          <p className="ma-rl-card__sub">Run episodes to update the on-disk policy for the selected universe.</p>

          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <div className="ma-rl-label">Universe</div>
              <select
                className="ma-rl-input"
                style={{ cursor: "pointer" }}
                disabled={trainLoading}
                value={universeId}
                onChange={(e) => setUniverseId(e.target.value)}
              >
                <option value="sp500_top50">sp500_top50</option>
                <option value="sp500_top150">sp500_top150</option>
              </select>
            </div>
            <div>
              <div className="ma-rl-label">Period</div>
              <select
                className="ma-rl-input"
                disabled={trainLoading}
                value={trainBody.period}
                onChange={(e) => setTrainBody((b) => ({ ...b, period: e.target.value }))}
              >
                {["3y", "5y", "7y"].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="ma-rl-label">Episodes</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  className="ma-rl-ep-btn"
                  disabled={trainLoading}
                  onClick={() => setTrainBody((b) => ({ ...b, episodes: Math.max(1, Number(b.episodes) - 1000) }))}
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  max={50000}
                  className="ma-rl-input"
                  style={{ flex: 1 }}
                  disabled={trainLoading}
                  value={trainBody.episodes}
                  onChange={(e) => setTrainBody((b) => ({ ...b, episodes: e.target.value }))}
                />
                <button
                  type="button"
                  className="ma-rl-ep-btn"
                  disabled={trainLoading}
                  onClick={() => setTrainBody((b) => ({ ...b, episodes: Math.min(50000, Number(b.episodes) + 1000) }))}
                >
                  +
                </button>
              </div>
            </div>
            <div>
              <div className="ma-rl-label">Top N</div>
              <input
                type="number"
                min={3}
                max={30}
                className="ma-rl-input"
                disabled={trainLoading}
                value={trainBody.topN}
                onChange={(e) => setTrainBody((b) => ({ ...b, topN: e.target.value }))}
              />
            </div>
            <div>
              <div className="ma-rl-label">Strategy</div>
              <select
                className="ma-rl-input"
                disabled={trainLoading}
                value={trainBody.strategy}
                onChange={(e) => setTrainBody((b) => ({ ...b, strategy: e.target.value }))}
              >
                <option value="full_composite">full_composite</option>
              </select>
            </div>
            <div>
              <div className="ma-rl-label">Weights</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {[
                  ["momentum", "M"],
                  ["value", "V"],
                  ["fundamental", "Q"],
                  ["earningsMomentum", "E"],
                  ["dcf", "DCF"],
                  ["valuation", "Val"]
                ].map(([key, lab]) => (
                  <div key={key} style={{ flex: "0 0 72px" }}>
                    <div className="ma-rl-label" style={{ marginBottom: 4 }}>
                      {lab}
                    </div>
                    <input
                      type="number"
                      step={0.05}
                      min={0}
                      max={1}
                      className="ma-rl-input"
                      style={{ width: 60, padding: "0 8px" }}
                      disabled={trainLoading}
                      value={trainBody.weights[key]}
                      onChange={(e) =>
                        setTrainBody((b) => ({
                          ...b,
                          weights: { ...b.weights, [key]: parseFloat(e.target.value) || 0 }
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="ma-mono" style={{ fontSize: 12, marginTop: 8, color: sumOk ? GREEN_LIGHT : RED_LIGHT }}>
                Sum: {weightSum.toFixed(2)} {sumOk ? "✓" : "✗"}
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", userSelect: "none" }}>
              <button
                type="button"
                className={"ma-rl-toggle" + (trainBody.rlRandomAgent ? " ma-rl-toggle--on" : "")}
                disabled={trainLoading}
                onClick={() => setTrainBody((b) => ({ ...b, rlRandomAgent: !b.rlRandomAgent }))}
                aria-pressed={trainBody.rlRandomAgent}
              >
                <span className="ma-rl-toggle__knob" />
              </button>
              <span className="ma-mono" style={{ fontSize: 12 }}>
                Random agent (smoke test)
              </span>
            </label>
          </div>

          <button type="button" className="ma-rl-run-btn ma-btn-primary" disabled={trainLoading || !sumOk} onClick={runTrain}>
            {trainLoading ? (
              <>
                <Loader2 size={16} className="ma-alphalab-loadbtn__spin" style={{ verticalAlign: "middle", marginRight: 8 }} />
                TRAINING… ({trainElapsedSec}s)
              </>
            ) : (
              "Run training"
            )}
          </button>
          {trainLoading && (
            <div className="ma-rl-prog" aria-hidden>
              <div className="ma-rl-prog__indet" />
            </div>
          )}
          <p style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 10 }}>Estimated time: {estTrain}</p>

          {trainErr && <div style={{ marginTop: 12, color: RED_LIGHT, fontSize: 12, fontFamily: MONO }}>{trainErr}</div>}
          {trainResult && (
            <div
              style={{
                marginTop: 16,
                padding: 16,
                borderRadius: 10,
                border: `1px solid ${GREEN}`,
                background: "rgba(34,197,94,0.08)",
                fontFamily: MONO,
                fontSize: 12,
                lineHeight: 1.7
              }}
            >
              <div style={{ fontWeight: 800, color: GREEN_LIGHT, marginBottom: 8 }}>Training complete</div>
              <div>Episodes: {trainResult.episodes ?? "—"}</div>
              <button type="button" className="ma-btn-ghost" style={{ marginTop: 10, fontFamily: MONO, fontSize: 12 }} onClick={scrollToCompare}>
                Run compare →
              </button>
            </div>
          )}
        </section>

        <section className="ma-rl-card">
          <h2 className="ma-rl-card__title">Live policy</h2>
          <p className="ma-rl-card__sub">Greedy action per visited state ({universeId}).</p>
          <button type="button" className="ma-rl-load-policy" disabled={policyLoading} onClick={loadPolicy}>
            {policyLoading ? "Loading…" : "Load policy"}
          </button>
          {policyErr && <div style={{ color: RED_LIGHT, fontFamily: MONO, fontSize: 12, marginTop: 12 }}>{policyErr}</div>}
          {policyJson && (
            <div style={{ marginTop: 16 }}>
              <div className="ma-rl-card__title" style={{ marginBottom: 8 }}>
                Top Q-values by state
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="ma-rl-q-table">
                  <thead>
                    <tr>
                      <th>State</th>
                      <th>Regime</th>
                      <th>Action</th>
                      <th className="ma-num">Q</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topQRows.map((row) => (
                      <tr key={row.stateIdx}>
                        <td className="ma-mono">{row.stateIdx}</td>
                        <td className="ma-mono" style={{ color: regimeTextColor(row.regime) }}>
                          {row.regime}
                        </td>
                        <td className="ma-mono" style={{ maxWidth: 220, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
                          {actionLabel(row.action)}
                        </td>
                        <td className="ma-num ma-mono" style={{ color: Number(row.qValue) >= 0 ? GREEN_LIGHT : RED_LIGHT }}>
                          {row.qValue != null ? Number(row.qValue).toFixed(2) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 8 }}>Showing top 10 by Q-value</p>

              {qStats && (
                <>
                  <div className="ma-rl-card__title" style={{ marginTop: 20, marginBottom: 8 }}>
                    Q-value distribution
                  </div>
                  <div className="ma-mono" style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                    Min: {qStats.min.toFixed(2)} · Max: {qStats.max.toFixed(2)}
                    <br />
                    Spread: {qStats.spread.toFixed(2)} (target &gt; 3.0) ·{" "}
                    <span style={{ color: spreadFillColor }}>{spreadH?.label}</span>
                  </div>
                  <div className="ma-rl-spread-bar">
                    <div
                      className="ma-rl-spread-bar__fill"
                      style={{
                        width: `${spreadH?.barPct ?? 0}%`,
                        background: spreadFillColor,
                        transition: "width 0.8s ease"
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      </div>

      <section className="ma-rl-card" style={{ marginTop: 24 }}>
        <h2 className="ma-rl-card__title">Paper trade · Live RL decisions</h2>
        <p className="ma-rl-card__sub">Paper portfolio and RL controls (same feed as Paper Trade tab).</p>
        {paperPfErr && <div style={{ color: RED_LIGHT, fontFamily: MONO, fontSize: 12, marginBottom: 12 }}>{paperPfErr}</div>}
        {paperLoading && !paperPf && <div className="ma-mono" style={{ fontSize: 12, opacity: 0.7 }}>Loading portfolio…</div>}
        {!paperPf && !paperLoading && !paperPfErr && (
          <div className="ma-mono" style={{ fontSize: 12, opacity: 0.75 }}>No paper portfolio. Initialize from Trading tab.</div>
        )}
        {paperPf && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: 20,
                marginBottom: 16
              }}
            >
              <div>
                <div className="ma-rl-label">Portfolio</div>
                <div className="ma-mono" style={{ fontSize: 22, fontWeight: 800, color: GREEN_LIGHT }}>{fmtMoney(sum?.totalValue)}</div>
                <div className="ma-mono" style={{ fontSize: 14, marginTop: 6 }}>
                  Return{" "}
                  <span style={{ color: (sum?.totalReturn ?? 0) >= 0 ? GREEN_LIGHT : RED_LIGHT }}>{fmtPct(sum?.totalReturn)}</span>
                </div>
                <div className="ma-mono" style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 8, lineHeight: 1.7 }}>
                  {sum?.daysActive ?? "—"} days active · {sum?.holdingsCount ?? paperPf.holdings?.length ?? "—"} positions
                  <br />
                  Cash: {sum?.cashPct != null ? `${sum.cashPct}%` : "—"}
                </div>
              </div>
              <div>
                <div className="ma-rl-label">RL status</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                  <span className={`ma-pill ${rlCfgOn ? "ma-pill--green" : "ma-pill--neutral"}`} style={{ fontFamily: MONO, fontSize: 11 }}>
                    RL {rlCfgOn ? "ON" : "OFF"}
                  </span>
                  <span
                    className={`ma-pill ${rlOnlineCfgOn ? "ma-pill--green" : "ma-pill--neutral"}`}
                    style={{ fontFamily: MONO, fontSize: 11 }}
                  >
                    Online {rlOnlineCfgOn ? "ON" : "OFF"}
                  </span>
                </div>
                <div className="ma-mono" style={{ fontSize: 12, lineHeight: 1.8 }}>
                  <div>Regime: {sum?.currentRegime ?? "—"}</div>
                  <div>Weights: {weightsShort(paperPf.activeWeights || cfg?.weights)}</div>
                  <div>
                    Last action:{" "}
                    {sum?.rlLastAction
                      ? `${sum.rlLastAction.exposure} exp / ${sum.rlLastAction.positionCount} pos / ${sum.rlLastAction.sizingMethod}`
                      : "—"}
                  </div>
                </div>
              </div>
            </div>

            {previewHealth && (
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: 8,
                  background: "rgba(210,153,34,0.12)",
                  border: "1px solid rgba(210,153,34,0.35)",
                  fontFamily: MONO,
                  fontSize: 11,
                  lineHeight: 1.6,
                  marginBottom: 12
                }}
              >
                ⚠ Positions locked: {previewHealth.positionsLocked} / {previewHealth.currentHoldings}
                {previewHealth.nextEligibleDate && <> · Eligible: {formatCalendarDate(previewHealth.nextEligibleDate)}</>}
              </div>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, fontFamily: MONO, fontSize: 12 }}>
              <span>
                Next rebalance: {nextReb ? formatCalendarDate(nextReb) : "—"}
                {daysAway != null && typeof daysAway === "number" && (
                  <span style={{ opacity: 0.8 }}> · {daysAway} days away</span>
                )}
              </span>
              <button type="button" className="ma-rl-load-policy" disabled={previewLoading} onClick={openPreviewModal}>
                {previewLoading ? "Preview…" : "Preview rebalance"}
              </button>
            </div>
            {previewErr && <div style={{ color: RED_LIGHT, fontSize: 11, marginTop: 8 }}>{previewErr}</div>}
          </>
        )}
      </section>

      <section className="ma-rl-card" style={{ marginTop: 24 }} ref={compareSectionRef}>
        <h2 className="ma-rl-card__title">Backtest comparison</h2>
        <p className="ma-rl-card__sub">Rules-based vs Q-learning on the same path.</p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 12 }}>
          <div style={{ minWidth: 140, flex: "1 1 140px" }}>
            <div className="ma-rl-label">Universe</div>
            <select className="ma-rl-input" value={universeId} onChange={(e) => setUniverseId(e.target.value)} disabled={compareLoading}>
              <option value="sp500_top50">sp500_top50</option>
              <option value="sp500_top150">sp500_top150</option>
            </select>
          </div>
          <div style={{ minWidth: 100, flex: "0 1 100px" }}>
            <div className="ma-rl-label">Period</div>
            <select className="ma-rl-input" value={comparePeriod} onChange={(e) => setComparePeriod(e.target.value)} disabled={compareLoading}>
              <option value="3y">3y</option>
              <option value="5y">5y</option>
            </select>
          </div>
          <div style={{ minWidth: 72, flex: "0 1 72px" }}>
            <div className="ma-rl-label">Top N</div>
            <input
              type="number"
              className="ma-rl-input"
              value={compareTopN}
              onChange={(e) => setCompareTopN(parseInt(e.target.value, 10) || 15)}
              disabled={compareLoading}
            />
          </div>
          <div style={{ minWidth: 120, flex: "0 1 120px" }}>
            <div className="ma-rl-label">Rebalance</div>
            <select className="ma-rl-input" value={compareFreq} onChange={(e) => setCompareFreq(e.target.value)} disabled={compareLoading}>
              <option value="bimonthly">bimonthly</option>
              <option value="monthly">monthly</option>
            </select>
          </div>
          <button type="button" className="ma-rl-run-btn" style={{ maxWidth: 200, marginTop: 18 }} disabled={compareLoading} onClick={runCompare}>
            {compareLoading ? "Running…" : "Run compare"}
          </button>
        </div>
        {compareErr && <div style={{ marginTop: 8, color: RED_LIGHT, fontFamily: MONO, fontSize: 12 }}>{compareErr}</div>}
        {hasCompare && (
          <>
            <div className="ma-rl-compare-grid">
              {["baseline", "rlEval"].map((side) => {
                const row = side === "baseline" ? base : rl;
                const isRl = side === "rlEval";
                const isWin = winner === (isRl ? "rl" : "rules");
                return (
                  <div key={side} className={"ma-rl-compare-card" + (isWin && winner !== "tie" ? " ma-rl-compare-card--win" : "")}>
                    <div style={{ fontWeight: 800, marginBottom: 12, color: isRl ? AMBER_LIGHT : TEXT }}>
                      {isRl ? "Q-learning" : "Rules-based"}
                    </div>
                    <MetricLine label="Return" value={parseN(row?.totalReturn)} suffix="%" />
                    <MetricLine label="Alpha" value={parseN(row?.alpha)} suffix="%" />
                    <MetricLine label="Sharpe" value={parseN(row?.sharpe)} suffix="" />
                    <MetricLine label="Max DD" value={parseN(row?.maxDrawdown)} suffix="%" />
                  </div>
                );
              })}
            </div>
            {winner && winner !== "tie" && (
              <p className="ma-mono" style={{ fontSize: 12, marginTop: 14, color: "var(--text-secondary)" }}>
                Winner: {winner === "rl" ? "Q-learning" : "Rules-based"} (higher Sharpe)
              </p>
            )}
            {winner === "tie" && (
              <p className="ma-mono" style={{ fontSize: 12, marginTop: 14, color: "var(--text-secondary)" }}>
                Sharpe tie — compare returns or max DD manually.
              </p>
            )}
          </>
        )}
      </section>

      {previewModal && (
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
          onClick={() => setPreviewModal(null)}
        >
          <div
            style={{
              maxWidth: 640,
              width: "100%",
              maxHeight: "85vh",
              overflow: "auto",
              background: "#1a1a1c",
              border: `1px solid ${BORDER_LIGHT}`,
              borderRadius: 12,
              padding: 20,
              fontFamily: MONO,
              fontSize: 12,
              color: TEXT
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontWeight: 800 }}>Preview rebalance</span>
              <button type="button" className="ma-btn-ghost" onClick={() => setPreviewModal(null)}>
                Close
              </button>
            </div>
            <pre style={{ marginTop: 12, fontSize: 10, background: "rgba(0,0,0,0.4)", padding: 12, borderRadius: 8, overflow: "auto", maxHeight: 360 }}>
              {JSON.stringify(
                {
                  regime: previewModal.regime,
                  exposure: previewModal.exposure,
                  adjustedTopN: previewModal.adjustedTopN,
                  rlDecision: previewModal.rlDecision,
                  buys: previewModal.buys,
                  sells: previewModal.sells,
                  health: previewModal.health
                },
                null,
                2
              )}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricLine({ label, value, suffix }) {
  const vStr =
    value != null && !Number.isNaN(value)
      ? `${suffix === "%" && value > 0 ? "+" : ""}${value}${suffix}`
      : "—";
  const color = suffix === "%" && value != null ? (value >= 0 ? GREEN_LIGHT : RED_LIGHT) : TEXT;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, opacity: 0.65, marginBottom: 2 }}>{label}</div>
      <div className="ma-mono" style={{ color }}>
        <strong>{vStr}</strong>
      </div>
    </div>
  );
}
