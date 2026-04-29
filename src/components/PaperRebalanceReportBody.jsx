import { MONO } from "../lib/theme.js";
import { fmtDate } from "../lib/formatters.js";

/**
 * Full detail for one paper-trade rebalance log entry (buys/sells, rankings, optional composite report).
 * @param {{ rb: object, variant?: "inline" | "page" }} props
 */
export default function PaperRebalanceReportBody({ rb, variant = "inline" }) {
  const pad = variant === "page" ? "12px 0" : "10px 12px";
  const bg = variant === "page" ? "transparent" : "rgba(255,255,255,0.01)";
  const borderRadius = variant === "page" ? 0 : "0 0 6px 6px";

  return (
    <div style={{ padding: pad, background: bg, borderRadius, fontFamily: MONO }}>
      {variant === "page" && rb?.date && (
        <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>
          Rebalance date: <span style={{ color: "#f0f0f0" }}>{fmtDate(rb.date)}</span>
          {rb.portfolioValue != null && (
            <>
              {" "}
              · Portfolio <span style={{ color: "#f0f0f0" }}>${Number(rb.portfolioValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </>
          )}
        </div>
      )}

      {rb.buys?.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: "#22c55e", fontWeight: 700, letterSpacing: 1, marginBottom: 6, fontFamily: MONO }}>BOUGHT</div>
          {rb.buys.map((b) => (
            <div key={b.ticker} style={{ display: "flex", gap: 16, fontSize: 11, fontFamily: MONO, color: "#f0f0f0", marginBottom: 3, flexWrap: "wrap" }}>
              <span style={{ color: "#f0f0f0", fontWeight: 600, minWidth: 50 }}>{b.ticker}</span>
              <span>{b.shares} shares @ ${Number(b.buyPrice).toFixed(2)}</span>
              {b.scores?.composite != null && <span style={{ color: "#f0f0f0" }}>Score: {Number(b.scores.composite).toFixed(1)}</span>}
              {b.scores?.fundamental != null && <span>Fund: {Number(b.scores.fundamental).toFixed(0)}</span>}
              {b.scores?.momentum != null && <span>Mom: {Number(b.scores.momentum).toFixed(0)}</span>}
            </div>
          ))}
        </div>
      )}

      {rb.sells?.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: "#ef4444", fontWeight: 700, letterSpacing: 1, marginBottom: 6, fontFamily: MONO }}>SOLD</div>
          {rb.sells.map((s) => (
            <div key={s.ticker} style={{ display: "flex", gap: 16, fontSize: 11, fontFamily: MONO, color: "#f0f0f0", marginBottom: 3, flexWrap: "wrap" }}>
              <span style={{ color: "#f0f0f0", fontWeight: 600, minWidth: 50 }}>{s.ticker}</span>
              <span>{s.shares} shares @ ${Number(s.sellPrice).toFixed(2)}</span>
              <span style={{ color: s.pnl >= 0 ? "#22c55e" : "#ef4444" }}>
                {s.pnl >= 0 ? "+" : ""}${Number(s.pnl).toFixed(0)} ({s.pnlPct >= 0 ? "+" : ""}{Number(s.pnlPct).toFixed(1)}%)
              </span>
            </div>
          ))}
        </div>
      )}

      {rb.allRankings && rb.allRankings.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 6, fontFamily: MONO }}>TOP RANKINGS</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: MONO }}>
            <thead>
              <tr>
                {["#", "Ticker", "Composite", "Fund", "Mom", "Val", "Value", "Congress"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "4px 6px", color: "#f0f0f0", fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rb.allRankings.map((r, ri) => (
                <tr key={ri} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                  <td style={{ padding: "4px 6px", color: "#f0f0f0" }}>{ri + 1}</td>
                  <td style={{ padding: "4px 6px", color: "#f0f0f0", fontWeight: 600 }}>{r.ticker}</td>
                  <td style={{ padding: "4px 6px", color: "#f0f0f0" }}>{r.compositeScore?.toFixed(1)}</td>
                  <td style={{ padding: "4px 6px", color: "#f0f0f0" }}>{r.fundamentalScore != null ? Number(r.fundamentalScore).toFixed(0) : "—"}</td>
                  <td style={{ padding: "4px 6px", color: "#f0f0f0" }}>{r.momentumScore != null ? Number(r.momentumScore).toFixed(0) : "—"}</td>
                  <td style={{ padding: "4px 6px", color: "#f0f0f0" }}>{r.valuationScore != null ? Number(r.valuationScore).toFixed(0) : "—"}</td>
                  <td style={{ padding: "4px 6px", color: "#f0f0f0" }}>{r.valueScore != null ? Number(r.valueScore).toFixed(0) : "—"}</td>
                  <td style={{ padding: "4px 6px" }}>
                    {(r.congressScore ?? 0) > 0 ? (
                      <span
                        title={`${r.congressSentiment} · ${r.congressScore}/10${r.congressBoosted ? ` · +${r.congressBoosted}pts` : ""}`}
                        style={{ color: r.congressSentiment === "bullish" ? "#4ade80" : r.congressSentiment === "mild" ? "#38bdf8" : "#f0f0f0", fontWeight: 600, cursor: "help" }}
                      >
                        {r.congressSentiment === "bullish" ? "▲" : r.congressSentiment === "bearish" ? "▼" : "●"} {r.congressScore?.toFixed(1)}
                      </span>
                    ) : <span style={{ color: "#475569" }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rb.report ? (
        <div style={{ marginTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12 }}>
          <div style={{ fontSize: 10, color: "#818cf8", fontWeight: 700, letterSpacing: 1, marginBottom: 10, fontFamily: MONO }}>PERFORMANCE REPORT</div>

          <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, fontFamily: MONO }}>
              <span style={{ color: "#f0f0f0", opacity: 0.7 }}>Period: </span>
              <span style={{ color: rb.report.periodReturn >= 0 ? "#22c55e" : "#ef4444", fontWeight: 700 }}>
                {rb.report.periodReturn >= 0 ? "+" : ""}{rb.report.periodReturn}%
              </span>
            </div>
            <div style={{ fontSize: 12, fontFamily: MONO }}>
              <span style={{ color: "#f0f0f0", opacity: 0.7 }}>S&P: </span>
              <span style={{ color: rb.report.spyReturn >= 0 ? "#f59e0b" : "#ef4444", fontWeight: 700 }}>
                {rb.report.spyReturn >= 0 ? "+" : ""}{rb.report.spyReturn}%
              </span>
            </div>
            <div style={{ fontSize: 12, fontFamily: MONO }}>
              <span style={{ color: "#f0f0f0", opacity: 0.7 }}>Alpha: </span>
              <span style={{ color: rb.report.alpha >= 0 ? "#22c55e" : "#ef4444", fontWeight: 700 }}>
                {rb.report.alpha >= 0 ? "+" : ""}{rb.report.alpha}%
              </span>
            </div>
          </div>

          {rb.report.factorPerformance?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 6, fontFamily: MONO }}>FACTOR PERFORMANCE</div>
              {rb.report.factorPerformance.map((fp) => {
                const barPct = Math.min(100, Math.max(0, (fp.spread + 10) / 20 * 100));
                const barColor =
                  fp.contribution === "strong" ? "#22c55e"
                  : fp.contribution === "moderate" ? "#4ade80"
                  : fp.contribution === "weak" ? "#eab308" : "#ef4444";
                return (
                  <div key={fp.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO, width: 80, flexShrink: 0 }}>{fp.label}</span>
                    <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${barPct}%`, background: barColor, borderRadius: 3 }} />
                    </div>
                    <span style={{ fontSize: 10, color: barColor, fontFamily: MONO, width: 60, textAlign: "right", flexShrink: 0 }}>
                      {fp.spread >= 0 ? "+" : ""}{fp.spread}
                    </span>
                    <span style={{ fontSize: 9, color: barColor, fontFamily: MONO, width: 60, textAlign: "right", flexShrink: 0, textTransform: "uppercase" }}>
                      {fp.contribution}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {rb.report.missedOpportunities?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 6, fontFamily: MONO }}>MISSED OPPORTUNITIES</div>
              {rb.report.missedOpportunities.map((m) => (
                <div key={m.ticker} style={{ fontSize: 11, fontFamily: MONO, color: "#f0f0f0", marginBottom: 3 }}>
                  <span style={{ fontWeight: 600, minWidth: 50, display: "inline-block" }}>{m.ticker}</span>
                  <span style={{ color: "#22c55e" }}>+{m.returnPct}%</span>
                  <span style={{ color: "#f0f0f0", opacity: 0.5, marginLeft: 8 }}>
                    {m.currentRank ? `ranked #${m.currentRank}` : "unranked"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {rb.report.weightChanges?.changes?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 6, fontFamily: MONO }}>WEIGHT ADJUSTMENTS</div>
              {rb.report.weightChanges.changes.map((c) => (
                <div key={c.factor} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontFamily: MONO, marginBottom: 3 }}>
                  <span style={{ color: "#f0f0f0", width: 80, flexShrink: 0 }}>{c.label}</span>
                  <span style={{ color: "#f0f0f0", opacity: 0.5 }}>{c.from}%</span>
                  <span style={{ color: "#f0f0f0", opacity: 0.5 }}>→</span>
                  <span style={{ color: c.direction === "increased" ? "#22c55e" : c.direction === "decreased" ? "#ef4444" : "#f0f0f0", fontWeight: 600 }}>
                    {c.to}%
                  </span>
                  <span style={{ fontSize: 10, color: c.direction === "increased" ? "#22c55e" : c.direction === "decreased" ? "#ef4444" : "#f0f0f0" }}>
                    {c.direction === "increased" ? "▲" : c.direction === "decreased" ? "▼" : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {rb.report.narrative != null && rb.report.narrative !== "" && (
            <div style={{ fontSize: 11, color: "#f0f0f0", padding: "8px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 6, lineHeight: 1.6, fontFamily: MONO }}>
              {rb.report.narrative}
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 12, fontSize: 11, color: "#888", fontFamily: MONO, lineHeight: 1.5 }}>
          No performance report for this rebalance (composite strategies include period alpha, factors, and narrative).
        </div>
      )}
    </div>
  );
}

export { fmtDate as fmtRebalanceDate };
