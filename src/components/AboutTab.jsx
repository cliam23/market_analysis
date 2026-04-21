import { useState, useEffect, useCallback } from "react";
import { apiFetch, safeJson } from "../lib/api.js";

/** Must match PaperTradeTab. */
const PAPER_TRADE_NAV_UNIVERSE_KEY = "ma-paper-trade-nav-universe";
const RL_NAV_UNIVERSE_KEY = "ma-rl-nav-universe";

function ic(v) {
  return <code className="ma-about-code">{v}</code>;
}

function Strong({ children }) {
  return <strong className="ma-about-strong">{children}</strong>;
}

function DotList({ variant, children }) {
  return <ul className={`ma-about-dots ma-about-dots--${variant}`}>{children}</ul>;
}

function DotItem({ children }) {
  return (
    <li>
      <span className="ma-about-dots__mark" aria-hidden />
      {children}
    </li>
  );
}

function PillarCard({ name, weight, children }) {
  return (
    <div className="ma-about-pillar">
      <div className="ma-about-pillar__head">
        <span className="ma-about-pillar__name">{name}</span>
        <span className="ma-about-pillar__wt">{weight}</span>
      </div>
      <p className="ma-about-pillar__body">{children}</p>
    </div>
  );
}

function Accordion({ title, children, defaultOpen = false, idx = 0 }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="ma-about-acc" style={{ animationDelay: `${Math.min(idx, 12) * 40}ms` }}>
      <button
        type="button"
        className="ma-about-acc__btn"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ma-about-acc__chev" aria-hidden>
          ▸
        </span>
        <span className="ma-about-acc__title">{title}</span>
      </button>
      <div className={`ma-about-acc__panel ${open ? "ma-about-acc__panel--open" : ""}`} aria-hidden={!open}>
        <div className="ma-about-acc__overflow">
          <div className={`ma-about-acc__inner ${open ? "ma-about-acc__inner--visible" : ""}`}>
            <div className="ma-about-acc__divider" />
            <div className="ma-about-acc__body">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtK(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toLocaleString();
}

function StatusPill({ ok, labelOk, labelBad }) {
  return (
    <span className={`ma-about-mini-pill ${ok ? "ma-about-mini-pill--ok" : "ma-about-mini-pill--bad"}`}>
      <span className="ma-about-mini-pill__dot" />
      {ok ? labelOk : labelBad}
    </span>
  );
}

async function getJsonQuiet(path) {
  try {
    const res = await apiFetch(path);
    return await safeJson(res);
  } catch {
    return null;
  }
}

export default function AboutTab({ setTab, backendConnected = true }) {
  const [snap, setSnap] = useState({
    rl: null,
    p50: null,
    p150: null,
    opt: null
  });

  const refresh = useCallback(async () => {
    const [rl, p50, p150, opt] = await Promise.all([
      getJsonQuiet("/api/rl/status"),
      getJsonQuiet("/api/paper-trade/portfolio?universe=sp500_top50"),
      getJsonQuiet("/api/paper-trade/portfolio?universe=sp500_top150"),
      getJsonQuiet("/api/options/scan?universeId=sp500_top50")
    ]);
    setSnap({ rl, p50, p150, opt });
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  const totalStates = snap.rl?.totalStates ?? 1920;
  const a50 = snap.rl?.agents?.sp500_top50;
  const a150 = snap.rl?.agents?.sp500_top150;

  const goDashboard = () => setTab?.("dashboard");
  const goSearch = () => setTab?.("search");
  const goRl = (uid) => {
    try {
      sessionStorage.setItem(RL_NAV_UNIVERSE_KEY, uid);
    } catch {
      /* ignore */
    }
    setTab?.("rl");
  };
  const goPaper = (uid) => {
    try {
      sessionStorage.setItem(PAPER_TRADE_NAV_UNIVERSE_KEY, uid);
    } catch {
      /* ignore */
    }
    setTab?.("papertrade");
  };
  const goOptions = () => setTab?.("options");

  const scoringOk = Boolean(snap.rl) && backendConnected;

  function paperLines(pfJson) {
    if (!pfJson?.portfolio) {
      return { has: false, line1: "No portfolio", line2: "Initialize on Trading tab", rlOn: false, online: false };
    }
    const s = pfJson.portfolio.summary;
    const cfg = pfJson.portfolio.config;
    const n = s?.holdingsCount ?? 0;
    const v = s?.totalValue;
    const val = v != null ? `$${(v / 1000).toFixed(1)}K` : "—";
    const rlOn =
      cfg &&
      cfg.rlAgent !== false &&
      cfg.rlAgent !== "false" &&
      cfg.rlAgent !== "0" &&
      cfg.rlAgent !== 0;
    const online = Boolean(cfg?.rlOnlineLearning === true || cfg?.rlOnlineLearning === "true" || cfg?.rlOnlineLearning === "1");
    return {
      has: true,
      line1: `${n} positions · ${val}`,
      line2: `RL: ${rlOn ? "ON" : "OFF"} · Online: ${online ? "ON" : "OFF"}`,
      rlOn,
      online
    };
  }

  const pt50 = paperLines(snap.p50);
  const pt150 = paperLines(snap.p150);
  const optCount = snap.opt?.count;
  const optLive = snap.opt != null && Number.isFinite(Number(snap.opt.count));

  return (
    <div className="ma-about-page">
      <header className="ma-about-hero">
        <p className="ma-about-kicker">About</p>
        <h1 className="ma-about-h1">How everything works</h1>
        <p className="ma-about-lead">
          One scoring engine · Search, Backtest, Trading (paper), Options, and RL Agent · optional Python Random Forest rank blend and
          tabular Q-learning policies per universe.
        </p>
      </header>

      <div className="ma-about-layout">
        <div className="ma-about-docs">
          <Accordion title="Forward performance (how to read results)" defaultOpen idx={0}>
            <p className="ma-about-p">
              This system is optimized for <Strong>forward</Strong> expectations, not maximizing a single backtest number. Every backtest and
              paper stat is <Strong>past data</Strong>, including out-of-sample splits. The <Strong>forward estimate</Strong> and{" "}
              <Strong>forward confidence</Strong> blend sub-period stability, regime robustness, weight simplicity, and a discount when recent
              years look much stronger than the long run.
            </p>
            <DotList variant="green">
              <DotItem>Prefer durable factor weights over the peak-alpha corner of the grid.</DotItem>
              <DotItem>Discount periods where recent performance dominates long-run averages.</DotItem>
              <DotItem>Favor fewer active factors when weights look like overfit tinkering.</DotItem>
              <DotItem>Require economic rationale (why should the edge persist?), not only curve fit.</DotItem>
              <DotItem>
                <Strong>RL agent:</Strong> Q-learning is trained for both Top 50 and Top 150 universes (see{" "}
                {ic("rl-agent-top50.json")} / {ic("rl-agent-top150.json")}). Online learning can be enabled so the policy continues to adapt
                from live paper-trade outcomes.
              </DotItem>
            </DotList>
          </Accordion>

          <Accordion title="The big picture" defaultOpen idx={1}>
            <p className="ma-about-p">
              <Strong>Shared brain:</Strong> Search, Backtest, and Trading rely on the same analysis and ranking code paths (pillars →
              composite → sort). What changes is <em>how time works</em>: Search scores one ticker “now”; Backtest replays past rebalance
              dates; Paper starts from today and advances when you (or auto-rebalance) trigger a rebalance.
            </p>
            <p className="ma-about-p">
              <Strong>Optional extras:</Strong> a <Strong>Python Random Forest</Strong> can blend into ranks or single-ticker composite when
              you configure {ic(".env")} (separate from RL). <Strong>Q-learning</Strong> policies are trained in-app and saved per universe;
              they can steer composite <Strong>backtests</Strong> and composite <Strong>paper</Strong> rebalances when enabled — see the RL
              section below.
            </p>
            <p className="ma-about-p ma-about-p--note">
              <Strong>Running locally:</Strong> the UI talks to a <Strong>Node server</Strong> that loads prices and fundamentals, scores
              tickers, runs backtests, and stores paper portfolios. From the project folder, use {ic("npm run dev:all")} so the API and Vite run
              together. If you see “Backend not connected,” the server is not running or the proxy cannot reach it.
            </p>
            <p className="ma-about-p">
              <Strong>Data path:</Strong> quotes, history, and financials are fetched from <Strong>Yahoo Finance</Strong> (via yahoo-finance2).
              Nothing in the browser calls Yahoo directly; the server is the only place that pulls market data.
            </p>
          </Accordion>

          <Accordion title="The 5-pillar ranking model" defaultOpen idx={2}>
            <p className="ma-about-p">
              Full Composite and related modes blend these pillars (illustrative default weights for <Strong>Full Composite</Strong>; aggressive
              and turbo shift emphasis toward momentum and relax gates):
            </p>
            <div className="ma-about-pillar-grid">
              <PillarCard name="FUNDAMENTAL" weight="35%">
                Buffett-style quality, moat, ROIC spread, earnings quality, shareholder yield, growth constraints, and an AI disruption
                signal — summarized as one fundamental pillar.
              </PillarCard>
              <PillarCard name="DCF" weight="10%">
                Simplified discounted cash flow: project free cash flow with fading growth, discount with a beta-derived WACC, add terminal
                value, compare intrinsic value per share to price. Underweight or zero in more aggressive presets.
              </PillarCard>
              <PillarCard name="DYNAMIC VALUATION" weight="15%">
                Price-based valuation signals (e.g. vs long moving averages, trend quality) with adjustments so strong businesses are not
                always punished for rich multiples.
              </PillarCard>
              <PillarCard name="MOMENTUM" weight="25%">
                Multi-month risk-adjusted momentum plus trend bonus. Composite variants may blend raw momentum with a “momentum quality” tilt
                (weighting depends on strategy).
              </PillarCard>
              <PillarCard name="PRICE VALUE" weight="15%">
                Entry and pullback quality: distance from highs, moving-average structure, multi-horizon strength — favors constructive setups
                within a trend.
              </PillarCard>
            </div>
            <p className="ma-about-mono-note">
              Default Full Composite ≈ Fundamental 35% + DCF 10% + Dynamic valuation 15% + Momentum 25% + Price value 15%, before any
              optional ML blend. Aggressive / Turbo use different weight vectors and different filter strictness in simulation.
            </p>

            <div className="ma-about-subsection">
              <h3 className="ma-about-h3">DCF methodology (inside the DCF pillar)</h3>
              <p className="ma-about-p">
                The server runs a <Strong>10-year</Strong> free-cash-flow discount model, then maps implied upside into the 0–100 DCF pillar
                score:
              </p>
              <ol className="ma-about-ol">
                <li>
                  <Strong>Starting FCF:</Strong> from reported free cash flow (with fallbacks when lines are missing).
                </li>
                <li>
                  <Strong>Growth:</Strong> two phases with fading growth rates by year (revenue/earnings caps for very large companies apply).
                  Long-run <Strong>terminal growth</Strong> is about <Strong>2.5%</Strong> nominal.
                </li>
                <li>
                  <Strong>WACC:</Strong> blended cost of capital — <Strong>cost of equity</Strong> uses a 4.3% risk-free rate, a 5.5% equity risk
                  premium, and a beta shrunk toward 1; <Strong>after-tax cost of debt</Strong> steps with leverage; result is nudged for very
                  high FCF margins / strong balance sheets and then <Strong>clamped between ~6% and 15%</Strong>.
                </li>
                <li>
                  <Strong>Enterprise vs equity:</Strong> discounted cash flows plus terminal value, adjusted for <Strong>net cash</Strong> (cash
                  minus debt), divided by shares for implied value per share.
                </li>
                <li>
                  <Strong>Score:</Strong> how far market price sits below or above that implied value, compressed to the 0–100 pillar range.
                </li>
              </ol>
              <p className="ma-about-mono-note">Still a single-scenario toy model — use it as one pillar among five, not a precision intrinsic value.</p>
            </div>
          </Accordion>

          <Accordion title="How scoring fits together" idx={3}>
            <p className="ma-about-p">
              <Strong>Core idea:</Strong> each eligible stock gets sub-scores (fundamental quality, DCF gap, dynamic valuation, momentum,
              price/value entry), mapped to roughly 0–100. They combine into a <Strong>composite</Strong> using weights that depend on the
              strategy (conservative full composite vs aggressive vs turbo). Backtest and paper trade use the same underlying analysis code paths
              so results are comparable.
            </p>
            <p className="ma-about-p">
              <Strong>Optional Python Random Forest:</Strong> if you train the Random Forest and set environment variables (see{" "}
              {ic("README.md")} ML section), the server can blend that model into composite <Strong>ranking</Strong> for paper rebalance and
              composite <Strong>backtests</Strong>, and optionally into the <Strong>single-ticker analysis</Strong> composite in Search. With RF
              off, everything stays rules-based and pillar-by-pillar inspectable. <Strong>Q-learning</Strong> (
              {ic("rl-agent-top50.json")} / {ic("rl-agent-top150.json")}) is a separate knob and does not replace the RF variables — see the RL
              section.
            </p>
            <DotList variant="blue">
              <DotItem>
                <Strong>ML_RANK_WEIGHT</Strong> (0–1): blends the model into composite ranking on paper and composite backtest rebalances.
              </DotItem>
              <DotItem>
                <Strong>ML_COMPOSITE_ANALYSIS=1</Strong>: for single-ticker analysis, blends rules with the model signal in Search when inference
                succeeds.
              </DotItem>
              <DotItem>
                <Strong>PYTHON</Strong>: optional interpreter path; otherwise the server prefers {ic(".venv")} if present.
              </DotItem>
            </DotList>
            <p className="ma-about-mono-note">
              Copy {ic(".env.example")} to {ic(".env")} for variable names. RF inference adds latency (Python subprocess per batch) — backtests
              with the blend enabled run slower.
            </p>
          </Accordion>

          <Accordion title="Backtest mechanics (what the curve really is)" idx={4}>
            <DotList variant="gray">
              <DotItem>
                <Strong>Universe:</Strong> a fixed list of tickers (e.g. top names by market cap slice, or theme lists like Mag 7). Only symbols
                with enough history participate in ranking each period.
              </DotItem>
              <DotItem>
                <Strong>Rebalance:</Strong> on schedule (monthly, weekly, etc.), the model re-ranks and may rotate holdings. Monthly mode is
                anchored around mid-month; other frequencies step through calendar time from the start of your chosen period.
              </DotItem>
              <DotItem>
                <Strong>Benchmark:</Strong> when possible, the chart compares you to an <Strong>equal-weight</Strong> version of the same universe;
                if data is insufficient, the server falls back to SPY and labels that clearly in the UI.
              </DotItem>
              <DotItem>
                <Strong>Stops and regime:</Strong> composite-style runs can cut positions on adverse moves (volatility-aware trailing stops) and
                scale exposure by market regime. Sharp single-day steps on the equity curve are often stops or clusters of exits — check the trade
                log (STOP vs rebalance).
              </DotItem>
              <DotItem>
                <Strong>Fundamentals in time:</Strong> the backtest uses fundamentals loaded for the run as a slow-moving snapshot (no lookahead
                within the sim). That matches a conservative research assumption; it is not the same as true point-in-time fundamentals for every
                historical date.
              </DotItem>
            </DotList>
            <p className="ma-about-p">
              For composite strategies, an RL toggle runs the trained Q-agent when a policy file is loaded unless you force rules-only (
              {ic("rlAgent=false")} in the request). {ic("rlRandomAgent=true")} is a diagnostic random-action mode.
            </p>
          </Accordion>

          <Accordion title="Paper trading vs backtest (detail)" idx={5}>
            <p className="ma-about-p">
              <Strong>Backtest</Strong> replays history: you pick start/end, rebalance frequency, and the server simulates the whole period in one
              run. <Strong>Paper</Strong> is stateful: one portfolio on disk per universe, advancing only when you POST a rebalance (or when
              auto-rebalance fires). You always see current holdings, cash, next due date, and cumulative performance vs SPY (and capture stats when
              available).
            </p>
            <p className="ma-about-p">
              Composite paper runs can use <Strong>adaptive pillar weights</Strong> like the backtest (rolling factor behavior).{" "}
              <Strong>RF rank blending</Strong> applies at rebalance if {ic(".env")} is set. <Strong>RL</Strong>, when enabled for a composite book
              and a trained agent is loaded, participates in that same rebalance step (exposure / count / sizing), not as a separate broker.
            </p>
            <p className="ma-about-mono-note">
              APIs (for integrators): GET portfolio/history, POST init, POST rebalance, DELETE reset, PATCH config (e.g. {ic("rlAgent")},{" "}
              {ic("rlOnlineLearning")}), GET rebalance-entry for standalone report pages.
            </p>
          </Accordion>

          <Accordion title="Q-learning reinforcement learning (RL Agent tab)" idx={6}>
            <DotList variant="green">
              <DotItem>
                <Strong>What it is:</Strong> a discrete-action Q-learning policy trained on synthetic rebalance episodes; the server persists
                weights in per-universe files such as {ic("rl-agent-top50.json")} and {ic("rl-agent-top150.json")} (gitignored — your machine only
                unless you copy them).
              </DotItem>
              <DotItem>
                <Strong>Backtest:</Strong> when those files load at server start, composite backtests can use RL-on; pass {ic("rlAgent=false")} to
                force pure rules. {ic("rlRandomAgent=true")} is a diagnostic random-action mode.
              </DotItem>
              <DotItem>
                <Strong>Paper:</Strong> init can set {ic("rlAgent")} / {ic("rlOnlineLearning")}; you can change them later via PATCH. If RL is off
                or no agent is loaded for that universe, composite paper falls back to regime-based exposure rules where applicable.
              </DotItem>
              <DotItem>
                <Strong>Online learning:</Strong> set {ic("RL_ONLINE_LEARNING=1")} in the environment or {ic("rlOnlineLearning: true")} in paper
                config so the agent receives Q-updates from paper outcomes (reward uses portfolio vs benchmark and risk proxies).
              </DotItem>
              <DotItem>
                <Strong>UI tools:</Strong> Train / Policy / Compare on the RL Agent tab call the HTTP endpoints; Compare runs two short backtests
                (baseline vs eval) to sanity-check the policy.
              </DotItem>
            </DotList>
          </Accordion>

          <Accordion title="Filters and safeguards" idx={7}>
            <p className="ma-about-p">Composite strategies apply eligibility rules before ranking (exact thresholds vary by strategy):</p>
            <DotList variant="gray">
              <DotItem>
                <Strong>Fundamental floor:</Strong> very weak fundamental scores are dropped in standard full composite; aggressive modes relax
                this; turbo largely minimizes quality gates for experimentation.
              </DotItem>
              <DotItem>
                <Strong>Balance sheet / growth constraints:</Strong> severe flags can exclude names.
              </DotItem>
              <DotItem>
                <Strong>Volatility cap:</Strong> extremely high realized vol can exclude speculative names in stricter modes.
              </DotItem>
              <DotItem>
                <Strong>Trend / value interaction:</Strong> deep downtrends with poor value can be filtered in stricter profiles.
              </DotItem>
              <DotItem>
                <Strong>History length:</Strong> enough trading days are required so momentum and volatility are meaningful.
              </DotItem>
            </DotList>
          </Accordion>

          <Accordion title="Data sources and limitations" idx={8}>
            <p className="ma-about-p">
              <Strong>Market data:</Strong> Yahoo Finance. Corporate actions are reflected in adjusted prices where the upstream series provides
              them.
            </p>
            <p className="ma-about-p">
              <Strong>Inflation / cash baseline (backtest):</Strong> when U.S. CPI series can be loaded from FRED, the equity chart can show a
              purchasing-power baseline for cash; otherwise a simple assumed rate may be documented in the UI. This does not change strategy
              returns — it is a reference curve.
            </p>
            <p className="ma-about-p">
              <Strong>Options:</Strong> chains and screening use Tradier when configured; the Options tab labels live vs delayed or mock mode in
              the UI.
            </p>
            <DotList variant="gray">
              <DotItem>Historical fundamentals for every past date are not fully replicated; long backtests lean on a stable fundamental snapshot for the run.</DotItem>
              <DotItem>Smaller or non-U.S. tickers may have gaps or odd fields in Yahoo’s payload.</DotItem>
              <DotItem>No slippage, commissions, taxes, or borrow costs in simulation or paper mode.</DotItem>
              <DotItem>Paper trade uses discrete rebalance pricing, not full intraday execution simulation.</DotItem>
            </DotList>
          </Accordion>

          <Accordion title="Disclaimer" idx={9}>
            <div className="ma-about-disclaimer">
              <p className="ma-about-disclaimer__title">Educational tool — not financial advice</p>
              <p>
                This application is for learning and research. It shows how multi-factor rules, optional Random Forest rank blending, and optional
                Q-learning policies can be combined; it should <Strong>never</Strong> be the sole basis for real investment decisions.
              </p>
              <p>
                Past backtest or paper results do not predict future returns. Simplifications (fundamentals, DCF, costs, execution, and learned
                models fit to history) mean live outcomes would differ.
              </p>
              <p className="ma-about-p--last">
                Do your own due diligence, consult a licensed professional if you need advice, and only risk capital you can afford to lose. The
                authors accept no liability for decisions made using this tool.
              </p>
            </div>
          </Accordion>
        </div>

        <aside className="ma-about-sidebar">
          <div className="ma-about-sidebar__head">
            <p className="ma-about-sidebar__kicker">System status</p>
            <p className="ma-about-sidebar__sub">Live snapshot · refreshes every 30s</p>
          </div>
          <div className="ma-about-sidebar__scroll">
            <button type="button" className="ma-about-mini-card ma-about-mini-card--click" onClick={goDashboard}>
              <div className="ma-about-mini-card__title">Scoring engine</div>
              <StatusPill ok={scoringOk} labelOk="Active" labelBad="Offline" />
              <p className="ma-about-mini-card__mono">5 pillars · adaptive strategy presets</p>
              <p className="ma-about-mini-card__mono ma-about-mini-card__mono--dim">Anchors · F35 / D10 / DV15 / M25 / PV15 (Full Composite)</p>
            </button>

            <button type="button" className="ma-about-mini-card ma-about-mini-card--click" onClick={() => goRl("sp500_top50")}>
              <div className="ma-about-mini-card__title">Q-learning (Top 50)</div>
              <StatusPill ok={Boolean(a50?.loaded)} labelOk="Trained" labelBad="No agent" />
              <p className="ma-about-mini-card__mono">
                {a50?.loaded
                  ? `${a50.statesVisited?.toLocaleString() ?? "—"} / ${totalStates.toLocaleString()} states · ${fmtK(a50.totalUpdates)} upd`
                  : "Policy not loaded"}
              </p>
              <p className="ma-about-mini-card__file">{a50?.agentFile ?? "—"}</p>
            </button>

            <button type="button" className="ma-about-mini-card ma-about-mini-card--click" onClick={() => goRl("sp500_top150")}>
              <div className="ma-about-mini-card__title">Q-learning (Top 150)</div>
              <StatusPill ok={Boolean(a150?.loaded)} labelOk="Trained" labelBad="No agent" />
              <p className="ma-about-mini-card__mono">
                {a150?.loaded
                  ? `${a150.statesVisited?.toLocaleString() ?? "—"} / ${totalStates.toLocaleString()} states · ${fmtK(a150.totalUpdates)} upd`
                  : "Policy not loaded"}
              </p>
              <p className="ma-about-mini-card__file">{a150?.agentFile ?? "—"}</p>
            </button>

            <button type="button" className="ma-about-mini-card ma-about-mini-card--click" onClick={() => goPaper("sp500_top50")}>
              <div className="ma-about-mini-card__title">Paper trade (Top 50)</div>
              <p className="ma-about-mini-card__mono">{pt50.line1}</p>
              <p className="ma-about-mini-card__mono ma-about-mini-card__mono--dim">{pt50.line2}</p>
            </button>

            <button type="button" className="ma-about-mini-card ma-about-mini-card--click" onClick={() => goPaper("sp500_top150")}>
              <div className="ma-about-mini-card__title">Paper trade (Top 150)</div>
              <p className="ma-about-mini-card__mono">{pt150.line1}</p>
              <p className="ma-about-mini-card__mono ma-about-mini-card__mono--dim">{pt150.line2}</p>
            </button>

            <button type="button" className="ma-about-mini-card ma-about-mini-card--click" onClick={goOptions}>
              <div className="ma-about-mini-card__title">Options scanner</div>
              <StatusPill ok={optLive} labelOk="Live" labelBad="Unavailable" />
              <p className="ma-about-mini-card__mono">{optLive ? `${optCount ?? 0} opportunities` : "Could not load scan"}</p>
            </button>

            <div className="ma-about-mini-card ma-about-mini-card--static">
              <div className="ma-about-mini-card__title">Data sources</div>
              <p className="ma-about-mini-card__mono">Yahoo Finance (prices)</p>
              <p className="ma-about-mini-card__mono">Tradier (options, when configured)</p>
              <p className="ma-about-mini-card__mono">FRED (CPI baseline)</p>
            </div>

            <button type="button" className="ma-about-mini-card ma-about-mini-card--click ma-about-mini-card--ghost" onClick={goSearch}>
              Open Search
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
