import YahooFinance from 'yahoo-finance2';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

export async function pullTicker(ticker) {
  const result = { ticker: ticker.toUpperCase() };
  
  try {
    const [quoteData, quoteSummary, chartData] = await Promise.all([
      yf.quote(ticker),
      yf.quoteSummary(ticker, { modules: ['summaryDetail', 'defaultKeyStatistics', 'financialData', 'assetProfile', 'incomeStatementHistory', 'cashflowStatementHistory', 'balanceSheetHistory'] }),
      yf.chart(ticker, { period1: '2024-01-01', period2: '2025-12-31' })
    ]);

    result.price = quoteData?.regularMarketPrice || 0;
    result.beta = quoteData?.beta || 1;
    result.marketCap = quoteData?.marketCap || 0;
    result.sharesOutstanding = quoteData?.sharesOutstanding || 0;
    result.trailingEPS = quoteData?.trailingEps || 0;
    result.forwardEPS = quoteData?.forwardEps || 0;
    result.trailingPE = quoteData?.trailingPE || 0;
    result.forwardPE = result.forwardEPS > 0 ? result.price / result.forwardEPS : 0;
    result.priceToSales = quoteData?.priceToTrailingSales || 0;
    result.priceToBook = quoteData?.priceToBook || 0;
    result.week52High = quoteData?.fiftyTwoWeekHigh || 0;
    result.week52Low = quoteData?.fiftyTwoWeekLow || 0;
    result.week52HighChange = quoteData?.fiftyTwoWeekHighChange || 0;
    result.avgVolume = quoteData?.regularMarketVolume || 0;

    result.name = quoteData?.shortName || quoteData?.longName || ticker.toUpperCase();
    result.exchange = quoteData?.exchange || 'N/A';
    result.sector = quoteData?.sector || 'N/A';
    result.industry = quoteData?.industry || 'N/A';

    const summaryDetail = quoteSummary?.summaryDetail || {};
    const keyStats = quoteSummary?.defaultKeyStatistics || {};
    const financialData = quoteSummary?.financialData || {};
    const assetProfile = quoteSummary?.assetProfile || {};

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
    result.totalRevenue = financialData?.totalRevenue || quoteData?.totalRevenue || 0;
    result.grossProfit = financialData?.grossProfit || 0;
    result.operatingIncome = financialData?.operatingIncome || 0;
    result.netIncome = financialData?.netIncome || quoteData?.netIncomeToCommon || keyStats?.netIncome || 0;

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
    console.error(`Error pulling data for ${ticker}:`, error.message);
    result.error = error.message;
  }

  return result;
}

function calculateMA(prices, period) {
  if (!prices || prices.length < period) return null;
  const slice = prices.slice(-period);
  const valid = slice.filter(p => p !== null && p !== undefined);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
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
