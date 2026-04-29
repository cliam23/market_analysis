/**
 * wheel-portfolio-service.js
 *
 * Options-Enhanced Wheel Portfolio (lightweight orchestrator + persistence).
 *
 * This tracks a separate wheel "overlay" on top of the existing paper equity portfolio:
 * - Covered Calls (CC) on tickers already held in paper portfolio
 * - Cash-Secured Puts (CSP) on high-score tickers not yet held
 *
 * Execution is done via Tradier sandbox through the options auto-trader helpers.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

const DATA_DIR_WHEEL = process.env.DATA_DIR ? String(process.env.DATA_DIR).replace(/\/?$/, '/') : '';
const WHEEL_PORTFOLIO_FILE = `${DATA_DIR_WHEEL}wheel-portfolio.json`;

export const WHEEL_CONFIG = {
  scoreFloor: 65,
  maxWheelPositions: 5,
  profitTarget: 0.5,
  dteTarget: 30,
  dteClose: 21,
  minPremiumPct: 0.01,
  // Regime permissions
  regimeAllowsCSP: ['strong_bull', 'normal'],
  regimeAllowsCC: ['strong_bull', 'normal', 'pullback'],
  regimeClosesAll: ['bear'],
  // ── Three-paper academic signal thresholds ──────────────────────────────
  // Lower than auto-trader (wheel uses longer horizons, equity quality matters too)
  minSellScore:      0.30,
  // Never sell CCs/CSPs when realized vol > implied vol (Goyal & Saretto)
  blockCheapOptions: true,
  // Require at least 1 positive paper signal (relaxed vs auto-trader's 2)
  minSignalCount:    1
};

function portfolioPath() {
  return path.isAbsolute(WHEEL_PORTFOLIO_FILE) ? WHEEL_PORTFOLIO_FILE : path.join(process.cwd(), WHEEL_PORTFOLIO_FILE);
}

export function loadWheelPortfolio() {
  const fp = portfolioPath();
  if (!existsSync(fp)) {
    return {
      optionsLegs: [],
      closedLegs: [],
      stats: {
        totalOptionsPnl: 0,
        premiumCollected: 0,
        wins: 0,
        losses: 0,
        totalLegs: 0
      },
      lastRun: null
    };
  }
  try {
    const raw = JSON.parse(readFileSync(fp, 'utf8'));
    return {
      optionsLegs: Array.isArray(raw.optionsLegs) ? raw.optionsLegs : [],
      closedLegs: Array.isArray(raw.closedLegs) ? raw.closedLegs : [],
      stats:
        raw.stats && typeof raw.stats === 'object'
          ? {
              totalOptionsPnl: Number(raw.stats.totalOptionsPnl) || 0,
              premiumCollected: Number(raw.stats.premiumCollected) || 0,
              wins: Number(raw.stats.wins) || 0,
              losses: Number(raw.stats.losses) || 0,
              totalLegs: Number(raw.stats.totalLegs) || 0
            }
          : { totalOptionsPnl: 0, premiumCollected: 0, wins: 0, losses: 0, totalLegs: 0 },
      lastRun: raw.lastRun ?? null
    };
  } catch {
    return {
      optionsLegs: [],
      closedLegs: [],
      stats: { totalOptionsPnl: 0, premiumCollected: 0, wins: 0, losses: 0, totalLegs: 0 },
      lastRun: null
    };
  }
}

export function saveWheelPortfolio(p) {
  writeFileSync(portfolioPath(), JSON.stringify(p, null, 2));
}

/**
 * Select wheel targets from the scanner output.
 *
 * @param {Array<object>} paperHoldings - paper portfolio holdings (tickers you own)
 * @param {Array<object>} opportunities - scanner opportunities (CC/CSP)
 * @param {Array<object>} existingLegs - current wheel open legs
 * @param {string} regime - current market regime
 */
export function selectWheelTargets(paperHoldings, opportunities, existingLegs, regime) {
  const out = [];
  const held = new Set((paperHoldings || []).map((h) => String(h.ticker || '').toUpperCase()).filter(Boolean));
  const active = new Set((existingLegs || []).map((l) => String(l.ticker || '').toUpperCase()).filter(Boolean));
  const slots = Math.max(0, WHEEL_CONFIG.maxWheelPositions - (existingLegs?.length ?? 0));
  if (slots <= 0) return out;

  const regimeAllowsCC = WHEEL_CONFIG.regimeAllowsCC.includes(regime);
  const regimeAllowsCSP = WHEEL_CONFIG.regimeAllowsCSP.includes(regime);

  const opps = Array.isArray(opportunities) ? opportunities : [];

  // CCs on held tickers
  if (regimeAllowsCC) {
    for (const h of paperHoldings || []) {
      if (out.length >= slots) break;
      const t = String(h.ticker || '').toUpperCase();
      if (!t || active.has(t)) continue;
      const score = Number(h.compositeScore ?? h.score ?? 0) || 0;
      if (score > 0 && score < WHEEL_CONFIG.scoreFloor) continue;

      const best = opps
        .filter((o) => {
          if (!o || o.strategy !== 'COVERED_CALL') return false;
          if (String(o.ticker || '').toUpperCase() !== t) return false;
          // G&S: don't sell CCs when options are cheap (RV > IV)
          if (WHEEL_CONFIG.blockCheapOptions && o.gsSellEdge === false) return false;
          // Composite score minimum
          if (WHEEL_CONFIG.minSellScore > 0 && o.sellScore != null && o.sellScore < WHEEL_CONFIG.minSellScore) return false;
          // Signal count minimum
          if (WHEEL_CONFIG.minSignalCount > 1 && o.signalCount != null && o.signalCount < WHEEL_CONFIG.minSignalCount) return false;
          return true;
        })
        .sort((a, b) => {
          // Blend academic sellScore with equity composite score for CC ranking
          const aScore = (a.sellScore ?? 0.3) * 50 + (Number(a.compositeScore ?? score) || 0) * 0.5;
          const bScore = (b.sellScore ?? 0.3) * 50 + (Number(b.compositeScore ?? score) || 0) * 0.5;
          return bScore - aScore;
        })[0];

      if (!best) continue;
      const prem = Number(best.mid ?? best.premium ?? 0) || 0;
      const px = Number(best.currentPrice ?? h.currentPrice ?? h.entryPrice ?? 0) || 0;
      if (px > 0 && prem / px < WHEEL_CONFIG.minPremiumPct) continue;
      if (!best.optionSymbol) continue;

      out.push({
        ticker: t,
        leg: 'COVERED_CALL',
        opp: best,
        reason: `CC on held ticker (${t})`
      });
      active.add(t);
    }
  }

  // CSPs on not-held tickers
  if (regimeAllowsCSP && out.length < slots) {
    const csp = opps
      .filter((o) => {
        if (!o || o.strategy !== 'CASH_SECURED_PUT') return false;
        const t = String(o.ticker || '').toUpperCase();
        if (!t || held.has(t) || active.has(t)) return false;
        if (!o.optionSymbol) return false;
        const score = Number(o.compositeScore ?? 0) || 0;
        if (score > 0 && score < WHEEL_CONFIG.scoreFloor) return false;
        // G&S: don't sell CSPs when options are cheap
        if (WHEEL_CONFIG.blockCheapOptions && o.gsSellEdge === false) return false;
        // Composite score minimum
        if (WHEEL_CONFIG.minSellScore > 0 && o.sellScore != null && o.sellScore < WHEEL_CONFIG.minSellScore) return false;
        // Signal count minimum
        if (WHEEL_CONFIG.minSignalCount > 1 && o.signalCount != null && o.signalCount < WHEEL_CONFIG.minSignalCount) return false;
        return true;
      })
      .sort((a, b) => {
        // Blend academic sellScore with equity composite score for CSP ranking
        const aScore = (a.sellScore ?? 0.3) * 50 + (Number(a.compositeScore) || 0) * 0.5;
        const bScore = (b.sellScore ?? 0.3) * 50 + (Number(b.compositeScore) || 0) * 0.5;
        return bScore - aScore;
      });

    for (const o of csp) {
      if (out.length >= slots) break;
      const t = String(o.ticker || '').toUpperCase();
      out.push({
        ticker: t,
        leg: 'CASH_SECURED_PUT',
        opp: o,
        reason: `CSP on high-score non-holding (${t})`
      });
      active.add(t);
    }
  }

  return out;
}

export function getWheelSummary({ equityTotalValue, equityTotalReturnPct, regime }, wheelPortfolio) {
  const w = wheelPortfolio || loadWheelPortfolio();
  const equityValue = Number(equityTotalValue) || 0;
  const equityRet = Number(equityTotalReturnPct) || 0;
  const optionsPnl = Number(w.stats?.totalOptionsPnl) || 0;
  const prem = Number(w.stats?.premiumCollected) || 0;
  const premYield = equityValue > 0 ? (prem / equityValue) * 100 : 0;
  const combinedPnl = equityValue > 0 ? (equityValue * (equityRet / 100) + optionsPnl) : optionsPnl;
  const winRate =
    (Number(w.stats?.totalLegs) || 0) > 0 ? (Number(w.stats?.wins) / Number(w.stats?.totalLegs)) * 100 : null;
  return {
    regime: regime ?? null,
    equityTotalValue: equityValue,
    equityTotalReturnPct: equityRet,
    optionsOpenLegs: (w.optionsLegs || []).length,
    optionsClosedLegs: (w.closedLegs || []).length,
    premiumCollected: prem,
    optionsPnl: optionsPnl,
    premiumYieldPct: parseFloat(premYield.toFixed(2)),
    combinedPnl: parseFloat(combinedPnl.toFixed(2)),
    winRatePct: winRate != null ? parseFloat(winRate.toFixed(1)) : null
  };
}

