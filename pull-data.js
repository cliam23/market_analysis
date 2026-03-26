import YahooFinance from 'yahoo-finance2';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const QUOTE_BATCH_SIZE = 50;
const DEFAULT_CONCURRENCY = 6;

async function mapWithConcurrency(items, limit, mapper) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await mapper(items[i], i);
      } catch (err) {
        results[i] = { error: err };
      }
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/**
 * Batch Yahoo Finance quote (multiple symbols per HTTP round-trip).
 * @param {string[]} symbols
 * @returns {Promise<Map<string, object>>} upper symbol -> quote row
 */
export async function pullQuotesBatch(symbols) {
  const out = new Map();
  const uniq = [...new Set(symbols.map((s) => String(s).toUpperCase()).filter(Boolean))];
  for (let i = 0; i < uniq.length; i += QUOTE_BATCH_SIZE) {
    const chunk = uniq.slice(i, i + QUOTE_BATCH_SIZE);
    try {
      const rows = await yf.quote(chunk);
      const arr = Array.isArray(rows) ? rows : (rows ? [rows] : []);
      for (const row of arr) {
        const sym = row?.symbol;
        if (sym) out.set(String(sym).toUpperCase(), row);
      }
    } catch (e) {
      console.error('pullQuotesBatch error:', e.message);
    }
  }
  return out;
}

function calculateMA(prices, period) {
  if (!prices || prices.length < period) return null;
  const slice = prices.slice(-period);
  const valid = slice.filter((p) => p !== null && p !== undefined);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/**
 * Merge a live quote row into the same shape as pullTicker uses from yf.quote.
 */
function applyQuoteRowToResult(result, quoteData) {
  if (!quoteData) return;
  result.price = quoteData.regularMarketPrice ?? result.price;
  result.beta = quoteData.beta ?? result.beta;
  result.marketCap = quoteData.marketCap ?? result.marketCap;
  result.sharesOutstanding = quoteData.sharesOutstanding ?? result.sharesOutstanding;
  result.trailingEPS = quoteData.trailingEps ?? result.trailingEPS;
  result.forwardEPS = quoteData.forwardEps ?? result.forwardEPS;
  result.trailingPE = quoteData.trailingPE ?? result.trailingPE;
  result.forwardPE = result.forwardEPS > 0 ? result.price / result.forwardEPS : 0;
  result.priceToSales = quoteData.priceToTrailingSales ?? result.priceToSales;
  result.priceToBook = quoteData.priceToBook ?? result.priceToBook;
  result.week52High = quoteData.fiftyTwoWeekHigh ?? result.week52High;
  result.week52Low = quoteData.fiftyTwoWeekLow ?? result.week52Low;
  result.week52HighChange = quoteData.fiftyTwoWeekHighChange ?? result.week52HighChange;
  result.avgVolume = quoteData.regularMarketVolume ?? result.avgVolume;
  result.name = quoteData.shortName || quoteData.longName || result.name;
  result.exchange = quoteData.exchange || result.exchange;
  result.sector = quoteData.sector || result.sector;
  result.industry = quoteData.industry || result.industry;
}

/**
 * @param {string} ticker
 * @param {{ quoteHint?: object }} [options] Pass quoteHint from pullQuotesBatch to avoid an extra quote call.
 */
export async function pullTicker(ticker, options = {}) {
  const sym = ticker.toUpperCase();
  const result = { ticker: sym };

  try {
    let quoteData = options.quoteHint;
    if (quoteData === undefined) {
      const quoteMap = await pullQuotesBatch([sym]);
      quoteData = quoteMap.get(sym);
    }

    const [quoteSummary, chartData] = await Promise.all([
      yf.quoteSummary(sym, {
        modules: [
          'summaryDetail', 'defaultKeyStatistics', 'financialData', 'assetProfile',
          'incomeStatementHistory', 'cashflowStatementHistory', 'balanceSheetHistory'
        ]
      }),
      yf.chart(sym, { period1: '2024-01-01', period2: '2025-12-31' })
    ]);

    applyQuoteRowToResult(result, quoteData);

    const summaryDetail = quoteSummary?.summaryDetail || {};
    const keyStats = quoteSummary?.defaultKeyStatistics || {};
    const financialData = quoteSummary?.financialData || {};
    const assetProfile = quoteSummary?.assetProfile || {};

    if (!result.price && quoteSummary?.price) {
      const p = quoteSummary.price;
      result.price = p.regularMarketPrice || 0;
      result.name = p.shortName || p.longName || sym;
    }
    result.dividendYield = summaryDetail?.dividendYield || 0;
    result.dividendRate = summaryDetail?.dividendRate || 0;
    result.payoutRatio = keyStats?.payoutRatio || 0;
    result.currentRatio = summaryDetail?.currentRatio || 0;
    result.debtToEquity = summaryDetail?.debtToEquity || 0;
    result.totalDebtToEquity = summaryDetail?.totalDebtToEquity || 0;
    result.earningsGrowth = financialData?.earningsGrowth || keyStats?.earningsGrowth || 0;
    result.revenueGrowth = financialData?.revenueGrowth || keyStats?.revenueGrowth || 0;
    result.roe = financialData?.returnOnEquity || keyStats?.returnOnEquity || 0;
    result.roa = financialData?.returnOnAssets || keyStats?.returnOnAssets || 0;
    result.profitMargin = financialData?.profitMargins || keyStats?.profitMargins || 0;
    result.operatingMargin = financialData?.operatingMargins || keyStats?.operatingMargins || 0;
    result.grossMargin = financialData?.grossMargins || 0;
    result.freeCashflow = financialData?.freeCashflow || keyStats?.freeCashflow || 0;
    result.operatingCashflow = financialData?.operatingCashflow || keyStats?.operatingCashflow || 0;
    result.totalRevenue = financialData?.totalRevenue || 0;
    result.grossProfit = financialData?.grossProfit || 0;
    result.operatingIncome = financialData?.operatingIncome || 0;
    result.netIncome = financialData?.netIncome || 0;

    const incomeHistory = quoteSummary?.incomeStatementHistory?.incomeStatementHistory || [];
    const cashflowHistory = quoteSummary?.cashflowStatementHistory?.cashflowStatementHistory || [];
    const balanceHistory = quoteSummary?.balanceSheetHistory?.balanceSheetHistory || [];

    if (incomeHistory.length > 0) {
      const latest = incomeHistory[0];
      if (!result.totalRevenue || result.totalRevenue === 0) result.totalRevenue = latest?.totalRevenue || 0;
      if (!result.grossProfit || result.grossProfit === 0) result.grossProfit = latest?.grossProfit || 0;
      if (!result.operatingIncome || result.operatingIncome === 0) result.operatingIncome = latest?.operatingIncome || 0;
      if (!result.netIncome || result.netIncome === 0) result.netIncome = latest?.netIncome || 0;
    }

    if (cashflowHistory.length > 0) {
      const latest = cashflowHistory[0];
      if (!result.operatingCashflow || result.operatingCashflow === 0) result.operatingCashflow = latest?.operatingCashflow || 0;
      if (!result.capitalExpenditures || result.capitalExpenditures === 0) result.capitalExpenditures = latest?.capitalExpenditures || 0;
      if (!result.freeCashflow || result.freeCashflow === 0) result.freeCashflow = latest?.freeCashflow || 0;
      if (!result.repurchaseOfStock) result.repurchaseOfStock = latest?.repurchaseOfCapitalStock || 0;
    }

    if (balanceHistory.length > 0) {
      const latest = balanceHistory[0];
      if (!result.totalCash || result.totalCash === 0) result.totalCash = latest?.cash || latest?.cashAndCashEquivalents || 0;
      if (!result.totalDebt || result.totalDebt === 0) result.totalDebt = latest?.totalDebt || latest?.longTermDebt || 0;
      if (!result.totalAssets || result.totalAssets === 0) result.totalAssets = latest?.totalAssets || 0;
      if (!result.totalLiabilities) result.totalLiabilities = latest?.totalLiabilities || 0;
      if (!result.shareholderEquity) result.shareholderEquity = latest?.stockholdersEquity || 0;
      if (!result.bookValue) result.bookValue = latest?.bookValue || 0;
    }

    result.sector = result.sector || assetProfile?.sector || 'N/A';
    result.industry = result.industry || assetProfile?.industry || 'N/A';

    if (result.roe === 0 && result.netIncome !== 0 && result.shareholderEquity !== 0) {
      result.roe = result.netIncome / result.shareholderEquity;
    }

    if (chartData?.quotes?.[0]) {
      const quotes = chartData.quotes[0];
      result.closes = quotes.close || [];
      result.volumes = quotes.volume || [];

      if (result.closes.length > 0) {
        result.twoHundredDayMA = calculateMA(result.closes, 200);
        result.fiftyDayMA = calculateMA(result.closes, 50);
      }
    }

    result.earningsHistory = [];
    result.insiderHolders = [];
  } catch (error) {
    console.error(`Error pulling data for ${sym}:`, error.message);
    result.error = error.message;
  }

  return result;
}

/**
 * Pull many tickers: one batch quote pass + bounded parallel quoteSummary/chart per symbol.
 * @param {string[]} symbols
 * @param {{ concurrency?: number }} [opts]
 * @returns {Promise<Record<string, object>>} keyed by upper ticker
 */
export async function pullUniverseData(symbols, opts = {}) {
  const limit = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const uniq = [...new Set(symbols.map((s) => String(s).toUpperCase()).filter(Boolean))];
  const quoteMap = await pullQuotesBatch(uniq);

  const rows = await mapWithConcurrency(uniq, limit, async (sym) => {
    const data = await pullTicker(sym, { quoteHint: quoteMap.get(sym) });
    return { sym, data };
  });

  const out = {};
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const sym = uniq[i];
    if (row?.data && !row.error) out[sym] = row.data;
  }
  return out;
}

async function main(ticker) {
  if (!ticker) {
    console.log('Usage: node pull-data.js <TICKER>');
    process.exit(1);
  }

  console.log(`Pulling data for ${ticker}...`);
  const data = await pullTicker(ticker);
  console.log(JSON.stringify(data, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ticker = process.argv[2];
  main(ticker).catch(console.error);
}
