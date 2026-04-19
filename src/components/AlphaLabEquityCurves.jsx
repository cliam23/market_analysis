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
  rulesOnly: "#6366f1",
  rulesHedged: "#818cf8",
  dqnHedged: "#22c55e"
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
  const d = new Map((curves?.dqnHedged || []).map((p) => [p.date, p.value]));
  return rules.map((row) => ({
    date: row.date,
    benchmark: b.get(row.date) ?? null,
    rulesOnly: row.value,
    rulesHedged: h.get(row.date) ?? null,
    dqnHedged: d.get(row.date) ?? null
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
  const hasDqn = (raw?.curves?.dqnHedged?.length ?? 0) > 0;

  const summaryText = useMemo(() => {
    const s = raw?.summary;
    if (!s) return "";
    const parts = [
      `Rules: ${fmtPctSigned(s.rulesOnly?.totalReturn)}`,
      `Rules+Hedge: ${fmtPctSigned(s.rulesHedged?.totalReturn)}${
        s.rulesHedged?.maxDrawdown != null ? ` (DD: ${fmtPctSigned(s.rulesHedged.maxDrawdown)})` : ""
      }`,
      `Benchmark: ${fmtPctSigned(s.benchmark?.totalReturn)}`
    ];
    if (hasDqn) {
      parts.push(`DQN+Hedge: ${fmtPctSigned(s.dqnHedged?.totalReturn)}`);
    }
    return parts.join(" | ");
  }, [raw, hasDqn]);

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
    <section className="ma-alphalab-card ma-alphalab-equity" style={{ width: "100%", maxWidth: "100%", marginBottom: 20 }}>
      <div className="ma-alphalab-card__head">
        <div>
          <div className="ma-alphalab-card__title">Cumulative equity (indexed to 100)</div>
          <div className="ma-alphalab-card__sub">
            GET /api/diagnostics/equity-curves/{universeId} · {period} · click legend to toggle
          </div>
        </div>
      </div>
      <div className="ma-alphalab-card__body" style={{ paddingTop: 0 }}>
        {loading ? (
          <div className="ma-alphalab-skel" style={{ height: 320, width: "100%", borderRadius: 8 }} />
        ) : err ? (
          <div className="ma-mono" style={{ color: "var(--color-negative)", fontSize: 12 }}>
            {err}
          </div>
        ) : chartData.length === 0 ? (
          <div className="ma-mono" style={{ fontSize: 12, opacity: 0.7 }}>
            No curve data
          </div>
        ) : (
          <>
            <div style={{ width: "100%", height: 340 }}>
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
                  <Line
                    type="monotone"
                    dataKey="rulesHedged"
                    name="Rules + hedge"
                    stroke={COLORS.rulesHedged}
                    strokeWidth={off.rulesHedged ? 0 : 3}
                    strokeOpacity={off.rulesHedged ? 0 : 1}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                  {hasDqn ? (
                    <Line
                      type="monotone"
                      dataKey="dqnHedged"
                      name="DQN + hedge"
                      stroke={COLORS.dqnHedged}
                      strokeWidth={off.dqnHedged ? 0 : 3}
                      strokeOpacity={off.dqnHedged ? 0 : 1}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ) : null}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {summaryText ? (
              <div
                className="ma-mono ma-num"
                style={{
                  marginTop: 14,
                  fontSize: 11,
                  lineHeight: 1.6,
                  color: "var(--color-text-dim)",
                  textAlign: "center",
                  flexWrap: "wrap"
                }}
              >
                {summaryText}
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
