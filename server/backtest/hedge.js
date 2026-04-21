import { daysBetween } from '../utils/dates.js';

/**
 * SPY put hedge policy (backtest + paper recommendation). Pure function.
 * @param {string} regime — from calculateMarketRegime
 * @param {number} portfolioValue — NAV after rebalance assembly
 * @param {{ openDate: string, regime: string, notionalHedge: number, hedgePct: number, spyPxAtOpen: number, lastPremiumAccrualDate: string } | null} activeHedge
 */
export function evaluateHedgeNeed(regime, portfolioValue, activeHedge) {
  const r = regime != null ? String(regime).toLowerCase().trim() : '';
  const pv = Number(portfolioValue);
  const hasHedge = activeHedge != null && typeof activeHedge === 'object';

  if ((r === 'caution' || r === 'bear') && !hasHedge) {
    const hedgePct = r === 'bear' ? 0.5 : 0.3;
    const notionalHedge = (Number.isFinite(pv) && pv > 0 ? pv : 0) * hedgePct;
    const pctLabel = (hedgePct * 100).toFixed(0);
    return {
      action: 'OPEN_HEDGE',
      hedgePct,
      notionalHedge,
      regime: r,
      description: `Open SPY put hedge covering ${pctLabel}% of portfolio (~$${Math.round(notionalHedge)} notional)`
    };
  }
  if ((r === 'normal' || r === 'strong_bull') && hasHedge) {
    return { action: 'CLOSE_HEDGE', reason: `regime improved to ${r}` };
  }
  return { action: 'HOLD' };
}

/** Put premium drag: 0.5% of notional per 30.44-day month, pro-rated by calendar days. */
export function hedgePremiumForPeriod(activeHedge, toDateStr, notional) {
  if (!activeHedge || !toDateStr || !activeHedge.lastPremiumAccrualDate) return 0;
  const d = daysBetween(activeHedge.lastPremiumAccrualDate, toDateStr);
  if (d <= 0) return 0;
  const n = Number(notional);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n * 0.005 * (d / 30.44);
}
