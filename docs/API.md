# HTTP API reference

Base URL (local): `http://localhost:3001`  
All routes are served by **`server.js`** unless noted. Query parameters vary by route; many accept `period`, `rebalanceFreq`, `topN`, `strategy`, `rlAgent`, etc.

---

## Health

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Liveness / readiness |

---

## Quotes, universe, scan

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/quote/:ticker` | Quote summary for one ticker |
| `GET` | `/api/universe/:universeId` | Universe membership |
| `GET` | `/api/momentum/:universeId` | Momentum ranking / scores |
| `GET` | `/api/scan/:universeId` | Universe scan |

---

## Analysis & valuation

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/analysis/:ticker` | Full analysis pipeline (composite, factors, narrative) |
| `GET` | `/api/dcf/:ticker` | DCF view |
| `GET` | `/api/comps/:ticker` | Comparables |
| `POST` | `/api/analysis/:ticker/network-input` | Store user network-effect input |
| `GET` | `/api/analysis/:ticker/network-input` | Read stored network input |

---

## Backtest

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/backtest/:universeId` | Walk-forward backtest (performance, equity curve, logs). On the Vercel-only deploy, only a fixed matrix of configs is available — see below. |
| `GET` | `/api/backtest/diagnostic/:universeId` | Compact diagnostic row |

---

## Reinforcement learning

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/rl/test` | RL connectivity / smoke |
| `GET` | `/api/rl/status` | Agent file, coverage, metadata |
| `GET` | `/api/rl/policy` | Greedy policy per visited state (`verbose` optional) |
| `GET` | `/api/rl/oracle` | Constant-action oracle vs trained greedy (`period`, `universeId`, …) |
| `GET` | `/api/rl/compare` | Rules baseline vs RL eval |
| `POST` | `/api/rl/train` | Train tabular Q or DQN (`agentType`, `gamma`, weights, …) |
| `POST` | `/api/rl/hyperparameter-sweep` | Batch training configs |

---

## Diagnostics (Alpha Lab)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/diagnostics/factors/:universeId` | Factor diagnostics |
| `GET` | `/api/diagnostics/universe-compare` | Multi-universe comparison |
| `GET` | `/api/diagnostics/hedge-impact` | Hedging stats |
| `GET` | `/api/diagnostics/equity-curves/:universeId` | Equity series |
| `GET` | `/api/diagnostics/earnings/:ticker` | Earnings-related diagnostic |
| `POST` | `/api/diagnostics/forward-confidence` | Forward-looking confidence |
| `POST` | `/api/diagnostics/forward-weight-recommendation` | Weight suggestion |
| `POST` | `/api/diagnostics/weight-sweep` | Long-running weight sweep |

---

## Dashboard & optimization

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/market/indices` | Index snapshot |
| `GET` | `/api/dashboard/summary` | Dashboard bundle |
| `GET` | `/api/scores` | Public composite-score + RL-decision snapshot (`?ticker=` optional). Served from `public/data/scores-snapshot.json`, refreshed on a schedule by `scripts/generate-scores-snapshot.mjs`. On Vercel this is a standalone serverless function (`api/scores.js`) — no `server.js` process required; locally `server.js` serves the identical route from the same file. See [README § Live deployment](../README.md#live-deployment--data-pipeline). |

On the Vercel-only deploy, `GET /api/dashboard/summary`, `GET /api/market/indices`, `GET /api/paper-trade/portfolio`, `GET /api/paper-trade/history`, `GET /api/paper-trade/preview`, and `GET /api/rl/status` (all `?universe=` where applicable) are also served — by `api/dashboard/summary.js`, `api/market/indices.js`, and two catch-all functions, `api/paper-trade/[...path].js` (portfolio/history/preview) and `api/rl/[...path].js` (status/compare/policy, dispatching on the first path segment) — as a **read-only mirror** of the same routes above, replaying whatever `scripts/generate-scores-snapshot.mjs` last captured (`publicMirror: true`, `mirroredAt` in the response). The catch-all shape (rather than one file per route) keeps the deployment under Vercel Hobby's 12-serverless-function limit. Every other route in this document, and all non-GET methods on these, require `server.js` running (locally, Railway, Docker, …).

`GET /api/backtest/:universeId` is mirrored too (`api/backtest/[universeId].js`), but only for a **fixed matrix**: `universeId` ∈ {`sp500_top50`, `sp500_top150`} × `period` ∈ {`3y`, `5y`} × `rlAgent` ∈ {`true`, `false`}, always `rebalanceFreq=quarterly&topN=15&strategy=full_composite` (the Backtest tab's own defaults for everything except universe/period/strategy — see `scripts/lib/backtest-mirror.mjs`). A request matching that matrix gets the real captured response verbatim (equity curve, rebalance log, everything); anything else gets a 404 explaining only that matrix is available.

`GET /api/analysis/:ticker`, `GET /api/dcf/:ticker`, and `GET /api/comps/:ticker` are also mirrored (`api/analysis/[ticker].js`, `api/dcf/[ticker].js`, `api/comps/[ticker].js`), for every ticker in `sp500_top150` (a superset of `sp500_top50` — see `scripts/lib/analysis-mirror.mjs`). Search, and the DCF/Comps sub-tabs, work for real on any of those ~150 tickers; a ticker outside that list gets a 404 naming it explicitly.

Alpha Lab's diagnostics are mirrored too, for a **fixed combo** — `universeId` ∈ {`sp500_top50`, `sp500_top150`} × `period = 3y` (see `scripts/lib/diagnostics-mirror.mjs`): `GET /api/diagnostics/universe-compare`, `GET /api/diagnostics/factors/:universeId`, `GET /api/diagnostics/hedge-impact`, `GET /api/diagnostics/equity-curves/:universeId`, `GET /api/diagnostics/forward-confidence` (the real route is `POST`; the mirror is GET-only and always reflects the paper portfolio's actual current weights — there's no way to submit custom weights on a read-only deploy anyway), `GET /api/rl/compare` (fixed at `period=3y&topN=15&strategy=full_composite&rebalanceFreq=bimonthly`), and `GET /api/rl/policy`. The Alpha Lab period selector narrows to `3y` only in lite mode so every request lands on a mirrored combo.

`POST /api/diagnostics/forward-weight-recommendation` and `POST /api/diagnostics/weight-sweep` (both weight-sweep-shaped, genuinely expensive to mirror), `POST /api/rl/train`, and the `/api/options/*` and `/api/wheel/*` routes (live chains, mutable paper positions) are **not** mirrored. `src/hooks/useBackendMode.js` detects the deploy at runtime and the corresponding tabs, sections, and buttons (Options nav item, Wheel sub-tab, RL Train card, Retrain/weight-sweep/weight-rec buttons, every paper-trade mutating action) are **removed from the page entirely** in lite mode rather than shown disabled — they render normally, fully functional, wherever `server.js` is actually running (local dev, Railway, Docker, …).

Every function in `api/` is GET/HEAD-only — `requireGet()` in `scripts/lib/read-mirror.mjs` rejects any other method with `405` before the handler body runs, and none of them import `writeFileSync` or touch mutable state. There is no route anywhere under `api/` that writes to anything, on Vercel's filesystem or otherwise.
| `POST` | `/api/optimization/reset` | Optimization state reset |
| `POST` | `/api/optimization/freeze` | Freeze optimization |
| `GET` | `/api/optimization/status` | Optimization status |

---

## Paper trading

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/paper-trade/init` | Create empty portfolio |
| `DELETE` | `/api/paper-trade/reset` | Reset portfolio |
| `PATCH` | `/api/paper-trade/config` | Update strategy, universe, weights, RL flags, … |
| `POST` | `/api/paper-trade/snapshot` | Persist snapshot |
| `GET` | `/api/paper-trade/portfolio` | Current portfolio + NAV |
| `POST` | `/api/paper-trade/rebalance` | Run rebalance |
| `GET` | `/api/paper-trade/preview` | Preview rebalance |
| `GET` | `/api/paper-trade/schedule` | Schedule hints |
| `GET` | `/api/paper-trade/history` | History |
| `GET` | `/api/paper-trade/rebalance-entry` | Entry for standalone report |

---

## Options

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/options/scan` | Scanner |
| `GET` | `/api/options/chain/:ticker` | Options chain |
| `POST` | `/api/options/paper/open` | Open paper leg |
| `POST` | `/api/options/paper/close` | Close paper leg |
| `POST` | `/api/options/paper/delete` | Delete paper leg |
| `GET` | `/api/options/paper/portfolio` | Paper options book |

---

## Architecture (high level)

```
Browser (Vite SPA, port 5173)
    → proxy /api → Express (server.js, port 3001)
          → analysis-engine.js (scoring, composite, rankers)
          → runBacktestSimulation (walk-forward sim)
          → Yahoo / FRED / optional ml/predict.py
          → JSON portfolios & RL agents on disk (gitignored)
```

See **[README.md](../README.md)** for layout, **[SECURITY.md](./SECURITY.md)** for deployment hardening, **[DATA_CONTRACTS.md](./DATA_CONTRACTS.md)** for data shapes and gold layers.
