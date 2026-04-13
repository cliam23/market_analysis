# Market Analysis

Local-first web app for equity research, composite ranking, **walk-forward backtests**, optional **paper trading**, and a **Q-learning (tabular RL)** layer on composite strategies. The UI is a React (Vite) SPA; the API and simulations run on a Node (Express) server.

## Prerequisites

- **Node.js 18+** (20 LTS recommended). The stack uses native `fetch`, ES modules, and `structuredClone` in newer paths.
- **npm** (ships with Node).

Optional:

- **Python 3** with a project `.venv` if you use ML prediction paths (`ml/predict.py` / `ml/predict_worker.py` and joblib models under `models/`).
- **FRED API key** for official U.S. CPI in backtests (`FRED_API_KEY` in `.env`). Without it, the server uses a simple inflation fallback (documented in API responses).

## Quick start (any machine)

```bash
git clone <repository-url>
cd "Market Analysis"
npm install
cp .env.example .env
# Edit .env if you want FRED CPI, ML toggles, or a non-default API URL (see below).
npm run dev:all
```

Then open the app in a browser:

| Service | URL | Notes |
|--------|-----|--------|
| **Frontend (Vite)** | [http://localhost:5173](http://localhost:5173) | Proxies `/api/*` to the backend |
| **Backend (Express)** | [http://localhost:3001](http://localhost:3001) | JSON API; CORS enabled for local dev |

**`npm run dev:all`** runs **Vite** and **`node server.js`** together (via `concurrently`). Stop with `Ctrl+C` in that terminal.

### Environment variables

Copy **`.env.example`** → **`.env`**. Real secrets stay in `.env` (gitignored).

Commonly useful:

| Variable | Purpose |
|----------|---------|
| `PORT` | API port (default **3001**) |
| `FRED_API_KEY` | Official CPI series for backtest inflation baseline |
| `VITE_API_TARGET` | Where Vite proxies `/api` (default **http://localhost:3001**) if the API runs on another host/port |

Many other toggles (adaptive weights debug, ML ranking, trailing stops, RL train logs) are documented in **`.env.example`**.

## npm scripts

| Script | Command | Description |
|--------|---------|-------------|
| **Full dev** | `npm run dev:all` | Vite (5173) + Express API (3001) — main workflow |
| UI only | `npm run dev` | Vite dev server only (API must run separately) |
| API only | `npm run server` | `node server.js` only |
| Production UI build | `npm run build` | Output in `dist/` |
| Preview build | `npm run preview` | Serves `dist/` (configure API target if not proxied) |
| Other | `npm run analyze` / `pull` / `oos-adaptive` | CLI utilities (see `package.json`) |

## How the project is wired

1. **Frontend** (`src/`) — React tabs: search, single-ticker analysis, **backtest**, **paper trade**, **RL** (training/status), about/help.
2. **Backend** (`server.js`) — Express app: Yahoo Finance (prices, fundamentals, PIT where used), FRED CPI, composite ranking, **backtest cache**, **paper portfolio** (`paper-portfolio.json`), **RL agent file** (`rl-agent.json`), ML hooks to Python when enabled.
3. **Shared logic** — `analysis-engine.js`, `adaptiveWeights.js`, `q-learning-agent.js` (RL state/action space and Q-table serialize/deserialize).

API routes are under **`/api/...`** (examples: `/api/backtest/:universeId`, `/api/paper-trade/*`, `/api/rl/train`, `/api/rl/status`). The Vite dev server proxies **`/api`** to the backend so the browser only talks to **5173** during development.

## Local data files (not in git)

These are created at runtime and listed in **`.gitignore`**:

- **`paper-portfolio.json`** — paper trading state (holdings, rebalances, config).
- **`rl-agent.json`** — trained Q-learning agent (large).
- **`rl-test-report.json`** — written when you run the RL test harness (`/api/rl/test` or `node rl-test-harness.js`).
- **`rl-train-*.json`**, **`rl-agent.backup*.json`** — training logs / backups (optional).
- **`.cache/`** — Yahoo and other caches.

New clones start without them; the UI explains how to init paper trading and how RL loads when the file exists. **You do not need any of these files to run `npm run dev:all`** — only optional features (RL eval, paper trade persistence) expect them after you create them locally.

## Production-style run

```bash
npm run build
npm run server
# Serve dist/ with any static host, or use `npm run preview` after build.
```

Point `VITE_API_TARGET` (at build time) or your reverse proxy so the built UI can reach the API.

## Troubleshooting

- **Blank API / network errors** — Ensure **`npm run server`** is running (or `dev:all`) and port **3001** is free.
- **Backtests hang** — Yahoo calls use timeouts; check server logs for `[Yahoo]` lines. Very long backtests also use extended HTTP timeouts on the backtest route.
- **RL “not loaded”** — Train or place **`rl-agent.json`** in the project root (same directory as `server.js`), then restart the server so it reloads the file.

## License / contribution

Private project (`"private": true` in `package.json`). Adjust this section if you open-source or add a license file.
