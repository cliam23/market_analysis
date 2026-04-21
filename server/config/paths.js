/**
 * All filesystem paths relative to repository root (same as legacy server.js __dirname).
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.join(__dirname, '..', '..');

export const OPTIONS_PORTFOLIO_PATH = path.join(REPO_ROOT, 'options-portfolio.json');
export const RL_AGENT_JSON_PATH = path.join(REPO_ROOT, 'rl-agent.json');
export const RL_AGENT_TOP50_PATH = path.join(REPO_ROOT, 'rl-agent-top50.json');
export const RL_AGENT_TOP150_PATH = path.join(REPO_ROOT, 'rl-agent-top150.json');
export const DQN_AGENT_JSON_PATH = path.join(REPO_ROOT, 'dqn-agent.json');
export const DQN_AGENT_BEST_JSON_PATH = path.join(REPO_ROOT, 'dqn-agent-best.json');

export const ML_PREDICT_SCRIPT = path.join(REPO_ROOT, 'ml', 'predict.py');
export const ML_WORKER_SCRIPT = path.join(REPO_ROOT, 'ml', 'predict_worker.py');

export const YAHOO_DISK_CACHE_DIR = path.join(REPO_ROOT, '.cache', 'yahoo');
export const EARNINGS_DISK_CACHE_DIR = path.join(REPO_ROOT, '.cache', 'earnings');

export const PAPER_PORTFOLIO_PATH = path.join(REPO_ROOT, 'paper-portfolio.json');
export const PAPER_PORTFOLIO_TOP50_PATH = path.join(REPO_ROOT, 'paper-portfolio-top50.json');
export const PAPER_PORTFOLIO_TOP150_PATH = path.join(REPO_ROOT, 'paper-portfolio-top150.json');
