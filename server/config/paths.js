/**
 * All filesystem paths relative to repository root (same as legacy server.js __dirname).
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.join(__dirname, '..', '..');

// ── Persistent data directory ────────────────────────────────────────────────
// Locally: files stay in project root (DATA_DIR unset)
// Railway: set DATA_DIR=/data (mounted persistent volume)
const DATA_DIR = process.env.DATA_DIR
  ? String(process.env.DATA_DIR).replace(/\/?$/, '/')
  : null;

export function dataPath(filename) {
  const name = String(filename || '').replace(/^\/+/, '');
  if (!name) throw new Error('dataPath requires filename');
  return DATA_DIR ? path.join(DATA_DIR, name) : path.join(REPO_ROOT, name);
}

export const OPTIONS_PORTFOLIO_PATH = dataPath('options-portfolio.json');
export const RL_AGENT_JSON_PATH = dataPath('rl-agent.json');
export const RL_AGENT_TOP50_PATH = dataPath('rl-agent-top50.json');
export const RL_AGENT_TOP150_PATH = dataPath('rl-agent-top150.json');
export const DQN_AGENT_JSON_PATH = dataPath('dqn-agent.json');
export const DQN_AGENT_BEST_JSON_PATH = dataPath('dqn-agent-best.json');

export const ML_PREDICT_SCRIPT = path.join(REPO_ROOT, 'ml', 'predict.py');
export const ML_WORKER_SCRIPT = path.join(REPO_ROOT, 'ml', 'predict_worker.py');

export const YAHOO_DISK_CACHE_DIR = path.join(REPO_ROOT, '.cache', 'yahoo');
export const EARNINGS_DISK_CACHE_DIR = path.join(REPO_ROOT, '.cache', 'earnings');

/** Local normalized daily bars (gitignored). See docs/DATA_CONTRACTS.md */
export const DATA_GOLD_DIR = path.join(REPO_ROOT, 'data', 'gold');
export const DATA_GOLD_BARS_DIR = path.join(DATA_GOLD_DIR, 'bars');

/** Dashboard / UI API snapshots (gitignored). See server/README.md */
export const LOCAL_UI_SNAPSHOTS_DIR = path.join(REPO_ROOT, 'data', 'local-snapshots');

export const PAPER_PORTFOLIO_PATH = dataPath('paper-portfolio.json');
export const PAPER_PORTFOLIO_TOP50_PATH = dataPath('paper-portfolio-top50.json');
export const PAPER_PORTFOLIO_TOP150_PATH = dataPath('paper-portfolio-top150.json');
/** Shadow book that mirrors sp500_top50 tickers but runs the new defaults (quarterly + quality weights + fixed). */
export const PAPER_PORTFOLIO_TOP50_SHADOW_PATH = dataPath('paper-portfolio-top50-shadow.json');

export const CONGRESS_SIGNAL_PATH = dataPath('congress-signal.json');
