/**
 * options-auto-trader.js
 *
 * Autonomous options trading engine using Tradier's sandbox simulation API.
 *
 * Strategy:
 * - Consume opportunities from the scanner (must include `ev`, `ivRank`, `optionSymbol|osiSymbol`, `currentPrice`, `premium|mid`).
 * - Open the highest positive-EV opportunities (short premium: covered calls / cash-secured puts).
 * - Manage open positions:
 *   - Close at 50% profit (for sellers: mark <= 0.5 * entry credit).
 *   - Close/roll at 21 DTE (close only here; rolling can be added later).
 *   - Optional: close non-hedge positions in bear regime.
 *
 * All orders go through Tradier sandbox when TRADIER_SANDBOX_TOKEN is set. Otherwise returns a dry-run plan.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

const SANDBOX_BASE = 'https://sandbox.tradier.com/v1';
const TOKEN = process.env.TRADIER_SANDBOX_TOKEN != null && String(process.env.TRADIER_SANDBOX_TOKEN).trim() !== ''
  ? String(process.env.TRADIER_SANDBOX_TOKEN).trim()
  : null;

const PORTFOLIO_FILE = 'options-auto-portfolio.json';

const AUTO_CONFIG = {
  maxOpenPositions: 5,
  minEV: 10,
  minIVRank: 40,
  targetContracts: 1,
  profitTarget: 0.5,
  dteCloseThreshold: 21,
  bearRegimeClose: true
};

function portfolioPath() {
  return path.join(process.cwd(), PORTFOLIO_FILE);
}

function loadPortfolio() {
  const fp = portfolioPath();
  if (!existsSync(fp)) {
    return {
      positions: [],
      closedTrades: [],
      orders: [],
      stats: { totalPnl: 0, wins: 0, losses: 0, totalTrades: 0 },
      lastRun: null
    };
  }
  try {
    const raw = JSON.parse(readFileSync(fp, 'utf8'));
    return {
      positions: Array.isArray(raw.positions) ? raw.positions : [],
      closedTrades: Array.isArray(raw.closedTrades) ? raw.closedTrades : [],
      orders: Array.isArray(raw.orders) ? raw.orders : [],
      stats: raw.stats && typeof raw.stats === 'object'
        ? {
            totalPnl: Number(raw.stats.totalPnl) || 0,
            wins: Number(raw.stats.wins) || 0,
            losses: Number(raw.stats.losses) || 0,
            totalTrades: Number(raw.stats.totalTrades) || 0
          }
        : { totalPnl: 0, wins: 0, losses: 0, totalTrades: 0 },
      lastRun: raw.lastRun ?? null
    };
  } catch {
    return {
      positions: [],
      closedTrades: [],
      orders: [],
      stats: { totalPnl: 0, wins: 0, losses: 0, totalTrades: 0 },
      lastRun: null
    };
  }
}

function savePortfolio(p) {
  writeFileSync(portfolioPath(), JSON.stringify(p, null, 2));
}

async function tradierGet(p) {
  if (!TOKEN) throw new Error('TRADIER_SANDBOX_TOKEN not set');
  const res = await fetch(`${SANDBOX_BASE}${p}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json'
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Tradier GET ${p} → ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
  }
  return res.json();
}

async function tradierPost(p, params) {
  if (!TOKEN) throw new Error('TRADIER_SANDBOX_TOKEN not set');
  const body = new URLSearchParams(params).toString();
  const res = await fetch(`${SANDBOX_BASE}${p}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Tradier POST ${p} → ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
  }
  return res.json();
}

async function getSandboxAccountId() {
  const envAcct = process.env.TRADIER_ACCOUNT_ID || process.env.TRADIER_SANDBOX_ACCOUNT;
  if (envAcct != null && String(envAcct).trim() !== '') return String(envAcct).trim();
  const data = await tradierGet('/user/profile');
  const accounts = data?.profile?.account;
  if (!accounts) throw new Error('No accounts found in Tradier profile');
  const acct = Array.isArray(accounts) ? accounts[0] : accounts;
  const id = acct?.account_number ?? acct?.accountNumber ?? acct?.number ?? null;
  if (!id) throw new Error('Tradier profile missing account_number');
  return String(id);
}

async function getOptionQuote(optionSymbol) {
  const data = await tradierGet(
    `/markets/quotes?symbols=${encodeURIComponent(optionSymbol)}&greeks=true`
  );
  const q = data?.quotes?.quote;
  return q ?? null;
}

function quoteMid(q) {
  const bid = Number(q?.bid) || 0;
  const ask = Number(q?.ask) || 0;
  const last = Number(q?.last) || 0;
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  return last || bid || ask || 0;
}

async function submitOrder(accountId, payload) {
  const result = await tradierPost(`/accounts/${encodeURIComponent(accountId)}/orders`, payload);
  const id = result?.order?.id ?? result?.order?.order_id ?? null;
  const status = result?.order?.status ?? 'unknown';
  return { id: id != null ? String(id) : null, status, raw: result };
}

async function submitSellToOpen(accountId, underlying, optionSymbol, quantity, limitPrice) {
  return submitOrder(accountId, {
    class: 'option',
    symbol: underlying,
    option_symbol: optionSymbol,
    side: 'sell_to_open',
    quantity: String(quantity),
    type: 'limit',
    price: Number(limitPrice).toFixed(2),
    duration: 'day'
  });
}

async function submitBuyToClose(accountId, underlying, optionSymbol, quantity, limitPrice) {
  return submitOrder(accountId, {
    class: 'option',
    symbol: underlying,
    option_symbol: optionSymbol,
    side: 'buy_to_close',
    quantity: String(quantity),
    type: 'limit',
    price: Number(limitPrice).toFixed(2),
    duration: 'day'
  });
}

function computeDte(expirationIso) {
  if (!expirationIso) return null;
  const exp = new Date(String(expirationIso).slice(0, 10));
  if (Number.isNaN(exp.getTime())) return null;
  return Math.max(0, Math.ceil((exp.getTime() - Date.now()) / 86400000));
}

function dryRun(opportunities, currentRegime, portfolio) {
  const eligible = opportunities
    .filter((o) => (Number(o.ev) || 0) >= AUTO_CONFIG.minEV)
    .filter((o) => (Number(o.ivRank) || 0) >= AUTO_CONFIG.minIVRank)
    .filter((o) => o.strategy !== 'REGIME_HEDGE')
    .filter((o) => !!(o.optionSymbol || o.osiSymbol))
    .sort((a, b) => (Number(b.ev) || 0) - (Number(a.ev) || 0))
    .slice(0, Math.max(0, AUTO_CONFIG.maxOpenPositions - (portfolio.positions?.length ?? 0)))
    .map((o) => ({
      ticker: o.ticker,
      strategy: o.strategy,
      optionSymbol: o.optionSymbol || o.osiSymbol,
      strike: o.strike,
      expiration: o.expiration,
      dte: o.dte,
      premium: o.premium ?? o.mid,
      ev: o.ev,
      ivRank: o.ivRank,
      regime: currentRegime
    }));

  return {
    wouldOpen: eligible,
    openSlots: Math.max(0, AUTO_CONFIG.maxOpenPositions - (portfolio.positions?.length ?? 0)),
    config: AUTO_CONFIG
  };
}

export function getAutoPortfolio() {
  return loadPortfolio();
}

export async function runAutoTrader(opportunities, currentRegime) {
  const portfolio = loadPortfolio();
  const nowIso = new Date().toISOString();
  const actions = { opened: [], closed: [], skipped: [], errors: [] };

  if (!TOKEN) {
    return {
      success: false,
      mode: 'mock',
      message: 'TRADIER_SANDBOX_TOKEN not set — dry-run only',
      regime: currentRegime,
      dryRun: dryRun(opportunities, currentRegime, portfolio)
    };
  }

  const accountId = await getSandboxAccountId();

  // ── Manage existing positions ──────────────────────────────────────────────
  const remaining = [];
  for (const pos of portfolio.positions) {
    try {
      const q = await getOptionQuote(pos.optionSymbol);
      const mark = quoteMid(q);
      const dte = computeDte(pos.expiration) ?? pos.dte ?? null;

      const entry = Number(pos.entryCredit) || 0;
      const qty = Number(pos.quantity) || 1;
      const isSeller = pos.strategy !== 'REGIME_HEDGE';
      const pnl = isSeller ? (entry - mark) * 100 * qty : (mark - entry) * 100 * qty;
      const pnlPct = entry > 0 ? pnl / (entry * 100 * qty) : 0;

      const closeAtProfit = isSeller && mark <= entry * (1 - AUTO_CONFIG.profitTarget);
      const closeAtDte = dte != null && dte <= AUTO_CONFIG.dteCloseThreshold;
      const closeAtBear =
        AUTO_CONFIG.bearRegimeClose === true && currentRegime === 'bear' && pos.strategy !== 'REGIME_HEDGE';

      const shouldClose = closeAtProfit || closeAtDte || closeAtBear;
      if (!shouldClose) {
        remaining.push({ ...pos, currentMark: mark, currentDTE: dte, currentPnL: pnl, currentPnLPct: pnlPct });
        continue;
      }

      const reason = closeAtBear
        ? 'bear regime override'
        : closeAtProfit
          ? '50% profit target'
          : '21 DTE threshold';

      // buy-to-close: slightly above mid to increase fill probability
      const limit = Math.max(0.01, mark + 0.05);
      const order = await submitBuyToClose(accountId, pos.ticker, pos.optionSymbol, qty, limit);

      portfolio.orders.push({
        type: 'close',
        orderId: order.id,
        status: order.status,
        optionSymbol: pos.optionSymbol,
        ticker: pos.ticker,
        quantity: qty,
        limitPrice: Number(limit.toFixed(2)),
        placedAt: nowIso,
        reason
      });

      const closed = {
        ...pos,
        closedAt: nowIso,
        closeReason: reason,
        closeOrderId: order.id,
        currentMark: mark,
        currentDTE: dte,
        realizedPnL: pnl
      };
      portfolio.closedTrades.push(closed);
      portfolio.stats.totalPnl += Number.isFinite(pnl) ? pnl : 0;
      portfolio.stats.totalTrades += 1;
      if ((pnl || 0) >= 0) portfolio.stats.wins += 1;
      else portfolio.stats.losses += 1;

      actions.closed.push({ symbol: pos.optionSymbol, orderId: order.id, pnl, reason });
    } catch (e) {
      remaining.push(pos);
      actions.errors.push({ phase: 'manage', symbol: pos.optionSymbol, error: e.message || String(e) });
    }
  }
  portfolio.positions = remaining;

  // ── Open new positions ─────────────────────────────────────────────────────
  const slotsAvail = Math.max(0, AUTO_CONFIG.maxOpenPositions - portfolio.positions.length);
  if (slotsAvail > 0) {
    const eligible = opportunities
      .filter((o) => o && typeof o === 'object')
      .filter((o) => o.strategy === 'COVERED_CALL' || o.strategy === 'CASH_SECURED_PUT')
      .filter((o) => (Number(o.ev) || 0) >= AUTO_CONFIG.minEV)
      .filter((o) => (Number(o.ivRank) || 0) >= AUTO_CONFIG.minIVRank)
      .filter((o) => !!(o.optionSymbol || o.osiSymbol) && !!o.ticker)
      .filter((o) => !portfolio.positions.some((p) => p.ticker === String(o.ticker).toUpperCase()))
      .sort((a, b) => (Number(b.ev) || 0) - (Number(a.ev) || 0))
      .slice(0, slotsAvail);

    for (const opp of eligible) {
      try {
        const ticker = String(opp.ticker).toUpperCase();
        const optionSymbol = String(opp.optionSymbol || opp.osiSymbol).trim();
        const premRaw = opp.premium ?? opp.mid ?? null;
        const mid = premRaw != null && Number.isFinite(Number(premRaw)) ? Number(premRaw) : null;
        if (mid == null || mid < 0.1) {
          actions.skipped.push({ symbol: optionSymbol, reason: 'premium_too_low' });
          continue;
        }

        // sell-to-open: slightly below mid to increase fill probability
        const limit = Math.max(0.01, mid - 0.02);
        const order = await submitSellToOpen(accountId, ticker, optionSymbol, AUTO_CONFIG.targetContracts, limit);

        portfolio.orders.push({
          type: 'open',
          orderId: order.id,
          status: order.status,
          optionSymbol,
          ticker,
          quantity: AUTO_CONFIG.targetContracts,
          limitPrice: Number(limit.toFixed(2)),
          placedAt: nowIso,
          ev: Number(opp.ev) || 0
        });

        const newPos = {
          ticker,
          optionSymbol,
          strategy: opp.strategy,
          strike: opp.strike,
          expiration: opp.expiration,
          quantity: AUTO_CONFIG.targetContracts,
          entryCredit: Number(limit.toFixed(2)),
          entryDate: nowIso,
          entryOrderId: order.id,
          ev: Number(opp.ev) || 0,
          delta: opp.delta != null ? Number(opp.delta) : null,
          dte: opp.dte != null ? Number(opp.dte) : computeDte(opp.expiration),
          ivRank: opp.ivRank != null ? Number(opp.ivRank) : null,
          currentPrice: opp.currentPrice != null ? Number(opp.currentPrice) : null,
          compositeScore: opp.compositeScore != null ? Number(opp.compositeScore) : null
        };
        portfolio.positions.push(newPos);
        actions.opened.push({ symbol: optionSymbol, orderId: order.id, ev: newPos.ev, credit: newPos.entryCredit });
      } catch (e) {
        actions.errors.push({ phase: 'open', symbol: opp?.optionSymbol ?? opp?.osiSymbol ?? opp?.ticker ?? 'unknown', error: e.message || String(e) });
      }
    }
  }

  portfolio.lastRun = nowIso;
  savePortfolio(portfolio);

  const totalTrades = portfolio.stats.totalTrades;
  const winRate = totalTrades > 0 ? (portfolio.stats.wins / totalTrades) * 100 : null;

  return {
    success: true,
    mode: 'sandbox',
    accountId,
    regime: currentRegime,
    config: AUTO_CONFIG,
    actions,
    summary: {
      openPositions: portfolio.positions.length,
      openedToday: actions.opened.length,
      closedToday: actions.closed.length,
      errors: actions.errors.length,
      totalPnl: portfolio.stats.totalPnl,
      winRate: winRate != null ? `${winRate.toFixed(1)}%` : 'N/A'
    },
    positions: portfolio.positions
  };
}

