# Market Analysis

Local-first web app for equity research, **multi-factor composite ranking**, **walk-forward backtests**, optional **paper trading**, optional **ML-blended ranking** (Python), optional **RL overlays** (tabular Q-learning or DQN), and an **options scanner** with a small paper-options book. The UI is a React (Vite) SPA; the API and simulations run on Node (Express). Market data is primarily from **Yahoo Finance**.

---

## Prerequisites

- **Node.js 18+** (20+ or 22 LTS recommended). ES modules, `fetch`, `structuredClone`.
- **npm**

Optional:

- **Python 3** + project **`.venv`** for ML paths — see **[ML layer](#ml-layer-random-forest--rnn)** below.
- **`FRED_API_KEY`** in **`.env`** for official U.S. CPI in backtests (server falls back if unset).

---

## Quick start

```bash
git clone <repository-url>
cd "Market Analysis"
npm install
cp .env.example .env   # if present; edit for FRED, ML, RL, ports
npm run dev:all
```

| Service | URL | Notes |
|--------|-----|--------|
| **Frontend (Vite)** | [http://localhost:5173](http://localhost:5173) | Proxies `/api/*` → backend (`VITE_API_TARGET`, default `http://localhost:3001`) |
| **Backend (Express)** | [http://localhost:3001](http://localhost:3001) | JSON API; CORS enabled |

Stop with **Ctrl+C**. The API process resolves paths like **`./paper-portfolio.json`** relative to its **current working directory** — run **`node server.js`** from the project root.

---

## npm scripts

| Script | Description |
|--------|-------------|
| **`npm run dev:all`** | Vite + Express (main workflow); frees port 3001 then starts server |
| **`npm run dev`** | Vite only — start API separately |
| **`npm run server`** | `node server.js` only |
| **`npm run server:free`** | Kill listener on API port (macOS/Linux helper) |
| **`npm run build`** | Production bundle → **`dist/`** |
| **`npm run preview`** | Serves **`dist/`** (Vite preview; can proxy `/api` like dev) |
| **`npm run analyze`** / **`pull`** / **`oos-adaptive`** | CLI utilities — see **`package.json`** |

---

## Environment variables (overview)

Copy **`.env.example`** → **`.env`** when available. Commonly used:

| Variable | Purpose |
|----------|---------|
| **`PORT`** | API port (default **3001**) |
| **`FRED_API_KEY`** | CPI series for backtest inflation handling |
| **`VITE_API_TARGET`** | Vite dev/proxy target for `/api` |
| **`VITE_API_BASE`** | Optional absolute API origin for built UI (see **`src/lib/api.js`**) |
| **`RL_ENABLED`** | Set to **`true`** / **`1`** to allow default RL evaluation in backtest/paper when a trained agent exists; if unset, defaults favor **rules-only** (explicit `rlAgent=true` on backtest can still request the agent) |
| **`RL_AGENT_TYPE`** | **`qlearning`** (default; per-universe **`rl-agent-top50.json`** / **`rl-agent-top150.json`** or legacy **`rl-agent.json`**) or **`dqn`** (**`dqn-agent.json`**) |

Many more toggles (adaptive weights, ML weight, trailing stops, RL training) are documented in **`.env.example`** when present.

---

## Repository layout — what each group of files does

### Root — application core

| Files / area | Role |
|--------------|------|
| **`server.js`** | Express app: routes (`/api/...`), Yahoo + FRED, backtest engine, paper trade engine, RL train/eval, options, caching, portfolio JSON persistence. Main orchestration file. |
| **`analysis-engine.js`** | Stock-analysis heuristics (moats, peers, comps, DCF-related inputs), **rules composite** (`calcCompositeRules` / `calcComposite`), and **backtest-style ranking** (e.g. `bt_rankFullCompositeV2`, momentum/value pipelines). Feeds single-ticker UI and universe ranking for backtests/paper. |
| **`adaptiveWeights.js`** | Rolling / adaptive composite weights (IC-style updates, optional ridge, conservative regime blend). Used when paper/backtest **`adaptiveMode`** is not **`fixed`** and enough history exists. |
| **`q-learning-agent.js`** | Tabular **Q-learning** agent: state/action encoding, Q-table, serialize/deserialize to **`rl-agent.json`**. |
| **`dqn-agent.js`** | **DQN** agent (TensorFlow.js): training/inference hooks; weights saved to **`dqn-agent.json`**. |
| **`options-service.js`** | Options chain / IV helpers and paper-order building blocks for the options API layer. |

### Frontend — `src/`

| Area | Role |
|------|------|
| **`src/App.jsx`**, **`src/main.jsx`** | App shell, tab routing, backend health check, optional standalone paper report URL mode. |
| **`src/components/Sidebar.jsx`** | Navigation: Search, Backtest, Trading (paper), Alpha Lab, Options, RL Agent, About. |
| **`src/components/SearchView.jsx`**, **`AnalysisDetail.jsx`** | Ticker search → loads **`/api/analysis/:ticker`**, DCF, comps, network-input POST. |
| **`src/components/BacktestTab.jsx`** | Backtest UI → **`GET /api/backtest/:universeId`** with query params (period, strategy, **`rlAgent`**, etc.). |
| **`src/components/PaperTradeTab.jsx`**, **`PaperRebalanceStandalone.jsx`**, **`PaperRebalanceReportBody.jsx`** | Paper portfolio UI and rebalance report → **`/api/paper-trade/*`**. |
| **`src/components/AlphaLabTab.jsx`**, **`AlphaLabEquityCurves.jsx`** | Diagnostics: universe compare, factors, hedging, weight sweep, equity curves — **`/api/diagnostics/*`**. |
| **`src/components/RLTab.jsx`** | RL status, train, policy, compare → **`/api/rl/*`**. |
| **`src/components/OptionsTab.jsx`** | Options scan + paper options book → **`/api/options/*`**. |
| **`src/components/DCFTab.jsx`**, **`CompsTab.jsx`**, **`AboutTab.jsx`**, **`shared.jsx`** | Feature tabs and shared UI primitives. |
| **`src/lib/api.js`** | **`apiFetch` / `apiUrl`** — single place for API base (`VITE_API_BASE` for split deploys). |
| **`src/lib/theme.js`**, **`education.js`** | Styling and copy. |
| **`src/hooks/useAbortableApi.js`** | Abort in-flight fetches when filters change. |
| **`vite.config.js`** | Dev server + **`/api`** proxy; preview can share the same proxy. |

### Machine learning — `ml/`

Python training/inference (Random Forest, RNN, validation). Node invokes **`predict.py`** when ML blending is enabled. Setup and commands are in **[ML layer](#ml-layer-random-forest--rnn)** below.

### Scripts — `scripts/`

| File | Role |
|------|------|
| **`free-api-port.mjs`** | Frees TCP port before **`dev:all`** (non-Windows). |
| **`oos_adaptive_replay.mjs`** | Out-of-sample adaptive-weight replay experiments (`npm run oos-adaptive`). |

### CLI / utilities (repo root)

| File | Role |
|------|------|
| **`analyze.js`**, **`pull-data.js`** | Batch/offline analysis or data pull helpers. |
| **`rl-test-harness.js`** | RL regression / test harness against the API or agent files (optional). |

### Build output

| Path | Role |
|------|------|
| **`dist/`** | Vite production build (generated; not source of truth). |

### Runtime JSON (gitignored / local)

| File | Role |
|------|------|
| **`paper-portfolio.json`** | Paper trade state: **`config`**, **`cash`**, **`holdings`** (not `positions`), **`navHistory`**, **`rebalanceHistory`**, etc. |
| **`options-portfolio.json`** | Paper options positions. |
| **`dqn-agent.json`**, **`rl-agent.json`**, **`rl-agent-top50.json`**, **`rl-agent-top150.json`** | Trained RL policies (DQN global; tabular Q per universe or legacy single file). |
| **`.cache/`** | Yahoo, earnings, and other caches. |

---

## ML layer (Random Forest + RNN)

Uses **Python** (`scikit-learn`, **PyTorch**) alongside the Node server. Training is **offline**; the server runs **`ml/predict.py`** when **`ML_RANK_WEIGHT`** (0–1) is set for **paper rebalance** and **backtest simulation** (composite strategies only), or **`portfolio.config.mlRankWeight`** for paper.

### ML setup

```bash
cd "/path/to/Market Analysis"
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r ml/requirements.txt
```

### Train models (writes to `models/`)

```bash
python3 ml/train_rf.py
python3 ml/train_rnn.py
```

- Without `data/ml_panel.csv`, `train_rf.py` fits a **synthetic** panel (smoke test only). For real use, add a CSV with **all** columns in `ml/features_schema.json` plus a label column: **`label_pos_20d`** (0/1), or **`forward_return_20d`** (signed; label = positive), or **`forward_annualized_return`** (legacy; label = positive).
- Without `data/ml_sequences.npz`, `train_rnn.py` uses **synthetic** sequences.

### ML inference

Node runs `ml/predict.py` with JSON stdin `{ "features": [[...]], "sequences": [[60 log-returns], ...] }`.

- **Interpreter:** If **`PYTHON`** is unset, the server uses **`.venv/bin/python3`** (macOS/Linux) or **`.venv\Scripts\python.exe`** (Windows) when that path exists—so `npm run server` picks up your venv without activating it in the shell.
- **Blend weight:** Set **`ML_RANK_WEIGHT`** (0–1) in `.env` — affects **Backtest** and **Paper trade** composite re-ranking (one Python call per simulated/live rebalance; slower backtests). `0` = rules-only. Paper init **`mlRankWeight`** overrides env for paper only; backtest always uses env.
- **Ticker analysis hybrid composite:** Set **`ML_COMPOSITE_ANALYSIS=1`** in `.env` to blend **`calcComposite`** with RF **P(up 20d)** (requires trained `models/rf_regressor.joblib`). Response includes **`mlAnalysisPredict`** when inference succeeds.

### ML validation (time-series OOS)

```bash
python3 ml/validate_model.py
```

Writes **`models/validation_metrics.json`** using **`TimeSeriesSplit`** (no shuffle). Optional **`train_rf.py --pca K`** for PCA whitening before the forest.

### ML API surface

- **Paper rebalance** (`POST /api/paper-trade/rebalance`): blends ML `mlScore` with `compositeScore` when weight > 0 and models exist.
- **Ticker analysis** (`GET /api/analysis/:ticker`): includes `mlFeatures` `{ names, vector }` when the composite is built via `calcComposite` (not the short backtest-style composite path).

There is no separate `POST /api/rebalance`; paper trading uses **`/api/paper-trade/rebalance`**.

---

## Logic run-through — how the system works end-to-end

### 1. Request path (browser → API)

The UI uses relative **`/api/...`** calls. In development, **Vite** proxies **`/api`** to **`VITE_API_TARGET`**. The Express app handles JSON, CORS, timeouts, and logging.

### 2. Single-ticker analysis (Search tab)

1. User enters a ticker → **`GET /api/analysis/:ticker`**.
2. Server loads Yahoo quotes, fundamentals, and runs pipelines that call **`analysis-engine.js`**: moat, checklist, earnings quality, shareholder yield, timing, **composite** (rules and/or hybrid ML when env allows).
3. **`GET /api/dcf/:ticker`** and **`GET /api/comps/:ticker`** power DCF and comps subviews.
4. Optional **`POST /api/analysis/:ticker/network-input`** stores a user “network effect” score used in the narrative.

### 3. Composite ranking (shared brain for backtest + paper)

For universe strategies (**full_composite** and variants), the server:

1. Loads **price history** (and **point-in-time fundamentals** when applicable) for each rebalance date.
2. Calls **`bt_rankFullCompositeV2`** (or sibling rankers) in **`analysis-engine.js`**, which combines pillars (momentum, value, quality, valuation, DCF, **earnings momentum**, etc.) using **configurable weights** and **redistribution** when a pillar is missing.
3. Produces a **sorted list of tickers** with factor scores — the same conceptual ranking feeds **backtest simulation** and **live paper rebalance**.

### 4. Backtest (Backtest tab)

1. **`GET /api/backtest/:universeId`** with query params (period, rebalance frequency, **`topN`**, strategy, weights, **`rlAgent`**, etc.).
2. Server steps through time: at each rebalance, **re-ranks**, applies **position rules** (exposure, regime, score floors, sizing: equal / inv vol / score / blends), optionally **ML blend** (Python) when enabled, optionally **RL policy** when loaded and allowed by **`RL_ENABLED`** / query flags.
3. Tracks portfolio vs benchmark, caches results in memory (**versioned** cache keys so logic changes don’t silently reuse stale runs).
4. Returns performance stats, series, and trade lists for the UI.

### 5. Paper trading (Trading tab)

1. **`POST /api/paper-trade/init`** creates **`paper-portfolio.json`** via **`createEmptyPortfolio`** (empty **`holdings`**, **`cash`** = capital).
2. **`PATCH /api/paper-trade/config`** updates strategy, universe, weights, **`rlAgent`**, **`rebalanceFreq`**, etc.
3. **`POST /api/paper-trade/rebalance`** runs **`paperRebalanceExecute`**: fetch prices/fundamentals, rank universe (same family as backtest), apply **regime** (may change effective **top N** and **exposure**), optional **RL** adjustments when enabled, sell names that drop out (subject to min-hold and filters), buy into targets with chosen **position sizing**, append **`rebalanceHistory`**, update **`takeNavSnapshot`**.
4. **`GET /api/paper-trade/portfolio`** marks holdings to market and returns enriched **`holdings`**, weights, NAV history, schedule hints.

### 6. Reinforcement learning (RL Agent tab + env)

1. **`POST /api/rl/train`** runs training episodes, updates **DQN** or **tabular Q** weights, writes **`dqn-agent.json`** or the appropriate **`rl-agent*.json`** (including per-universe top50/top150 paths), refreshes in-memory agent.
2. At inference, state features encode regime and portfolio context; the agent chooses discrete **actions** (exposure, position count, sizing mode, etc.) that **constrain or override** parts of the rules pipeline when **`RL_ENABLED`** and config allow.
3. **`GET /api/rl/compare`**, **`GET /api/rl/policy`**, **`GET /api/rl/status`** expose diagnostics for the UI.

**Important:** If composite scoring changes materially, **retrain** RL; the README’s **`RL_ENABLED`** gate avoids silently using a stale policy.

### 7. Alpha Lab (diagnostics)

Read-heavy routes under **`/api/diagnostics/*`**: multi-universe comparison, factor subperiods, hedge impact, long-running **weight sweep** POST, equity curves — used to study robustness separate from the main trading UI.

### 8. Options

1. **`GET /api/options/scan`** runs the scanner (filters, regime context — see **`options-service.js`** + server).
2. Paper legs use **`GET/POST /api/options/paper/*`**; state in **`options-portfolio.json`**.

### 9. ML (optional)

When **`ML_RANK_WEIGHT`** or paper **`mlRankWeight`** is set and models exist, the server may call **`ml/predict.py`** to blend ML scores into composite ranks during backtest/paper. Ticker-level hybrid analysis may use **`ML_COMPOSITE_ANALYSIS`**. See **[ML layer](#ml-layer-random-forest--rnn)** above.

---

## Production-style run

```bash
npm run build
npm run server
# Serve dist/ behind nginx/Caddy, or npm run preview — point /api to Node or set VITE_API_BASE at build time
```

---

## Troubleshooting

- **API unreachable** — Run **`npm run dev:all`** or **`npm run server`**; ensure **`PORT`** is free.
- **Backtests slow or errors** — Check logs for **`[Yahoo]`**; long runs need patience and network.
- **RL not used** — Confirm **`RL_ENABLED=true`** if you want default RL-on behavior; confirm the right agent file exists (**`dqn-agent.json`** vs tabular **`rl-agent-*.json`**) and **`RL_AGENT_TYPE`** matches.
- **Paper trade odd state** — Ensure **`paper-portfolio.json`** uses **`holdings`** (not only `positions`), numeric **`cash`**, and init via API or match **`createEmptyPortfolio`** shape.

---

## License / visibility

Private project (`"private": true` in `package.json`). Adjust if you open-source.

---

## Third-party README files

`node_modules/` and any vendored repos under the tree ship hundreds of small **README** files from npm and upstream authors. They are not maintained here; **do not delete them** (you would break installs or forks). For this project, **`README.md` at the repo root** is the single maintained overview.
