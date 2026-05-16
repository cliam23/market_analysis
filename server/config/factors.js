/**
 * Default full_composite anchor (M/V/Q/E with room for adaptive IC shifts); DCF/valuation off.
 * Raw intent: 30/30/10/15% on M/V/Q/E → normalized to sum 1.
 */
export const DEFAULT_COMPOSITE_WEIGHTS = {
  momentum: 0.3 / 0.85,
  value: 0.3 / 0.85,
  fundamental: 0.1 / 0.85,
  earningsMomentum: 0.15 / 0.85,
  dcf: 0.0,
  valuation: 0.0
};
export const AGGRESSIVE_COMPOSITE_WEIGHTS = {
  fundamental: 0.25,
  dcf: 0.0,
  valuation: 0.1,
  momentum: 0.4,
  value: 0.25,
  earningsMomentum: 0
};
export const TURBO_COMPOSITE_WEIGHTS = {
  fundamental: 0.1,
  dcf: 0.0,
  valuation: 0.05,
  momentum: 0.55,
  value: 0.3,
  earningsMomentum: 0
};
/**
 * Sharpe-optimised mix from the 3y sweep: quality-led with a small earnings tilt.
 * Used as a pillarOverride default when the UI selects `full_composite_quality`.
 */
export const QUALITY_COMPOSITE_WEIGHTS = {
  fundamental: 0.40,
  dcf: 0.0,
  valuation: 0.0,
  momentum: 0.25,
  value: 0.25,
  earningsMomentum: 0.10
};
export const FACTOR_NAMES = ['fundamental', 'dcf', 'valuation', 'momentum', 'value', 'earningsMomentum'];
export const FACTOR_LABELS = {
  fundamental: 'Quality',
  dcf: 'DCF',
  valuation: 'Valuation',
  momentum: 'Momentum',
  value: 'Value',
  earningsMomentum: 'Earnings momentum'
};

// =====================================================================
// OPTIMIZATION GUARDRAILS
// =====================================================================

export const MAX_OPTIMIZATION_ROUNDS = 5;
export const MAX_WEIGHT_DELTA_PER_ROUND = 0.03;
export const MIN_SHARPE_IMPROVEMENT = 0.05;

export const WEIGHT_BOUNDS = {
  fundamental: { min: 0.02, max: 0.7 },
  dcf: { min: 0, max: 0.25 },
  valuation: { min: 0.02, max: 0.35 },
  momentum: { min: 0.02, max: 0.6 },
  value: { min: 0.02, max: 0.3 },
  earningsMomentum: { min: 0, max: 0.35 }
};

/** Same targets as DEFAULT_COMPOSITE_WEIGHTS; reference when an explicit fixed vector is needed. */
export const EQUAL_FIXED_COMPOSITE_WEIGHTS = {
  fundamental: DEFAULT_COMPOSITE_WEIGHTS.fundamental,
  dcf: 0.0,
  valuation: 0.0,
  momentum: DEFAULT_COMPOSITE_WEIGHTS.momentum,
  value: DEFAULT_COMPOSITE_WEIGHTS.value,
  earningsMomentum: DEFAULT_COMPOSITE_WEIGHTS.earningsMomentum ?? 0
};
