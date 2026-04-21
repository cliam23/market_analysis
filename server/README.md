# Server modules (`server/`)

This directory holds extracted modules from the historical `server.js` monolith. Imports use **ESM** (`import`/`export`); project root is `"type": "module"`.

## Conventions

- **Dependency direction**: `config/` → `utils/` → `data/` → `scoring/` → `backtest/` → `routes/`. Avoid circular imports.
- **Paths**: Use [`config/paths.js`](config/paths.js) for JSON files and caches relative to the repo root so moving files does not break on-disk portfolios.
- **RL agent**: `q-learning-agent.js` remains at the **repo root** so the Vite client (`RLTab.jsx`) can import encoding helpers without bundling Node-only code. Server code under `server/rl/` imports via `../../q-learning-agent.js`.

## Layout (incremental)

| Area | Location |
|------|-----------|
| Config / universes | `config/` |
| Yahoo parse + disk + earnings | `data/yahoo-parse.js`, `data/yahoo-disk-cache.js`, `data/earnings-fetch.js` |
| Backtest hedge helpers | `backtest/hedge.js` |
| Earnings momentum signals | `scoring/earnings-signals.js` |
| Analysis engine facade | `scoring/analysis-engine-facade.js` re-exports root `analysis-engine.js` |
| Paper / RL path constants | `paper-trade/paths.js`, `rl/paths.js` |
| Options | `options/index.js` re-exports root `options-service.js` |

## Entry

- **`server/index.js`** — currently `import '../server.js'` so `node server/index.js` behaves like `node server.js`. When `createApp()` exists, listen will move here and root `server.js` can become a one-line re-export.
- **`server.js`** (repo root) — main file that registers routes until routers are split.

## Verification

After each extraction step:

```bash
curl -sS "http://localhost:3001/api/backtest/sp500_top150?period=1y&rebalanceFreq=bimonthly&topN=15&strategy=full_composite&rlAgent=false&fresh=true" | jq '{cached, computedAt, return: .performance.totalReturn}'
```

### Frontend env (`VITE_API_BASE`)

The Vite app calls `/api/...` on the **dev server origin** (e.g. `localhost:5173`) and relies on the proxy to reach this Express process on port 3001. If you set **`VITE_API_BASE`** in `.env`, the client **skips** that proxy and fetches the given base URL instead—so it must match wherever `node server.js` is listening, or the Backtest tab will show numbers from a different backend.

### Backtest freshness

In-memory backtest **result** reuse requires `useResultCache=1` on the query string. Normal UI runs send `fresh=true` and always run a new simulation. Responses include **`computedAt`** (ISO) when the run finishes.
