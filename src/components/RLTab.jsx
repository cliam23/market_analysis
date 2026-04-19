import { useState, useEffect, useCallback, useRef } from "react";
import { decodeState, TOTAL_ACTIONS, TOTAL_STATES } from "../../q-learning-agent.js";
import { apiFetch } from "../lib/api.js";
import { MONO, SANS, TEXT, GREEN, GREEN_LIGHT, RED, RED_LIGHT, AMBER, AMBER_LIGHT, BG, BORDER, BORDER_LIGHT } from "../lib/theme.js";
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
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
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
  return `${a.exposure} exp / ${a.positionCount} pos / ${a.sizingMethod}`;
}

function buildRegimePolicyRows(policy) {
  if (!Array.isArray(policy) || !policy.length) return [];
  const buckets = [[], [], [], [], []];
  for (const row of policy) {
    const { regimeBucket } = decodeState(row.stateIdx);
    const b = Math.max(0, Math.min(4, regimeBucket | 0));
    buckets[b].push(row);
  }
  const refQ = 0.61;
  return REGIME_LABELS.map((regime, b) => {
    const list = buckets[b];
    if (!list.length) {
      return { regime, bestAction: "—", avgQ: null, confidence: "—", barPct: 0 };
    }
    const counts = new Map();
    for (const row of list) {
      const k = `${row.action.exposure}|${row.action.positionCount}|${row.action.sizingMethod}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    let bestK = null;
    let bestCnt = -1;
    for (const [k, c] of counts) {
      if (c > bestCnt) {
        bestCnt = c;
        bestK = k;
      }
    }
    const sample = list.find((r) => `${r.action.exposure}|${r.action.positionCount}|${r.action.sizingMethod}` === bestK);
    let sumQ = 0;
    let n = 0;
    for (const row of list) {
      if (`${row.action.exposure}|${row.action.positionCount}|${row.action.sizingMethod}` === bestK) {
        sumQ += Number(row.qValue) || 0;
        n++;
      }
    }
    const avgQ = n > 0 ? sumQ / n : null;
    const barPct = avgQ != null && refQ > 0 ? Math.min(100, Math.max(0, (avgQ / refQ) * 100)) : 0;
    let confidence = "Low";
    if (avgQ != null) {
      if (avgQ >= 0.5) confidence = "High";
      else if (avgQ >= 0.35) confidence = "Med";
    }
    return {
      regime,
      bestAction: sample ? actionLabel(sample.action) : "—",
      avgQ: avgQ != null ? parseFloat(avgQ.toFixed(2)) : null,
      confidence,
      barPct
    };
  });
}

function weightsShort(w) {
  if (!w) return "—";
  const q = Math.round((Number(w.fundamental) || 0) * 100);
  const v = Math.round((Number(w.value) || 0) * 100);
  const m = Math.round((Number(w.momentum) || 0) * 100);
  return `M${m} / V${v} / Q${q}`;
}

function Card({ title, subtitle, children, style: sx = {} }) {
  return (
    <div
      style={{
        background: BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: 20,
        marginBottom: 16,
        ...sx
      }}
    >
      {title && (
        <div style={{ marginBottom: 4 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: 2,
              color: AMBER_LIGHT,
              fontFamily: MONO
            }}
          >
            {title}
          </div>
          {subtitle && (
            <div style={{ fontSize: 11, color: TEXT, fontFamily: MONO, marginTop: 4, opacity: 0.55 }}>{subtitle}</div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

export default function RLTab() {
  const [rlStatus, setRlStatus] = useState(null);
  const [statusErr, setStatusErr] = useState(null);

  const [trainBody, setTrainBody] = useState({
    universeId: "sp500_top150",
    period: "5y",
    episodes: 50000,
    topN: 15,
    strategy: "full_composite",
    rlRandomAgent: false,
    weights: { fundamental: 0.2, value: 0.4, momentum: 0.4, dcf: 0, valuation: 0 }
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

  const [compareUniverse, setCompareUniverse] = useState("sp500_top150");
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
    (Number(trainBody.weights.dcf) || 0) +
    (Number(trainBody.weights.valuation) || 0);
  const sumOk = Math.abs(weightSum - 1) < 0.02;

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
      const [pRes, sRes] = await Promise.all([
        apiFetch("/api/paper-trade/portfolio"),
        apiFetch("/api/paper-trade/schedule")
      ]);
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
          universeId: trainBody.universeId,
          period: trainBody.period,
          episodes: Math.min(50000, Math.max(1, parseInt(String(trainBody.episodes), 10) || 1)),
          topN: Number(trainBody.topN),
          strategy: trainBody.strategy,
          rlRandomAgent: trainBody.rlRandomAgent,
          weights: trainBody.weights
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      const clientTotalMs =
        (typeof performance !== "undefined" ? performance.now() : Date.now()) - clientStart;
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
  }, [trainBody, sumOk, loadStatus, loadPaperBlock]);

  const loadPolicy = useCallback(async () => {
    setPolicyLoading(true);
    setPolicyErr(null);
    try {
      const res = await apiFetch("/api/rl/policy");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setPolicyJson(data);
    } catch (e) {
      setPolicyJson(null);
      setPolicyErr(e.message);
    } finally {
      setPolicyLoading(false);
    }
  }, []);

  const runCompare = useCallback(async () => {
    setCompareLoading(true);
    setCompareErr(null);
    setCompareResult(null);
    try {
      const params = new URLSearchParams({
        universeId: compareUniverse,
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
  }, [compareUniverse, comparePeriod, compareTopN, compareFreq]);

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

  const inputStyle = {
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${BORDER_LIGHT}`,
    borderRadius: 8,
    padding: "10px 12px",
    color: TEXT,
    fontSize: 13,
    fontFamily: MONO,
    width: "100%",
    boxSizing: "border-box"
  };

  const labelStyle = {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1.2,
    color: TEXT,
    marginBottom: 6,
    fontFamily: MONO,
    opacity: 0.85
  };

  const cov = rlStatus != null ? parseFloat(rlStatus.coveragePct) : null;
  const statesLine =
    rlStatus != null
      ? `${rlStatus.statesVisited?.toLocaleString?.() ?? rlStatus.statesVisited} / ${rlStatus.totalStates?.toLocaleString?.() ?? rlStatus.totalStates} states · ${cov ?? "—"}% coverage`
      : "—";
  const updatesLine =
    rlStatus != null ? `${(rlStatus.totalUpdates ?? 0).toLocaleString()} training updates` : "—";

  const regimeRows = policyJson?.policy ? buildRegimePolicyRows(policyJson.policy) : [];
  const conv = policyJson?.convergence;
  const coverageStr = conv?.coveragePercent != null ? `${conv.coveragePercent}%` : "—";

  const sum = paperPf?.summary;
  const cfg = paperPf?.config;
  const nextReb = scheduleInfo?.nextRebalance || paperPf?.nextRebalance;
  const daysAway = scheduleInfo?.daysUntilNext;

  const base = compareResult?.baseline;
  const rl = compareResult?.rlEval;
  const parseN = (x) => (x == null ? null : parseFloat(String(x), 10));
  const hasCompare = base && rl;

  return (
    <div
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: "8px 16px 48px",
        fontFamily: SANS,
        color: TEXT,
        boxSizing: "border-box"
      }}
    >
      <header style={{ marginBottom: 28, textAlign: "left" }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 4, fontFamily: MONO, color: AMBER_LIGHT, marginBottom: 6 }}>
          RL AGENT
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: "0 0 12px", letterSpacing: -0.5 }}>Q-learning portfolio policy</h1>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "12px 20px",
            padding: "12px 16px",
            borderRadius: 10,
            border: `1px solid ${BORDER}`,
            background: "rgba(0,0,0,0.25)",
            fontFamily: MONO,
            fontSize: 12
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: rlStatus?.loaded ? GREEN : RED,
                flexShrink: 0
              }}
            />
            <span style={{ color: rlStatus?.loaded ? GREEN_LIGHT : RED_LIGHT, fontWeight: 700 }}>
              {rlStatus?.loaded ? "Agent loaded" : "No agent"}
            </span>
          </div>
          <span style={{ color: TEXT, opacity: 0.9 }}>{statesLine}</span>
          <span style={{ color: TEXT, opacity: 0.75 }}>{updatesLine}</span>
          <span style={{ color: TEXT, opacity: 0.75 }}>
            Last trained: <span style={{ color: GREEN_LIGHT }}>{formatAgentMtime(rlStatus?.agentFileMtime)}</span>
          </span>
          {statusErr && <span style={{ color: RED_LIGHT }}>Status: {statusErr}</span>}
        </div>
        {rlStatus?.loaded && rlStatus?.rlEvalGloballyEnabled === false && (
          <p style={{ margin: "12px 0 0", fontSize: 12, color: AMBER_LIGHT, lineHeight: 1.55, maxWidth: 720 }}>
            Rules-based active · DQN parked (no consistent lift vs rules on recent eval). Export <span style={{ fontFamily: MONO }}>RL_ENABLED=true</span> to evaluate
            the policy. In training runs the agent often failed to beat rules out-of-sample; re-enable when state features or the algorithm change.
          </p>
        )}
      </header>

      {/* Train */}
      <Card title="TRAIN AGENT" subtitle="POST /api/rl/train">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 14,
            marginBottom: 16
          }}
        >
          <div>
            <div style={labelStyle}>Universe</div>
            <select
              style={{ ...inputStyle, cursor: "pointer" }}
              value={trainBody.universeId}
              onChange={(e) => setTrainBody((b) => ({ ...b, universeId: e.target.value }))}
            >
              <option value="sp500_top50">sp500_top50</option>
              <option value="sp500_top150">sp500_top150</option>
            </select>
          </div>
          <div>
            <div style={labelStyle}>Period</div>
            <select
              style={{ ...inputStyle, cursor: "pointer" }}
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
            <div style={labelStyle}>Episodes</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                className="ma-btn-ghost"
                style={{ fontFamily: MONO, fontSize: 16, minWidth: 36 }}
                onClick={() => setTrainBody((b) => ({ ...b, episodes: Math.max(1, Number(b.episodes) - 1000) }))}
              >
                −
              </button>
              <input
                type="number"
                min={1}
                max={50000}
                style={{ ...inputStyle, flex: 1 }}
                value={trainBody.episodes}
                onChange={(e) => setTrainBody((b) => ({ ...b, episodes: e.target.value }))}
              />
              <button
                type="button"
                className="ma-btn-ghost"
                style={{ fontFamily: MONO, fontSize: 16, minWidth: 36 }}
                onClick={() => setTrainBody((b) => ({ ...b, episodes: Math.min(50000, Number(b.episodes) + 1000) }))}
              >
                +
              </button>
            </div>
          </div>
          <div>
            <div style={labelStyle}>Top N</div>
            <input
              type="number"
              min={3}
              max={30}
              style={inputStyle}
              value={trainBody.topN}
              onChange={(e) => setTrainBody((b) => ({ ...b, topN: e.target.value }))}
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={labelStyle}>Strategy</div>
            <select style={{ ...inputStyle, cursor: "pointer" }} value={trainBody.strategy} onChange={(e) => setTrainBody((b) => ({ ...b, strategy: e.target.value }))}>
              <option value="full_composite">full_composite</option>
              <option value="full_composite_aggressive" disabled>
                full_composite_aggressive (disabled)
              </option>
              <option value="full_composite_turbo" disabled>
                full_composite_turbo (disabled)
              </option>
            </select>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={labelStyle}>Weights (Q / V / M / DCF / Val)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
              {[
                ["fundamental", "Q"],
                ["value", "V"],
                ["momentum", "M"],
                ["dcf", "DCF"],
                ["valuation", "Val"]
              ].map(([key, lab]) => (
                <div key={key} style={{ flex: "1 1 72px", minWidth: 64 }}>
                  <div style={{ ...labelStyle, marginBottom: 4 }}>{lab}</div>
                  <input
                    type="number"
                    step={0.05}
                    min={0}
                    max={1}
                    style={inputStyle}
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
            <div style={{ fontSize: 11, fontFamily: MONO, marginTop: 8, color: sumOk ? GREEN_LIGHT : RED_LIGHT }}>
              Sum: {weightSum.toFixed(2)} {sumOk ? "✓" : "≠ 1.0"}
            </div>
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, fontFamily: MONO, marginBottom: 16, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={trainBody.rlRandomAgent}
            onChange={(e) => setTrainBody((b) => ({ ...b, rlRandomAgent: e.target.checked }))}
          />
          Random agent (smoke test)
        </label>
        <button
          type="button"
          onClick={runTrain}
          disabled={trainLoading || !sumOk}
          style={{
            padding: "12px 22px",
            borderRadius: 10,
            border: "none",
            background: trainLoading || !sumOk ? "rgba(255,255,255,0.08)" : "rgba(34,197,94,0.35)",
            color: TEXT,
            fontWeight: 800,
            fontFamily: MONO,
            fontSize: 13,
            cursor: trainLoading || !sumOk ? "not-allowed" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 10
          }}
        >
          {trainLoading && (
            <span
              style={{
                width: 14,
                height: 14,
                border: `2px solid ${BORDER_LIGHT}`,
                borderTopColor: GREEN_LIGHT,
                borderRadius: "50%",
                animation: "ma-spin 0.7s linear infinite",
                display: "inline-block"
              }}
            />
          )}
          {trainLoading ? `Training… (${trainElapsedSec}s elapsed)` : "Run training"}
        </button>
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
            <div>
              States: {trainResult.statesVisited ?? "—"} / {trainResult.convergence?.totalStates ?? TOTAL_STATES} (
              {trainResult.convergence?.coveragePercent ?? "—"}% coverage)
            </div>
            <div>Total Q-updates: {(trainResult.totalUpdates ?? 0).toLocaleString()}</div>
            <div>
              Duration:{" "}
              {trainResult.trainingDurationSec != null
                ? `${trainResult.trainingDurationSec}s`
                : trainResult.trainingDurationMs != null
                  ? `${(trainResult.trainingDurationMs / 1000).toFixed(2)}s`
                  : "—"}
            </div>
            <button
              type="button"
              className="ma-btn-ghost"
              style={{ marginTop: 12, fontFamily: MONO, fontSize: 12, color: AMBER_LIGHT }}
              onClick={scrollToCompare}
            >
              Run eval →
            </button>
          </div>
        )}
      </Card>

      {/* Live policy */}
      <Card title="LIVE POLICY" subtitle="GET /api/rl/policy">
        <button
          type="button"
          onClick={loadPolicy}
          disabled={policyLoading}
          style={{
            padding: "10px 20px",
            borderRadius: 10,
            border: `1px solid ${BORDER_LIGHT}`,
            background: policyLoading ? BG : "rgba(59,130,246,0.2)",
            color: TEXT,
            fontWeight: 700,
            fontFamily: MONO,
            fontSize: 12,
            cursor: policyLoading ? "wait" : "pointer",
            marginBottom: 16
          }}
        >
          {policyLoading ? "Loading…" : "Load policy"}
        </button>
        {policyErr && <div style={{ color: RED_LIGHT, fontFamily: MONO, fontSize: 12, marginBottom: 12 }}>{policyErr}</div>}
        {policyJson && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 12,
                marginBottom: 20
              }}
            >
              <div style={{ ...inputStyle, border: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 10, fontFamily: MONO, color: TEXT, opacity: 0.7 }}>Total states</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: MONO }}>{conv?.totalStates ?? TOTAL_STATES}</div>
                <div style={{ fontSize: 10, opacity: 0.65, marginTop: 4 }}>5 features × state space</div>
              </div>
              <div style={{ ...inputStyle, border: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 10, fontFamily: MONO, color: TEXT, opacity: 0.7 }}>Actions</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: MONO }}>{TOTAL_ACTIONS}</div>
                <div style={{ fontSize: 10, opacity: 0.65, marginTop: 4 }}>4 exposure × 4 positions × 3 sizing</div>
              </div>
              <div style={{ ...inputStyle, border: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 10, fontFamily: MONO, color: TEXT, opacity: 0.7 }}>Coverage</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: MONO }}>{coverageStr}</div>
                <div
                  style={{
                    marginTop: 8,
                    height: 6,
                    borderRadius: 3,
                    background: BORDER,
                    overflow: "hidden"
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(100, parseFloat(coverageStr) || 0)}%`,
                      background: GREEN,
                      transition: "width 0.3s ease"
                    }}
                  />
                </div>
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: MONO, fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: `1px solid ${BORDER}` }}>
                    <th style={{ padding: "8px 6px" }}>Regime</th>
                    <th style={{ padding: "8px 6px" }}>Best action</th>
                    <th style={{ padding: "8px 6px" }}>Avg Q</th>
                    <th style={{ padding: "8px 6px" }}>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {regimeRows.map((row) => (
                    <tr key={row.regime} style={{ borderBottom: `1px solid ${BORDER}` }}>
                      <td style={{ padding: "10px 6px", color: AMBER_LIGHT }}>{row.regime}</td>
                      <td style={{ padding: "10px 6px", wordBreak: "break-word" }}>{row.bestAction}</td>
                      <td style={{ padding: "10px 6px" }}>{row.avgQ != null ? row.avgQ.toFixed(2) : "—"}</td>
                      <td style={{ padding: "10px 6px", minWidth: 140 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div
                            style={{
                              flex: 1,
                              height: 8,
                              borderRadius: 4,
                              background: BORDER,
                              overflow: "hidden",
                              maxWidth: 100
                            }}
                          >
                            <div style={{ width: `${row.barPct}%`, height: "100%", background: AMBER }} />
                          </div>
                          <span style={{ whiteSpace: "nowrap", opacity: 0.85 }}>{row.confidence}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {/* Paper trade */}
      <Card title="PAPER TRADE" subtitle="Live RL decisions">
        {paperPfErr && <div style={{ color: RED_LIGHT, fontFamily: MONO, fontSize: 12, marginBottom: 12 }}>{paperPfErr}</div>}
        {paperLoading && !paperPf && <div style={{ fontFamily: MONO, fontSize: 12, opacity: 0.7 }}>Loading portfolio…</div>}
        {!paperPf && !paperLoading && !paperPfErr && (
          <div style={{ fontFamily: MONO, fontSize: 12, opacity: 0.75 }}>No paper portfolio. Initialize from Trading tab.</div>
        )}
        {paperPf && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 20,
                marginBottom: 16
              }}
            >
              <div>
                <div style={{ ...labelStyle }}>Portfolio</div>
                <div style={{ fontFamily: MONO, fontSize: 13, lineHeight: 1.8 }}>
                  <div>
                    Total value: <span style={{ color: GREEN_LIGHT }}>{fmtMoney(sum?.totalValue)}</span>
                  </div>
                  <div>
                    Total return:{" "}
                    <span style={{ color: (sum?.totalReturn ?? 0) >= 0 ? GREEN_LIGHT : RED_LIGHT }}>{fmtPct(sum?.totalReturn)}</span>
                  </div>
                  <div>Days active: {sum?.daysActive ?? "—"}</div>
                  <div>Holdings: {sum?.holdingsCount ?? paperPf.holdings?.length ?? "—"} positions</div>
                  <div>Cash: {sum?.cashPct != null ? `${sum.cashPct}%` : "—"}</div>
                </div>
              </div>
              <div>
                <div style={labelStyle}>RL status</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                  <span
                    className={`ma-pill ${sum?.rlEnabled ? "ma-pill--green" : "ma-pill--neutral"}`}
                    style={{ fontFamily: MONO, fontSize: 11 }}
                  >
                    RL {sum?.rlEnabled ? "ON" : "OFF"}
                  </span>
                  <span
                    className={`ma-pill ${sum?.rlOnlineLearning ? "ma-pill--green" : "ma-pill--neutral"}`}
                    style={{ fontFamily: MONO, fontSize: 11 }}
                  >
                    Online {sum?.rlOnlineLearning ? "ON" : "OFF"}
                  </span>
                </div>
                <div style={{ fontFamily: MONO, fontSize: 13, lineHeight: 1.8 }}>
                  <div>
                    Last action:{" "}
                    {sum?.rlLastAction
                      ? `${sum.rlLastAction.exposure} exp / ${sum.rlLastAction.positionCount} pos / ${sum.rlLastAction.sizingMethod}`
                      : "—"}
                  </div>
                  <div>Current regime: {sum?.currentRegime ?? "—"}</div>
                  <div>Weights: {weightsShort(paperPf.activeWeights || cfg?.weights)}</div>
                </div>
              </div>
            </div>

            {previewHealth && (
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: 8,
                  background: previewHealth.rlPolicyMatch === false ? "rgba(234,179,8,0.12)" : BG,
                  border: `1px solid ${previewHealth.rlPolicyMatch === false ? AMBER : BORDER}`,
                  fontFamily: MONO,
                  fontSize: 11,
                  lineHeight: 1.6,
                  marginBottom: 12
                }}
              >
                Positions locked: {previewHealth.positionsLocked} / {previewHealth.currentHoldings}
                {previewHealth.nextEligibleDate && (
                  <>
                    {" "}
                    · All eligible: {previewHealth.nextEligibleDate}
                  </>
                )}
                {previewHealth.rlWants != null && (
                  <>
                    {" "}
                    · RL wants {previewHealth.rlWants} positions (currently {previewHealth.currentHoldings})
                    {previewHealth.rlPolicyMatch === false ? " — will reshape at next rebalance" : ""}
                  </>
                )}
              </div>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, fontFamily: MONO, fontSize: 12 }}>
              <span>
                Next rebalance: {nextReb ? formatCalendarDate(nextReb) : "—"}
                {daysAway != null && typeof daysAway === "number" && (
                  <span style={{ opacity: 0.8 }}> · {daysAway} days away</span>
                )}
              </span>
              <button
                type="button"
                className="ma-btn-ghost"
                style={{ fontSize: 11, fontFamily: MONO }}
                disabled={previewLoading}
                onClick={openPreviewModal}
              >
                {previewLoading ? "Preview…" : "Preview rebalance"}
              </button>
            </div>
            {previewErr && <div style={{ color: RED_LIGHT, fontSize: 11, marginTop: 8 }}>{previewErr}</div>}
          </>
        )}
      </Card>

      {/* Compare */}
      <div ref={compareSectionRef}>
        <Card title="BACKTEST COMPARISON" subtitle="GET /api/rl/compare — Rules-based vs RL agent">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 12,
              marginBottom: 16
            }}
          >
            <div>
              <div style={labelStyle}>Universe</div>
              <input style={inputStyle} value={compareUniverse} onChange={(e) => setCompareUniverse(e.target.value)} />
            </div>
            <div>
              <div style={labelStyle}>Period</div>
              <select style={{ ...inputStyle, cursor: "pointer" }} value={comparePeriod} onChange={(e) => setComparePeriod(e.target.value)}>
                <option value="3y">3y</option>
                <option value="5y">5y</option>
              </select>
            </div>
            <div>
              <div style={labelStyle}>Top N</div>
              <input
                type="number"
                style={inputStyle}
                value={compareTopN}
                onChange={(e) => setCompareTopN(parseInt(e.target.value, 10) || 15)}
              />
            </div>
            <div>
              <div style={labelStyle}>Rebalance</div>
              <select style={{ ...inputStyle, cursor: "pointer" }} value={compareFreq} onChange={(e) => setCompareFreq(e.target.value)}>
                <option value="bimonthly">bimonthly</option>
                <option value="monthly">monthly</option>
              </select>
            </div>
          </div>
          <button
            type="button"
            onClick={runCompare}
            disabled={compareLoading}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: "none",
              background: compareLoading ? BG : "rgba(168,85,247,0.25)",
              color: TEXT,
              fontWeight: 800,
              fontFamily: MONO,
              fontSize: 12,
              cursor: compareLoading ? "wait" : "pointer"
            }}
          >
            {compareLoading ? "Running…" : "Run compare"}
          </button>
          {compareErr && <div style={{ marginTop: 12, color: RED_LIGHT, fontFamily: MONO, fontSize: 12 }}>{compareErr}</div>}
          {hasCompare && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: 16,
                marginTop: 20
              }}
            >
              {["baseline", "rlEval"].map((side) => {
                const row = side === "baseline" ? base : rl;
                const isRl = side === "rlEval";
                const tr = parseN(row.totalReturn);
                const al = parseN(row.alpha);
                const sh = parseN(row.sharpe);
                const dd = parseN(row.maxDrawdown);
                const bTr = parseN(base.totalReturn);
                const bAl = parseN(base.alpha);
                const bSh = parseN(base.sharpe);
                const bDd = parseN(base.maxDrawdown);
                const dTr = isRl && tr != null && bTr != null ? tr - bTr : null;
                const dAl = isRl && al != null && bAl != null ? al - bAl : null;
                const dSh = isRl && sh != null && bSh != null ? sh - bSh : null;
                const dDd = isRl && dd != null && bDd != null ? dd - bDd : null;
                /** For returns/alpha/sharpe/maxDD (all as numbers), higher is better (less negative DD is better). */
                const better = (delta) =>
                  delta == null || Number.isNaN(delta) ? null : delta > 0;
                return (
                  <div
                    key={side}
                    style={{
                      padding: 16,
                      borderRadius: 10,
                      border: `1px solid ${BORDER}`,
                      background: "rgba(0,0,0,0.2)",
                      fontFamily: MONO,
                      fontSize: 13
                    }}
                  >
                    <div style={{ fontWeight: 800, marginBottom: 12, color: isRl ? AMBER_LIGHT : TEXT }}>
                      {isRl ? "RL agent" : "Rules-based"}
                    </div>
                    <MetricLine label="Total return" value={tr} suffix="%" delta={dTr} isRl={isRl} better={better(dTr)} />
                    <MetricLine label="Alpha" value={al} suffix="%" delta={dAl} isRl={isRl} better={better(dAl)} />
                    <MetricLine label="Sharpe" value={sh} suffix="" delta={dSh} isRl={isRl} better={better(dSh)} />
                    <MetricLine label="Max DD" value={dd} suffix="%" delta={dDd} isRl={isRl} better={better(dDd)} />
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

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
            <div style={{ opacity: 0.85, lineHeight: 1.6 }}>
              <div>Regime: {previewModal.regime ?? "—"}</div>
              <div>Adjusted top N: {previewModal.adjustedTopN ?? "—"}</div>
              <div>Buys: {(previewModal.buys || []).length} · Sells: {(previewModal.sells || []).length}</div>
              {previewModal.health && (
                <div style={{ marginTop: 10 }}>
                  Health: locked {previewModal.health.positionsLocked}, eligible {previewModal.health.positionsEligible}
                </div>
              )}
            </div>
            <pre
              style={{
                marginTop: 12,
                fontSize: 10,
                background: "rgba(0,0,0,0.4)",
                padding: 12,
                borderRadius: 8,
                overflow: "auto",
                maxHeight: 360
              }}
            >
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

      <style>{`@keyframes ma-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function MetricLine({ label, value, suffix, delta, isRl, better }) {
  const vStr =
    value != null && !Number.isNaN(value)
      ? `${suffix === "%" && value > 0 ? "+" : ""}${value}${suffix}`
      : "—";
  const color =
    !isRl || better == null ? TEXT : better ? GREEN_LIGHT : better === false ? RED_LIGHT : TEXT;
  return (
    <div style={{ marginBottom: 10, color }}>
      <div style={{ fontSize: 10, opacity: 0.65, marginBottom: 2 }}>{label}</div>
      <div>
        <strong>{vStr}</strong>
        {isRl && delta != null && !Number.isNaN(delta) && (
          <span style={{ fontSize: 11, marginLeft: 8, opacity: 0.9 }}>
            ({delta > 0 ? "+" : ""}
            {delta.toFixed(2)}
            {suffix === "%" ? "%" : ""})
          </span>
        )}
      </div>
    </div>
  );
}
