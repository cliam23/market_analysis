import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { MONO } from "../lib/theme.js";
import { apiFetch } from "../lib/api.js";

const COLORS = {
  benchmark: "#6b7280",
  rulesOnly: "#58a6ff",
  rulesHedged: "rgba(88, 166, 255, 0.55)",
  rlEval: "#3fb950"
};

function fmtPctSigned(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const x = Number(n);
  const sign = x > 0 ? "+" : "";
  return `${sign}${x.toFixed(1)}%`;
}

function mergeEquityRows(curves) {
  const rules = curves?.rulesOnly || [];
  if (!rules.length) return [];
  const b = new Map((curves?.benchmark || []).map((p) => [p.date, p.value]));
  const h = new Map((curves?.rulesHedged || []).map((p) => [p.date, p.value]));
  const r = new Map((curves?.rlEval || []).map((p) => [p.date, p.value]));
  return rules.map((row) => ({
    date: row.date,
    benchmark: b.get(row.date) ?? null,
    rulesOnly: row.value,
    rulesHedged: h.get(row.date) ?? null,
    rlEval: r.get(row.date) ?? null
  }));
}

function EquityTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value != null && Number.isFinite(Number(p.value)));
  if (!rows.length) return null;
  return (
    <div
      style={{
        background: "var(--color-tooltip-bg)",
        border: "1px solid var(--color-tooltip-border)",
        borderRadius: 8,
        padding: "10px 12px",
        fontFamily: MONO,
        fontSize: 11,
        color: "var(--color-text-primary)"
      }}
    >
      <div style={{ marginBottom: 8, opacity: 0.85 }}>{label}</div>
      {rows.map((p) => (
        <div key={String(p.dataKey)} style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 4 }}>
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="ma-num">{Number(p.value).toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

function colorVsBench(val, bench) {
  const v = Number(val);
  const b = Number(bench);
  if (!Number.isFinite(v) || !Number.isFinite(b)) return "var(--color-text-dim)";
  if (v >= b) return "var(--green)";
  return "var(--red)";
}

export default function AlphaLabEquityCurves({ visible, universeId, period }) {
  const [raw, setRaw] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [off, setOff] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const q = new URLSearchParams({ period });
      const res = await apiFetch(`/api/diagnostics/equity-curves/${encodeURIComponent(universeId)}?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setRaw(data);
    } catch (e) {
      setErr(e.message);
      setRaw(null);
    } finally {
      setLoading(false);
    }
  }, [universeId, period]);

  useEffect(() => {
    if (!visible) return;
    load();
  }, [visible, load]);

  const chartData = useMemo(() => mergeEquityRows(raw?.curves), [raw]);
  const hasRl = (raw?.curves?.rlEval?.length ?? 0) > 0;
  const rlLabel = raw?.rlAgentKind === "dqn" ? "DQN (eval)" : "Q-learning (eval)";

  const benchRet = raw?.summary?.benchmark?.totalReturn;
  const rulesRet = raw?.summary?.rulesOnly?.totalReturn;
  const rlRet = raw?.summary?.rlEval?.totalReturn;

  const toggle = (key) => {
    setOff((o) => ({ ...o, [key]: !o[key] }));
  };

  const legendContent = (props) => {
    const payload = props.payload;
    if (!payload?.length) return null;
    return (
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "12px 20px",
          justifyContent: "center",
          paddingTop: 10,
          fontFamily: MONO,
          fontSize: 11
        }}
      >
        {payload.map((e) => (
          <button
            key={String(e.dataKey)}
            type="button"
            onClick={() => toggle(e.dataKey)}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              padding: 0,
              opacity: off[e.dataKey] ? 0.35 : 1,
              color: "var(--color-text-primary)"
            }}
          >
            <span style={{ color: e.color }}>● </span>
            {e.value}
          </button>
        ))}
      </div>
    );
  };

  return (
    <section className="ma-alphalab-card ma-alphalab-fadein" style={{ marginBottom: 20 }}>
      <div className="ma-alphalab-card__head" style={{ marginBottom: 12 }}>
        <div>
          <div className="ma-alphalab-card__title">Cumulative equity</div>
          <div className="ma-alphalab-card__sub">
            {universeId} · {period} · click legend to toggle series
          </div>
        </div>
      </div>
      <div className="ma-alphalab-card__body">
        {!visible ? null : loading ? (
          <div className="ma-alphalab-equity-inner">
            <div className="ma-alphalab-skel" style={{ height: 400, width: "100%", borderRadius: 8 }} />
          </div>
        ) : err ? (
          <div className="ma-mono" style={{ color: "var(--color-negative)", fontSize: 12 }}>
            {err}
          </div>
        ) : chartData.length === 0 ? (
          <div className="ma-mono" style={{ fontSize: 12, opacity: 0.7 }}>
            No curve data
          </div>
        ) : (
          <div className="ma-alphalab-fadein ma-alphalab-equity-inner">
            <div style={{ width: "100%", height: 400 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke="var(--color-chart-grid)" strokeDasharray="4 4" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "var(--color-text-muted)" }}
                    tickLine={false}
                    axisLine={{ stroke: "var(--color-border)" }}
                    minTickGap={48}
                    tickFormatter={(v) => {
                      const d = new Date(`${String(v).slice(0, 10)}T12:00:00`);
                      return Number.isNaN(d.getTime()) ? v : `${d.toLocaleString("en-US", { month: "short" })} ${d.getFullYear()}`;
                    }}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--color-text-muted)" }}
                    tickLine={false}
                    axisLine={false}
                    domain={["auto", "auto"]}
                    tickFormatter={(v) => v.toFixed(0)}
                  />
                  <Tooltip content={<EquityTooltip />} />
                  <Legend content={legendContent} />
                  <Line
                    type="monotone"
                    dataKey="benchmark"
                    name="Benchmark (EW)"
                    stroke={COLORS.benchmark}
                    strokeWidth={off.benchmark ? 0 : 1}
                    strokeOpacity={off.benchmark ? 0 : 1}
                    strokeDasharray="6 4"
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="rulesOnly"
                    name="Rules only"
                    stroke={COLORS.rulesOnly}
                    strokeWidth={off.rulesOnly ? 0 : 2}
                    strokeOpacity={off.rulesOnly ? 0 : 1}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                  {hasRl ? (
                    <Line
                      type="monotone"
                      dataKey="rlEval"
                      name={rlLabel}
                      stroke={COLORS.rlEval}
                      strokeWidth={off.rlEval ? 0 : 3}
                      strokeOpacity={off.rlEval ? 0 : 1}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ) : null}
                  <Line
                    type="monotone"
                    dataKey="rulesHedged"
                    name="Rules + hedge"
                    stroke={COLORS.rulesHedged}
                    strokeWidth={off.rulesHedged ? 0 : 1.5}
                    strokeOpacity={off.rulesHedged ? 0 : 0.9}
                    strokeDasharray="4 3"
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {raw?.summary ? (
              <div
                className="ma-mono ma-num"
                style={{
                  marginTop: 14,
                  fontSize: 11,
                  lineHeight: 1.8,
                  textAlign: "center",
                  flexWrap: "wrap"
                }}
              >
                {hasRl ? (
                  <>
                    <span style={{ color: colorVsBench(rlRet, benchRet) }}>
                      {rlLabel.replace(" (eval)", "")}: {fmtPctSigned(rlRet)}
                    </span>
                    <span style={{ color: "var(--color-text-dim)" }}> · </span>
                  </>
                ) : null}
                <span style={{ color: colorVsBench(rulesRet, benchRet) }}>Rules: {fmtPctSigned(rulesRet)}</span>
                <span style={{ color: "var(--color-text-dim)" }}> · </span>
                <span style={{ color: "var(--color-text-muted)" }}>Benchmark: {fmtPctSigned(benchRet)}</span>
                <span style={{ color: "var(--color-text-dim)" }}> · </span>
                <span style={{ color: colorVsBench(raw.summary?.rulesHedged?.totalReturn, benchRet) }}>
                  Rules+Hedge: {fmtPctSigned(raw.summary?.rulesHedged?.totalReturn)}
                </span>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
