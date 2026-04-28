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
| `GET` | `/api/backtest/:universeId` | Walk-forward backtest (performance, equity curve, logs) |
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
