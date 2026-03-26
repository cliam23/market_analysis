import { useState } from "react";

import { MONO } from "../lib/theme.js";

function Section({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 12, border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, overflow: "hidden" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", background: "rgba(255,255,255,0.02)", border: "none",
          color: "#f0f0f0", fontFamily: MONO, fontSize: 13, fontWeight: 700, cursor: "pointer",
          letterSpacing: 0.5
        }}
      >
        {title}
        <span style={{ fontSize: 11, color: "#f0f0f0" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && <div style={{ padding: "16px 18px", fontSize: 13, lineHeight: 1.75, color: "#f0f0f0" }}>{children}</div>}
    </div>
  );
}

function PillarCard({ name, weight, children }) {
  return (
    <div style={{
      flex: "1 1 180px", padding: 16, borderRadius: 8,
      background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)"
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontWeight: 700, color: "#f0f0f0", fontSize: 12, fontFamily: MONO }}>{name}</span>
        <span style={{
          fontSize: 11, fontFamily: MONO, fontWeight: 700, color: "#f0f0f0",
          background: "rgba(255,255,255,0.08)", borderRadius: 4, padding: "2px 8px"
        }}>{weight}</span>
      </div>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.65, color: "#f0f0f0" }}>{children}</p>
    </div>
  );
}

function FlowStep({ n, title, body }) {
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "flex-start" }}>
      <span style={{
        flexShrink: 0, width: 22, height: 22, borderRadius: 6, fontSize: 11, fontWeight: 800,
        fontFamily: MONO, background: "rgba(255,255,255,0.08)", color: "#f0f0f0",
        display: "flex", alignItems: "center", justifyContent: "center"
      }}>{n}</span>
      <div>
        <div style={{ fontWeight: 700, fontSize: 12, fontFamily: MONO, color: "#f0f0f0", marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12, lineHeight: 1.65, color: "#f0f0f0" }}>{body}</div>
      </div>
    </div>
  );
}

export default function AboutTab() {
  return (
    <div style={{ maxWidth: 840, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 4, color: "#f0f0f0", marginBottom: 6, fontFamily: MONO }}>ABOUT</div>
        <h2 style={{ fontSize: 20, fontWeight: 900, margin: 0, color: "#f0f0f0" }}>How everything works</h2>
        <p style={{ fontSize: 12, color: "#f0f0f0", marginTop: 6, fontFamily: MONO }}>
          Multi-factor scoring, historical simulation, and optional ML — one coherent pipeline
        </p>
      </div>

      <Section title="Start here: running the app" defaultOpen={true}>
        <p style={{ margin: "0 0 12px" }}>
          The UI talks to a <strong style={{ color: "#f0f0f0" }}>Node server</strong> that loads prices and fundamentals, scores tickers, runs backtests, and stores paper portfolios.
          From the project folder, use <strong style={{ color: "#f0f0f0" }}>npm run dev:all</strong> so the API and the Vite front end run together.
          If you see “Backend not connected,” the server is not running or the proxy cannot reach it.
        </p>
        <p style={{ margin: 0 }}>
          <strong style={{ color: "#f0f0f0" }}>Data path:</strong> quotes, history, and financials are fetched from <strong style={{ color: "#f0f0f0" }}>Yahoo Finance</strong> (via yahoo-finance2).
          Nothing in the browser calls Yahoo directly; the server is the only place that pulls market data.
        </p>
      </Section>

      <Section title="The five screens (tabs)" defaultOpen={true}>
        <FlowStep
          n={1}
          title="Search"
          body="Pick a ticker from the list or search. Opening a name loads a full analysis: composite and pillar scores, Buffett-style checklist context, DCF summary, comparables, shareholder yield, and momentum/entry timing. Deep sections may call dedicated endpoints (for example DCF detail or comps). You can go back to the list without losing the server session."
        />
        <FlowStep
          n={2}
          title="Backtest"
          body="Choose universe (e.g. S&P 500 Top 50, Mag 7), calendar period, rebalance frequency, how many names to hold, and strategy. The server walks forward in time: on each rebalance it ranks the universe, applies sector limits where relevant, sizes positions, and simulates daily marks with optional stop-loss and regime-based exposure. Results include performance stats vs a benchmark, equity curve (with optional inflation baseline when data is available), monthly returns, factor attribution for composite strategies, and a trade log."
        />
        <FlowStep
          n={3}
          title="Strategy Rankings"
          body="This is a live cross-sectional scan, not a time machine. You choose the same strategy families as the backtest (momentum-only through full composite variants), a universe, a momentum lookback (3 / 6 / 12 months), and optional smoothing. Run Scan to fetch fresh data and rank every stock in that universe today. Sort by strategy score, raw momentum, or risk-adjusted momentum. Tap a row to open that ticker in Search."
        />
        <FlowStep
          n={4}
          title="Trading (paper)"
          body="Initialize a virtual portfolio with capital, universe, strategy, and how many positions to hold. The server tracks holdings, cash, next rebalance date, and history. You rebalance manually (or use auto-rebalance when the calendar reaches the scheduled date). Each rebalance recomputes rankings the same way as the backtest engine for your chosen strategy, then rebuilds the book. Performance is charted against a reference line (often SPY or universe-appropriate benchmark, depending on configuration)."
        />
        <FlowStep
          n={5}
          title="About"
          body="This page — methodology, limitations, and disclaimers."
        />
      </Section>

      <Section title="How scoring fits together">
        <p style={{ margin: "0 0 10px" }}>
          <strong style={{ color: "#f0f0f0" }}>Core idea:</strong> each eligible stock gets sub-scores (fundamental quality, DCF gap, dynamic valuation, momentum, price/value entry), mapped to roughly 0–100.
          They combine into a <strong style={{ color: "#f0f0f0" }}>composite</strong> using weights that depend on the strategy (conservative full composite vs aggressive vs turbo).
          Rankings for backtest, scan, and paper trade use the same underlying analysis code paths so results are comparable.
        </p>
        <p style={{ margin: 0 }}>
          <strong style={{ color: "#f0f0f0" }}>Optional ML:</strong> if you train the Random Forest and set environment variables (see below), the server can blend a model score into composite <strong style={{ color: "#f0f0f0" }}>ranking</strong> for paper rebalance and composite <strong style={{ color: "#f0f0f0" }}>backtests</strong>, and optionally blend into the <strong style={{ color: "#f0f0f0" }}>single-ticker analysis</strong> composite.
          The default with ML off remains fully rules-based and inspectable pillar-by-pillar.
        </p>
      </Section>

      <Section title="The 5-pillar ranking model" defaultOpen={true}>
        <p style={{ margin: "0 0 16px" }}>
          Full Composite and related modes blend these pillars (illustrative default weights for <strong style={{ color: "#f0f0f0" }}>Full Composite</strong>; aggressive and turbo shift emphasis toward momentum and relax gates):
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
          <PillarCard name="FUNDAMENTAL" weight="35%">
            Buffett-style quality, moat, ROIC spread, earnings quality, shareholder yield, growth constraints, and an AI disruption signal — summarized as one fundamental pillar.
          </PillarCard>
          <PillarCard name="DCF" weight="10%">
            Simplified discounted cash flow: project free cash flow with fading growth, discount with a beta-derived WACC, add terminal value, compare intrinsic value per share to price. Underweight or zero in more aggressive presets.
          </PillarCard>
          <PillarCard name="DYNAMIC VALUATION" weight="15%">
            Price-based valuation signals (e.g. vs long moving averages, trend quality) with adjustments so strong businesses are not always punished for rich multiples.
          </PillarCard>
          <PillarCard name="MOMENTUM" weight="25%">
            Multi-month risk-adjusted momentum plus trend bonus. Composite variants may blend raw momentum with a “momentum quality” tilt (weighting depends on strategy).
          </PillarCard>
          <PillarCard name="PRICE VALUE" weight="15%">
            Entry and pullback quality: distance from highs, moving-average structure, multi-horizon strength — favors constructive setups within a trend.
          </PillarCard>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: "#f0f0f0", fontFamily: MONO, lineHeight: 1.65 }}>
          Default Full Composite ≈ Fundamental 35% + DCF 10% + Dynamic valuation 15% + Momentum 25% + Price value 15%, before any optional ML blend. Aggressive / Turbo use different weight vectors and different filter strictness in simulation.
        </p>
      </Section>

      <Section title="Backtest mechanics (what the curve really is)">
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
          <li><strong style={{ color: "#f0f0f0" }}>Universe:</strong> a fixed list of tickers (e.g. top names by market cap slice, or theme lists like Mag 7). Only symbols with enough history participate in ranking each period.</li>
          <li><strong style={{ color: "#f0f0f0" }}>Rebalance:</strong> on schedule (monthly, weekly, etc.), the model re-ranks and may rotate holdings. Monthly mode is anchored around mid-month; other frequencies step through calendar time from the start of your chosen period.</li>
          <li><strong style={{ color: "#f0f0f0" }}>Benchmark:</strong> when possible, the chart compares you to an <strong style={{ color: "#f0f0f0" }}>equal-weight</strong> version of the same universe; if data is insufficient, the server falls back to SPY and labels that clearly in the UI.</li>
          <li><strong style={{ color: "#f0f0f0" }}>Stops and regime:</strong> composite-style runs can cut positions on adverse moves (volatility-aware trailing stops) and scale exposure by market regime. Sharp single-day steps on the equity curve are often stops or cluster of exits — check the trade log (STOP vs rebalance).</li>
          <li><strong style={{ color: "#f0f0f0" }}>Fundamentals in time:</strong> the backtest uses fundamentals loaded for the run as a slow-moving snapshot (no lookahead within the sim). That matches a conservative research assumption; it is not the same as true point-in-time fundamentals for every historical date.</li>
        </ul>
      </Section>

      <Section title="Paper trade vs backtest">
        <p style={{ margin: "0 0 10px" }}>
          <strong style={{ color: "#f0f0f0" }}>Backtest</strong> replays the past with your chosen dates and cadence. <strong style={{ color: "#f0f0f0" }}>Paper trade</strong> starts from “now” (or your init time) and moves forward: you see a live portfolio state, suggested next rebalance, and can apply a rebalance when you choose.
        </p>
        <p style={{ margin: 0 }}>
          Composite paper portfolios can use <strong style={{ color: "#f0f0f0" }}>adaptive pillar weights</strong> informed by recent factor behavior (similar in spirit to adaptive logic in the backtest). Optional <strong style={{ color: "#f0f0f0" }}>ML rank blending</strong> applies at rebalance when configured. Execution is still model-level (prices at rebalance), not a broker simulator.
        </p>
      </Section>

      <Section title="Optional machine learning (admin / .env)">
        <p style={{ margin: "0 0 10px" }}>
          ML is <strong style={{ color: "#f0f0f0" }}>off by default</strong>. To use it you need Python dependencies (see <strong style={{ color: "#f0f0f0" }}>ml/README.md</strong>), a trained model under <strong style={{ color: "#f0f0f0" }}>models/</strong>, and typically a virtualenv the server can invoke.
        </p>
        <ul style={{ margin: "0 0 10px", paddingLeft: 18, lineHeight: 2 }}>
          <li><strong style={{ color: "#f0f0f0" }}>ML_RANK_WEIGHT</strong> (0–1): blends the model into <strong style={{ color: "#f0f0f0" }}>composite ranking</strong> on paper rebalance and on composite <strong style={{ color: "#f0f0f0" }}>backtest</strong> rebalances. Higher values give more influence to the learned score. Requires a compatible trained RF pipeline.</li>
          <li><strong style={{ color: "#f0f0f0" }}>ML_COMPOSITE_ANALYSIS=1</strong>: for <strong style={{ color: "#f0f0f0" }}>single-ticker analysis</strong>, blends rules with the model’s structural / probability-style signal in the composite shown in Search. Response may include a small ML prediction payload when inference succeeds.</li>
          <li><strong style={{ color: "#f0f0f0" }}>PYTHON</strong>: optional path to the interpreter; otherwise the server prefers <strong style={{ color: "#f0f0f0" }}>.venv</strong> if present.</li>
        </ul>
        <p style={{ margin: 0, fontSize: 12, fontFamily: MONO, color: "#f0f0f0" }}>
          Copy <strong style={{ color: "#f0f0f0" }}>.env.example</strong> to <strong style={{ color: "#f0f0f0" }}>.env</strong> for variable names. ML adds latency (Python subprocess per batch) — backtests with ML run slower.
        </p>
      </Section>

      <Section title="DCF methodology">
        <p style={{ margin: "0 0 10px" }}>The server runs a <strong style={{ color: "#f0f0f0" }}>10-year</strong> free-cash-flow discount model, then maps implied upside into the 0–100 DCF pillar score:</p>
        <ol style={{ margin: "0 0 12px", paddingLeft: 20, lineHeight: 2 }}>
          <li><strong style={{ color: "#f0f0f0" }}>Starting FCF:</strong> from reported free cash flow (with fallbacks when lines are missing).</li>
          <li><strong style={{ color: "#f0f0f0" }}>Growth:</strong> two phases with fading growth rates by year (revenue/earnings caps for very large companies apply). Long-run <strong style={{ color: "#f0f0f0" }}>terminal growth</strong> is about <strong style={{ color: "#f0f0f0" }}>2.5%</strong> nominal.</li>
          <li><strong style={{ color: "#f0f0f0" }}>WACC:</strong> blended cost of capital — <strong style={{ color: "#f0f0f0" }}>cost of equity</strong> uses a 4.3% risk-free rate, a 5.5% equity risk premium, and a beta shrunk toward 1; <strong style={{ color: "#f0f0f0" }}>after-tax cost of debt</strong> steps with leverage; result is nudged for very high FCF margins / strong balance sheets and then <strong style={{ color: "#f0f0f0" }}>clamped between ~6% and 15%</strong>.</li>
          <li><strong style={{ color: "#f0f0f0" }}>Enterprise vs equity:</strong> discounted cash flows plus terminal value, adjusted for <strong style={{ color: "#f0f0f0" }}>net cash</strong> (cash minus debt), divided by shares for implied value per share.</li>
          <li><strong style={{ color: "#f0f0f0" }}>Score:</strong> how far market price sits below or above that implied value, compressed to the 0–100 pillar range.</li>
        </ol>
        <p style={{ margin: 0, fontSize: 12, color: "#f0f0f0", fontFamily: MONO }}>
          Still a single-scenario toy model — use it as one pillar among five, not a precision intrinsic value.
        </p>
      </Section>

      <Section title="Filters and safeguards">
        <p style={{ margin: "0 0 8px" }}>Composite strategies apply eligibility rules before ranking (exact thresholds vary by strategy):</p>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
          <li><strong style={{ color: "#f0f0f0" }}>Fundamental floor:</strong> very weak fundamental scores are dropped in standard full composite; aggressive modes relax this; turbo largely minimizes quality gates for experimentation.</li>
          <li><strong style={{ color: "#f0f0f0" }}>Balance sheet / growth constraints:</strong> severe flags can exclude names.</li>
          <li><strong style={{ color: "#f0f0f0" }}>Volatility cap:</strong> extremely high realized vol can exclude speculative names in stricter modes.</li>
          <li><strong style={{ color: "#f0f0f0" }}>Trend / value interaction:</strong> deep downtrends with poor value can be filtered in stricter profiles.</li>
          <li><strong style={{ color: "#f0f0f0" }}>History length:</strong> enough trading days are required so momentum and volatility are meaningful.</li>
        </ul>
      </Section>

      <Section title="Data sources and limitations">
        <p style={{ margin: "0 0 10px" }}>
          <strong style={{ color: "#f0f0f0" }}>Market data:</strong> Yahoo Finance. Corporate actions are reflected in adjusted prices where the upstream series provides them.
        </p>
        <p style={{ margin: "0 0 10px" }}>
          <strong style={{ color: "#f0f0f0" }}>Inflation / cash baseline (backtest):</strong> when U.S. CPI series can be loaded from FRED, the equity chart can show a purchasing-power baseline for cash; otherwise a simple assumed rate may be documented in the UI. This does not change strategy returns — it is a reference curve.
        </p>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
          <li>Historical fundamentals for every past date are not fully replicated; long backtests lean on a stable fundamental snapshot for the run.</li>
          <li>Smaller or non-U.S. tickers may have gaps or odd fields in Yahoo’s payload.</li>
          <li>No slippage, commissions, taxes, or borrow costs in simulation or paper mode.</li>
          <li>Paper trade uses discrete rebalance pricing, not full intraday execution simulation.</li>
        </ul>
      </Section>

      <Section title="Disclaimer">
        <div style={{
          padding: 14, borderRadius: 8, background: "rgba(239,68,68,0.06)",
          border: "1px solid rgba(239,68,68,0.15)", fontSize: 12, lineHeight: 1.7, color: "#f0f0f0"
        }}>
          <p style={{ margin: "0 0 8px", color: "#ef4444", fontWeight: 700, fontFamily: MONO, fontSize: 12 }}>
            EDUCATIONAL TOOL — NOT FINANCIAL ADVICE
          </p>
          <p style={{ margin: "0 0 8px" }}>
            This application is for learning and research. It shows how multi-factor and optional ML-augmented workflows can be structured; it should <strong style={{ color: "#f0f0f0" }}>never</strong> be the sole basis for real investment decisions.
          </p>
          <p style={{ margin: "0 0 8px" }}>
            Past backtest or paper results do not predict future returns. Simplifications (fundamentals, DCF, costs, execution) mean live outcomes would differ.
          </p>
          <p style={{ margin: 0 }}>
            Do your own due diligence, consult a licensed professional if you need advice, and only risk capital you can afford to lose. The authors accept no liability for decisions made using this tool.
          </p>
        </div>
      </Section>
    </div>
  );
}
