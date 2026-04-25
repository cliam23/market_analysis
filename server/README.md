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

### Data quality and golden parity

- Responses include **`dataQuality`** (bar fetch sources, validation warnings) when running a full backtest.
- **Local gold bars** (optional, faster repeat runs): set `DATA_GOLD_LAYER=1`, populate with `npm run warm:gold` (see [docs/DATA_CONTRACTS.md](../docs/DATA_CONTRACTS.md)).
- **Golden check** (after capturing a baseline once with the API server running):

```bash
node scripts/verify-golden.mjs --capture   # writes scripts/golden-baseline.json
npm run verify:golden                     # fails if KPIs drift beyond tolerance
```

See [docs/DATA_CONTRACTS.md](../docs/DATA_CONTRACTS.md) for schemas, env flags, and the deferred “second free source” note.

### Dashboard / Alpha Lab — local snapshots (fast repeat loads)

**Dashboard** (`GET /api/market/indices`, `GET /api/dashboard/summary`) can serve last-written JSON from `data/local-snapshots/` when:

- `LOCAL_UI_SNAPSHOTS=1`
- Snapshot file exists and is newer than `LOCAL_UI_SNAPSHOT_MAX_AGE_MS` (default 5 minutes)

Populate or refresh snapshots (API must be up):

```bash
npm run snapshot:ui
# or: BACKTEST_GOLDEN_BASE=http://127.0.0.1:3001 npm run snapshot:ui
```

Auto-save snapshots after each live response (optional):

```bash
export LOCAL_UI_SNAPSHOT_WRITE=1
```

Bypass snapshot reads (force live Yahoo + paper files): `GET /api/market/indices?_t=1` or `?fresh=true`.

**Alpha Lab** heavy diagnostics (`/api/diagnostics/*`) already use **in-memory TTL caching** on the server; they are not written to `data/local-snapshots/` by default. Use the same **`DATA_GOLD_LAYER=1`** + `npm run warm:gold` so chart-heavy paths hit local gold bars faster when diagnostics run simulations.
