/**
 * Scan/momentum universes (may differ from backtest ticker lists in UNIVERSE_TICKERS).
 */
export const UNIVERSES = {
  sp500_top50: ["AAPL","MSFT","AMZN","NVDA","GOOGL","META","BRK-B","LLY","AVGO","JPM","TSLA","UNH","XOM","V","MA","PG","COST","JNJ","HD","ABBV","WMT","NFLX","BAC","KO","MRK","CRM","CVX","AMD","PEP","LIN","TMO","ADBE","ACN","MCD","CSCO","ABT","WFC","DHR","TXN","QCOM","ISRG","PM","INTU","GE","AMAT","AMGN","NEE","RTX","PFE","LOW"],
  sp500_full: ["AAPL","MSFT","AMZN","NVDA","GOOGL","META","BRK-B","LLY","AVGO","JPM","TSLA","UNH","XOM","V","MA","PG","COST","JNJ","HD","ABBV","WMT","NFLX","BAC","KO","MRK","CRM","CVX","AMD","PEP","LIN","TMO","ADBE","ACN","MCD","CSCO","ABT","WFC","DHR","TXN","QCOM","ISRG","PM","INTU","GE","AMAT","AMGN","NEE","RTX","PFE","LOW"],
  vgt: ["AAPL","MSFT","NVDA","AVGO","AMD","ADBE","CRM","ACN","CSCO","TXN","QCOM","INTU","AMAT","ADI","LRCX","KLAC","SNPS","CDNS","MRVL","FTNT","PANW","NOW","WDAY","TEAM","DDOG","ZS","CRWD","HUBS","TTD","NET"],
  russell_growth: ["DECK","AXON","FIX","TOST","DUOL","CAVA","CELH","ELF","BIRK","ONON","LULU","MNDY","PCVX","IOT","RELY","FRPT","KRYS","ACLX","DOC","CFLT"],
  dividend_aristocrats: ["JNJ","PG","KO","PEP","ABBV","MCD","WMT","LOW","CL","SHW","EMR","GD","ADP","AFL","ECL","CTAS","SWK","GWW","APD","BDX"],
  mag7: ["AAPL","MSFT","AMZN","NVDA","GOOGL","META","TSLA"]
};

export const UNIVERSE_TICKERS = {
  sp500_top50: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'GOOG', 'BRK-B', 'LLY', 'AVGO', 'JPM', 'XOM', 'UNH', 'TSLA', 'V', 'JNJ', 'PG', 'MA', 'HD', 'CVX', 'MRK', 'ABBV', 'PEP', 'COST', 'KO', 'ADBE', 'ACN', 'TMO', 'MCD', 'CSCO', 'ABT', 'DHR', 'CRM', 'WMT', 'BAC', 'LIN', 'CMCSA', 'VRTX', 'NFLX', 'AMD', 'TXN', 'NEE', 'PM', 'ORCL', 'INTU', 'QCOM', 'AMGN', 'UPS', 'HON', 'RTX', 'LOW', 'IBM', 'SPY'],
  vgt: ['MSFT', 'AAPL', 'NVDA', 'AVGO', 'CRM', 'AMD', 'ADBE', 'CSCO', 'ACN', 'INTU', 'TXN', 'QCOM', 'IBM', 'NOW', 'SNOW', 'PANW', 'MU', 'AMAT', 'LRCX', 'KLAC', 'MPWR', 'CDNS', 'FTNT', 'ANET', 'ON', 'HPQ', 'DELL', 'NXPI', 'INTC', 'STX', 'WDC', 'SPY'],
  mag7: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'TSLA', 'SPY'],
  russell_growth: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'TSLA', 'AVGO', 'AMD', 'AMAT', 'NFLX', 'CRM', 'ADBE', 'NOW', 'INTU', 'QCOM', 'TXN', 'MU', 'AMGN', 'SPY'],
  dividend_aristocrats: ['MMM', 'ABT', 'ABBV', 'AFL', 'ADP', 'BALL', 'BAC', 'CAH', 'CCL', 'CAT', 'CB', 'CINF', 'CTAS', 'CVX', 'CLX', 'KO', 'CL', 'COP', 'CTSH', 'CVS', 'SPY']
};

/** Ranks 51–100 (append after sp500_top50; overlaps deduped). */
const SP500_TOP150_TIER2 = [
  'ISRG', 'REGN', 'VRTX', 'MDLZ', 'SCHW', 'BSX', 'PLD', 'LRCX', 'KLAC',
  'SNPS', 'CDNS', 'PANW', 'CRWD', 'FTNT', 'CME', 'ICE', 'MCO', 'CTAS',
  'ORLY', 'AZO', 'FAST', 'PAYX', 'ODFL', 'SHW', 'ECL', 'APH', 'TT',
  'IR', 'CARR', 'GWW', 'ITW', 'ROK', 'EMR', 'ETN', 'NSC', 'CSX', 'WM',
  'RSG', 'PSA', 'O', 'AMT', 'CCI', 'EQIX', 'DLR', 'WELL', 'SPG',
  'EXR', 'MAA', 'ARE', 'AVB'
];

/** Ranks 101–150 (append after tier 2; overlaps deduped). */
const SP500_TOP150_TIER3 = [
  'IDXX', 'DXCM', 'ZTS', 'ALGN', 'ILMN', 'MKTX', 'MSCI', 'CPRT',
  'FICO', 'MPWR', 'MCHP', 'ON', 'TER', 'GLW', 'KEYS', 'ZBRA',
  'WAT', 'A', 'TMO', 'DHR', 'BDX', 'STE', 'MTD', 'BIO', 'TECH',
  'FTV', 'BR', 'TRMB', 'TYL', 'PAYC', 'POOL', 'WST',
  'RMD', 'TFX', 'HOLX', 'EW', 'PODD', 'INSP', 'NVST', 'ALGM',
  'ENTG', 'MKSI', 'LSCC', 'ANET', 'PSTG', 'SMCI', 'RVTY', 'MANH', 'GEN'
];

(function attachSp500Top150Universe() {
  const seen = new Set();
  const out = [];
  for (const t of UNIVERSE_TICKERS.sp500_top50) {
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  for (const t of SP500_TOP150_TIER2) {
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  for (const t of SP500_TOP150_TIER3) {
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  UNIVERSE_TICKERS.sp500_top150 = out;
})();

/** Same tickers as `sp500_top50`; separate paper book under different defaults (see paths.PAPER_PORTFOLIO_TOP50_SHADOW_PATH). */
UNIVERSE_TICKERS.sp500_top50_shadow = UNIVERSE_TICKERS.sp500_top50;

/** Same tickers as `sp500_top150`; separate paper book under different defaults (see paths.PAPER_PORTFOLIO_TOP150_SHADOW_PATH). */
UNIVERSE_TICKERS.sp500_top150_shadow = UNIVERSE_TICKERS.sp500_top150;

/** Same ticker list as backtest `sp500_top150` for /api/universe and momentum. */
UNIVERSES.sp500_top150 = UNIVERSE_TICKERS.sp500_top150;

/** UI + chart names for equal-weight universe benchmark (must match `universeId` route param). */
export const UNIVERSE_BENCHMARK_LABELS = {
  sp500_top50: { shortLabel: 'S&P Top 50', chartLabel: 'Equal-weight S&P Top 50' },
  sp500_top50_shadow: { shortLabel: 'S&P Top 50 (shadow)', chartLabel: 'Equal-weight S&P Top 50' },
  sp500_top150: { shortLabel: 'S&P Top 150', chartLabel: 'Equal-weight S&P Top 150' },
  sp500_top150_shadow: { shortLabel: 'S&P Top 150 (shadow)', chartLabel: 'Equal-weight S&P Top 150' },
  vgt: { shortLabel: 'VGT', chartLabel: 'VGT universe (equal-weight)' },
  mag7: { shortLabel: 'Mag 7', chartLabel: 'Mag 7 (equal-weight)' },
  russell_growth: { shortLabel: 'Russell growth', chartLabel: 'Russell growth (equal-weight)' },
  dividend_aristocrats: { shortLabel: 'Div. aristocrats', chartLabel: 'Dividend aristocrats (equal-weight)' }
};
