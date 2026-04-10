import { useState, useCallback } from "react";

import { MONO, SANS } from "../lib/theme.js";

function Box({ children, style: sx = {} }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 10,
        padding: 16,
        marginBottom: 12,
        ...sx
      }}
    >
      {children}
    </div>
  );
}

export default function RLTab() {
  const [policyJson, setPolicyJson] = useState(null);
  const [policyErr, setPolicyErr] = useState(null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [verbosePolicy, setVerbosePolicy] = useState(false);

  const [trainBody, setTrainBody] = useState({
    universeId: "sp500_top50",
    period: "3y",
    episodes: 500,
    topN: 15,
    strategy: "full_composite",
    rlRandomAgent: false
  });
  const [trainResult, setTrainResult] = useState(null);
  const [trainErr, setTrainErr] = useState(null);
  const [trainLoading, setTrainLoading] = useState(false);

  const [compareUniverse, setCompareUniverse] = useState("sp500_top50");
  const [compareResult, setCompareResult] = useState(null);
  const [compareErr, setCompareErr] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);

  const loadPolicy = useCallback(async () => {
    setPolicyLoading(true);
    setPolicyErr(null);
    try {
      const q = verbosePolicy ? "?verbose=1" : "";
      const res = await fetch(`/api/rl/policy${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setPolicyJson(data);
    } catch (e) {
      setPolicyJson(null);
      setPolicyErr(e.message);
    } finally {
      setPolicyLoading(false);
    }
  }, [verbosePolicy]);

  const runTrain = useCallback(async () => {
    setTrainLoading(true);
    setTrainErr(null);
    setTrainResult(null);
    try {
      const res = await fetch("/api/rl/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          universeId: trainBody.universeId,
          period: trainBody.period,
          episodes: Number(trainBody.episodes),
          topN: Number(trainBody.topN),
          strategy: trainBody.strategy,
          rlRandomAgent: trainBody.rlRandomAgent
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setTrainResult(data);
    } catch (e) {
      setTrainErr(e.message);
    } finally {
      setTrainLoading(false);
    }
  }, [trainBody]);

  const runCompare = useCallback(async () => {
    setCompareLoading(true);
    setCompareErr(null);
    setCompareResult(null);
    try {
      const params = new URLSearchParams({
        universeId: compareUniverse,
        period: "3y",
        topN: "15",
        strategy: "full_composite"
      });
      const res = await fetch(`/api/rl/compare?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setCompareResult(data);
    } catch (e) {
      setCompareErr(e.message);
    } finally {
      setCompareLoading(false);
    }
  }, [compareUniverse]);

  const inputStyle = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 6,
    padding: "8px 10px",
    color: "#f0f0f0",
    fontSize: 12,
    fontFamily: MONO,
    width: "100%",
    boxSizing: "border-box"
  };

  const labelStyle = {
    fontSize: 10,
    color: "#f0f0f0",
    fontWeight: 700,
    letterSpacing: 1,
    marginBottom: 4,
    fontFamily: MONO
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", fontFamily: SANS, color: "#f0f0f0" }}>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 4, marginBottom: 6, fontFamily: MONO }}>
          RL AGENT
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>Q-learning portfolio policy</h2>
        <p style={{ fontSize: 12, color: "#f0f0f0", marginTop: 8, fontFamily: MONO, lineHeight: 1.6 }}>
          Trains on random rebalance windows, persists <code style={{ color: "#a7f3d0" }}>rl-agent.json</code>.
          Backtest: RL is on by default when the file exists; use <code style={{ color: "#a7f3d0" }}>rlAgent=false</code> for rules only (optional{" "}
          <code style={{ color: "#a7f3d0" }}>rlRandomAgent=true</code> for uniform random smoke).
          Paper: <code style={{ color: "#a7f3d0" }}>config.rlAgent</code> defaults true on init when an agent is loaded; set{" "}
          <code style={{ color: "#a7f3d0" }}>false</code> to disable. Online Q-updates:{" "}
          <code style={{ color: "#a7f3d0" }}>RL_ONLINE_LEARNING=1</code> or <code style={{ color: "#a7f3d0" }}>rlOnlineLearning: true</code>.
        </p>
      </div>

      <Box>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12, fontFamily: MONO }}>Train (POST /api/rl/train)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div>
            <div style={labelStyle}>universeId</div>
            <input
              style={inputStyle}
              value={trainBody.universeId}
              onChange={(e) => setTrainBody((b) => ({ ...b, universeId: e.target.value }))}
            />
          </div>
          <div>
            <div style={labelStyle}>period</div>
            <select
              style={{ ...inputStyle, cursor: "pointer" }}
              value={trainBody.period}
              onChange={(e) => setTrainBody((b) => ({ ...b, period: e.target.value }))}
            >
              {["1y", "2y", "3y", "5y"].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div style={labelStyle}>episodes</div>
            <input
              type="number"
              min={1}
              max={2000}
              style={inputStyle}
              value={trainBody.episodes}
              onChange={(e) => setTrainBody((b) => ({ ...b, episodes: e.target.value }))}
            />
          </div>
          <div>
            <div style={labelStyle}>topN</div>
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
            <div style={labelStyle}>strategy</div>
            <select
              style={{ ...inputStyle, cursor: "pointer" }}
              value={trainBody.strategy}
              onChange={(e) => setTrainBody((b) => ({ ...b, strategy: e.target.value }))}
            >
              <option value="full_composite">full_composite</option>
              <option value="full_composite_aggressive">full_composite_aggressive</option>
              <option value="full_composite_turbo">full_composite_turbo</option>
            </select>
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontFamily: MONO, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={trainBody.rlRandomAgent}
            onChange={(e) => setTrainBody((b) => ({ ...b, rlRandomAgent: e.target.checked }))}
          />
          rlRandomAgent (random actions while training)
        </label>
        <button
          type="button"
          onClick={runTrain}
          disabled={trainLoading}
          style={{
            padding: "10px 18px",
            borderRadius: 8,
            border: "none",
            background: trainLoading ? "rgba(255,255,255,0.1)" : "rgba(34,197,94,0.25)",
            color: "#f0f0f0",
            fontWeight: 800,
            fontFamily: MONO,
            fontSize: 12,
            cursor: trainLoading ? "wait" : "pointer"
          }}
        >
          {trainLoading ? "Training…" : "Run training"}
        </button>
        {trainErr && (
          <div style={{ marginTop: 12, color: "#f87171", fontSize: 12, fontFamily: MONO }}>{trainErr}</div>
        )}
        {trainResult && (
          <pre
            style={{
              marginTop: 12,
              fontSize: 11,
              fontFamily: MONO,
              background: "rgba(0,0,0,0.35)",
              padding: 12,
              borderRadius: 8,
              overflow: "auto",
              maxHeight: 220
            }}
          >
            {JSON.stringify(trainResult, null, 2)}
          </pre>
        )}
      </Box>

      <Box>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12, fontFamily: MONO }}>Policy preview (GET /api/rl/policy)</div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontFamily: MONO, marginBottom: 12 }}>
          <input type="checkbox" checked={verbosePolicy} onChange={(e) => setVerbosePolicy(e.target.checked)} />
          verbose (include unvisited states — large JSON)
        </label>
        <button
          type="button"
          onClick={loadPolicy}
          disabled={policyLoading}
          style={{
            padding: "10px 18px",
            borderRadius: 8,
            border: "none",
            background: policyLoading ? "rgba(255,255,255,0.1)" : "rgba(59,130,246,0.25)",
            color: "#f0f0f0",
            fontWeight: 800,
            fontFamily: MONO,
            fontSize: 12,
            cursor: policyLoading ? "wait" : "pointer"
          }}
        >
          {policyLoading ? "Loading…" : "Load policy"}
        </button>
        {policyErr && (
          <div style={{ marginTop: 12, color: "#f87171", fontSize: 12, fontFamily: MONO }}>{policyErr}</div>
        )}
        {policyJson && (
          <pre
            style={{
              marginTop: 12,
              fontSize: 11,
              fontFamily: MONO,
              background: "rgba(0,0,0,0.35)",
              padding: 12,
              borderRadius: 8,
              overflow: "auto",
              maxHeight: 320
            }}
          >
            {JSON.stringify(
              {
                success: policyJson.success,
                convergence: policyJson.convergence,
                overPruning: policyJson.overPruning,
                policySize: policyJson.policySize,
                totalUpdates: policyJson.totalUpdates,
                policySample: (policyJson.policy || []).slice(0, 40)
              },
              null,
              2
            )}
          </pre>
        )}
      </Box>

      <Box>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12, fontFamily: MONO }}>Compare baseline vs RL eval (GET /api/rl/compare)</div>
        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>universeId</div>
          <input
            style={inputStyle}
            value={compareUniverse}
            onChange={(e) => setCompareUniverse(e.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={runCompare}
          disabled={compareLoading}
          style={{
            padding: "10px 18px",
            borderRadius: 8,
            border: "none",
            background: compareLoading ? "rgba(255,255,255,0.1)" : "rgba(168,85,247,0.25)",
            color: "#f0f0f0",
            fontWeight: 800,
            fontFamily: MONO,
            fontSize: 12,
            cursor: compareLoading ? "wait" : "pointer"
          }}
        >
          {compareLoading ? "Running backtests…" : "Run compare"}
        </button>
        {compareErr && (
          <div style={{ marginTop: 12, color: "#f87171", fontSize: 12, fontFamily: MONO }}>{compareErr}</div>
        )}
        {compareResult && (
          <pre
            style={{
              marginTop: 12,
              fontSize: 11,
              fontFamily: MONO,
              background: "rgba(0,0,0,0.35)",
              padding: 12,
              borderRadius: 8,
              overflow: "auto",
              maxHeight: 360
            }}
          >
            {JSON.stringify(compareResult, null, 2)}
          </pre>
        )}
      </Box>
    </div>
  );
}
