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

const DATA_DIR_AUTO = process.env.DATA_DIR ? String(process.env.DATA_DIR).replace(/\/?$/, '/') : '';
const PORTFOLIO_FILE = `${DATA_DIR_AUTO}options-auto-portfolio.json`;

const AUTO_CONFIG = {
  maxOpenPositions: 5,
  minEV: 10,
  minIVRank: 40,
  targetContracts: 1,
  profitTarget: 0.5,
  dteCloseThreshold: 21,
  bearRegimeClose: true,
  // Stop-loss: close if mark goes above this multiple of entry credit. Capping
  // losses at ≈2.5× premium has the largest single impact on long-run wheel
  // outcomes — without it a COST-style runaway costs months of premium.
  stopLossMult: 2.5,
  // Which regimes allow opening NEW positions per strategy
  regimeAllowOpen: {
    COVERED_CALL: ['strong_bull', 'normal', 'pullback'],
    CASH_SECURED_PUT: ['strong_bull', 'normal'],
    REGIME_HEDGE: ['caution', 'bear']
  },
  // In caution: close any short-premium position down > this %
  cautionStopPct: 0.3,
  // In pullback: take profits faster
  pullbackProfitTarget: 0.35,
  // ── Three-paper academic signal thresholds ──────────────────────────────
  // Minimum composite sell score (0-1). 0.35 = moderate signal from 2+ papers.
  // Set to 0 to disable (use IVR/EV only).
  minSellScore: 0.35,
  // When true, rank by blended sellScore×EV rather than EV alone
  sellScoreWeight: true,
  // Require positive reading from at least N of 3 papers (0 = disable)
  minSignalCount: 2,
  // G&S hard gate: never sell when realized vol > implied vol (options are cheap)
  blockCheapOptions: true
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
      pendingRolls: [],
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
      pendingRolls: Array.isArray(raw.pendingRolls) ? raw.pendingRolls : [],
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
      pendingRolls: [],
      stats: { totalPnl: 0, wins: 0, losses: 0, totalTrades: 0 },
      lastRun: null
    };
  }
}

function savePortfolio(p) {
  writeFileSync(portfolioPath(), JSON.stringify(p, null, 2));
}

function buildOCCSymbol(ticker, expiration, optionType, strike) {
  if (!ticker || !expiration || !optionType || strike == null) return null;
  try {
    const root = String(ticker).replace(/-/g, '').toUpperCase();
    const d = new Date(expiration);
    const yy = String(d.getUTCFullYear()).slice(2);
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const cp = String(optionType).toLowerCase().startsWith('c') ? 'C' : 'P';
    const stk = String(Math.round(Number(strike) * 1000)).padStart(8, '0');
    return `${root}${yy}${mm}${dd}${cp}${stk}`;
  } catch {
    return null;
  }
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

// Sandbox account IDs look like VA######## (2 letters + 8-10 digits). Reject obvious garbage.
const ACCT_ID_RE = /^[A-Z]{2}\d{6,12}$/;
let _cachedAccountId = null;
async function getSandboxAccountId() {
  if (_cachedAccountId) return _cachedAccountId;
  const envAcct = (process.env.TRADIER_ACCOUNT_ID || process.env.TRADIER_SANDBOX_ACCOUNT || '').trim();
  if (envAcct && ACCT_ID_RE.test(envAcct)) {
    _cachedAccountId = envAcct;
    return _cachedAccountId;
  }
  if (envAcct) {
    console.warn(`[tradier] ignoring malformed TRADIER_ACCOUNT_ID="${envAcct}" (expected ${ACCT_ID_RE}); falling back to /user/profile`);
  }
  const data = await tradierGet('/user/profile');
  const accounts = data?.profile?.account;
  if (!accounts) throw new Error('No accounts found in Tradier profile');
  const acct = Array.isArray(accounts) ? accounts[0] : accounts;
  const id = acct?.account_number ?? acct?.accountNumber ?? acct?.number ?? null;
  if (!id) throw new Error('Tradier profile missing account_number');
  _cachedAccountId = String(id);
  return _cachedAccountId;
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

export async function openShortOptionLeg({ ticker, optionSymbol, quantity = 1, limitPrice }) {
  const t = String(ticker || '').toUpperCase();
  const sym = String(optionSymbol || '').trim();
  const qty = Math.max(1, parseInt(String(quantity), 10) || 1);
  const px = Number(limitPrice);
  if (!t || !sym || !Number.isFinite(px)) throw new Error('Invalid openShortOptionLeg args');

  if (!TOKEN) {
    return { mode: 'mock', order: { id: 'DRY_RUN', status: 'dry_run' }, limitPrice: px };
  }
  const accountId = await getSandboxAccountId();
  const order = await submitSellToOpen(accountId, t, sym, qty, px);
  return { mode: 'sandbox', accountId, order, limitPrice: px };
}

/**
 * Manage open option legs: refresh quotes & academic signals, then decide close vs. keep.
 *
 * @param {Array<object>} openLegs    - persisted open positions
 * @param {string}        currentRegime
 * @param {object} [opts]
 * @param {Map<string,object>} [opts.signalMap]
 *        Map of ticker → live opportunity row (from latest computeOptionsScan).
 *        When supplied, every leg's academic fields (sellScore, signalCount,
 *        gsSignal, gsSellEdge, ivolPct, vrpIntensity, ivPremium, regimeBoost,
 *        bkRegimeBoost) are rewritten on the kept leg so the UI grade tracks
 *        current truth instead of entry-time snapshots.
 */
export async function manageOptionLegsOnce(openLegs, currentRegime, opts = {}) {
  const legs = Array.isArray(openLegs) ? openLegs : [];
  const nowIso = new Date().toISOString();
  const actions = { closed: [], errors: [], kept: [] };
  const sigMap = opts.signalMap instanceof Map ? opts.signalMap : null;

  // Pull live academic signals onto the kept leg so persisted snapshots refresh.
  const applyLiveSignals = (leg) => {
    if (!sigMap) return leg;
    const t = String(leg?.ticker || '').toUpperCase();
    const live = sigMap.get(t);
    if (!live) return leg;
    return {
      ...leg,
      // EV refreshes too — old broken formula left -$26k snapshots that distort
      // every UI panel that aggregates EV.
      ev:               (live.ev != null) ? live.ev : leg.ev,
      sellScore:        live.sellScore        ?? leg.sellScore        ?? null,
      signalCount:      live.signalCount      ?? leg.signalCount      ?? null,
      academicSellEdge: live.academicSellEdge ?? leg.academicSellEdge ?? null,
      gsSignal:         live.gsSignal         ?? leg.gsSignal         ?? null,
      gsNorm:           live.gsNorm           ?? leg.gsNorm           ?? null,
      gsSellEdge:       live.gsSellEdge       ?? leg.gsSellEdge       ?? null,
      gsInterpretation: live.gsInterpretation ?? leg.gsInterpretation ?? null,
      vrpIntensity:     live.vrpIntensity     ?? leg.vrpIntensity     ?? null,
      ivPremium:        live.ivPremium        ?? leg.ivPremium        ?? null,
      regimeBoost:      live.regimeBoost      ?? leg.regimeBoost      ?? null,
      bkRegimeBoost:    live.bkRegimeBoost    ?? leg.bkRegimeBoost    ?? null,
      ivolPct:          live.ivolPct          ?? leg.ivolPct          ?? null,
      ivolRaw:          live.ivolRaw          ?? leg.ivolRaw          ?? null
    };
  };

  if (!TOKEN) {
    // In dry-run, just compute what would close based on existing mark/currentPremium if present.
    for (const pos of legs) actions.kept.push(pos);
    return { mode: 'mock', actions, positions: legs };
  }

  const accountId = await getSandboxAccountId();
  const remaining = [];

  for (const pos of legs) {
    // Always try to refresh MTM first. Even if close submission fails later we want
    // the leg's currentMark/currentDTE/currentPnL to reflect the latest quote.
    let mark = null;
    let dte = null;
    let pnl = null;
    let pnlPct = null;
    let mtmOk = false;
    try {
      const q = await getOptionQuote(pos.optionSymbol);
      mark = quoteMid(q);
      dte = computeDte(pos.expiration) ?? pos.dte ?? null;
      const entry = Number(pos.entryCredit) || 0;
      const qty = Number(pos.quantity) || 1;
      const isSeller = pos.strategy !== 'REGIME_HEDGE';
      pnl = isSeller ? (entry - mark) * 100 * qty : (mark - entry) * 100 * qty;
      pnlPct = entry > 0 ? pnl / (entry * 100 * qty) : 0;
      mtmOk = Number.isFinite(mark) && mark > 0;
    } catch (qe) {
      actions.errors.push({ symbol: pos?.optionSymbol ?? 'unknown', stage: 'quote', error: qe.message || String(qe) });
    }

    const baseEnriched = mtmOk
      ? { ...pos, currentMark: mark, currentDTE: dte, currentPnL: pnl, currentPnLPct: pnlPct }
      : { ...pos };
    const enriched = applyLiveSignals(baseEnriched);

    if (!mtmOk) {
      remaining.push(enriched);
      actions.kept.push(enriched);
      continue;
    }

    const entry = Number(pos.entryCredit) || 0;
    const qty = Number(pos.quantity) || 1;
    const isSeller = pos.strategy !== 'REGIME_HEDGE';
    const activeTarget =
      currentRegime === 'pullback' ? AUTO_CONFIG.pullbackProfitTarget : AUTO_CONFIG.profitTarget;
    const closeAtProfit = isSeller && mark <= entry * (1 - activeTarget);
    const closeAtDte = dte != null && dte <= AUTO_CONFIG.dteCloseThreshold;
    const closeAtBear =
      AUTO_CONFIG.bearRegimeClose === true && currentRegime === 'bear' && pos.strategy !== 'REGIME_HEDGE';
    const closeAtCautionStop =
      currentRegime === 'caution' && isSeller && pnlPct < -AUTO_CONFIG.cautionStopPct;
    // Hard stop-loss for sellers: mark above stopLossMult × entry credit.
    const closeAtStopLoss =
      isSeller && AUTO_CONFIG.stopLossMult > 0 && entry > 0 &&
      mark >= entry * AUTO_CONFIG.stopLossMult;
    // Academic-signal kill switch: live G&S says don't sell this name anymore
    // (realized vol now exceeds implied → options are cheap), and we're past
    // the half-life of the trade. Lock in whatever premium decay we got.
    const liveGsBad = enriched.gsSellEdge === false;
    const halfLifeReached = dte != null && pos.dte && dte <= Math.max(7, pos.dte / 2);
    const closeAtSignalReversal = isSeller && liveGsBad && halfLifeReached && pnl > 0;

    const shouldClose =
      closeAtProfit || closeAtDte || closeAtBear || closeAtCautionStop ||
      closeAtStopLoss || closeAtSignalReversal;
    if (!shouldClose) {
      remaining.push(enriched);
      actions.kept.push(enriched);
      continue;
    }

    const reason = closeAtBear
      ? 'bear regime override'
      : closeAtStopLoss
        ? `stop-loss: mark ${mark.toFixed(2)} ≥ ${AUTO_CONFIG.stopLossMult}× entry (${entry.toFixed(2)})`
        : closeAtCautionStop
          ? `caution regime stop: position down ${(pnlPct * 100).toFixed(1)}%`
          : closeAtSignalReversal
            ? `G&S signal reversal: realized vol > implied (locking +${(pnlPct*100).toFixed(1)}%)`
            : closeAtProfit
              ? `${Math.round(activeTarget * 100)}% profit target (regime: ${currentRegime})`
              : '21 DTE threshold';

    try {
      const limit = Math.max(0.01, mark + 0.05);
      const order = await submitBuyToClose(accountId, pos.ticker, pos.optionSymbol, qty, limit);
      actions.closed.push({
        symbol: pos.optionSymbol,
        ticker: pos.ticker,
        orderId: order.id,
        reason,
        pnl,
        closedAt: nowIso
      });
    } catch (ce) {
      // Close failed — keep the leg with FRESH MTM + live signals so it's
      // visible and retried next run.
      remaining.push(enriched);
      actions.kept.push(enriched);
      actions.errors.push({
        symbol: pos?.optionSymbol ?? 'unknown',
        stage: 'close',
        intendedReason: reason,
        error: ce.message || String(ce)
      });
    }
  }

  return { mode: 'sandbox', accountId, actions, positions: remaining };
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
    .filter((o) => {
      const allowedRegimes = AUTO_CONFIG.regimeAllowOpen?.[o.strategy];
      if (Array.isArray(allowedRegimes) && !allowedRegimes.includes(currentRegime)) return false;
      return true;
    })
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
      regime: currentRegime,
      sellScore:    o.sellScore    ?? null,
      signalCount:  o.signalCount  ?? null,
      gsSignal:     o.gsSignal     ?? null,
      ivolPct:      o.ivolPct      ?? null,
      vrpIntensity: o.vrpIntensity ?? null
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

      // Tighten profit target in pullback regime — take money faster
      const activeTarget =
        currentRegime === 'pullback' ? AUTO_CONFIG.pullbackProfitTarget : AUTO_CONFIG.profitTarget;
      const closeAtProfit = isSeller && mark <= entry * (1 - activeTarget);
      const closeAtDte = dte != null && dte <= AUTO_CONFIG.dteCloseThreshold;
      const closeAtBear =
        AUTO_CONFIG.bearRegimeClose === true && currentRegime === 'bear' && pos.strategy !== 'REGIME_HEDGE';
      const closeAtCautionStop =
        currentRegime === 'caution' && isSeller && pnlPct < -AUTO_CONFIG.cautionStopPct;

      const shouldClose = closeAtProfit || closeAtDte || closeAtBear || closeAtCautionStop;
      if (!shouldClose) {
        remaining.push({ ...pos, currentMark: mark, currentDTE: dte, currentPnL: pnl, currentPnLPct: pnlPct });
        continue;
      }

      const reason = closeAtBear
        ? 'bear regime override'
        : closeAtCautionStop
          ? `caution regime stop: position down ${(pnlPct * 100).toFixed(1)}%`
          : closeAtProfit
            ? `${Math.round(activeTarget * 100)}% profit target (regime: ${currentRegime})`
            : closeAtDte
              ? `${dte} DTE — rolling to next expiry`
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

      // Roll queue: after closing near 21 DTE, queue a new STO at ~30 DTE
      if (closeAtDte && order?.id) {
        const nextExpiry = (() => {
          const d = new Date();
          d.setUTCDate(d.getUTCDate() + 30);
          return d.toISOString().split('T')[0];
        })();
        const optType = pos.strategy === 'COVERED_CALL' ? 'call' : 'put';
        const nextSymbol = buildOCCSymbol(pos.ticker, nextExpiry, optType, pos.strike);
        if (nextSymbol) {
          portfolio.pendingRolls = Array.isArray(portfolio.pendingRolls) ? portfolio.pendingRolls : [];
          portfolio.pendingRolls.push({
            ticker: pos.ticker,
            strategy: pos.strategy,
            strike: pos.strike,
            expiration: nextExpiry,
            optionSymbol: nextSymbol,
            rolledFrom: pos.optionSymbol,
            queuedAt: nowIso
          });
          actions.closed[actions.closed.length - 1].rollQueued = nextSymbol;
        }
      }
    } catch (e) {
      remaining.push(pos);
      actions.errors.push({ phase: 'manage', symbol: pos.optionSymbol, error: e.message || String(e) });
    }
  }
  portfolio.positions = remaining;

  // ── Open new positions ─────────────────────────────────────────────────────
  const slotsAvail = Math.max(0, AUTO_CONFIG.maxOpenPositions - portfolio.positions.length);
  if (slotsAvail > 0) {
    // Process pending rolls first (priority over new opens)
    if (Array.isArray(portfolio.pendingRolls) && portfolio.pendingRolls.length > 0) {
      const toRoll = portfolio.pendingRolls.splice(0);
      for (const roll of toRoll) {
        try {
          const rq = await getOptionQuote(roll.optionSymbol).catch(() => null);
          const bid = Number(rq?.bid) || 0;
          const ask = Number(rq?.ask) || 0;
          const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : Number(rq?.last) || bid || ask || 0;
          const limit = Math.max(0.01, parseFloat((mid - 0.02).toFixed(2)));
          if (!Number.isFinite(limit) || limit < 0.1) {
            actions.skipped.push({ symbol: roll.optionSymbol, reason: 'roll_premium_too_low' });
            continue;
          }

          const order = await submitSellToOpen(accountId, String(roll.ticker).toUpperCase(), roll.optionSymbol, AUTO_CONFIG.targetContracts, limit);
          portfolio.orders.push({
            type: 'roll_open',
            orderId: order.id,
            status: order.status,
            optionSymbol: roll.optionSymbol,
            ticker: String(roll.ticker).toUpperCase(),
            quantity: AUTO_CONFIG.targetContracts,
            limitPrice: Number(limit.toFixed(2)),
            placedAt: nowIso,
            rolledFrom: roll.rolledFrom
          });

          portfolio.positions.push({
            ticker: String(roll.ticker).toUpperCase(),
            optionSymbol: roll.optionSymbol,
            strategy: roll.strategy,
            strike: roll.strike,
            expiration: roll.expiration,
            quantity: AUTO_CONFIG.targetContracts,
            entryCredit: Number(limit.toFixed(2)),
            entryDate: nowIso,
            entryOrderId: order.id,
            isRoll: true,
            rolledFrom: roll.rolledFrom
          });
          actions.opened.push({ symbol: roll.optionSymbol, orderId: order.id, credit: Number(limit.toFixed(2)), isRoll: true, rolledFrom: roll.rolledFrom });
        } catch (e) {
          actions.errors.push({ phase: 'roll', symbol: roll?.optionSymbol ?? 'unknown', error: e.message || String(e) });
        }
      }
    }

    const eligible = opportunities
      .filter((opp) => {
        if (!opp || typeof opp !== 'object') return false;
        if (opp.strategy !== 'COVERED_CALL' && opp.strategy !== 'CASH_SECURED_PUT') return false;
        if ((Number(opp.ev) || 0) < AUTO_CONFIG.minEV) return false;
        if ((Number(opp.ivRank) || 0) < AUTO_CONFIG.minIVRank) return false;
        if (!(opp.optionSymbol || opp.osiSymbol) || !opp.ticker) return false;
        if (portfolio.positions.some((p) => p.ticker === String(opp.ticker).toUpperCase())) return false;

        // Regime gate
        const allowedRegimes = AUTO_CONFIG.regimeAllowOpen?.[opp.strategy];
        if (Array.isArray(allowedRegimes) && !allowedRegimes.includes(currentRegime)) return false;

        // VRP gate (preserved)
        const vrpEdge = opp.vrpEdge != null ? !!opp.vrpEdge : (Number(opp.ivRank) || 0) > 50;
        if (!vrpEdge) return false;

        // ── G&S hard gate: block when options are cheap (RV > IV) ──
        // Goyal & Saretto: selling on the wrong side is the highest-cost mistake
        if (AUTO_CONFIG.blockCheapOptions && opp.gsSellEdge === false) return false;

        // ── Composite sell score minimum ──
        if (AUTO_CONFIG.minSellScore > 0 && opp.sellScore != null && opp.sellScore < AUTO_CONFIG.minSellScore) return false;

        // ── Signal count gate: require positive reading from N papers ──
        if (AUTO_CONFIG.minSignalCount > 1 && opp.signalCount != null && opp.signalCount < AUTO_CONFIG.minSignalCount) return false;

        return true;
      })
      .sort((a, b) => {
        // Primary sort: blended sellScore×EV when enabled (academic + dollar edge)
        if (AUTO_CONFIG.sellScoreWeight && a.sellScore != null && b.sellScore != null) {
          const aCombo = (a.sellScore * 500) * 0.6 + (Number(a.ev) || 0) * 0.4;
          const bCombo = (b.sellScore * 500) * 0.6 + (Number(b.ev) || 0) * 0.4;
          return bCombo - aCombo;
        }
        return (Number(b.ev) || 0) - (Number(a.ev) || 0);
      })
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
        // B&K regime-adjusted contract count: in high-vol regimes the sell edge is stronger
        const bkBoost  = Number(opp.regimeBoost ?? opp.bkRegimeBoost ?? 1.0);
        const contracts = Math.max(1, Math.round(AUTO_CONFIG.targetContracts * Math.min(bkBoost, 1.5)));
        const order = await submitSellToOpen(accountId, ticker, optionSymbol, contracts, limit);

        portfolio.orders.push({
          type: 'open',
          orderId: order.id,
          status: order.status,
          optionSymbol,
          ticker,
          quantity: contracts,
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
          quantity: contracts,
          entryCredit: Number(limit.toFixed(2)),
          entryDate: nowIso,
          entryOrderId: order.id,
          ev: Number(opp.ev) || 0,
          delta: opp.delta != null ? Number(opp.delta) : null,
          dte: opp.dte != null ? Number(opp.dte) : computeDte(opp.expiration),
          ivRank: opp.ivRank != null ? Number(opp.ivRank) : null,
          currentPrice: opp.currentPrice != null ? Number(opp.currentPrice) : null,
          compositeScore: opp.compositeScore != null ? Number(opp.compositeScore) : null,
          // Academic signal snapshot at entry (three-paper system)
          gsSignal:         opp.gsSignal         ?? null,
          sellScore:        opp.sellScore        ?? null,
          signalCount:      opp.signalCount      ?? null,
          ivolPct:          opp.ivolPct          ?? null,
          vrpIntensity:     opp.vrpIntensity      ?? null,
          regimeBoost:      opp.regimeBoost       ?? null,
          academicSellEdge: opp.academicSellEdge  ?? null
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

