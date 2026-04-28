# Market Analysis

Local-first equity research app: **multi-factor composite ranking**, **walk-forward backtests**, optional **paper trading**, optional **ML blending** (Python), optional **RL overlays** (tabular Q-learning or DQN), and an **options scanner**.  
**Frontend:** React (Vite). **Backend:** Node (Express). Data mainly from **Yahoo Finance**.

---

## Run from Git (any computer)

Works on **Windows**, **macOS**, and **Linux** once [Node.js](https://nodejs.org/) **18+** (20 LTS recommended) and **npm** are installed.

```bash
git clone https://github.com/cliam23/market_analysis.git
cd market_analysis
npm install
cp .env.example .env
```

Edit **`.env`** as needed (see [Environment](#environment)). Then start **UI + API** together:

```bash
npm run dev:all
```

| Where | URL |
|--------|-----|
| Web app (Vite) | [http://localhost:5173](http://localhost:5173) |
| JSON API | [http://localhost:3001](http://localhost:3001) |

Stop with **Ctrl+C**.

**Working directory:** Always run `npm run …` and `node server.js` from the **repository root** so paths like `./paper-portfolio*.json`, caches, and `server/config/paths.js` resolve correctly.

**Windows:** Prefer PowerShell or Git Bash; commands above are the same.

**Backend only:** `npm run server` — then open the UI with `npm run dev` in another terminal, or build the SPA (`npm run build`) and use `npm run preview` / a static host with API proxy.

---

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm run dev:all` | **Recommended:** Vite + Express (frees API port then starts server) |
| `npm run dev` | Frontend only — start API separately |
| `npm run server` | API only (`node server.js`) |
| `npm run server:free` | Free TCP port used by API (helper; macOS/Linux) |
| `npm run build` | Production bundle → `dist/` |
| `npm run preview` | Serve `dist/` (configure API base for split deploys) |
| `npm run analyze` / `pull` / `oos-adaptive` | CLI utilities — see `package.json` |

---

## Environment

Copy **`.env.example`** → **`.env`**. Common variables:

| Variable | Role |
|----------|------|
| `PORT` | API port (default **3001**) |
| `VITE_API_TARGET` | Where Vite proxies `/api` in dev (default `http://localhost:3001`) |
| `VITE_API_BASE` | Optional absolute API URL for **built** UI (split hosting) |
| `FRED_API_KEY` | U.S. CPI for backtest inflation; server degrades gracefully if unset |
| `RL_ENABLED` | `true`/`1` to prefer RL when a trained agent exists |
| `RL_AGENT_TYPE` | `qlearning` (default; `rl-agent-top50.json` / `rl-agent-top150.json`) or `dqn` (`dqn-agent.json`) |

More toggles are documented in **`.env.example`**.

---

## What’s in the repo (short)

| Area | Role |
|------|------|
| `server.js` | Express: `/api/*`, Yahoo/FRED, backtest, paper trade, RL train/eval, options |
| `analysis-engine.js` | Scoring, comps/DCF inputs, **composite** + **backtest rankers** |
| `adaptiveWeights.js` | Rolling IC-style composite weights when not `fixed` |
| `q-learning-agent.js` / `dqn-agent.js` | RL agents + serialization to `rl-agent*.json` / `dqn-agent.json` |
| `src/` | React UI (Backtest, Paper, Alpha Lab, RL, Options, …) |
| `ml/` | Python RF/RNN training; Node calls `ml/predict.py` when ML blending is on |
| `server/` | Extracted modules (config, data, scoring) — see [server/README.md](server/README.md) |

Runtime JSON (paper portfolios, trained agents, `.cache/`) is mostly **gitignored** — see `.gitignore`.

---

## Documentation

| Doc | Contents |
|-----|----------|
| **[docs/API.md](docs/API.md)** | HTTP routes (`/api/*`) grouped by area |
| **[docs/SECURITY.md](docs/SECURITY.md)** | Threat model, spawn/M L, auth, secrets |
| **[docs/DATA_CONTRACTS.md](docs/DATA_CONTRACTS.md)** | Data shapes, gold layer, verification |

---

## ML (optional)

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r ml/requirements.txt
```

Train (writes under `models/`): `python3 ml/train_rf.py`, `python3 ml/train_rnn.py`.  
Blend weight for backtest/paper: **`ML_RANK_WEIGHT`** in `.env` (0–1). Node uses `.venv/bin/python3` automatically when present.

---

## RL (optional)

Train via **`POST /api/rl/train`** (body: `universeId`, `period`, `episodes`, `strategy`, weights, optional **`gamma`** for reward tuning).  
Diagnostics: **`GET /api/rl/status`**, **`/api/rl/policy`**, **`/api/rl/compare`**, **`GET /api/rl/oracle`** (constant-policy oracle vs full greedy policy).

---

## Presentation data export

With the API running on port **3001**:

```bash
bash extract-presentation-data.sh
```

Writes **`presentation-data.json`** (~3–4 minutes; oracle runs 48 backtests). Requires **`jq`** installed.

---

## Architecture notes (`server/`)

- Dependency direction: `config/` → `utils/` → `data/` → `scoring/` → `backtest/` — avoid circular imports.
- Use **`server/config/paths.js`** for repo-root-relative JSON and caches.
- **`q-learning-agent.js`** stays at **repo root** so the client can share encoding helpers without pulling Node-only code into odd bundles.
- **`server/index.js`** re-exports the main app from root `server.js`.

**Smoke check** (after `npm run server`):

```bash
curl -sS "http://localhost:3001/api/backtest/sp500_top150?period=1y&rebalanceFreq=bimonthly&topN=15&strategy=full_composite&rlAgent=false&fresh=true" | jq '{cached, computedAt, return: .performance.totalReturn}'
```

Backtests: UI typically sends **`fresh=true`**. Cached reuse needs **`useResultCache=1`**. Golden / gold-bar workflows: **`docs/DATA_CONTRACTS.md`**, `npm run verify:golden`, `npm run warm:gold`.

---

## Production-style run

```bash
npm run build
npm run server
# Serve `dist/` behind a reverse proxy; set `VITE_API_BASE` at build time if API is on another origin.
```

---

## Troubleshooting

| Issue | What to try |
|--------|-------------|
| Blank API / CORS | Run API on `PORT`; ensure Vite proxy target matches (`VITE_API_TARGET`). |
| Yahoo / slow backtests | Network and rate limits; retry; check server logs for `[Yahoo]`. |
| RL ignored | Set `RL_ENABLED=true`; ensure matching agent file exists and `RL_AGENT_TYPE` is correct. |
| Paper portfolio errors | Holdings live under **`holdings`** (not only `positions`); init via **`POST /api/paper-trade/init`**. |

---

## License

Private project (`"private": true` in `package.json`).

---

## Other README files

Third-party **`README`** files under `node_modules/` come from npm packages — do not edit or delete them. **This file** is the maintained project overview.
