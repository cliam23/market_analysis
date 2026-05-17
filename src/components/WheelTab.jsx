import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch, safeJson } from "../lib/api.js";
import { fmtMoney as _fmtMoney } from "../lib/formatters.js";
import { SANS, TEXT, GREEN, RED, AMBER } from "../lib/theme.js";

const fmtMoney = (n) => _fmtMoney(n, 2);

/** Matches server paper JSON files per `universeId` on GET /api/wheel/status */
export const WHEEL_EQUITY_BOOK = {
  sp500_top50: { label: "S&P 500 Top 50", file: "paper-portfolio-top50.json" },
  sp500_top150: { label: "S&P 500 Top 150", file: "paper-portfolio-top150.json" }
};

function equityBookMeta(universeId) {
  const id = String(universeId || "sp500_top50");
  return WHEEL_EQUITY_BOOK[id] || WHEEL_EQUITY_BOOK.sp500_top50;
}

/** Placeholder grid while first `/api/wheel/status` fetch is in flight */
function WheelStatsSkeleton() {
  return (
    <div className="ma-opt-stats-grid" style={{ marginTop: 0 }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="ma-bt-stat" style={{ "--bt-accent": "#334155" }}>
          <div className="ma-bt-stat__label ma-skeleton" style={{ width: "58%", height: 10, borderRadius: 4, marginBottom: 10 }} />
          <div className="ma-bt-stat__val ma-skeleton" style={{ width: "72%", height: 24, borderRadius: 6 }} />
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, tone }) {
  const color = tone === "good" ? GREEN : tone === "bad" ? RED : TEXT;
  return (
    <div className="ma-bt-stat" style={{ "--bt-accent": color }}>
      <div className="ma-bt-stat__label">{label}</div>
      <div className="ma-bt-stat__val" style={{ fontSize: 20, color, fontFamily: "monospace" }}>
        {value}
      </div>
    </div>
  );
}

/** Second grid slot: equity book (e.g. S&P 500 Top 50) + paper portfolio return */
function EquityBookReturnStatCard({ book, returnPct }) {
  const pct = Number(returnPct) || 0;
  return (
    <div className="ma-bt-stat" style={{ "--bt-accent": "#0EA5E9" }}>
      <div
        className="ma-bt-stat__label"
        style={{ textTransform: "none", letterSpacing: "0.02em", lineHeight: 1.35 }}
      >
        <span style={{ display: "block", color: "#0EA5E9", fontWeight: 800, fontSize: 11, textTransform: "none" }}>
          {book.label}
        </span>
        <span style={{ display: "block", marginTop: 5, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-secondary)" }}>
          Paper portfolio return
        </span>
      </div>
      <div className="ma-bt-stat__val" style={{ fontSize: 20, color: TEXT, fontFamily: "monospace" }}>
        {pct.toFixed(2)}%
      </div>
    </div>
  );
}

// ── Academic signal helpers ───────────────────────────────────────────────

function sellScoreColor(s) {
  if (s == null) return "#64748B";
  if (s >= 0.65) return "#22C55E";
  if (s >= 0.45) return "#0EA5E9";
  if (s >= 0.30) return "#F59E0B";
  return "#EF4444";
}

function gsSignalColor(g) {
  if (g == null) return "#64748B";
  if (g < -0.5) return "#22C55E";
  if (g < -0.2) return "#0EA5E9";
  if (g < 0.1)  return "#F59E0B";
  return "#EF4444";
}

function vrpColor(v) {
  if (v == null) return "#64748B";
  if (v > 0.3)  return "#22C55E";
  if (v > 0.1)  return "#F59E0B";
  if (v > 0)    return "#94A3B8";
  return "#EF4444";
}

/** Signal dot strip: 3 coloured dots = 3 papers */
function SignalDots({ signalCount }) {
  const n = Number(signalCount) || 0;
  const colors = ["#22C55E", "#0EA5E9", "#F59E0B"];
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 7, height: 7, borderRadius: "50%",
            background: i < n ? colors[i] : "#334155",
            display: "inline-block"
          }}
        />
      ))}
    </span>
  );
}

/** Compact signal row for a single leg */
function LegSignalRow({ leg }) {
  const s = leg.sellScore;
  const g = leg.gsSignal;
  const v = leg.vrpIntensity;
  const ivolPct = leg.ivolPct;
  const n = leg.signalCount;

  if (s == null && g == null && v == null) return null;

  return (
    <div
      style={{
        marginTop: 8,
        padding: "8px 10px",
        borderRadius: 6,
        background: "rgba(15,23,42,0.6)",
        border: "1px solid #1E293B",
        display: "flex",
        flexWrap: "wrap",
        gap: "10px 20px",
        alignItems: "center"
      }}
    >
      {/* Composite */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <SignalDots signalCount={n} />
        <span style={{ color: "#64748B", fontSize: 10 }}>Score</span>
        <span
          style={{
            fontFamily: "monospace",
            fontSize: 12,
            fontWeight: 800,
            color: sellScoreColor(s)
          }}
        >
          {s != null ? `${(s * 100).toFixed(0)}/100` : "—"}
        </span>
        {n != null && (
          <span style={{ fontSize: 10, color: "#64748B" }}>{n}/3 papers</span>
        )}
      </div>

      {/* G&S */}
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 10, color: "#64748B" }}>G&S</span>
        <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: gsSignalColor(g) }}>
          {g != null ? g.toFixed(3) : "—"}
        </span>
      </div>

      {/* B&K VRP */}
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 10, color: "#64748B" }}>VRP</span>
        <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: vrpColor(v) }}>
          {v != null ? `${(v * 100).toFixed(0)}%` : "—"}
        </span>
        {leg.regimeBoost != null && (
          <span style={{ fontSize: 10, color: "#64748B" }}>{leg.regimeBoost}×</span>
        )}
      </div>

      {/* C&H IVOL rank */}
      {ivolPct != null && (
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 10, color: "#64748B" }}>IVOL</span>
          <span
            style={{
              fontFamily: "monospace", fontSize: 11, fontWeight: 700,
              color: Number(ivolPct) >= 70 ? "#22C55E" : Number(ivolPct) >= 40 ? "#F59E0B" : "#94A3B8"
            }}
          >
            {Number(ivolPct).toFixed(0)}th pct
          </span>
        </div>
      )}

      {/* Edge badge */}
      {leg.academicSellEdge != null && (
        <span
          style={{
            padding: "2px 7px",
            borderRadius: 10,
            fontSize: 10,
            fontWeight: 700,
            background: leg.academicSellEdge ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.12)",
            color: leg.academicSellEdge ? "#22C55E" : "#EF4444",
            border: `1px solid ${leg.academicSellEdge ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`
          }}
        >
          {leg.academicSellEdge ? "Academic edge" : "Weak signal"}
        </span>
      )}

      {leg.gsInterpretation && (
        <div style={{ width: "100%", fontSize: 10, color: "#475569", marginTop: 2, lineHeight: 1.4 }}>
          {leg.gsInterpretation}
        </div>
      )}
    </div>
  );
}

/** Letter grade + /100 from composite sell score (0–1) */
function academicGrade(score01) {
  if (score01 == null || Number.isNaN(score01)) return null;
  const x = score01 * 100;
  if (x >= 88) return { letter: "A+", label: "Excellent", color: "#22C55E" };
  if (x >= 80) return { letter: "A", label: "Strong", color: "#22C55E" };
  if (x >= 72) return { letter: "B+", label: "Good", color: "#4ADE80" };
  if (x >= 64) return { letter: "B", label: "Solid", color: "#0EA5E9" };
  if (x >= 55) return { letter: "C+", label: "Fair", color: "#F59E0B" };
  if (x >= 45) return { letter: "C", label: "Weak", color: "#FB923C" };
  if (x >= 35) return { letter: "D", label: "Poor", color: "#F97316" };
  return { letter: "F", label: "Avoid", color: "#EF4444" };
}

/** Academic grader sidebar — letter grade from average sellScore */
function AcademicGraderSidebar({ avgSellScore01, scoredCount, totalLegs }) {
  const hasGrade = scoredCount > 0 && avgSellScore01 != null;
  const g = hasGrade ? academicGrade(avgSellScore01) : null;
  const scoreNum = hasGrade ? Math.round(avgSellScore01 * 100) : null;

  return (
    <div
      style={{
        flex: "0 0 140px",
        minWidth: 130,
        padding: "16px 14px",
        borderRadius: 12,
        border: "1px solid #1E3A5F",
        background: "linear-gradient(165deg, #0C1829 0%, #0F172A 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 3
      }}
    >
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", color: "#475569", textTransform: "uppercase", marginBottom: 4 }}>
        Portfolio grade
      </div>
      {g ? (
        <>
          <div style={{ fontSize: 52, fontWeight: 900, lineHeight: 1, color: g.color, letterSpacing: "-0.02em" }}>
            {g.letter}
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 800, color: "#E2E8F0", marginTop: 2 }}>
            {scoreNum}<span style={{ fontSize: 13, color: "#64748B" }}>/100</span>
          </div>
          <div style={{ fontSize: 11, color: g.color, fontWeight: 700, marginTop: 2 }}>{g.label}</div>
        </>
      ) : (
        <div style={{ fontSize: 36, fontWeight: 800, color: "#2d3748", lineHeight: 1.2 }}>—</div>
      )}
      <div style={{ fontSize: 9, color: "#475569", lineHeight: 1.4, marginTop: 6, maxWidth: 120 }}>
        {scoredCount > 0
          ? `${scoredCount} leg${scoredCount === 1 ? "" : "s"} averaged`
          : totalLegs > 0
            ? "Re-open after Optimize for scores"
            : "Run Wheel to open legs"}
      </div>
    </div>
  );
}

/** Portfolio-level academic signal health panel */
function SignalHealthPanel({ legs, bkRegimeBoost, empty }) {
  const scoredLegs = legs.filter((l) => l.sellScore != null);
  const avgScore = scoredLegs.length > 0
    ? scoredLegs.reduce((s, l) => s + l.sellScore, 0) / scoredLegs.length
    : null;
  const strongEdge = scoredLegs.filter((l) => l.academicSellEdge).length;
  const avgSignals = scoredLegs.length > 0
    ? scoredLegs.reduce((s, l) => s + (l.signalCount ?? 0), 0) / scoredLegs.length
    : null;
  const gsLegs = legs.filter((l) => l.gsSignal != null && Number.isFinite(Number(l.gsSignal)));
  const avgGs = gsLegs.length > 0 ? gsLegs.reduce((s, l) => s + Number(l.gsSignal), 0) / gsLegs.length : null;
  const ivolLegs = legs.filter((l) => l.ivolPct != null && Number.isFinite(Number(l.ivolPct)));
  const avgIvolPct = ivolLegs.length > 0 ? ivolLegs.reduce((s, l) => s + Number(l.ivolPct), 0) / ivolLegs.length : null;
  const vrpLegs = legs.filter((l) => l.vrpIntensity != null && Number.isFinite(Number(l.vrpIntensity)));
  const avgVrp = vrpLegs.length > 0 ? vrpLegs.reduce((s, l) => s + Number(l.vrpIntensity), 0) / vrpLegs.length : null;

  const boostColor = bkRegimeBoost == null ? "#64748B"
    : bkRegimeBoost >= 1.5 ? "#22C55E"
    : bkRegimeBoost >= 1.2 ? "#38bdf8"
    : bkRegimeBoost <= 0.7 ? "#94A3B8"
    : "#64748B";
  const boostLabel = bkRegimeBoost == null ? null
    : bkRegimeBoost >= 1.5 ? "High-vol — sell edge 3× stronger"
    : bkRegimeBoost >= 1.2 ? "Elevated vol — sell edge enhanced"
    : bkRegimeBoost <= 0.7 ? "Low-vol — edge reduced"
    : "Normal vol (B&K baseline)";

  return (
    <div className="ma-academic-panel">
      <div className="ma-academic-panel__head">
        <div>
          <div className="ma-academic-panel__title">Academic Signal Health</div>
          {boostLabel && (
            <div style={{ fontSize: 11, color: boostColor, marginTop: 4, fontFamily: "var(--font-mono)" }}>
              {boostLabel}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
          {bkRegimeBoost != null && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "#475569", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>B&amp;K Boost</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 800, color: boostColor }}>{bkRegimeBoost}×</div>
            </div>
          )}
          {avgScore != null && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "#475569", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>Avg Score</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 800, color: sellScoreColor(avgScore) }}>{(avgScore * 100).toFixed(0)}/100</div>
            </div>
          )}
          {avgSignals != null && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "#475569", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>Papers Aligned</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 800, color: avgSignals >= 2 ? "#22C55E" : avgSignals >= 1 ? "#F59E0B" : "#EF4444" }}>{avgSignals.toFixed(1)}/3</div>
            </div>
          )}
          {scoredLegs.length > 0 && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "#475569", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>Edge Legs</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 800, color: strongEdge === scoredLegs.length ? "#22C55E" : "#F59E0B" }}>{strongEdge}/{scoredLegs.length}</div>
            </div>
          )}
        </div>
      </div>

      {empty && (
        <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 8, background: "rgba(14,165,233,0.06)", border: "1px solid rgba(14,165,233,0.25)", fontSize: 12, lineHeight: 1.6, color: "#94A3B8" }}>
          <strong style={{ color: "#E2E8F0" }}>Signals appear after legs open.</strong>{" "}
          Each new leg stores G&amp;S mispricing, C&amp;H IVOL rank, and B&amp;K VRP intensity at entry.
          Open the <strong style={{ color: "#E2E8F0" }}>Options</strong> tab → scanner for full opportunity cards.
        </div>
      )}

      <div style={{ fontSize: 10, color: "#475569", marginBottom: 12, lineHeight: 1.55 }}>
        Entry-snapshot averages across open legs.{" "}
        <span style={{ color: "#64748B" }}>Negative G&amp;S → IV rich vs realized · High IVOL rank → dealer premium (C&amp;H) · High VRP → premium over HV30 (B&amp;K).</span>
      </div>

      <div className="ma-academic-panel__body">
        <div className="ma-academic-paper-card">
          <div className="ma-academic-paper-card__cite">G&amp;S (2007)</div>
          <div className="ma-academic-paper-card__name">Mispricing</div>
          <div className="ma-academic-paper-card__value" style={{ color: gsSignalColor(avgGs) }}>
            {avgGs != null ? avgGs.toFixed(3) : "—"}
          </div>
          <div className="ma-academic-paper-card__sub">avg log(RV)−log(IV)</div>
        </div>
        <div className="ma-academic-paper-card">
          <div className="ma-academic-paper-card__cite">C&amp;H (2013)</div>
          <div className="ma-academic-paper-card__name">IVOL Rank</div>
          <div className="ma-academic-paper-card__value" style={{ color: avgIvolPct == null ? "#64748B" : Number(avgIvolPct) >= 70 ? "#22C55E" : Number(avgIvolPct) >= 40 ? "#F59E0B" : "#94A3B8" }}>
            {avgIvolPct != null ? `${Number(avgIvolPct).toFixed(0)}th` : "—"}
          </div>
          <div className="ma-academic-paper-card__sub">avg universe percentile</div>
        </div>
        <div className="ma-academic-paper-card">
          <div className="ma-academic-paper-card__cite">B&amp;K (2003)</div>
          <div className="ma-academic-paper-card__name">VRP Intensity</div>
          <div className="ma-academic-paper-card__value" style={{ color: vrpColor(avgVrp) }}>
            {avgVrp != null ? `${(avgVrp * 100).toFixed(0)}%` : "—"}
          </div>
          <div className="ma-academic-paper-card__sub">avg IV premium × regime</div>
        </div>
        <AcademicGraderSidebar avgSellScore01={avgScore} scoredCount={scoredLegs.length} totalLegs={legs.length} />
      </div>
    </div>
  );
}

/** Redesigned leg card */
function WheelLegCard({ leg }) {
  const pnl = Number(leg.currentPnL) || 0;
  const pnlPct = Number(leg.currentPnLPct) || 0;
  const isCSP = leg.strategy === "CASH_SECURED_PUT";
  const stripColor = isCSP ? "#8B5CF6" : "#0EA5E9";
  const dte = leg.currentDTE ?? leg.dte;
  const dteLow = dte != null && dte <= 21;

  return (
    <div className="ma-wheel-leg">
      <div className="ma-wheel-leg__strip" style={{ background: stripColor }} />
      <div className="ma-wheel-leg__header">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="ma-wheel-leg__ticker">{leg.ticker}</span>
          <span className={`ma-wheel-leg__badge ${isCSP ? "ma-wheel-leg__badge--csp" : "ma-wheel-leg__badge--cc"}`}>
            {isCSP ? "Cash-Secured Put" : "Covered Call"}
          </span>
          {leg.sellScore != null && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, color: sellScoreColor(leg.sellScore), padding: "3px 9px", borderRadius: 6, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
              {(leg.sellScore * 100).toFixed(0)}/100
            </span>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="ma-wheel-leg__pnl" style={{ color: pnl >= 0 ? "#4ade80" : "#f87171" }}>
            {pnl >= 0 ? "+" : ""}{fmtMoney(pnl)}
          </div>
          {pnlPct !== 0 && (
            <div className="ma-wheel-leg__pnl-pct" style={{ color: pnl >= 0 ? "#4ade80" : "#f87171" }}>
              {pnlPct >= 0 ? "+" : ""}{(pnlPct * 100).toFixed(1)}%
            </div>
          )}
        </div>
      </div>
      <div className="ma-wheel-leg__body">
        <div className="ma-wheel-leg__data-grid">
          {[
            { label: "Strike", value: fmtMoney(leg.strike) },
            { label: "Credit", value: fmtMoney(leg.entryCredit) },
            { label: "Expiration", value: leg.expiration ? String(leg.expiration).slice(0, 10) : "—" },
            { label: "DTE", value: dte != null ? `${dte}d` : "—", color: dteLow ? "#F59E0B" : undefined }
          ].map(({ label, value, color }) => (
            <div key={label} className="ma-wheel-leg__data-cell">
              <div className="ma-wheel-leg__data-label">{label}</div>
              <div className="ma-wheel-leg__data-val" style={color ? { color } : undefined}>{value}</div>
            </div>
          ))}
        </div>
        {(leg.sellScore != null || leg.gsSignal != null || leg.vrpIntensity != null) && (
          <div className="ma-signal-row">
            {leg.gsSignal != null && (
              <span className="ma-signal-chip">
                <span className="ma-signal-chip__key">G&S</span>
                <span style={{ color: gsSignalColor(leg.gsSignal) }}>{Number(leg.gsSignal).toFixed(3)}</span>
              </span>
            )}
            {leg.ivolPct != null && (
              <span className="ma-signal-chip">
                <span className="ma-signal-chip__key">IVOL</span>
                <span style={{ color: Number(leg.ivolPct) >= 70 ? "#22C55E" : Number(leg.ivolPct) >= 40 ? "#F59E0B" : "#94A3B8" }}>
                  {Number(leg.ivolPct).toFixed(0)}th pct
                </span>
              </span>
            )}
            {leg.vrpIntensity != null && (
              <span className="ma-signal-chip">
                <span className="ma-signal-chip__key">VRP</span>
                <span style={{ color: vrpColor(leg.vrpIntensity) }}>{(leg.vrpIntensity * 100).toFixed(0)}%</span>
              </span>
            )}
            {leg.academicSellEdge != null && (
              <span className="ma-signal-chip" style={{ background: leg.academicSellEdge ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.08)", borderColor: leg.academicSellEdge ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.25)", color: leg.academicSellEdge ? "#4ade80" : "#f87171" }}>
                {leg.academicSellEdge ? "Academic edge" : "Weak signal"}
              </span>
            )}
          </div>
        )}
        <div className="ma-wheel-leg__meta">
          {leg.ivRank != null && <span>IVR {Number(leg.ivRank).toFixed(0)}</span>}
          {leg.delta != null && <span>Δ {Number(leg.delta).toFixed(2)}</span>}
          {leg.ev != null && <span>EV ${Number(leg.ev).toFixed(0)}</span>}
          {leg.compositeScore != null && <span>Eq {Number(leg.compositeScore).toFixed(0)}</span>}
          {leg.reason && <span style={{ color: "#64748B", fontSize: 10 }}>{leg.reason}</span>}
        </div>
      </div>
    </div>
  );
}

export default function WheelTab({
  visible = true,
  universeId = "sp500_top50",
  embedded = true
}) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState(null);

  const book = useMemo(() => equityBookMeta(universeId), [universeId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ universeId: String(universeId || "sp500_top50") });
      const res = await apiFetch(`/api/wheel/status?${q}`);
      const j = await safeJson(res);
      if (!j.success) throw new Error(j.error || "Wheel status failed");
      setStatus(j);
    } catch (e) {
      setError(e.message || String(e));
      /* keep previous status so the UI does not blank out on a transient refresh failure */
    } finally {
      setLoading(false);
    }
  }, [universeId]);

  useEffect(() => {
    if (!visible) return;
    load();
  }, [visible, load]);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await apiFetch("/api/wheel/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ universeId: String(universeId || "sp500_top50") })
      });
      const j = await safeJson(res);
      if (!j.success && j.mode !== "mock") throw new Error(j.error || "Wheel run failed");
      await load();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setRunning(false);
    }
  }, [load, universeId]);

  const optimize = useCallback(async () => {
    setOptimizing(true);
    setError(null);
    try {
      const res = await apiFetch("/api/wheel/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ universeId: String(universeId || "sp500_top50") })
      });
      const j = await safeJson(res);
      if (!j.success) throw new Error(j.error || "Wheel optimize failed");
      await load();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setOptimizing(false);
    }
  }, [load, universeId]);

  const summary = status?.summary;
  const legs = status?.optionsLegs ?? [];
  const toneCombined = (summary?.combinedPnl ?? 0) >= 0 ? "good" : "bad";

  const regime = status?.equity?.regime ?? summary?.regime ?? "normal";
  const regimeSource = status?.equity?.regimeSource;
  const regimeColor =
    regime === "strong_bull"
      ? GREEN
      : regime === "normal"
        ? "#0EA5E9"
        : regime === "pullback"
          ? AMBER
          : regime === "caution"
            ? "#F97316"
            : regime === "bear"
              ? RED
              : "#64748B";

  const openPnl = useMemo(() => {
    if (!legs.length) return 0;
    return legs.reduce((s, l) => s + (Number(l.currentPnL) || 0), 0);
  }, [legs]);

  // Derive the most-recently-seen bkRegimeBoost from open legs (set at entry time)
  const bkBoostDisplay = useMemo(() => {
    const fromLeg = legs.map((l) => l.bkRegimeBoost).find((v) => v != null);
    return fromLeg ?? status?.academicContext?.bkRegimeBoost ?? null;
  }, [legs, status?.academicContext?.bkRegimeBoost]);

  const regimePillClass = regime === "strong_bull" || regime === "normal"
    ? "ma-pro-regime-pill--bull"
    : regime === "pullback" || regime === "caution"
      ? "ma-pro-regime-pill--caution"
      : regime === "bear"
        ? "ma-pro-regime-pill--bear"
        : "ma-pro-regime-pill--neutral";

  return (
    <div
      className={embedded ? "ma-pt-wheel-embed" : "ma-page-container ma-pro-page"}
      style={{ fontFamily: SANS, color: TEXT, paddingBottom: embedded ? 16 : 32 }}
    >
      {/* ── Page header ── */}
      <div className="ma-pro-header">
        <div className="ma-pro-header__left">
          <p className="ma-pro-kicker">Wheel Strategy</p>
          <h1 className="ma-pro-title" style={{ fontSize: embedded ? 20 : 24 }}>Options-Enhanced Wheel</h1>
          <p className="ma-pro-sub">Equity alpha + covered-call premium + cash-secured put premium</p>
        </div>
        <div className="ma-pro-header__right">
          <span className={`ma-pro-regime-pill ${regimePillClass}`}>
            {regime.replace(/_/g, " ")}
            {regimeSource && (
              <span style={{ fontSize: 9, opacity: 0.65, marginLeft: 5 }}>
                {regimeSource === "paper_rebalance" ? "· rebalance" : "· live SPY"}
              </span>
            )}
          </span>
          <div className="ma-pro-live ma-pro-live--on">
            <span className="ma-pro-live__dot" />
            Auto-reload
          </div>
        </div>
      </div>

      {/* ── Action bar ── */}
      <div className="ma-pro-actions">
        <button
          type="button"
          className="ma-pro-btn ma-pro-btn--ghost"
          onClick={load}
          disabled={loading || running || optimizing}
          aria-busy={loading}
        >
          {loading ? (
            <>
              <Loader2 size={13} className="spin" aria-hidden />
              Refresh
            </>
          ) : (
            "Refresh"
          )}
        </button>
        <button
          type="button"
          className="ma-pro-btn ma-pro-btn--sky"
          onClick={optimize}
          disabled={optimizing || running}
        >
          {optimizing ? "Optimizing…" : "Optimize Now"}
        </button>
        <button
          type="button"
          className="ma-pro-btn ma-pro-btn--primary"
          onClick={run}
          disabled={running || optimizing}
        >
          {running ? (
            <>
              <Loader2 size={13} className="spin" aria-hidden />
              Running…
            </>
          ) : (
            "Run Wheel"
          )}
        </button>
        {status?.lastOptimized && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-secondary)", marginLeft: 4 }}>
            Last optimized{" "}
            {new Date(status.lastOptimized).toLocaleString("en-US", {
              month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
            })}
          </span>
        )}
      </div>

      {error && <div className="ma-pro-error">{error}</div>}

      {/* ── Stats ── */}
      <section aria-live="polite">
        {loading && !status && <WheelStatsSkeleton />}

        {summary && (
          <>
            <div
              className="ma-pro-stats"
              style={{
                opacity: loading ? 0.72 : 1,
                transition: "opacity 0.2s ease",
                pointerEvents: loading ? "none" : undefined
              }}
            >
              {/* Row 1 */}
              <div className="ma-pro-stat" style={{ "--pro-stat-accent": "var(--blue)" }}>
                <div className="ma-pro-stat__label">Paper NAV</div>
                <div className="ma-pro-stat__val" style={{ color: "var(--blue)" }}>{fmtMoney(summary.equityTotalValue)}</div>
                <div className="ma-pro-stat__sub">{book.label}</div>
              </div>
              <div className="ma-pro-stat" style={{ "--pro-stat-accent": "#38bdf8" }}>
                <div className="ma-pro-stat__label">Portfolio return</div>
                <div className="ma-pro-stat__val" style={{ color: "#38bdf8" }}>
                  {summary.equityTotalReturnPct != null ? `${Number(summary.equityTotalReturnPct).toFixed(2)}%` : "—"}
                </div>
                <div className="ma-pro-stat__sub">since inception</div>
              </div>
              <div className="ma-pro-stat" style={{ "--pro-stat-accent": "var(--green)" }}>
                <div className="ma-pro-stat__label">Premium collected</div>
                <div className="ma-pro-stat__val" style={{ color: "var(--green)" }}>{fmtMoney(summary.premiumCollected)}</div>
              </div>
              <div className="ma-pro-stat" style={{ "--pro-stat-accent": summary.optionsPnl >= 0 ? "var(--green)" : "var(--red)" }}>
                <div className="ma-pro-stat__label">Options P&L</div>
                <div className="ma-pro-stat__val" style={{ color: summary.optionsPnl >= 0 ? "var(--green)" : "var(--red)" }}>
                  {fmtMoney(summary.optionsPnl)}
                </div>
              </div>
              {/* Row 2 */}
              <div className="ma-pro-stat" style={{ "--pro-stat-accent": toneCombined === "good" ? "var(--green)" : "var(--red)" }}>
                <div className="ma-pro-stat__label">Combined P&L</div>
                <div className="ma-pro-stat__val" style={{ color: toneCombined === "good" ? "var(--green)" : "var(--red)" }}>
                  {fmtMoney(summary.combinedPnl)}
                </div>
              </div>
              <div className="ma-pro-stat" style={{ "--pro-stat-accent": "var(--text-secondary)" }}>
                <div className="ma-pro-stat__label">Open legs</div>
                <div className="ma-pro-stat__val">{String(summary.optionsOpenLegs ?? 0)}</div>
                <div className="ma-pro-stat__sub">of {status?.config?.maxWheelPositions ?? 8} slots</div>
              </div>
              <div className="ma-pro-stat" style={{ "--pro-stat-accent": openPnl >= 0 ? "var(--green)" : "var(--red)" }}>
                <div className="ma-pro-stat__label">Open P&L</div>
                <div className="ma-pro-stat__val" style={{ color: openPnl >= 0 ? "var(--green)" : "var(--red)" }}>
                  {fmtMoney(openPnl)}
                </div>
              </div>
              <div className="ma-pro-stat" style={{ "--pro-stat-accent": "var(--text-secondary)" }}>
                <div className="ma-pro-stat__label">Win rate</div>
                <div className="ma-pro-stat__val">
                  {summary.winRatePct != null ? `${summary.winRatePct.toFixed(1)}%` : "—"}
                </div>
              </div>
            </div>

            <SignalHealthPanel
              legs={legs}
              bkRegimeBoost={bkBoostDisplay}
              empty={legs.length === 0}
            />
          </>
        )}
      </section>

      {/* ── Open Legs ── */}
      <section style={{ marginTop: 28 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h2 className="ma-pro-section-title" style={{ margin: 0 }}>
            Open wheel legs
          </h2>
          <span className="ma-mono" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
            {legs.length} / 5 slots
          </span>
        </div>

        {legs.length === 0 ? (
          <div className="ma-opt-empty-card">
            <div className="ma-mono" style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>No open legs</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              Click <strong>Run Wheel</strong> to scan and open CC/CSP legs (regime-gated).
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {legs.map((leg) => (
              <WheelLegCard
                key={leg.optionSymbol || `${leg.ticker}-${leg.expiration}-${leg.strike}`}
                leg={leg}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Footer ── */}
      <footer style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 12 }}>
        {status?.equity != null && (
          <div className="ma-pro-meta-bar">
            <span>{status.optionsLegs?.length ?? 0} / 5 legs</span>
            <span className="ma-pro-meta-sep">·</span>
            <span>Auto-replaces underperformers</span>
            <span className="ma-pro-meta-sep">·</span>
            <span>9:35 AM + 2:45 PM ET schedule</span>
          </div>
        )}
        <div className="ma-wheel-explainer" role="region" aria-label="Equity value vs wheel profits">
          <p className="ma-wheel-explainer__title">Equity value is not your wheel "take-home"</p>
          <p style={{ margin: "0 0 8px" }}>
            <strong style={{ color: "var(--text-primary)" }}>Paper NAV</strong> is the total market value of stocks + cash. It moves with the market and rebalances —{" "}
            <strong style={{ color: "var(--text-primary)" }}>not cumulative options profit</strong>.
          </p>
          <p style={{ margin: "0 0 8px" }}>
            Wheel income shows in <span className="ma-mono">Premium collected</span>,{" "}
            <span className="ma-mono">Options P&L</span>, and <span className="ma-mono">Open P&L</span>.
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: "var(--text-primary)" }}>Combined P&L</strong> blends equity performance with options overlay; use the options lines to isolate premium selling results.
          </p>
        </div>
        <p className="ma-opt-footnote">Educational tool · Not financial advice</p>
      </footer>
    </div>
  );
}

