import { useState } from "react";

const MONO = "'IBM Plex Mono', monospace";

function Section({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 12, border: "1px solid rgba(129,140,248,0.12)", borderRadius: 8, overflow: "hidden" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", background: "rgba(255,255,255,0.02)", border: "none",
          color: "#f0f0f0", fontFamily: MONO, fontSize: 12, fontWeight: 700, cursor: "pointer",
          letterSpacing: 0.5
        }}
      >
        {title}
        <span style={{ fontSize: 10, color: "#818cf8" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && <div style={{ padding: "16px 18px", fontSize: 12.5, lineHeight: 1.75, color: "#c0c0c0" }}>{children}</div>}
    </div>
  );
}

function PillarCard({ name, weight, color, children }) {
  return (
    <div style={{
      flex: "1 1 180px", padding: 16, borderRadius: 8,
      background: "rgba(255,255,255,0.02)", border: `1px solid ${color}22`
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontWeight: 700, color, fontSize: 12, fontFamily: MONO }}>{name}</span>
        <span style={{
          fontSize: 10, fontFamily: MONO, fontWeight: 700, color: "#111",
          background: color, borderRadius: 4, padding: "2px 7px"
        }}>{weight}</span>
      </div>
      <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.65, color: "#999" }}>{children}</p>
    </div>
  );
}

export default function AboutTab() {
  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 4, color: "#818cf8", marginBottom: 6, fontFamily: MONO }}>ABOUT</div>
        <h2 style={{ fontSize: 20, fontWeight: 900, margin: 0, color: "#f0f0f0" }}>How the Model Works</h2>
        <p style={{ fontSize: 11, color: "#555", marginTop: 6, fontFamily: MONO }}>
          A multi-factor, rules-based investment analysis platform
        </p>
      </div>

      <Section title="Platform Overview" defaultOpen={true}>
        <p style={{ margin: "0 0 10px" }}>
          Value Signal Pro is a <strong style={{ color: "#f0f0f0" }}>rules-based investment analysis platform</strong> that
          combines multiple time-tested investment principles — Buffett quality, competitive moats, capital efficiency,
          valuation, and momentum — into a single composite ranking system.
        </p>
        <p style={{ margin: 0 }}>
          Unlike black-box ML models, every signal is transparent and grounded in decades of
          academic factor research. The platform lets you search stocks, backtest strategies on historical data,
          track momentum leaders, and paper-trade the model's picks in real time.
        </p>
      </Section>

      <Section title="Tabs & Features">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[
            { tab: "Search", icon: "🔍", desc: "Look up any ticker for a deep-dive analysis: Buffett checklist, moat assessment, ROIC, earnings quality, DCF valuation, comparables, total shareholder yield, and entry timing." },
            { tab: "Backtest", icon: "📈", desc: "Simulate trading strategies on historical data with four modes: Momentum Only, Momentum + Value, Quality Momentum, and Full Composite. Compare risk-adjusted returns, drawdowns, and factor attribution." },
            { tab: "Momentum Rankings", icon: "📊", desc: "Scan the universe for the strongest momentum stocks with configurable lookback, trend filters, and universe selection. See real-time rankings with volatility-adjusted scores." },
            { tab: "Paper Trade", icon: "💼", desc: "Forward-test the model by running it live. The system auto-rebalances every 30 days, tracking portfolio value, trades, and performance vs. S&P 500." },
          ].map(({ tab, icon, desc }) => (
            <div key={tab} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 12, color: "#f0f0f0", fontFamily: MONO, marginBottom: 3 }}>{tab}</div>
                <div style={{ fontSize: 11.5, color: "#999", lineHeight: 1.6 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="The 5-Pillar Ranking Model" defaultOpen={true}>
        <p style={{ margin: "0 0 16px" }}>
          When the model selects stocks for the paper-trade portfolio (or runs a Full Composite backtest),
          it scores every stock on <strong style={{ color: "#f0f0f0" }}>five pillars</strong> and weights them as follows:
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
          <PillarCard name="FUNDAMENTAL" weight="25%" color="#818cf8">
            Composite of Buffett quality, moat width, ROIC spread, earnings quality,
            shareholder yield, growth constraints, and AI disruption signal. Measures
            whether the underlying business is high-quality.
          </PillarCard>
          <PillarCard name="DCF" weight="15%" color="#34d399">
            Simplified discounted cash flow model. Projects free cash flow 5 years forward
            with decaying growth, applies a WACC discount rate derived from beta, calculates
            terminal value, and compares the resulting intrinsic value to the current price.
            Stocks trading well below intrinsic value score higher.
          </PillarCard>
          <PillarCard name="DYNAMIC VALUATION" weight="20%" color="#fbbf24">
            Real-time valuation signals that change at every rebalance: price vs. 52-week
            average, implied P/E from forward earnings, distance from 200-day MA, and a
            quality adjustment so high-quality businesses aren't penalized for deserved
            premium valuations.
          </PillarCard>
          <PillarCard name="MOMENTUM" weight="25%" color="#f472b6">
            6-month risk-adjusted momentum with trend confirmation. Captures the well-documented
            tendency for stocks with positive momentum to continue outperforming. Filtered
            for excessive volatility to avoid speculative blow-ups.
          </PillarCard>
          <PillarCard name="PRICE VALUE" weight="15%" color="#fb923c">
            Mean-reversion overlay: rewards stocks pulling back from highs while maintaining
            positive short-term momentum. Complements the momentum signal by identifying
            favorable entry points within an uptrend.
          </PillarCard>
        </div>
        <p style={{ margin: 0, fontSize: 11, color: "#666", fontFamily: MONO }}>
          Final score = (Fundamental × 0.25) + (DCF × 0.15) + (Dynamic Val × 0.20) + (Momentum × 0.25) + (Price Value × 0.15)
        </p>
      </Section>

      <Section title="DCF Methodology">
        <p style={{ margin: "0 0 10px" }}>The DCF (Discounted Cash Flow) model values a business by the present value of its future cash flows:</p>
        <ol style={{ margin: "0 0 12px", paddingLeft: 20, lineHeight: 2 }}>
          <li><strong style={{ color: "#f0f0f0" }}>Starting FCF:</strong> Uses reported free cash flow (or 75% of operating cash flow as a fallback).</li>
          <li><strong style={{ color: "#f0f0f0" }}>Growth projection:</strong> Projects FCF for 5 years using the company's earnings or revenue growth rate, with annual decay (growth fades 15% per year toward the terminal rate).</li>
          <li><strong style={{ color: "#f0f0f0" }}>WACC:</strong> Weighted average cost of capital derived from the stock's beta: WACC = 4.3% + beta × 5.5%.</li>
          <li><strong style={{ color: "#f0f0f0" }}>Terminal value:</strong> Assumes the business grows at 2.5% forever after year 5. Terminal Value = FCF₅ × (1 + 2.5%) / (WACC − 2.5%).</li>
          <li><strong style={{ color: "#f0f0f0" }}>Intrinsic value:</strong> Sum of discounted projected FCFs + discounted terminal value + net cash (cash minus debt), divided by shares outstanding.</li>
          <li><strong style={{ color: "#f0f0f0" }}>Scoring:</strong> Converted to a 0–100 score based on the upside from intrinsic value to current price. &ge;40% upside = 100, &le;−25% downside = 10.</li>
        </ol>
        <p style={{ margin: 0, fontSize: 11, color: "#666", fontFamily: MONO }}>
          This is a simplified single-scenario DCF. It does not model multiple scenarios, segment-level projections, or WACC refinements. Treat it as one signal among five, not a standalone valuation.
        </p>
      </Section>

      <Section title="Filters & Safeguards">
        <p style={{ margin: "0 0 8px" }}>Before a stock can enter the portfolio, it must pass several hard filters:</p>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
          <li><strong style={{ color: "#f0f0f0" }}>Fundamental quality &ge; 30:</strong> Removes low-quality businesses regardless of momentum or valuation.</li>
          <li><strong style={{ color: "#f0f0f0" }}>No severe constraints:</strong> Companies with critical debt or growth constraints are excluded.</li>
          <li><strong style={{ color: "#f0f0f0" }}>Volatility cap:</strong> Annualized volatility above 80% is excluded to avoid speculative names.</li>
          <li><strong style={{ color: "#f0f0f0" }}>Trend confirmation:</strong> Stocks in strong downtrends with weak value scores are filtered out.</li>
          <li><strong style={{ color: "#f0f0f0" }}>Minimum data:</strong> At least 120 trading days of price history required for reliable signal calculation.</li>
        </ul>
      </Section>

      <Section title="Data Source & Limitations">
        <p style={{ margin: "0 0 10px" }}>
          All data comes from <strong style={{ color: "#f0f0f0" }}>Yahoo Finance</strong> via the yahoo-finance2 API.
          This provides real-time quotes, historical prices, financial statements, and summary statistics.
        </p>
        <p style={{ margin: "0 0 10px" }}>
          <strong style={{ color: "#f0f0f0" }}>Key limitations:</strong>
        </p>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
          <li>Historical fundamentals are not available — the backtest uses current fundamentals as a point-in-time approximation, which is reasonable for 1–3 year periods but less reliable over 5+ years.</li>
          <li>Yahoo Finance data can occasionally return inconsistent types or missing fields for international tickers or smaller companies.</li>
          <li>The DCF model depends on the accuracy of reported FCF and growth estimates — if these are noisy, the DCF score will be noisy.</li>
          <li>No transaction costs, slippage, or taxes are modeled in the backtest or paper trade.</li>
          <li>Paper trade uses point-in-time prices at rebalance, not intraday execution prices.</li>
        </ul>
      </Section>

      <Section title="Disclaimer">
        <div style={{
          padding: 14, borderRadius: 8, background: "rgba(239,68,68,0.06)",
          border: "1px solid rgba(239,68,68,0.15)", fontSize: 11.5, lineHeight: 1.7, color: "#999"
        }}>
          <p style={{ margin: "0 0 8px", color: "#ef4444", fontWeight: 700, fontFamily: MONO, fontSize: 11 }}>
            THIS IS AN EDUCATIONAL TOOL — NOT FINANCIAL ADVICE
          </p>
          <p style={{ margin: "0 0 8px" }}>
            Value Signal Pro is built for learning and research purposes. It demonstrates how quantitative
            factor models work, but should <strong style={{ color: "#f0f0f0" }}>never</strong> be used as the
            sole basis for real investment decisions.
          </p>
          <p style={{ margin: "0 0 8px" }}>
            Past backtest performance does not predict future results. The model uses simplified approximations
            (point-in-time fundamentals, single-scenario DCF, no transaction costs) that would not hold up
            in a production trading system.
          </p>
          <p style={{ margin: 0 }}>
            Always do your own research, consult a qualified financial advisor, and never invest more
            than you can afford to lose. The creators of this tool accept no liability for any investment
            decisions made using it.
          </p>
        </div>
      </Section>
    </div>
  );
}
