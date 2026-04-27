# `server/` package

Supporting modules extracted from the historical **`server.js`** monolith (config, Yahoo helpers, scoring glue, paths).

**Setup, clone-from-git instructions, scripts, ML, RL, and troubleshooting:** see the **[root README](../README.md)**.

### Conventions

- Import order / layering: **`config/`** → **`utils/`** → **`data/`** → **`scoring/`** → **`backtest/`** → routes (avoid cycles).
- Resolve repo-root files via **`config/paths.js`** (paper portfolios, RL paths, caches).
- **`q-learning-agent.js`** remains at the **repository root** so shared state/action encoding stays one source of truth for server + client.

### Entry

- **`server/index.js`** — wires to the main Express app in **`../server.js`** until `createApp()` fully moves here.

### Verification & advanced docs

One-line API smoke test, golden-bar workflows, dashboard snapshots, and **`docs/DATA_CONTRACTS.md`** are summarized under **Architecture notes** in the root README.
