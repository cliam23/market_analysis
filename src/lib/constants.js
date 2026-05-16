export const PILLAR_ORDER = ["fundamental", "dcf", "valuation", "momentum", "value"];
export const PILLAR_LABELS = {
  fundamental: "Quality",
  dcf: "DCF",
  valuation: "Valuation",
  momentum: "Momentum",
  value: "Value"
};

export const COMPOSITE_FAMILY = [
  "full_composite",
  "full_composite_quality",
  "full_composite_aggressive",
  "full_composite_turbo"
];
export function isCompositeStrategy(s) { return COMPOSITE_FAMILY.includes(s); }

export const UNIVERSE_OPTIONS = [
  { id: "sp500_top50", label: "S&P 500 Top 50" },
  { id: "sp500_top150", label: "S&P 500 Top 150" },
  { id: "vgt", label: "VGT" },
  { id: "mag7", label: "Mag 7" },
  { id: "russell_growth", label: "Russell Growth" },
  { id: "dividend_aristocrats", label: "Dividend Aristocrats" }
];

export const STRATEGY_OPTIONS = [
  { id: "full_composite_quality", label: "Composite Quality" },
  { id: "full_composite", label: "Full Composite" },
  { id: "full_composite_aggressive", label: "Composite Aggressive" },
  { id: "full_composite_turbo", label: "Composite Turbo" },
  { id: "quality_momentum", label: "Quality + Momentum" },
  { id: "momentum_value", label: "Momentum + Value" },
  { id: "momentum", label: "Momentum Only" }
];

export const TOP_N_OPTIONS = [
  { id: "5", label: "5" },
  { id: "10", label: "10" },
  { id: "15", label: "15" },
  { id: "20", label: "20" }
];

export const PERIOD_OPTIONS = [
  { id: "1y", label: "1 Year" },
  { id: "2y", label: "2 Years" },
  { id: "3y", label: "3 Years" },
  { id: "5y", label: "5 Years" }
];
