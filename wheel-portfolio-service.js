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
  maxWheelPositions: 8,
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
  minSignalCount:    1,
  // Soft caps: select up to maxWheelPositions, but blend CC/CSP rather than fill CCs first.
  // After blending by score, reserve at most maxCCFrac of slots for CCs (so CSPs always
  // compete on the merits of their EV/sellScore in non-bearish regimes).
  maxCCFrac:         0.625,
  // Reject any opp with EV worse than this (post-credit, in dollars). Set to null to
  // disable the gate. Defaults to 0 so we never knowingly open a negative-EV trade.
  minEV:             0,
  // Require IV rank ≥ this to avoid selling vol when it's too cheap.
  minIVRank:         35
};

function portfolioPath() {
  return path.isAbsolute(WHEEL_PORTFOLIO_FILE) ? WHEEL_PORTFOLIO_FILE : path.join(process.cwd(), WHEEL_PORTFOLIO_FILE);
}

// Truth: premiumCollected = sum of (entryCredit × 100 × qty) across open + closed legs.
// We can self-heal a corrupted counter from the persisted leg history.
function reconcilePremium(open = [], closed = []) {
  const sumOpen = (open || []).reduce(
    (a, l) => a + (Number(l.entryCredit) || 0) * 100 * (Number(l.quantity) || 1),
    0
  );
  const sumClosed = (closed || []).reduce(
    (a, l) => a + (Number(l.entryCredit) || 0) * 100 * (Number(l.quantity) || 1),
    0
  );
  return sumOpen + sumClosed;
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
    const optionsLegs = Array.isArray(raw.optionsLegs) ? raw.optionsLegs : [];
    const closedLegs  = Array.isArray(raw.closedLegs)  ? raw.closedLegs  : [];
    const truthPrem = reconcilePremium(optionsLegs, closedLegs);
    const recordedPrem = Number(raw.stats?.premiumCollected) || 0;
    // If the persisted counter diverges by > $5 or > 5%, prefer the reconciled truth.
    const drift = Math.abs(recordedPrem - truthPrem);
    const premiumCollected =
      drift > Math.max(5, truthPrem * 0.05) ? truthPrem : recordedPrem;
    return {
      optionsLegs,
      closedLegs,
      stats:
        raw.stats && typeof raw.stats === 'object'
          ? {
              totalOptionsPnl: Number(raw.stats.totalOptionsPnl) || 0,
              premiumCollected,
              wins: Number(raw.stats.wins) || 0,
              losses: Number(raw.stats.losses) || 0,
              totalLegs: Number(raw.stats.totalLegs) || 0
            }
          : { totalOptionsPnl: 0, premiumCollected, wins: 0, losses: 0, totalLegs: 0 },
      lastRun: raw.lastRun ?? null,
      lastOptimized: raw.lastOptimized ?? null
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
// Shared ranking score for both CCs and CSPs: blend academic sellScore with equity
// composite score AND option EV (rewards real dollar premium, not just signal strength).
function rankWheelOpp(o, eqCompositeScore = 0) {
  const sellPart = (o.sellScore ?? 0.3) * 50;
  const eqPart   = (Number(o.compositeScore ?? eqCompositeScore) || 0) * 0.5;
  // log-scaled EV: $50 EV ≈ 4 pts, $500 EV ≈ 6 pts, $5000 EV ≈ 8.5 pts
  const evPart   = Math.log(1 + Math.max(0, Number(o.ev) || 0)) * 1.0;
  const ivrPart  = Math.min(20, (Number(o.ivRank) || 0) * 0.10);
  return sellPart + eqPart + evPart + ivrPart;
}

export function selectWheelTargets(paperHoldings, opportunities, existingLegs, regime) {
  const held = new Set((paperHoldings || []).map((h) => String(h.ticker || '').toUpperCase()).filter(Boolean));
  const heldByTicker = new Map(
    (paperHoldings || []).map((h) => [String(h.ticker || '').toUpperCase(), h])
  );
  const active = new Set((existingLegs || []).map((l) => String(l.ticker || '').toUpperCase()).filter(Boolean));
  const slots = Math.max(0, WHEEL_CONFIG.maxWheelPositions - (existingLegs?.length ?? 0));
  if (slots <= 0) return [];

  const regimeAllowsCC = WHEEL_CONFIG.regimeAllowsCC.includes(regime);
  const regimeAllowsCSP = WHEEL_CONFIG.regimeAllowsCSP.includes(regime);

  const opps = Array.isArray(opportunities) ? opportunities : [];

  // ── Gate every opportunity through shared filters, then assign a rank score ──
  const ccCandidates = [];
  const cspCandidates = [];

  for (const o of opps) {
    if (!o || !o.optionSymbol) continue;
    const t = String(o.ticker || '').toUpperCase();
    if (!t || active.has(t)) continue;
    if (WHEEL_CONFIG.blockCheapOptions && o.gsSellEdge === false) continue;
    if (WHEEL_CONFIG.minSellScore > 0 && o.sellScore != null && o.sellScore < WHEEL_CONFIG.minSellScore) continue;
    if (WHEEL_CONFIG.minSignalCount > 1 && o.signalCount != null && o.signalCount < WHEEL_CONFIG.minSignalCount) continue;
    // EV gate: reject knowingly negative-EV trades when the scanner has produced a number.
    if (WHEEL_CONFIG.minEV != null && o.ev != null && Number(o.ev) < WHEEL_CONFIG.minEV) continue;
    // IV-rank floor: don't sell premium when implied vol is too cheap.
    if (WHEEL_CONFIG.minIVRank > 0 && o.ivRank != null && Number(o.ivRank) < WHEEL_CONFIG.minIVRank) continue;

    if (o.strategy === 'COVERED_CALL') {
      if (!regimeAllowsCC) continue;
      // CC only on tickers we own
      if (!held.has(t)) continue;
      const h = heldByTicker.get(t);
      const eqScore = Number(h?.compositeScore ?? h?.score ?? 0) || 0;
      if (eqScore > 0 && eqScore < WHEEL_CONFIG.scoreFloor) continue;
      const prem = Number(o.mid ?? o.premium ?? 0) || 0;
      const px   = Number(o.currentPrice ?? h?.currentPrice ?? h?.entryPrice ?? 0) || 0;
      if (px > 0 && prem / px < WHEEL_CONFIG.minPremiumPct) continue;
      ccCandidates.push({ t, opp: o, score: rankWheelOpp(o, eqScore), eqScore });
    } else if (o.strategy === 'CASH_SECURED_PUT') {
      if (!regimeAllowsCSP) continue;
      // CSP only on tickers we DON'T already own
      if (held.has(t)) continue;
      const eqScore = Number(o.compositeScore ?? 0) || 0;
      if (eqScore > 0 && eqScore < WHEEL_CONFIG.scoreFloor) continue;
      cspCandidates.push({ t, opp: o, score: rankWheelOpp(o, eqScore), eqScore });
    }
  }

  // Best opp per ticker (avoid duplicate strikes on same name)
  const dedupeByTicker = (arr) => {
    const byT = new Map();
    for (const c of arr) {
      const prev = byT.get(c.t);
      if (!prev || c.score > prev.score) byT.set(c.t, c);
    }
    return Array.from(byT.values()).sort((a, b) => b.score - a.score);
  };

  const ccSorted  = dedupeByTicker(ccCandidates);
  const cspSorted = dedupeByTicker(cspCandidates);

  // ── Allocate slots: respect maxCCFrac so CSPs can't be starved ──
  const maxCC = Math.max(0, Math.floor(slots * (Number(WHEEL_CONFIG.maxCCFrac) || 1)));
  const out = [];

  // Round-robin merge by score, but bound CC count by maxCC.
  let i = 0, j = 0, ccTaken = 0;
  while (out.length < slots && (i < ccSorted.length || j < cspSorted.length)) {
    const cc  = i < ccSorted.length && ccTaken < maxCC ? ccSorted[i]  : null;
    const csp = j < cspSorted.length                                   ? cspSorted[j] : null;
    if (!cc && !csp) break;
    const pick = !csp ? cc : !cc ? csp : (cc.score >= csp.score ? cc : csp);
    if (pick === cc) { i += 1; ccTaken += 1; }
    else             { j += 1; }
    const t = pick.t;
    if (active.has(t)) continue; // safety
    out.push({
      ticker: t,
      leg: pick.opp.strategy,
      opp: pick.opp,
      reason: pick.opp.strategy === 'COVERED_CALL'
        ? `CC on held ticker (${t}) · score ${pick.score.toFixed(1)}`
        : `CSP on high-score non-holding (${t}) · score ${pick.score.toFixed(1)}`
    });
    active.add(t);
  }

  // If CC cap left empty slots and CSPs are exhausted, refill with overflow CCs
  while (out.length < slots && i < ccSorted.length) {
    const pick = ccSorted[i]; i += 1;
    if (active.has(pick.t)) continue;
    out.push({
      ticker: pick.t,
      leg: pick.opp.strategy,
      opp: pick.opp,
      reason: `CC on held ticker (${pick.t}) · score ${pick.score.toFixed(1)} (overflow)`
    });
    active.add(pick.t);
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

