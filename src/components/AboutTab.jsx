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
          One scoring engine · Search, Backtest, Trading (paper), and RL Agent · two optional “smart” layers (Python RF blend, Q-learning RL)
        </p>
      </div>

      <Section title="Forward performance (how to read results)" defaultOpen={true}>
        <p style={{ margin: "0 0 12px" }}>
          This system is optimized for <strong style={{ color: "#f0f0f0" }}>forward</strong> expectations, not maximizing a single backtest number.
          Every backtest and paper stat is <strong style={{ color: "#f0f0f0" }}>past data</strong>, including out-of-sample splits. The{" "}
          <strong style={{ color: "#f0f0f0" }}>forward estimate</strong> and <strong style={{ color: "#f0f0f0" }}>forward confidence</strong>{" "}
          blend sub-period stability, regime robustness, weight simplicity, and a discount when recent years look much stronger than the long run.
        </p>
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.75 }}>
          <li>Prefer durable factor weights over the peak-alpha corner of the grid.</li>
          <li>Discount periods where recent performance dominates long-run averages.</li>
          <li>Favor fewer active factors when weights look like overfit tinkering.</li>
          <li>Require economic rationale (why should the edge persist?), not only curve fit.</li>
          <li>
            <strong style={{ color: "#f0f0f0" }}>RL agent:</strong> parked by default when policy evaluation is off—pattern-matching RL
            needs a structural story before re-enabling.
          </li>
        </ul>
      </Section>

      <Section title="Start here: running the app" defaultOpen={false}>
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

      <Section title="The big picture" defaultOpen={true}>
        <p style={{ margin: "0 0 12px" }}>
          <strong style={{ color: "#f0f0f0" }}>Shared brain:</strong> Search, Backtest, and Trading all rely on the same analysis and ranking code paths (pillars → composite → sort). What changes is <em>how time works</em>: Search scores one ticker “now”; Backtest replays many past rebalance dates; Paper starts from today and only moves forward when you (or auto-rebalance) trigger a rebalance.
        </p>
        <p style={{ margin: 0 }}>
          <strong style={{ color: "#f0f0f0" }}>Optional extras:</strong> a <strong style={{ color: "#f0f0f0" }}>Python Random Forest</strong> can blend into ranks or single-ticker composite when you configure <strong style={{ color: "#f0f0f0" }}>.env</strong> (separate from RL). A <strong style={{ color: "#f0f0f0" }}>Q-learning agent</strong> (trained in-app, saved as <strong style={{ color: "#f0f0f0" }}>rl-agent.json</strong> on the server) can steer composite <strong style={{ color: "#f0f0f0" }}>backtests</strong> and composite <strong style={{ color: "#f0f0f0" }}>paper</strong> rebalances when enabled — see the RL section below.
        </p>
      </Section>

      <Section title="Sidebar: what each area does" defaultOpen={true}>
        <p style={{ margin: "0 0 14px", fontSize: 12, lineHeight: 1.65 }}>
          Order matches the left rail: <strong style={{ color: "#f0f0f0" }}>Search</strong>, <strong style={{ color: "#f0f0f0" }}>Backtest</strong>, <strong style={{ color: "#f0f0f0" }}>Trading</strong>, <strong style={{ color: "#f0f0f0" }}>RL Agent</strong>. <strong style={{ color: "#f0f0f0" }}>About</strong> is under the gear at the bottom.
        </p>
        <FlowStep
          n={1}
          title="Search"
          body="Pick a ticker from the list or type to filter. Opening a name loads a full analysis: composite and pillar scores, Buffett-style checklist context, DCF summary, comparables, shareholder yield, and momentum/entry timing. Some panels call extra endpoints (for example DCF detail or comps). Use Back to return to the list; the browser session keeps talking to the same Node server."
        />
        <FlowStep
          n={2}
          title="Backtest"
          body="Choose universe (e.g. S&P 500 Top 50, Mag 7), calendar period, rebalance frequency, position count, and strategy. The server walks forward in time: on each rebalance it re-ranks the universe, applies sector limits where relevant, sizes positions, and marks the book daily with optional stop-loss and regime-based exposure. You get performance vs benchmark, equity curve (optional inflation / cash baseline when data exists), monthly returns, factor attribution for composite strategies, and a trade log. For composite strategies, an RL toggle runs the trained Q-agent when rl-agent.json is loaded unless you force rules-only (rlAgent=false in the request)."
        />
        <FlowStep
          n={3}
          title="Trading (paper)"
          body="Paper portfolio lives in a server-side file (paper-portfolio.json — not committed to git). Initialize with capital, universe, strategy, position count, and schedule; the server stores holdings, cash, next rebalance date, NAV history, and every past rebalance. Run Rebalance when you want a fresh rank-and-trade step, or rely on auto-rebalance when the due date is reached. Each step uses the same ranking machinery as backtest for your strategy. After a rebalance, the log can expose a shareable link that opens a standalone report: ?paperRebalance=YYYY-MM-DD (add paperRebalanceOcc=n if two rebalances fall on the same calendar day). Composite portfolios can turn RL on/off and optional online Q-updates via the live config toggles (or init flags); when RL is on and a trained agent exists, the rebalance may adjust exposure, how many names to buy, and sizing — the response includes an rlDecision summary when applicable."
        />
        <FlowStep
          n={4}
          title="RL Agent"
          body="Operational home for Q-learning: train the agent (POST /api/rl/train) over random rebalance episodes, inspect policy (GET /api/rl/policy), and compare rules-only vs RL-eval backtests (GET /api/rl/compare). Training overwrites the on-disk policy file the server loads at startup. This is independent of the Python Random Forest path — both can be off, one on, or both on, but they solve different problems (tabular rank blend vs discrete portfolio actions)."
        />
        <FlowStep
          n={5}
          title="About (this page)"
          body="End-to-end map of the app: how data moves, what each screen does, pillar math, backtest and paper behavior, RL vs RF options, and limitations."
        />
      </Section>

      <Section title="How scoring fits together">
        <p style={{ margin: "0 0 10px" }}>
          <strong style={{ color: "#f0f0f0" }}>Core idea:</strong> each eligible stock gets sub-scores (fundamental quality, DCF gap, dynamic valuation, momentum, price/value entry), mapped to roughly 0–100.
          They combine into a <strong style={{ color: "#f0f0f0" }}>composite</strong> using weights that depend on the strategy (conservative full composite vs aggressive vs turbo).
          Backtest and paper trade use the same underlying analysis code paths so results are comparable.
        </p>
        <p style={{ margin: 0 }}>
          <strong style={{ color: "#f0f0f0" }}>Optional Python RF:</strong> if you train the Random Forest and set environment variables (see below), the server can blend that model into composite <strong style={{ color: "#f0f0f0" }}>ranking</strong> for paper rebalance and composite <strong style={{ color: "#f0f0f0" }}>backtests</strong>, and optionally into the <strong style={{ color: "#f0f0f0" }}>single-ticker analysis</strong> composite in Search.
          With RF off, everything stays rules-based and pillar-by-pillar inspectable. <strong style={{ color: "#f0f0f0" }}>Q-learning RL</strong> (rl-agent.json) is a separate knob and does not replace the RF variables — see the RL section.
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

      <Section title="Paper trading vs backtest (detail)">
        <p style={{ margin: "0 0 10px" }}>
          <strong style={{ color: "#f0f0f0" }}>Backtest</strong> replays history: you pick start/end, rebalance frequency, and the server simulates the whole period in one run. <strong style={{ color: "#f0f0f0" }}>Paper</strong> is stateful: one portfolio on disk, advancing only when you POST a rebalance (or when auto-rebalance fires). You always see current holdings, cash, next due date, and cumulative performance vs SPY (and capture stats when available).
        </p>
        <p style={{ margin: "0 0 10px" }}>
          Composite paper runs can use <strong style={{ color: "#f0f0f0" }}>adaptive pillar weights</strong> like the backtest (rolling factor behavior). <strong style={{ color: "#f0f0f0" }}>RF rank blending</strong> applies at rebalance if .env is set. <strong style={{ color: "#f0f0f0" }}>RL</strong>, when enabled for a composite book and a trained agent is loaded, participates in that same rebalance step (exposure / count / sizing), not as a separate broker.
        </p>
        <p style={{ margin: 0, fontSize: 12, fontFamily: MONO, lineHeight: 1.65, color: "#f0f0f0" }}>
          APIs (for integrators): GET portfolio/history, POST init, POST rebalance, DELETE reset, PATCH config (e.g. rlAgent, rlOnlineLearning), GET rebalance-entry for standalone report pages.
        </p>
      </Section>

      <Section title="Q-learning reinforcement learning (RL Agent tab)">
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
          <li><strong style={{ color: "#f0f0f0" }}>What it is:</strong> a discrete-action Q-learning policy trained on synthetic rebalance episodes; the server persists weights in <strong style={{ color: "#f0f0f0" }}>rl-agent.json</strong> (gitignored — your machine only unless you copy it).</li>
          <li><strong style={{ color: "#f0f0f0" }}>Backtest:</strong> when that file loads at server start, composite backtests default to RL-on; pass <strong style={{ color: "#f0f0f0" }}>rlAgent=false</strong> to force pure rules. <strong style={{ color: "#f0f0f0" }}>rlRandomAgent=true</strong> is a diagnostic random-action mode.</li>
          <li><strong style={{ color: "#f0f0f0" }}>Paper:</strong> init can set <strong style={{ color: "#f0f0f0" }}>rlAgent</strong> / <strong style={{ color: "#f0f0f0" }}>rlOnlineLearning</strong>; you can change them later via PATCH. If RL is off or no agent is loaded, composite paper falls back to regime-based exposure rules where applicable.</li>
          <li><strong style={{ color: "#f0f0f0" }}>Online learning:</strong> set <strong style={{ color: "#f0f0f0" }}>RL_ONLINE_LEARNING=1</strong> in the environment or <strong style={{ color: "#f0f0f0" }}>rlOnlineLearning: true</strong> in paper config so the agent receives Q-updates from paper outcomes (reward uses portfolio vs benchmark and risk proxies).</li>
          <li><strong style={{ color: "#f0f0f0" }}>UI tools:</strong> Train / Policy / Compare on the RL Agent tab call the HTTP endpoints above; Compare runs two short backtests (baseline vs eval) to sanity-check the policy.</li>
        </ul>
      </Section>

      <Section title="Optional Python Random Forest (admin / .env)">
        <p style={{ margin: "0 0 10px" }}>
          The <strong style={{ color: "#f0f0f0" }}>tabular RF rank blend</strong> is <strong style={{ color: "#f0f0f0" }}>off by default</strong> and unrelated to Q-learning. To use it you need Python dependencies (see <strong style={{ color: "#f0f0f0" }}>README.md (ML layer section)</strong>), a trained model under <strong style={{ color: "#f0f0f0" }}>models/</strong>, and typically a virtualenv the server can invoke.
        </p>
        <ul style={{ margin: "0 0 10px", paddingLeft: 18, lineHeight: 2 }}>
          <li><strong style={{ color: "#f0f0f0" }}>ML_RANK_WEIGHT</strong> (0–1): blends the model into <strong style={{ color: "#f0f0f0" }}>composite ranking</strong> on paper rebalance and on composite <strong style={{ color: "#f0f0f0" }}>backtest</strong> rebalances. Higher values give more influence to the learned score. Requires a compatible trained RF pipeline.</li>
          <li><strong style={{ color: "#f0f0f0" }}>ML_COMPOSITE_ANALYSIS=1</strong>: for <strong style={{ color: "#f0f0f0" }}>single-ticker analysis</strong>, blends rules with the model’s structural / probability-style signal in the composite shown in Search. Response may include a small ML prediction payload when inference succeeds.</li>
          <li><strong style={{ color: "#f0f0f0" }}>PYTHON</strong>: optional path to the interpreter; otherwise the server prefers <strong style={{ color: "#f0f0f0" }}>.venv</strong> if present.</li>
        </ul>
        <p style={{ margin: 0, fontSize: 12, fontFamily: MONO, color: "#f0f0f0" }}>
          Copy <strong style={{ color: "#f0f0f0" }}>.env.example</strong> to <strong style={{ color: "#f0f0f0" }}>.env</strong> for variable names. RF inference adds latency (Python subprocess per batch) — backtests with the blend enabled run slower.
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
            This application is for learning and research. It shows how multi-factor rules, optional Random Forest rank blending, and optional Q-learning policies can be combined; it should <strong style={{ color: "#f0f0f0" }}>never</strong> be the sole basis for real investment decisions.
          </p>
          <p style={{ margin: "0 0 8px" }}>
            Past backtest or paper results do not predict future returns. Simplifications (fundamentals, DCF, costs, execution, and learned models fit to history) mean live outcomes would differ.
          </p>
          <p style={{ margin: 0 }}>
            Do your own due diligence, consult a licensed professional if you need advice, and only risk capital you can afford to lose. The authors accept no liability for decisions made using this tool.
          </p>
        </div>
      </Section>
    </div>
  );
}
