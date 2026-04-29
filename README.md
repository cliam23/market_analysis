# Market Analysis

A local-first equity-research workbench: multi-factor composite ranking, walk-forward backtests, paper trading, an options scanner / wheel manager, and optional ML and reinforcement-learning overlays.

> Single repo, two processes: a **React + Vite** SPA on `:5173` talking to an **Express** JSON API on `:3001`. Data comes mostly from public Yahoo Finance with optional FRED, Tradier sandbox, and Anthropic / Alpha Vantage hooks.

---

## Highlights

- **Composite ranking** — momentum, value, fundamental, earnings momentum, DCF, and valuation pillars with rolling-IC adaptive weights.
- **Walk-forward backtests** — universes (S&P 500 top 50 / 150, Magnificent 7, Aristocrats), rebalance cadences, regime tagging, factor attribution, monthly heatmaps.
- **Paper trading** — Top 50 / Top 150 portfolios, RL overlay, wheel manager (covered calls + cash-secured puts), full trade history.
- **Options scanner & auto-trader** — academic sell edge (G&S, C&H, B&K), EV / IV-rank / Δ filters, scoring, optional Tradier sandbox execution.
- **Optional ML** — Python random forest / RNN models for rank blending or alpha prediction.
- **Optional RL** — tabular Q-learning or DQN agent that learns a sizing/exposure policy from rebalance histories.

---

## Quick start

### Prerequisites

| Tool | Version | Why |
|------|---------|-----|
| **Node.js** | 20 LTS (or 18.x) | Server + Vite |
| **npm**     | 9+              | Package manager |
| **Python**  | 3.11+ *(optional)* | ML training / blending |
| **jq**      | any *(optional)* | `extract-presentation-data.sh` |

The repo also ships with `.nvmrc` for `nvm`.

### Clone and run

```bash
git clone https://github.com/cliam23/market_analysis.git
cd market_analysis
npm install
cp .env.example .env        # leave it empty for mock data, or fill in keys
npm run dev:all
```

| Service | URL |
|---------|-----|
| Web app (Vite) | http://localhost:5173 |
| JSON API       | http://localhost:3001 |

Stop with **Ctrl+C**. The very first paint can take a few seconds while Yahoo warms its cache.

> **Working directory matters.** Always run scripts from the repo root — paths in `server/config/paths.js` resolve there.

### Backend only / frontend only

```bash
npm run server   # API on :3001 only
npm run dev      # SPA on :5173 only (expects API somewhere)
```

### Production-style local run

```bash
npm run build    # outputs to dist/
npm run server   # serves dist/ from Express + /api routes
```

---

## npm scripts

| Script | What it does |
|--------|--------------|
| `npm run dev:all`        | Recommended: free `:3001`, start API + Vite together |
| `npm run dev`            | Vite only |
| `npm run server`         | API only (`node server.js`) |
| `npm run server:free`    | Helper to free `$PORT` (macOS / Linux) |
| `npm run build`          | Production SPA bundle into `dist/` |
| `npm run preview`        | Vite preview of `dist/` |
| `npm run analyze`        | One-off CLI ranker (`analyze.js`) |
| `npm run pull`           | Yahoo data pull helper |
| `npm run oos-adaptive`   | OOS replay of adaptive composite weights |
| `npm run train-qlearn-both` | Train Q-learning agents for top50 + top150 |
| `npm run verify:golden`  | Golden snapshot replay |
| `npm run warm:gold`      | Warm `data/gold/` bars |
| `npm run snapshot:ui`    | Snapshot dashboard / API responses |

---

## Configuration

All variables live in **`.env`** (gitignored). Copy from `.env.example` and fill in only what you need — the app boots with mock data when keys are absent.

### Core

| Variable | Purpose |
|----------|---------|
| `NODE_ENV`   | `development` or `production` |
| `PORT`       | API port (default `3001`) |
| `DATA_DIR`   | Persistent volume for runtime JSON (e.g. Railway or Docker: `/data`) |
| `FRONTEND_URL` | CORS origin for split-deployed UI |
| `VITE_API_TARGET` | Vite dev-server proxy target (default `http://localhost:3001`) |
| `VITE_API_BASE`   | Absolute API URL baked into a built SPA |

### Optional data providers

| Variable | Provider | Free? |
|----------|----------|-------|
| `FRED_API_KEY` | [FRED](https://fred.stlouisfed.org) — U.S. macro / CPI | yes |
| `FINNHUB_API_KEY` | [Finnhub](https://finnhub.io) — congressional trade disclosures (STOCK Act); refreshed weekly; app degrades gracefully if absent | yes |
| `TRADIER_SANDBOX_TOKEN` + `TRADIER_ACCOUNT_ID` | [Tradier](https://documentation.tradier.com/sandbox) — real options chains | sandbox is free |
| `VITE_AV_KEY` | [Alpha Vantage](https://www.alphavantage.co) — quote fallback | free tier |
| `VITE_ANTHROPIC_API_KEY` | Anthropic — only if you wire LLM helpers | paid |

If none are set, options chains use a deterministic mock generator and CPI is treated as flat — backtests still run.

### Optional ML, RL, diagnostics

See **`.env.example`** for the full list of toggles (`ML_RANK_WEIGHT`, `RL_ENABLED`, `RL_AGENT_TYPE`, `ROLLING_IC_PERIODS`, `TRAILING_STOP_ENABLED`, plus a handful of debug-log switches).

---

## Repository layout

```
.
├─ src/                      # React UI (Vite)
│  ├─ App.jsx, main.jsx
│  ├─ components/            # Dashboard, Search, Backtest, PaperTrade, Wheel, Options, RL, About, …
│  ├─ assets/                # Bundled JSON fixtures
│  └─ lib/, utils/           # API client, formatters, education content
├─ server/                   # Modular server (config, data, scoring, paper-trade, options, RL, routes)
│  ├─ index.js               # Re-exports app from root server.js
│  └─ README.md
├─ server.js                 # Top-level Express app (legacy single-file entry)
├─ analysis-engine.js        # Pillar scoring, comps/DCF inputs, backtest rankers
├─ adaptiveWeights.js        # Rolling-IC adaptive composite weights
├─ q-learning-agent.js       # Tabular Q-learning agent (shared client/server)
├─ dqn-agent.js              # DQN agent (Node, optional tfjs-node)
├─ options-service.js        # Options chain fetch (Tradier / mock)
├─ options-auto-trader.js    # Scanner + auto-trader loop
├─ wheel-portfolio-service.js# Covered-call / CSP wheel manager
├─ pull-data.js, analyze.js  # CLI utilities
├─ scripts/                  # OOS replay, golden snapshots, qlearning trainer, etc.
├─ ml/                       # Python: train_rf*, train_rnn, predict workers
├─ models/                   # Trained sklearn / pytorch artifacts (joblib / pt)
├─ data/                     # gold/ bars, local-snapshots/  (both gitignored)
├─ docs/                     # API.md, DATA_CONTRACTS.md, SECURITY.md, slide PDF
├─ graphify-out/             # Knowledge-graph reports for the codebase
├─ Dockerfile, .dockerignore
├─ railway.json, vercel.json
└─ README.md
```

### Tracked runtime / seed JSON

These live at the repo root so the app boots with sensible state on a fresh persistent volume. They are *seed data*, not secrets — you can wipe them or move them to `$DATA_DIR` at any time.

- `paper-portfolio.json`, `paper-portfolio-top50.json`, `paper-portfolio-top150.json`
- `wheel-portfolio.json`, `options-portfolio.json`, `options-auto-portfolio.json`
- `rl-agent-top50.json`, `rl-agent-top150.json` (Q-learning)

Anything else (DQN, training reports, sweep outputs, caches, presentation export) is gitignored and regenerated on demand.

---

## How it runs locally (architecture)

```
 Browser (Vite :5173)
        │
        │  GET/POST /api/*
        ▼
 Express (Node :3001, server.js)
   ├─ analysis-engine.js   ← composite ranker
   ├─ adaptiveWeights.js   ← rolling-IC weights
   ├─ q-learning-agent.js  ← RL overlay (optional)
   ├─ options-* / wheel-*  ← options + wheel
   ├─ server/data, server/scoring, server/backtest …
   └─ ml/predict_worker.py ← spawned only if ML_* flags set
        │
        ▼ on disk
   .cache/yahoo, .cache/earnings   ← Yahoo / earnings caches
   data/gold/bars                  ← normalized daily bars (optional)
   *-portfolio*.json, rl-agent-*.json, dqn-*.json (state)
```

Dependency direction inside `server/`: `config → utils → data → scoring → backtest`. Use `server/config/paths.js` for repo-root-relative file resolution; do not hard-code paths.

---

## UI tour

| Tab | Purpose |
|-----|---------|
| **Dashboard** *(default)* | Indices, regime + system status, adaptive weight bar, performance tiles, signal feed, factor pulse, paper positions, movers |
| **Search**       | Single-ticker composite + pillar detail |
| **Backtest**     | Walk-forward simulation vs benchmark with regime tagging |
| **Paper Trade**  | Top 50 / Top 150 portfolios, holdings (with Congress signal column), rebalance, RL toggle, wheel layer |
| **Options**      | Portfolio KPIs, strategy backtest, auto-trader, scanner (G&S, C&H, B&K), manual + auto positions, full close-reason history |
| **RL Agent**     | Train and compare Q-learning or DQN |
| **About**        | In-app docs (pillars, paper vs backtest, RL, options & wheel, data limits) |

The first paint opens **Dashboard**; selecting a ticker from the search panel switches to **Search**.

---

## Optional: Python ML

```bash
python3 -m venv .venv
source .venv/bin/activate         # Windows: .venv\Scripts\activate
pip install -r ml/requirements.txt

python3 ml/train_rf.py            # writes models/rf_regressor.joblib + metrics
python3 ml/train_rnn.py           # writes models/rnn.pt + config
```

Then enable blending via `ML_RANK_WEIGHT`, `ML_ALPHA_RANKING`, `ML_COMPOSITE_ANALYSIS`, or `ML_COMPOSITE_CLUSTER` in `.env`. Node automatically uses `.venv/bin/python3` when present.

## Optional: RL overlay

Train via the **`POST /api/rl/train`** route (body: `universeId`, `period`, `episodes`, `strategy`, optional `gamma`). Diagnose with `GET /api/rl/status`, `/api/rl/policy`, `/api/rl/compare`, `/api/rl/oracle`. Set `RL_ENABLED=true` to actually use a trained agent, and `RL_AGENT_TYPE=qlearning|dqn` to pick the file.

## Presentation snapshot

With the API running on `:3001`:

```bash
bash extract-presentation-data.sh   # ~3–4 minutes, requires jq
```

Writes a self-contained `presentation-data.json` (gitignored).

---

## Documentation

- [`docs/API.md`](docs/API.md) — HTTP routes by area.
- [`docs/DATA_CONTRACTS.md`](docs/DATA_CONTRACTS.md) — data shapes, gold layer, verification.
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model, ML spawning, secrets handling.
- [`server/README.md`](server/README.md) — module breakdown.

A smoke check after starting the server:

```bash
curl -sS "http://localhost:3001/api/backtest/sp500_top150?period=1y&rebalanceFreq=bimonthly&topN=15&strategy=full_composite&rlAgent=false&fresh=true" \
  | jq '{cached, computedAt, return: .performance.totalReturn}'
```

---

## Deployment

The repo includes config for common split-deploy setups (Railway API + Vercel UI) plus plain Docker — or roll your own. **Always set `DATA_DIR`** to a persistent volume so portfolio / RL state survives restarts.

### Railway (Nixpacks, persistent volume)

`railway.json` uses the Nixpacks builder, runs `node server.js`, and points the health check at `/health`. Add a Railway volume mounted at `/data` and set `DATA_DIR=/data`.

### Vercel (frontend only, split deploy)

`vercel.json` builds the SPA (`npm run build`, `dist/`) and rewrites all routes to `index.html`. Point `VITE_API_BASE` at your API host (e.g. Railway) and add the same domain to `FRONTEND_URL` on the API side for CORS.

### Docker

```bash
docker build -t market-analysis .
docker run --rm -p 3001:3001 \
  -e DATA_DIR=/data -v market_data:/data \
  --env-file .env market-analysis
```

---

## Security & data notes

- **Never commit `.env`.** `.gitignore` covers `.env`, `.env.local`, `.env.production`.
- The repo contains **no real credentials**; verified against tracked files and full git history before publication.
- Tradier sandbox tokens are *paper money only* — there are no production order paths.
- Yahoo data is best-effort. Backtest results are simulations, not investment advice.

See `docs/SECURITY.md` for spawn boundaries, ML subprocess surface, and audit notes.

---

## Troubleshooting

| Symptom | Try |
|---------|-----|
| Blank API / CORS errors | API on `PORT`, Vite proxy at `VITE_API_TARGET`, or set `FRONTEND_URL` for split deploys |
| Slow / failing Yahoo backtests | Network or rate limits; retry, check `[Yahoo]` server logs, warm `data/gold/` |
| RL toggle does nothing | `RL_ENABLED=true` **and** the matching `rl-agent-top*.json` / `dqn-agent.json` exists for `RL_AGENT_TYPE` |
| Paper portfolio errors | Init via `POST /api/paper-trade/init`; holdings live under `holdings`, not `positions` |
| Options chains look fake | Without `TRADIER_SANDBOX_TOKEN` the server uses a deterministic mock by design |

---

## Contributing

This is a personal research project published for visibility. Issues and small PRs (typos, docs, obvious bugs) are welcome; please open an issue for anything bigger so we can sanity-check the direction first.

## License

Released as source-available for educational and research use. Not investment advice. See `package.json` for `"private": true` (no npm publishing) and treat any data, signals, or agent outputs as illustrative.
