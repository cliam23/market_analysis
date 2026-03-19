import express from 'express';
import cors from 'cors';
import yf from 'yahoo-finance2';
import {
  safeNum, billions, calcMoatAnalysis, calcAIDisruption,
  calcROICSensitivity, calcProfitabilityPath, calcGrowthConstraints,
  getPeers, calculateComps, calcEarningsQuality, calcTotalShareholderYield, calcComposite
} from './analysis-engine.js';

const app = express();
const PORT = 3001;
app.use(cors());
app.use(express.json());

const yahooFinance = new yf({ 
  suppressNotices: ['yahooSurvey'] 
});

// Suppress all console output from yahoo-finance2 about deprecated APIs
try {
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalLog = console.log;
  
  const suppressPattern = /fundamentalsTimeSeries|financial statements submodules|QuoteSummary financial statements/i;
  
  console.error = (...args) => {
    if (suppressPattern.test(args[0]?.toString?.() || '')) return;
    originalError.apply(console, args);
  };
  
  console.warn = (...args) => {
    if (suppressPattern.test(args[0]?.toString?.() || '')) return;
    originalWarn.apply(console, args);
  };
  
  console.log = (...args) => {
    if (suppressPattern.test(args[0]?.toString?.() || '')) return;
    originalLog.apply(console, args);
  };
} catch(e) {
  // Ignore if console patching fails
}

// Helper: safely extract number from Yahoo Finance (handles {raw, fmt} objects)
function yfNum(val, def = null) {
  if (val == null || val === '' || (typeof val === 'number' && isNaN(val))) return def;
  if (typeof val === 'number') return val;
  if (typeof val === 'object') {
    if (val.raw != null) return typeof val.raw === 'number' ? val.raw : parseFloat(val.raw) || def;
    if (val.toString) return parseFloat(val.toString().replace(/[^0-9.-]/g, '')) || def;
  }
  if (typeof val === 'string') return parseFloat(val.replace(/[^0-9.-]/g, '')) || def;
  return def;
}

const UNIVERSES = {
  sp500_top50: ["AAPL","MSFT","AMZN","NVDA","GOOGL","META","BRK-B","LLY","AVGO","JPM","TSLA","UNH","XOM","V","MA","PG","COST","JNJ","HD","ABBV","WMT","NFLX","BAC","KO","MRK","CRM","CVX","AMD","PEP","LIN","TMO","ADBE","ACN","MCD","CSCO","ABT","WFC","DHR","TXN","QCOM","ISRG","PM","INTU","GE","AMAT","AMGN","NEE","RTX","PFE","LOW"],
  sp500_full: ["AAPL","MSFT","AMZN","NVDA","GOOGL","META","BRK-B","LLY","AVGO","JPM","TSLA","UNH","XOM","V","MA","PG","COST","JNJ","HD","ABBV","WMT","NFLX","BAC","KO","MRK","CRM","CVX","AMD","PEP","LIN","TMO","ADBE","ACN","MCD","CSCO","ABT","WFC","DHR","TXN","QCOM","ISRG","PM","INTU","GE","AMAT","AMGN","NEE","RTX","PFE","LOW"],
  vgt: ["AAPL","MSFT","NVDA","AVGO","AMD","ADBE","CRM","ACN","CSCO","TXN","QCOM","INTU","AMAT","ADI","LRCX","KLAC","SNPS","CDNS","MRVL","FTNT","PANW","NOW","WDAY","TEAM","DDOG","ZS","CRWD","HUBS","TTD","NET"],
  russell_growth: ["DECK","AXON","FIX","TOST","DUOL","CAVA","CELH","ELF","BIRK","ONON","LULU","MNDY","PCVX","IOT","RELY","FRPT","KRYS","ACLX","DOC","CFLT"],
  dividend_aristocrats: ["JNJ","PG","KO","PEP","ABBV","MCD","WMT","LOW","CL","SHW","EMR","GD","ADP","AFL","ECL","CTAS","SWK","GWW","APD","BDX"],
  mag7: ["AAPL","MSFT","AMZN","NVDA","GOOGL","META","TSLA"]
};

const MOMENTUM_CACHE = new Map();
const NETWORK_INPUT_CACHE = new Map();
const COMPS_CACHE = new Map();
const QUOTE_CACHE = new Map();
const BACKTEST_CACHE = new Map();
const CACHE_TTL = 15 * 60 * 1000;
const COMPS_CACHE_TTL = 30 * 60 * 1000;
const QUOTE_CACHE_TTL = 15 * 60 * 1000;
const BACKTEST_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const BACKTEST_CACHE_VERSION = 'v2';

function calcBuffettScore(data) {
  const scores = {};
  const criteria = {};

  const marketCap = safeNum(data.marketCap);
  const price = safeNum(data.price);
  const sharesOutstanding = safeNum(data.sharesOutstanding);
  const operatingCF = safeNum(data.operatingCashflow);
  const capex = safeNum(data.capitalExpenditures);
  const beta = safeNum(data.beta, 1);
  const trailingEPS = safeNum(data.trailingEPS);
  const forwardEPS = safeNum(data.forwardEPS);
  const totalCash = safeNum(data.totalCash);
  const totalDebt = safeNum(data.totalDebt);
  const grossMargin = safeNum(data.grossMargin, 0) * 100;  // Convert decimal to percent
  const operatingMargin = safeNum(data.operatingMargin, 0) * 100;  // Convert decimal to percent
  const profitMargin = safeNum(data.profitMargin, 0) * 100;  // Convert decimal to percent
  const roe = safeNum(data.roe, 0) * 100;  // Convert decimal to percent
  const payoutRatio = safeNum(data.payoutRatio, 0) * 100;
  const repurchase = safeNum(data.repurchaseOfStock);
  const forwardPE = safeNum(data.forwardPE);
  const totalRevenue = safeNum(data.totalRevenue);
  const netIncome = safeNum(data.netIncome);

  const calcGrossMargin = grossMargin;
  const calcOperatingMargin = operatingMargin;
  const calcProfitMargin = profitMargin;
  const calcROE = roe;

  const ownerEarnings = operatingCF + capex;
  const ownerEarningsYield = marketCap > 0 ? (ownerEarnings / marketCap) * 100 : 0;
  const riskFreeRate = 4.3;
  
  let oeScore = 4;
  if (ownerEarningsYield >= 8.6) oeScore = 20;
  else if (ownerEarningsYield >= 6.5) oeScore = 16;
  else if (ownerEarningsYield >= 4.3) oeScore = 12;
  else if (ownerEarningsYield >= 2.15) oeScore = 8;
  
  scores.ownerEarnings = oeScore;
  criteria.ownerEarnings = {
    pass: oeScore >= 12,
    value: ownerEarningsYield.toFixed(1),
    multiplier: riskFreeRate > 0 ? (ownerEarningsYield / riskFreeRate).toFixed(1) : 'N/A'
  };

  const normalizedEPS = forwardEPS > 0 && trailingEPS > 0 
    ? (forwardEPS + trailingEPS) / 2 
    : (forwardEPS > 0 ? forwardEPS : (trailingEPS > 0 ? trailingEPS : price * 0.08));
  
  let wacc = 9.5;
  if (beta < 0.8) wacc = 8;
  else if (beta > 1.3) wacc = 11;
  
  const multiplier = Math.min(1 / (wacc / 100), 15);
  const netCashPerShare = sharesOutstanding > 0 ? (totalCash - totalDebt) / sharesOutstanding : 0;
  const intrinsicValue = normalizedEPS * multiplier + netCashPerShare;
  const marginOfSafety = price > 0 ? ((intrinsicValue - price) / price) * 100 : 0;
  
  let mosScore = 4;
  if (marginOfSafety >= 25) mosScore = 20;
  else if (marginOfSafety >= 15) mosScore = 16;
  else if (marginOfSafety >= 5) mosScore = 12;
  else if (marginOfSafety >= 0) mosScore = 8;
  
  scores.marginOfSafety = mosScore;
  criteria.marginOfSafety = {
    pass: mosScore >= 12,
    value: marginOfSafety.toFixed(1),
    iv: intrinsicValue.toFixed(2)
  };

  const signals = [
    forwardEPS > trailingEPS,
    calcOperatingMargin > 0,
    calcProfitMargin > 0,
    safeNum(data.earningsGrowth, 0) > -1 && safeNum(data.earningsGrowth, 0) < 2.5
  ];
  const signalCount = signals.filter(Boolean).length;
  
  let ecScore = 3;
  if (signalCount === 4) ecScore = 15;
  else if (signalCount === 3) ecScore = 11;
  else if (signalCount === 2) ecScore = 7;
  
  scores.earningsConsistency = ecScore;
  criteria.earningsConsistency = {
    pass: ecScore >= 9,
    value: `${signalCount}/4`,
    signals: {
      growth: forwardEPS > trailingEPS,
      opMargin: calcOperatingMargin > 0,
      netMargin: calcProfitMargin > 0,
      peg: safeNum(data.earningsGrowth, 0) > -1 && safeNum(data.earningsGrowth, 0) < 2.5
    }
  };

  let roeSub = 0;
  if (calcROE > 15) roeSub = 3.75;
  else if (calcROE > 10) roeSub = 2.5;
  else if (calcROE > 5) roeSub = 1.25;
  
  // Check buybacks: from cashflow if available, else infer from high ROE + low book value
  const buybacksFromCF = repurchase < 0;
  const buybacksInferred = calcROE > 40 && data.bookValue < 30;  // High ROE with moderate book value suggests buybacks
  const hasBuybacks = buybacksFromCF || buybacksInferred;
  const buybackSub = hasBuybacks ? 3.75 : 1;
  
  let payoutSub = 0;
  if (payoutRatio < 40) payoutSub = 3.75;
  else if (payoutRatio < 60) payoutSub = 2.5;
  else if (payoutRatio < 80) payoutSub = 1.25;
  
  const mqScore = Math.round(roeSub + buybackSub + payoutSub + 0.5);
  
  scores.managementQuality = mqScore;
  const buybackDisplay = buybacksFromCF ? 'Yes (CF)' : (buybacksInferred ? 'Yes (inferred)' : 'No');
  criteria.managementQuality = {
    pass: mqScore >= 9,
    roe: calcROE.toFixed(1),
    buyback: buybackDisplay,
    payout: payoutRatio.toFixed(0) + '%'
  };

  const effectiveGM = calcGrossMargin || grossMargin;
  let bsScore = 3;
  if (effectiveGM >= 60) bsScore = 15;
  else if (effectiveGM >= 40) bsScore = 12;
  else if (effectiveGM >= 25) bsScore = 8;
  else if (effectiveGM >= 15) bsScore = 5;
  
  scores.businessSimplicity = bsScore;
  criteria.businessSimplicity = {
    pass: bsScore >= 8,
    value: effectiveGM.toFixed(1)
  };

  const dcaSignals = [
    calcROE > 15,
    calcOperatingMargin > 15,
    effectiveGM > 40
  ];
  const dcaCount = dcaSignals.filter(Boolean).length;
  
  let dcaScore = 3;
  if (dcaCount === 3) dcaScore = 15;
  else if (dcaCount === 2) dcaScore = 10;
  else if (dcaCount === 1) dcaScore = 6;
  
  scores.durableAdvantage = dcaScore;
  criteria.durableAdvantage = {
    pass: dcaScore >= 10,
    value: `${dcaCount}/3`,
    signals: {
      roe: calcROE > 15,
      opMargin: calcOperatingMargin > 15,
      grossMargin: effectiveGM > 40
    }
  };

  const totalBuffett = Object.values(scores).reduce((a, b) => a + b, 0);
  
  return { scores, criteria, total: totalBuffett, wacc, intrinsicValue };
}

function calcROIC(data) {
  const price = safeNum(data.price);
  const sharesOutstanding = safeNum(data.sharesOutstanding);
  const totalRevenue = safeNum(data.totalRevenue);
  const totalDebt = safeNum(data.totalDebt);
  const shareholderEquity = safeNum(data.shareholderEquity);
  const totalAssets = safeNum(data.totalAssets);
  const beta = safeNum(data.beta, 1);
  
  // Derive from financialData-based values (now populated in fetchQuoteData)
  const operatingMargin = safeNum(data.operatingMargin, 0);
  const grossMargin = safeNum(data.grossMargin, 0);
  const operatingIncome = safeNum(data.operatingIncome);
  const netIncome = safeNum(data.netIncome);
  const roa = safeNum(data.roa, 0);
  const roe = safeNum(data.roe, 0);
  const bookValuePerShare = safeNum(data.bookValue, 0);
  const totalCash = safeNum(data.totalCash, 0);
  
  // NOPAT: operating income * (1 - tax rate)
  const taxRate = 0.21;
  const nopat = operatingIncome > 0 ? operatingIncome * (1 - taxRate) : (totalRevenue > 0 && operatingMargin > 0 ? totalRevenue * operatingMargin * (1 - taxRate) : 0);
  
  // Book equity method
  const bookEquity = shareholderEquity > 0 ? shareholderEquity : (bookValuePerShare * sharesOutstanding);
  const investedCapital_method1 = totalDebt + bookEquity;
  
  // Check if asset turnover seems too high (indicates buybacks eroded book equity)
  const assetTurnoverCheck = investedCapital_method1 > 0 ? totalRevenue / investedCapital_method1 : 0;
  
  let investedCapital = investedCapital_method1;
  let investedCapitalAdjusted = false;
  let adjustmentReason = "";
  
  if (assetTurnoverCheck > 3.0 || (roe > 1.0 && bookValuePerShare < 20)) {
    // Company has likely eroded book equity through buybacks
    // Use ROA-based estimation instead
    let investedCapital_method2 = 0;
    if (roa > 0 && netIncome > 0) {
      // Total Assets = Net Income / ROA
      const estimatedTotalAssets = netIncome / roa;
      // Invested capital = total assets - excess cash
      const excessCash = Math.max(0, totalCash - totalRevenue * 0.05);  // keep 5% of revenue as operating cash
      investedCapital_method2 = estimatedTotalAssets - excessCash;
    }
    
    // Method 3: Cap asset turnover at 2.0x and back-solve
    const investedCapital_method3 = totalRevenue / 2.0;
    
    // Use the higher of method2 and method3 (more conservative)
    const altCapital = Math.max(investedCapital_method2, investedCapital_method3);
    
    if (altCapital > investedCapital_method1) {
      investedCapital = altCapital;
      investedCapitalAdjusted = true;
      adjustmentReason = "Adjusted for share buyback impact on book equity";
    }
  }
  
  // ROIC
  const roic = investedCapital > 0 ? (nopat / investedCapital) * 100 : 
               (roa > 0 ? roa * 100 * (1 - taxRate) : 0);
  
  let wacc = 9.5;
  if (beta < 0.8) wacc = 8;
  else if (beta > 1.2) wacc = 11;
  
  const spread = roic - wacc;
  
  // NOPAT margin
  const nopatMargin = operatingMargin * (1 - taxRate) * 100;
  
  // Asset turnover
  const assetTurnover = investedCapital > 0 ? totalRevenue / investedCapital : 
                       (totalAssets > 0 ? totalRevenue / totalAssets : 0);
  
  let trend = 'Weak';
  if (roic > 20) trend = 'Strong';
  else if (roic >= 15) trend = 'Solid';
  else if (roic >= 10) trend = 'Moderate';
  
  let lever = 'Maintain operational excellence';
  if (nopatMargin < 15 && assetTurnover > 1.0) lever = 'Margin expansion';
  else if (nopatMargin > 15 && assetTurnover < 0.8) lever = 'Capital efficiency';
  else if (nopatMargin < 15 && assetTurnover < 0.8) lever = 'Margin expansion';
  
  let newROIC = roic;
  if (lever === 'Margin expansion' && nopatMargin > 0) {
    newROIC = ((nopatMargin + 2) / 100) * (assetTurnover || 1) * 100;
  } else if (lever === 'Capital efficiency' && assetTurnover > 0) {
    newROIC = nopatMargin / 100 * (assetTurnover + 0.1) * 100;
  }
  
  return { 
    roic: roic.toFixed(1), 
    wacc, 
    spread: spread.toFixed(1), 
    nopatMargin: nopatMargin.toFixed(1), 
    assetTurnover: assetTurnover.toFixed(2), 
    trend, 
    lever, 
    newROIC: newROIC.toFixed(1),
    investedCapitalAdjusted,
    adjustmentReason,
    grossMargin: grossMargin,
    operatingMargin: operatingMargin
  };
}

function calcProfitability(data) {
  const grossMargin = safeNum(data.grossMargin, 0) * 100;  // Convert decimal to percent
  const beta = safeNum(data.beta, 1);
  const operatingMargin = safeNum(data.operatingMargin, 0) * 100;  // Convert decimal to percent
  const freeCashflow = safeNum(data.freeCashflow);
  const netIncome = safeNum(data.netIncome);
  
  let recurring = 5;
  if (grossMargin >= 60) recurring = 25;
  else if (grossMargin >= 50) recurring = 20;
  else if (grossMargin >= 40) recurring = 15;
  else if (grossMargin >= 25) recurring = 10;
  
  let stability = 5;
  if (beta <= 0.7) stability = 25;
  else if (beta <= 1.0) stability = 20;
  else if (beta <= 1.3) stability = 15;
  else if (beta <= 1.6) stability = 10;
  
  let margin = 5;
  if (operatingMargin >= 25) margin = 25;
  else if (operatingMargin >= 18) margin = 20;
  else if (operatingMargin >= 12) margin = 15;
  else if (operatingMargin >= 5) margin = 10;
  
  const fcfRatio = netIncome !== 0 ? Math.abs(freeCashflow / netIncome) : (freeCashflow > 0 ? 0.8 : 0);
  let conversion = 5;
  if (fcfRatio >= 1.0) conversion = 25;
  else if (fcfRatio >= 0.8) conversion = 20;
  else if (fcfRatio >= 0.6) conversion = 15;
  else if (fcfRatio >= 0.4) conversion = 10;
  
  const total = recurring + stability + margin + conversion;
  
  return {
    recurring, stability, margin, conversion, total,
    gm: grossMargin.toFixed(1),
    beta: beta.toFixed(2),
    opMargin: operatingMargin.toFixed(1),
    fcfRatio: (fcfRatio * 100).toFixed(0) + '%'
  };
}

function calcConstraints(data) {
  const forwardPE = safeNum(data.forwardPE);
  const priceToSales = safeNum(data.priceToSales);
  const debtToEquity = safeNum(data.debtToEquity) || safeNum(data.totalDebtToEquity) || 0;
  const earningsGrowth = safeNum(data.earningsGrowth, 0);
  const forwardEPS = safeNum(data.forwardEPS);
  const trailingEPS = safeNum(data.trailingEPS);
  const sector = (data.sector || '').toLowerCase();
  
  let valuation = 'low';
  if (forwardPE > 30 || priceToSales > 10) valuation = 'high';
  else if (forwardPE > 25 || priceToSales > 7) valuation = 'moderate';
  
  let debt = 'low';
  if (debtToEquity > 150) debt = 'high';
  else if (debtToEquity > 80) debt = 'moderate';
  
  const peg = earningsGrowth !== 0 && forwardPE > 0 ? forwardPE / (earningsGrowth * 100) : 
              (forwardEPS < trailingEPS ? 2.6 : 1.5);
  let growth = 'low';
  if (peg > 2.5 || forwardEPS < trailingEPS) growth = 'high';
  else if (peg > 1.5) growth = 'moderate';
  
  let sectorRisk = 'low';
  if (sector.includes('technology') || sector.includes('healthcare') || sector.includes('financial')) {
    sectorRisk = 'moderate';
  }
  
  const allSeverities = [valuation, debt, growth, sectorRisk];
  const overall = allSeverities.includes('high') ? 'High' : (allSeverities.includes('moderate') ? 'Moderate' : 'Low');
  
  return { valuation, debt, growth, sectorRisk, overall, peg: peg.toFixed(1), fwdPE: forwardPE.toFixed(1), de: debtToEquity.toFixed(0) };
}

function calcEntryTiming(data) {
  const price = safeNum(data.price);
  const week52High = safeNum(data.week52High);
  const twoHundredDayMA = safeNum(data.twoHundredDayMA);
  const forwardPE = safeNum(data.forwardPE);
  const marginOfSafety = safeNum(data.marginOfSafety || 0, 0);
  
  const distanceFromHigh = week52High > 0 ? ((week52High - price) / week52High) * 100 : 0;
  let week52Score = 5;
  if (distanceFromHigh <= 5) week52Score = 0;
  else if (distanceFromHigh <= 15) week52Score = 2;
  else if (distanceFromHigh <= 30) week52Score = 4;
  
  const maDistance = twoHundredDayMA > 0 ? ((price - twoHundredDayMA) / twoHundredDayMA) * 100 : 0;
  let maScore = 4;
  if (maDistance > 10) maScore = 0;
  else if (maDistance >= -10) maScore = 2;
  else if (maDistance >= -15) maScore = 3;
  
  let mosScore = 1;
  if (marginOfSafety >= 16) mosScore = 4;
  else if (marginOfSafety >= 12) mosScore = 3;
  else if (marginOfSafety >= 8) mosScore = 2;
  
  let peScore = 0;
  if (forwardPE > 0 && forwardPE < 12) peScore = 4;
  else if (forwardPE < 18) peScore = 3;
  else if (forwardPE < 25) peScore = 2;
  else if (forwardPE < 35) peScore = 1;
  
  const total = week52Score + maScore + peScore + (maScore === 4 ? 2 : 0);
  
  let signal = 'wait';
  if (total >= 13) signal = 'strong_buy';
  else if (total >= 9) signal = 'buy_zone';
  else if (total >= 5) signal = 'accumulate';
  
  // Overextension warning
  let overextendedWarning = null;
  if (maDistance > 40) {
    overextendedWarning = `Trading ${maDistance.toFixed(0)}% above 200-day MA — extreme overextension with high mean-reversion risk`;
  } else if (maDistance > 25) {
    overextendedWarning = `Trading ${maDistance.toFixed(0)}% above 200-day MA — elevated mean-reversion risk`;
  }
  
  return { 
    week52: week52Score, 
    ma: maScore, 
    mos: mosScore, 
    pe: peScore, 
    total, 
    signal, 
    distance: distanceFromHigh.toFixed(1), 
    maDistance: twoHundredDayMA > 0 ? maDistance.toFixed(1) : 'N/A',
    overextended: maDistance > 40,
    overextendedWarning
  };
}

function calcIntrinsicValue(data, wacc) {
  const price = safeNum(data.price);
  const forwardEPS = safeNum(data.forwardEPS);
  const trailingEPS = safeNum(data.trailingEPS);
  const freeCashflow = safeNum(data.freeCashflow);
  const sharesOutstanding = safeNum(data.sharesOutstanding);
  const bookValue = safeNum(data.bookValue);
  const beta = safeNum(data.beta, 1);
  const totalRevenue = safeNum(data.totalRevenue);
  const netIncome = safeNum(data.netIncome);
  const roe = safeNum(data.roe, 0);
  const totalCash = safeNum(data.totalCash, 0);
  const totalDebt = safeNum(data.totalDebt, 0);
  
  let waccRate = wacc || 9.5;
  if (beta < 0.8) waccRate = 8;
  else if (beta > 1.3) waccRate = 11;
  
  const eps = forwardEPS > 0 ? forwardEPS : (trailingEPS > 0 ? trailingEPS : 0);
  
  // EPV with growth adjustment
  const baseMultiplier = Math.min(1 / (waccRate / 100), 15);
  const growthRate = forwardEPS > 0 && trailingEPS > 0 ? (forwardEPS / trailingEPS - 1) : 0;
  const growthBonus = Math.min(growthRate * 10, 5);
  const adjustedMultiplier = Math.min(baseMultiplier + growthBonus, 25);
  
  // Cap net cash impact
  const netCashPerShare = sharesOutstanding > 0 ? (totalCash - totalDebt) / sharesOutstanding : 0;
  const maxDebtDrag = eps * adjustedMultiplier * 0.20;
  const adjustedNetCash = Math.max(netCashPerShare, -maxDebtDrag);
  
  const epvValue = eps * adjustedMultiplier + adjustedNetCash;
  
  // FCF valuation
  const fcfPerShare = sharesOutstanding > 0 ? freeCashflow / sharesOutstanding : 
                     (totalRevenue > 0 ? freeCashflow / totalRevenue * 0.1 : 0);
  const fcfValue = waccRate > 0 && fcfPerShare > 0 ? fcfPerShare / (waccRate / 100) : 0;
  
  // Graham Number or alternative for buyback-heavy companies
  let grahamValue = 0;
  let method3Label = "Graham Number";
  
  if (bookValue < 10 || roe > 1.0) {
    // Graham Number not applicable — use earnings-based alternative
    const conservativePE = Math.min(forwardEPS > 0 ? (price / forwardEPS) : 20, 20);
    grahamValue = forwardEPS * conservativePE;
    method3Label = "Earnings Multiple";
  } else if (eps > 0 && bookValue > 0) {
    grahamValue = Math.sqrt(22.5 * eps * bookValue);
  }
  
  // Use MEDIAN instead of mean to avoid outlier distortion
  const validValues = [epvValue, fcfValue, grahamValue].filter(v => v > 0 && !isNaN(v));
  let intrinsicValue;
  if (validValues.length === 0) {
    intrinsicValue = epvValue;
  } else if (validValues.length === 1) {
    intrinsicValue = validValues[0];
  } else if (validValues.length === 2) {
    intrinsicValue = (validValues[0] + validValues[1]) / 2;
  } else {
    // Sort and use median
    validValues.sort((a, b) => a - b);
    intrinsicValue = validValues[1];  // Median
  }
  
  const undervaluation = price > 0 && intrinsicValue > 0 ? ((intrinsicValue - price) / price) * 100 : 0;
  
  return {
    epv: epvValue > 0 ? epvValue.toFixed(2) : 'N/A',
    fcf: fcfValue > 0 ? fcfValue.toFixed(2) : 'N/A',
    graham: grahamValue > 0 && !isNaN(grahamValue) ? grahamValue.toFixed(2) : 'N/A',
    method3Label,
    avg: intrinsicValue > 0 ? intrinsicValue.toFixed(2) : 'N/A',
    undervaluation: undervaluation.toFixed(1)
  };
}

function getVerdict(buffettScore, marginOfSafety = 0) {
  // If significantly overvalued, cap the verdict regardless of quality score
  if (marginOfSafety < -50) return 'avoid';           // >50% overvalued
  if (marginOfSafety < -25) return 'hold';            // 25-50% overvalued
  
  // If quality is poor, cap at hold
  if (buffettScore < 40) return 'avoid';
  
  // Combined scoring
  if (buffettScore >= 75 && marginOfSafety > 15) return 'strong_buy';
  if (buffettScore >= 60 && marginOfSafety > 5) return 'buy';
  if (buffettScore >= 50 && marginOfSafety > 0) return 'accumulate';
  if (buffettScore >= 50 && marginOfSafety > -15) return 'hold';
  if (buffettScore >= 40 && marginOfSafety > -25) return 'hold';
  
  return 'avoid';
}

async function fetchQuoteData(ticker) {
  const cached = QUOTE_CACHE.get(ticker);
  if (cached && Date.now() - cached.timestamp < QUOTE_CACHE_TTL) {
    return cached.data;
  }

  const modules = ['price', 'summaryDetail', 'summaryProfile', 'defaultKeyStatistics',
                   'financialData', 'incomeStatementHistory', 'balanceSheetHistory',
                   'cashflowStatementHistory', 'earningsTrend'];

  const data = await yahooFinance.quoteSummary(ticker, { modules });
  
  const p = data.price || {};
  const sd = data.summaryDetail || {};
  const sp = data.summaryProfile || {};
  const ks = data.defaultKeyStatistics || {};
  const fd = data.financialData || {};
  const incHistory = data.incomeStatementHistory?.incomeStatementHistory || [];
  const inc = incHistory[0] || {};
  const bs = data.balanceSheetHistory?.balanceSheetHistory?.[0] || {};
  const cf = data.cashflowStatementHistory?.cashflowStatementHistory?.[0] || {};
  
  // Check data availability
  const hasIncomeHistory = incHistory.length > 0 && (inc.totalRevenue > 0 || inc.grossProfit > 0 || inc.operatingIncome > 0);
  const hasCashflowHistory = cf && (cf.totalCashFromOperatingActivities !== undefined || cf.capitalExpenditures !== undefined);
  const hasBalanceSheet = bs && (bs.totalStockholderEquity > 0 || bs.totalDebt > 0 || bs.totalAssets > 0);
  
  // Derive values from financialData when statement history is unavailable
  const fdRevenue = fd.totalRevenue || 0;
  const fdGrossMargin = fd.grossMargins || 0;
  const fdOpMargin = fd.operatingMargins || 0;
  const fdProfitMargin = fd.profitMargins || 0;
  
  // Use income statement data if available, otherwise derive from financialData
  const totalRevenue = hasIncomeHistory ? inc.totalRevenue : fdRevenue;
  const grossProfit = hasIncomeHistory && inc.grossProfit > 0 ? inc.grossProfit : (fdRevenue > 0 && fdGrossMargin > 0 ? fdRevenue * fdGrossMargin : 0);
  const operatingIncome = hasIncomeHistory && inc.operatingIncome > 0 ? inc.operatingIncome : (fdRevenue > 0 && fdOpMargin > 0 ? fdRevenue * fdOpMargin : 0);
  const netIncome = hasIncomeHistory && inc.netIncome > 0 ? inc.netIncome : (fdRevenue > 0 && fdProfitMargin > 0 ? fdRevenue * fdProfitMargin : 0);
  
  // Operating CF and FCF
  const operatingCF = hasCashflowHistory && cf.totalCashFromOperatingActivities !== undefined 
    ? cf.totalCashFromOperatingActivities 
    : (netIncome > 0 ? netIncome * 1.1 : 0); // Estimate: net income + ~10% for D&A
  const capex = hasCashflowHistory ? Math.abs(cf.capitalExpenditures || 0) : 0;
  const freeCashflow = hasCashflowHistory && cf.totalCashFromOperatingActivities !== undefined
    ? cf.totalCashFromOperatingActivities + (cf.capitalExpenditures || 0)
    : (fd.ebitda ? fd.ebitda * 0.7 : netIncome * 0.8); // Estimate from EBITDA or net income
  
  // Balance sheet - prefer actual data, fall back to derived
  const totalCash = hasBalanceSheet && bs.cash > 0 ? bs.cash : (fd.totalCash || 0);
  const totalDebt = hasBalanceSheet && (bs.totalDebt > 0 || bs.longTermDebt > 0) 
    ? (bs.totalDebt || bs.longTermDebt) 
    : (fd.totalDebt || 0);
  const shareholderEquity = hasBalanceSheet && bs.totalStockholderEquity > 0 
    ? bs.totalStockholderEquity 
    : (ks.bookValue && ks.sharesOutstanding ? ks.bookValue * ks.sharesOutstanding : netIncome * 10);
  const totalAssets = hasBalanceSheet && bs.totalAssets > 0 ? bs.totalAssets : (shareholderEquity + totalDebt);
  
  // Margins - prefer financialData, fall back to derived
  const grossMargin = fdGrossMargin > 0 ? fdGrossMargin : (totalRevenue > 0 && grossProfit > 0 ? grossProfit / totalRevenue : 0);
  const operatingMargin = fdOpMargin > 0 ? fdOpMargin : (totalRevenue > 0 && operatingIncome > 0 ? operatingIncome / totalRevenue : 0);
  const profitMargin = fdProfitMargin > 0 ? fdProfitMargin : (totalRevenue > 0 && netIncome > 0 ? netIncome / totalRevenue : 0);
  
  // Build income statements for trend analysis - use what we have
  const incomeStatements = incHistory.length > 0 && inc.totalRevenue > 0
    ? incHistory.map(y => ({
        totalRevenue: y.totalRevenue || 0,
        costOfRevenue: y.costOfRevenue || 0,
        grossProfit: y.grossProfit || 0,
        totalOperatingExpenses: y.totalOperatingExpenses || 0,
        operatingIncome: y.operatingIncome || 0,
        netIncome: y.netIncome || 0
      }))
    : [{
        totalRevenue,
        grossProfit,
        operatingIncome,
        netIncome
      }];
  
  const result = {
    ticker: p.symbol || ticker,
    name: p.shortName || p.longName || ticker,
    price: p.regularMarketPrice || 0,
    marketCap: p.marketCap || 0,
    sharesOutstanding: p.sharesOutstanding || ks.sharesOutstanding || 0,
    beta: sd.beta || ks.beta || 1,
    trailingEPS: ks.trailingEps || 0,
    forwardEPS: ks.forwardEps || 0,
    forwardPE: safeNum(p.forwardPE || (ks.forwardEps ? p.regularMarketPrice / ks.forwardEps : 0)),
    trailingPE: p.trailingPE || 0,
    priceToSales: sd.priceToSales || 0,
    priceToBook: sd.priceToBook || 0,
    week52High: sd.fiftyTwoWeekHigh || 0,
    week52Low: sd.fiftyTwoWeekLow || 0,
    twoHundredDayMA: sd.twoHundredDayAverage || 0,
    fiftyDayMA: sd.fiftyDayAverage || 0,
    dividendYield: sd.dividendYield || 0,
    dividendRate: sd.dividendRate || 0,
    payoutRatio: sd.payoutRatio || ks.payoutRatio || 0,
    currentRatio: fd.currentRatio || sd.currentRatio || 0,
    debtToEquity: fd.debtToEquity || sd.debtToEquity || 0,
    totalDebtToEquity: sd.totalDebtToEquity || 0,
    earningsGrowth: fd.earningsGrowth || ks.earningsGrowth || 0,
    revenueGrowth: fd.revenueGrowth || ks.revenueGrowth || 0,
    roe: fd.returnOnEquity || ks.returnOnEquity || 0,
    roa: fd.returnOnAssets || ks.returnOnAssets || 0,
    profitMargin: profitMargin,
    operatingMargin: operatingMargin,
    grossMargin: grossMargin,
    freeCashflow: freeCashflow,
    operatingCashflow: operatingCF,
    totalRevenue: totalRevenue,
    grossProfit: grossProfit,
    operatingIncome: operatingIncome,
    netIncome: netIncome,
    capitalExpenditures: capex,
    repurchaseOfStock: cf.repurchaseOfCapitalStock || 0,
    totalCash: totalCash,
    totalDebt: totalDebt,
    totalAssets: totalAssets,
    totalLiabilities: bs.totalLiabilities || 0,
    shareholderEquity: shareholderEquity,
    bookValue: bs.bookValue || ks.bookValue || 0,
    sector: sp.sector || data.assetProfile?.sector || p.sector || '',
    industry: sp.industry || data.assetProfile?.industry || p.industry || '',
    description: sp.longBusinessSummary || data.assetProfile?.longBusinessSummary || '',
    incomeStatements: incomeStatements,
    pegRatio: ks.pegRatio || 0,
    // Data quality tracking
    dataQuality: {
      incomeStatementAvailable: hasIncomeHistory,
      cashflowAvailable: hasCashflowHistory,
      balanceSheetAvailable: hasBalanceSheet,
      estimatedFields: [
        !hasIncomeHistory && totalRevenue > 0 ? 'grossProfit' : null,
        !hasIncomeHistory && totalRevenue > 0 ? 'operatingIncome' : null,
        !hasIncomeHistory && totalRevenue > 0 ? 'netIncome' : null,
        !hasCashflowHistory ? 'freeCashflow' : null,
        !hasCashflowHistory ? 'operatingCashflow' : null,
        !hasBalanceSheet ? 'shareholderEquity' : null,
        !hasBalanceSheet ? 'totalAssets' : null
      ].filter(Boolean)
    }
  };

  QUOTE_CACHE.set(ticker, { data: result, timestamp: Date.now() });
  return result;
}

async function fetchHistoricalData(ticker, months = 18) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  
  const period1 = Math.floor(startDate.getTime() / 1000);
  const period2 = Math.floor(endDate.getTime() / 1000);
  
  const data = await yahooFinance.chart(ticker, {
    period1,
    period2,
    interval: '1d'
  });
  
  return data.quotes.filter(q => q.close != null).map(q => ({
    date: new Date(q.date * 1000),
    close: q.close,
    volume: q.volume
  }));
}

function calculateMomentum(prices, lookbackMonths = 6, smooth = true) {
  if (prices.length < 50) return null;
  
  const now = prices[prices.length - 1].close;
  const lookbackDays = lookbackMonths * 30;
  const lookbackIndex = Math.max(0, prices.length - lookbackDays);
  const startPrice = prices[lookbackIndex].close;
  
  if (!startPrice || startPrice === 0) return null;
  
  const rawMomentum = ((now - startPrice) / startPrice) * 100;
  const tradingDays = prices.length - lookbackIndex;
  const annualizedReturn = Math.pow(now / startPrice, 252 / tradingDays) - 1;
  
  const dailyReturns = [];
  for (let i = lookbackIndex + 1; i < prices.length; i++) {
    const ret = Math.log(prices[i].close / prices[i - 1].close);
    dailyReturns.push(ret);
  }
  
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / dailyReturns.length;
  const volatility = Math.sqrt(variance) * Math.sqrt(252);
  
  const riskAdjMomentum = volatility > 0 ? annualizedReturn / volatility : 0;
  
  const ma50 = prices.slice(-50);
  const ma200 = prices.slice(-200);
  const ma50Value = ma50.reduce((a, b) => a + b.close, 0) / ma50.length;
  const ma200Value = ma200.length > 0 ? ma200.reduce((a, b) => a + b.close, 0) / ma200.length : 0;
  
  let trendStatus = 'downtrend';
  let trendBonus = -1;
  
  if (now > ma50Value && ma50Value > ma200Value) {
    trendStatus = 'strong_uptrend';
    trendBonus = 2;
  } else if (now > ma200Value && now < ma50Value) {
    trendStatus = 'pullback_in_uptrend';
    trendBonus = 1;
  } else if (now < ma200Value && now > ma50Value) {
    trendStatus = 'mixed';
    trendBonus = 0;
  }
  
  let runningMax = prices[lookbackIndex].close;
  let maxDrawdown = 0;
  let volatilityFlagged = false;
  
  for (let i = lookbackIndex; i < prices.length; i++) {
    if (prices[i].close > runningMax) runningMax = prices[i].close;
    const dd = (runningMax - prices[i].close) / runningMax;
    if (dd > maxDrawdown) maxDrawdown = dd;
    
    if (i > lookbackIndex) {
      const dailyRet = Math.abs((prices[i].close - prices[i - 1].close) / prices[i - 1].close);
      if (dailyRet > 0.15) volatilityFlagged = true;
    }
  }
  
  const finalScore = smooth ? riskAdjMomentum + trendBonus : riskAdjMomentum;
  
  return {
    rawMomentum: rawMomentum.toFixed(1),
    annualizedReturn: annualizedReturn.toFixed(3),
    volatility: volatility.toFixed(3),
    riskAdjMomentum: riskAdjMomentum.toFixed(3),
    trendStatus,
    ma50: ma50Value.toFixed(2),
    ma200: ma200Value.toFixed(2),
    maxDrawdown: (-maxDrawdown * 100).toFixed(1),
    volatilityFlagged,
    finalScore: finalScore.toFixed(3)
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getUniverse(universeId) {
  const universe = UNIVERSES[universeId];
  if (!universe) {
    return { error: `Unknown universe: ${universeId}` };
  }
  return universe;
}

// API Endpoints
app.get('/api/quote/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const data = await fetchQuoteData(ticker);
    
    const buffett = calcBuffettScore(data);
    const roic = calcROIC(data);
    const profitability = calcProfitability(data);
    
    res.json({
      success: true,
      ticker,
      data,
      derived: {
        buffett,
        roic,
        profitability
      }
    });
  } catch (error) {
    console.error(`Error fetching quote for ${req.params.ticker}:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/universe/:universeId', (req, res) => {
  const { universeId } = req.params;
  const universe = getUniverse(universeId);
  
  if (universe.error) {
    return res.status(404).json(universe);
  }
  
  res.json({
    success: true,
    universeId,
    tickers: universe
  });
});

app.get('/api/momentum/:universeId', async (req, res) => {
  const { universeId } = req.params;
  const { lookback = '6', smooth = 'true', fresh = 'false' } = req.query;
  
  const universe = getUniverse(universeId);
  if (universe.error) {
    return res.status(404).json(universe);
  }
  
  const cacheKey = `${universeId}-${lookback}-${smooth}`;
  const cached = MOMENTUM_CACHE.get(cacheKey);
  if (cached && fresh !== 'true' && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.json({ ...cached.data, cached: true });
  }
  
  const tickers = universe;
  const lookbackMonths = parseInt(lookback);
  const applySmooth = smooth === 'true';
  
  const results = [];
  const errors = [];
  const BATCH_SIZE = 5;

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(async (ticker) => {
        const [quoteData, historicalData] = await Promise.all([
          fetchQuoteData(ticker).catch(() => null),
          fetchHistoricalData(ticker, 18).catch(() => [])
        ]);
        const momentum = calculateMomentum(historicalData, lookbackMonths, applySmooth);
        return {
          rank: 0,
          ticker,
          name: quoteData?.name || ticker,
          sector: quoteData?.sector || '',
          currentPrice: quoteData?.price || 0,
          ...momentum
        };
      })
    );

    for (let j = 0; j < settled.length; j++) {
      if (settled[j].status === 'fulfilled' && settled[j].value) {
        results.push(settled[j].value);
      } else if (settled[j].status === 'rejected') {
        errors.push({ ticker: batch[j], error: settled[j].reason?.message });
      }
    }

    if (i + BATCH_SIZE < tickers.length) {
      await sleep(150);
    }
  }
  
  results.sort((a, b) => parseFloat(b.finalScore) - parseFloat(a.finalScore));
  results.forEach((r, i) => r.rank = i + 1);
  
  const responseData = {
    success: true,
    universeId,
    lookback: lookbackMonths,
    smooth: applySmooth,
    results,
    errors,
    summary: {
      totalAssets: results.length,
      avgMomentum: (results.reduce((a, b) => a + parseFloat(b.rawMomentum), 0) / results.length).toFixed(1),
      percentUptrend: ((results.filter(r => r.trendStatus === 'strong_uptrend').length / results.length) * 100).toFixed(0),
      medianVolatility: (results.reduce((a, b) => a + parseFloat(b.volatility), 0) / results.length).toFixed(3)
    }
  };
  
  MOMENTUM_CACHE.set(cacheKey, { data: responseData, timestamp: Date.now() });
  
  res.json(responseData);
});

app.get('/api/analysis/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const data = await fetchQuoteData(ticker);
    
    // Get user network input if exists
    const networkInput = NETWORK_INPUT_CACHE.get(ticker);
    
    // Calculate ROIC components for the analysis
    const sharesOutstanding = safeNum(data.sharesOutstanding);
    const price = safeNum(data.price);
    const totalDebt = safeNum(data.totalDebt);
    const shareholderEquity = safeNum(data.shareholderEquity);
    const totalAssets = safeNum(data.totalAssets);
    const netIncome = safeNum(data.netIncome);
    const operatingIncome = safeNum(data.operatingIncome);
    const totalRevenue = safeNum(data.totalRevenue);
    
    const investedCapital = totalDebt + (shareholderEquity || netIncome * 10);
    const roic = investedCapital > 0 ? (operatingIncome / investedCapital) * 100 : 
                 (netIncome > 0 && totalAssets > 0 ? (netIncome / totalAssets) * 100 : 0);
    const nopatMargin = totalRevenue > 0 ? (operatingIncome / totalRevenue) * 100 : safeNum(data.operatingMargin) * 100;
    const assetTurnover = totalAssets > 0 ? totalRevenue / totalAssets : 
                         (totalRevenue > 0 && price > 0 ? totalRevenue / (sharesOutstanding * price) : 0);
    
    // Enrich data with calculated values
    const enrichedData = {
      ...data,
      roic,
      nopatMargin,
      assetTurnover,
      wacc: data.beta < 0.8 ? 8 : data.beta > 1.2 ? 11 : 9.5,
      gmTrend: 0 // Will be calculated in analysis engine
    };
    
    // Run all analysis sections
    const buffett = calcBuffettScore(enrichedData);
    const roicAnalysis = calcROIC(enrichedData);
    const profitability = calcProfitabilityPath(enrichedData);
    const constraints = calcGrowthConstraints(enrichedData, 0);
    const entry = calcEntryTiming(enrichedData);
    const iv = calcIntrinsicValue(enrichedData, buffett.wacc);
    const moat = calcMoatAnalysis(enrichedData, networkInput);
    const aiDisruption = calcAIDisruption(enrichedData);
    const roicSensitivity = calcROICSensitivity({
      ...enrichedData,
      roic: parseFloat(roicAnalysis.roic),
      nopatMargin: parseFloat(roicAnalysis.nopatMargin),
      assetTurnover: parseFloat(roicAnalysis.assetTurnover)
    });
    const earningsQuality = calcEarningsQuality({
      ...enrichedData,
      roic: parseFloat(roicAnalysis.roic),
      wacc: buffett.wacc
    });
    const tsy = calcTotalShareholderYield(enrichedData, iv);
    
    const composite = calcComposite({
      buffettChecklist: { total: buffett.total },
      moatAnalysis: moat,
      intrinsicValue: iv,
      roicTree: roicAnalysis,
      earningsQuality,
      entryTiming: entry,
      totalShareholderYield: tsy,
      growthConstraints: constraints,
      aiDisruption,
      fundamentals: data,
      price: data.price
    });
    
    const verdict = getVerdict(buffett.total, parseFloat(iv.undervaluation));
    
    const checklist = [
      { name: 'Owner Earnings Yield', pass: buffett.criteria.ownerEarnings.pass, value: `${buffett.criteria.ownerEarnings.value}% yield`, detail: `${buffett.criteria.ownerEarnings.multiplier}x risk-free rate` },
      { name: 'Margin of Safety', pass: buffett.criteria.marginOfSafety.pass, value: `${buffett.criteria.marginOfSafety.value}% discount`, detail: `IV: $${buffett.criteria.marginOfSafety.iv}` },
      { name: 'Earnings Consistency', pass: buffett.criteria.earningsConsistency.pass, value: buffett.criteria.earningsConsistency.value, detail: '4 signals positive' },
      { name: 'Management Quality', pass: buffett.criteria.managementQuality.pass, value: `ROE: ${buffett.criteria.managementQuality.roe}%`, detail: `Buybacks: ${buffett.criteria.managementQuality.buyback}` },
      { name: 'Business Simplicity', pass: buffett.criteria.businessSimplicity.pass, value: `${buffett.criteria.businessSimplicity.value}% GM`, detail: '' },
      { name: 'Durable Advantage', pass: buffett.criteria.durableAdvantage.pass, value: buffett.criteria.durableAdvantage.value, detail: 'durability signals' }
    ];
    
    res.json({
      success: true,
      ticker,
      name: data.name,
      price: data.price,
      sector: data.sector,
      industry: data.industry,
      marketCap: data.marketCap,
      description: data.description,
      verdict,
      dataQuality: data.dataQuality,
      buffettChecklist: {
        items: checklist,
        total: buffett.total
      },
      moatAnalysis: moat,
      aiDisruption,
      roicTree: roicAnalysis,
      roicSensitivity,
      profitabilityPath: profitability,
      growthConstraints: constraints,
      entryTiming: entry,
      intrinsicValue: iv,
      fundamentals: {
        beta: data.beta,
        dividendYield: data.dividendYield,
        payoutRatio: data.payoutRatio,
        forwardPE: data.forwardPE,
        trailingPE: data.trailingPE,
        priceToBook: data.priceToBook
      },
      earningsQuality,
      totalShareholderYield: tsy,
      composite
    });
  } catch (error) {
    console.error(`Error analyzing ${req.params.ticker}:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

function calculateDCF(data) {
  const ticker = data.ticker;
  const name = data.name;
  const currentPrice = safeNum(data.price);
  const sharesOutstanding = safeNum(data.sharesOutstanding);
  const totalRevenue = safeNum(data.totalRevenue);
  const freeCashflow = safeNum(data.freeCashflow);
  const operatingCashflow = safeNum(data.operatingCashflow);
  const capitalExpenditures = safeNum(data.capitalExpenditures);
  const beta = safeNum(data.beta, 1);
  const totalCash = safeNum(data.totalCash, 0);
  const totalDebt = safeNum(data.totalDebt, 0);
  const forwardEPS = safeNum(data.forwardEPS);
  const trailingEPS = safeNum(data.trailingEPS);
  const sector = data.sector || "";
  const industry = data.industry || "";
  const repurchaseOfStock = safeNum(data.repurchaseOfStock, 0);
  
  // Calculate revenue growth from income statements (more reliable than Yahoo's estimate)
  let manualRevenueGrowth = null;
  if (data.incomeStatements && data.incomeStatements.length >= 4) {
    const stmt = data.incomeStatements;
    // Calculate TTM: sum of last 4 quarters
    const ttmRev = (stmt[0]?.totalRevenue || 0) + (stmt[1]?.totalRevenue || 0) + 
                   (stmt[2]?.totalRevenue || 0) + (stmt[3]?.totalRevenue || 0);
    // Calculate prior year TTM (previous 4 quarters - need to look at prior year data)
    // If we have 8 quarters, use periods 4-7 for prior year
    if (stmt.length >= 8) {
      const priorTtmRev = (stmt[4]?.totalRevenue || 0) + (stmt[5]?.totalRevenue || 0) +
                          (stmt[6]?.totalRevenue || 0) + (stmt[7]?.totalRevenue || 0);
      if (ttmRev > 0 && priorTtmRev > 0 && priorTtmRev < ttmRev * 1.5) {
        manualRevenueGrowth = (ttmRev - priorTtmRev) / priorTtmRev;
      }
    }
    // Fallback: use first vs second half of available data
    if (manualRevenueGrowth === null) {
      const currentHalf = (stmt[0]?.totalRevenue || 0) + (stmt[1]?.totalRevenue || 0);
      const priorHalf = (stmt[2]?.totalRevenue || 0) + (stmt[3]?.totalRevenue || 0);
      if (currentHalf > 0 && priorHalf > 0 && priorHalf < currentHalf * 1.5) {
        // Extrapolate YoY from half-year comparison
        manualRevenueGrowth = (currentHalf - priorHalf) / priorHalf;
      }
    }
  } else if (data.incomeStatements && data.incomeStatements.length >= 2) {
    // Fallback: compare first and second period (assume quarterly)
    const stmt = data.incomeStatements;
    const revCurrent = stmt[0]?.totalRevenue || 0;
    const revPrev = stmt[1]?.totalRevenue || 0;
    if (revCurrent > 0 && revPrev > 0 && revPrev < revCurrent * 1.5) {
      // Extrapolate from sequential growth to YoY
      const sequentialGrowth = (revCurrent - revPrev) / revPrev;
      // Quarterly sequential ≈ half of annual growth, so multiply by 2 as rough estimate
      manualRevenueGrowth = Math.min(sequentialGrowth * 2, 0.25);
    }
  }
  
  // Get earnings growth for context only
  const earningsGrowth = safeNum(data.earningsGrowth, 0);
  let yahooRevenueGrowth = safeNum(data.revenueGrowth, 0);
  if (yahooRevenueGrowth > 1) yahooRevenueGrowth = yahooRevenueGrowth / 100;
  
  // Base FCF calculation
  let baseFCF;
  let fcfSource;
  
  // Use operatingCashflow + capex (capex is stored as negative)
  if (operatingCashflow > 0 && capitalExpenditures < 0) {
    baseFCF = operatingCashflow + capitalExpenditures;
    fcfSource = "cashflowStatement";
  } else if (freeCashflow > 0) {
    baseFCF = freeCashflow;
    fcfSource = "financialData_freeCashflow";
  } else if (operatingCashflow > 0) {
    baseFCF = operatingCashflow * 0.85;
    fcfSource = "estimated_from_opcf";
  } else {
    // Estimate from operating income
    const operatingIncome = totalRevenue * safeNum(data.operatingMargin, 0.2);
    baseFCF = operatingIncome * 0.79 * 0.85;
    fcfSource = "estimated_from_operating_income";
  }
  
  if (baseFCF < 0) {
    baseFCF = Math.abs(baseFCF);
    fcfSource = "estimated_absolute";
  }
  
  // FCF Margin
  let fcfMargin = totalRevenue > 0 ? baseFCF / totalRevenue : 0.2;
  fcfMargin = Math.max(0.05, Math.min(0.45, fcfMargin)); // Cap between 5-45%
  
  // === PHASE 1 GROWTH: Use manual YoY calculation first ===
  let phase1Growth = 0.05; // Default 5%
  let growthSource = "default_5pct";
  
  // Priority 1: Manual YoY from income statements
  if (manualRevenueGrowth !== null && manualRevenueGrowth > -0.3 && manualRevenueGrowth < 0.5) {
    phase1Growth = manualRevenueGrowth;
    growthSource = "manual_yoy";
  }
  // Priority 2: Yahoo's revenue growth (if manual not available)
  else if (yahooRevenueGrowth > 0 && yahooRevenueGrowth < 0.5) {
    phase1Growth = yahooRevenueGrowth;
    growthSource = "yahoo_revenueGrowth";
  }
  
  // Apply revenue-based caps (large companies can't grow as fast)
  if (totalRevenue > 200e9) {
    phase1Growth = Math.min(phase1Growth, 0.15); // >$200B: cap at 15%
  } else if (totalRevenue > 50e9) {
    phase1Growth = Math.min(phase1Growth, 0.20); // >$50B: cap at 20%
  } else if (totalRevenue > 5e9) {
    phase1Growth = Math.min(phase1Growth, 0.25); // >$5B: cap at 25%
  } else {
    phase1Growth = Math.min(phase1Growth, 0.35); // small cap: cap at 35%
  }
  
  // Floor: minimum 2% for default, but allow actual data to be lower if explicitly negative
  if (growthSource === "default_5pct") {
    phase1Growth = Math.max(phase1Growth, 0.02);
  }
  
  // === TERMINAL GROWTH RATE ===
  const terminalGrowthRate = 0.025; // 2.5% (nominal GDP growth)
  
  // === PHASE 2 GROWTH: Must always be LESS than Phase 1 ===
  // Start with 60% of Phase 1, but ensure it's below Phase 1
  const phase2TargetBuffer = Math.max(phase1Growth * 0.6, terminalGrowthRate + 0.01);
  // Phase 2 cannot exceed 85% of Phase 1 to ensure proper fade
  let phase2Growth = Math.min(phase2TargetBuffer, phase1Growth * 0.85);
  // Ensure Phase 2 is always below Phase 1
  phase2Growth = Math.min(phase2Growth, phase1Growth - 0.005); // At least 0.5% below Phase 1
  
  // === WACC CALCULATION with quality adjustment ===
  const riskFreeRate = 0.043;
  const equityRiskPremium = 0.055;
  const adjustedBeta = (2/3 * beta) + (1/3 * 1.0);
  const costOfEquity = riskFreeRate + adjustedBeta * equityRiskPremium;
  
  const debtToEquity = totalDebt > 0 && sharesOutstanding * currentPrice > 0 
    ? totalDebt / (sharesOutstanding * currentPrice) 
    : 0;
  
  let costOfDebt;
  if (debtToEquity < 0.3) costOfDebt = 0.035;
  else if (debtToEquity < 0.8) costOfDebt = 0.045;
  else if (debtToEquity < 1.5) costOfDebt = 0.055;
  else costOfDebt = 0.065;
  
  const costOfDebtAfterTax = costOfDebt * (1 - 0.21);
  const marketCap = sharesOutstanding * currentPrice;
  const totalCapital = marketCap + totalDebt;
  const equityWeight = totalCapital > 0 ? marketCap / totalCapital : 0.97;
  const debtWeight = 1 - equityWeight;
  
  let wacc = (equityWeight * costOfEquity) + (debtWeight * costOfDebtAfterTax);
  
  // Quality adjustment: high FCF margin + low debt = lower risk
  const fcfMarginPct = fcfMargin * 100;
  if (fcfMarginPct > 30 && debtToEquity < 1.0) {
    wacc = Math.max(wacc - 0.01, 0.06); // -100bps for fortress balance sheet + high margins
  } else if (fcfMarginPct > 25 && debtToEquity < 1.5) {
    wacc = Math.max(wacc - 0.005, 0.06); // -50bps for high margins
  }
  
  wacc = Math.max(Math.min(wacc, 0.15), 0.06); // Floor 6%, cap 15%
  
  // Terminal FCF margin
  const terminalFCFMargin = fcfMargin > 0.1 ? fcfMargin * 0.95 : fcfMargin * 1.10;
  
  // Net cash
  const netCash = totalCash - totalDebt;
  
  // === BUILD PROJECTIONS with gentle decay toward terminal ===
  const projections = [];
  let prevRevenue = totalRevenue;
  
  // Phase 1 decay: lose 4% of growth rate per year
  const phase1Decay = phase1Growth * 0.04;
  
  // Calculate what growth rate is at end of Phase 1
  const phase1EndRate = Math.max(phase1Growth - (phase1Decay * 4), terminalGrowthRate + 0.005);
  
  // Phase 2 target: approach terminal but never go below it
  const phase2Target = terminalGrowthRate + 0.003;
  
  for (let year = 1; year <= 10; year++) {
    let growth, yearFCFMargin;
    
    if (year <= 5) {
      // Phase 1: gentle decay
      growth = phase1Growth - (phase1Decay * (year - 1));
      // Floor: never below terminal growth
      growth = Math.max(growth, terminalGrowthRate + 0.005);
    } else {
      // Phase 2: LINEAR DECLINE from phase1EndRate to phase2Target
      const yearsIntoPhase2 = year - 5; // 1,2,3,4,5
      const fraction = yearsIntoPhase2 / 5; // 0.2, 0.4, 0.6, 0.8, 1.0
      growth = phase1EndRate - (phase1EndRate - phase2Target) * fraction;
      // This ALWAYS decreases because phase2Target < phase1EndRate
    }
    
    // FCF margin: hold steady Phase 1, fade Phase 2
    if (year <= 5) {
      yearFCFMargin = fcfMargin;
    } else {
      const fade = (year - 5) / 5;
      yearFCFMargin = fcfMargin - (fcfMargin - terminalFCFMargin) * fade;
    }
    
    const revenue = prevRevenue * (1 + growth);
    const fcf = revenue * yearFCFMargin;
    const discountFactor = 1 / Math.pow(1 + wacc, year);
    const presentValue = fcf * discountFactor;
    
    projections.push({
      year,
      revenue,
      revenueGrowth: growth,
      fcfMargin: yearFCFMargin,
      fcf,
      discountFactor,
      presentValue
    });
    
    prevRevenue = revenue;
  }
  
  // SANITY CHECK: verify growth never increases
  for (let i = 1; i < projections.length; i++) {
    if (projections[i].revenueGrowth > projections[i-1].revenueGrowth + 0.0001) {
      console.error(`DCF BUG: Growth increased from year ${i} (${(projections[i-1].revenueGrowth*100).toFixed(2)}%) to year ${i+1} (${(projections[i].revenueGrowth*100).toFixed(2)}%)`);
      // Force fix: set to previous year's rate minus small decay
      projections[i].revenueGrowth = projections[i-1].revenueGrowth - 0.001;
      // Recalculate downstream
      const prev = i > 0 ? projections[i-1].revenue : totalRevenue;
      projections[i].revenue = prev * (1 + projections[i].revenueGrowth);
      projections[i].fcf = projections[i].revenue * projections[i].fcfMargin;
      projections[i].presentValue = projections[i].fcf * projections[i].discountFactor;
    }
  }
  
  // Terminal value
  const year10 = projections[9];
  const effectiveTerminalGrowth = Math.min(terminalGrowthRate, wacc - 0.01);
  const terminalFCF = year10.fcf * (1 + effectiveTerminalGrowth);
  const terminalValue = terminalFCF / (wacc - effectiveTerminalGrowth);
  const pvOfTerminal = terminalValue * year10.discountFactor;
  
  const pvOfFCFs = projections.reduce((sum, p) => sum + p.presentValue, 0);
  const enterpriseValue = pvOfFCFs + pvOfTerminal;
  const equityValue = Math.max(enterpriseValue + netCash, 0);
  const intrinsicValuePerShare = sharesOutstanding > 0 ? equityValue / sharesOutstanding : 0;
  const upside = currentPrice > 0 ? (intrinsicValuePerShare - currentPrice) / currentPrice : 0;
  
  // === BUYBACK ADJUSTMENT ===
  let buybackAdjustedIV = null;
  let buybackYield = 0;
  let futureSharesReduction = 0;
  
  if (repurchaseOfStock < 0 && currentPrice > 0 && sharesOutstanding > 0) {
    buybackYield = Math.abs(repurchaseOfStock) / marketCap;
    
    // Only apply if >1% annual buyback yield
    if (buybackYield > 0.01) {
      // Estimate future share count reduction (conservative: 50% of current rate)
      const annualReduction = buybackYield * 0.5;
      futureSharesReduction = 1 - Math.pow(1 - annualReduction, 10);
      const futureShares = sharesOutstanding * (1 - futureSharesReduction);
      
      // Buyback-adjusted per-share value
      buybackAdjustedIV = equityValue / futureShares;
    }
  }
  
  const buybackAdjustedUpside = buybackAdjustedIV && currentPrice > 0 
    ? (buybackAdjustedIV - currentPrice) / currentPrice 
    : null;
  
  // Sensitivity matrix
  const waccValues = [0.08, 0.085, 0.09, 0.095, 0.10, 0.105, 0.11];
  const terminalGrowthValues = [0.015, 0.02, 0.025, 0.03, 0.035];
  
  const sensitivityMatrix = waccValues.map(w => 
    terminalGrowthValues.map(tg => {
      const tgCapped = Math.min(tg, w - 0.01);
      let pv = 0, prevRev = totalRevenue;
      let y10fcf = 0, y10df = 0;
      
      for (let y = 1; y <= 10; y++) {
        const g = y <= 5 
          ? phase1Growth - (phase1Decay * (y - 1))
          : phase1EndRate - (phase1EndRate - phase2Target) * ((y - 5) / 5);
        const gAdj = Math.max(g, phase2Target);
        
        const m = y <= 5 ? fcfMargin : fcfMargin - (fcfMargin - terminalFCFMargin) * ((y - 5) / 5);
        const rev = prevRev * (1 + gAdj);
        const fcfVal = rev * m;
        const df = 1 / Math.pow(1 + w, y);
        pv += fcfVal * df;
        if (y === 10) { y10fcf = fcfVal; y10df = df; }
        prevRev = rev;
      }
      
      const tv = (y10fcf * (1 + tgCapped)) / (w - tgCapped);
      const pvtv = tv * y10df;
      const ev = pv + pvtv + netCash;
      return Math.max(ev / sharesOutstanding, 0);
    })
  );
  
  // Find market-implied assumptions
  let marketImpliedWacc = null, marketImpliedTg = null;
  let minDiff = Infinity;
  for (let wi = 0; wi < sensitivityMatrix.length; wi++) {
    for (let ti = 0; ti < sensitivityMatrix[wi].length; ti++) {
      const diff = Math.abs(sensitivityMatrix[wi][ti] - currentPrice);
      if (diff < minDiff) {
        minDiff = diff;
        marketImpliedWacc = waccValues[wi];
        marketImpliedTg = terminalGrowthValues[ti];
      }
    }
  }
  
  const terminalPercent = pvOfTerminal / (pvOfFCFs + pvOfTerminal);
  const isFinancialSector = sector.toLowerCase().includes('financial') || sector.toLowerCase().includes('bank');
  const isReit = industry.toLowerCase().includes('reit') || industry.toLowerCase().includes('real estate');
  
  return {
    ticker,
    name,
    currentPrice,
    sharesOutstanding,
    inputs: {
      baseFCF,
      baseFCFPerShare: sharesOutstanding > 0 ? baseFCF / sharesOutstanding : 0,
      baseRevenue: totalRevenue,
      baseRevenuePerShare: sharesOutstanding > 0 ? totalRevenue / sharesOutstanding : 0,
      phase1Growth,
      phase2Growth,
      terminalGrowthRate,
      fcfMargin,
      fcfMarginTerminal: terminalFCFMargin,
      wacc,
      waccComponents: {
        riskFreeRate,
        equityRiskPremium,
        beta,
        adjustedBeta,
        costOfEquity,
        costOfDebt,
        taxRate: 0.21,
        costOfDebtAfterTax,
        marketCap,
        totalDebt,
        equityWeight,
        debtWeight
      },
      netCash,
      netCashPerShare: sharesOutstanding > 0 ? netCash / sharesOutstanding : 0,
      growthSource
    },
    projections: projections.map(p => ({
      year: p.year,
      revenue: p.revenue,
      revenueGrowth: p.revenueGrowth,
      fcfMargin: p.fcfMargin,
      fcf: p.fcf,
      discountFactor: p.discountFactor,
      presentValue: p.presentValue
    })),
    terminalValue: {
      terminalFCF,
      terminalValue,
      pvOfTerminal,
      terminalAsPercentOfTotal: terminalPercent
    },
    valuation: {
      pvOfFCFs,
      pvOfTerminal,
      enterpriseValue,
      netCash,
      equityValue,
      sharesOutstanding,
      intrinsicValuePerShare,
      currentPrice,
      upside,
      marginOfSafety: upside * 100,
      buybackAdjustedIV,
      buybackAdjustedUpside,
      buybackYield,
      futureSharesReduction
    },
    sensitivity: {
      waccValues,
      terminalGrowthValues,
      matrix: sensitivityMatrix
    },
    marketImplied: marketImpliedWacc && marketImpliedTg ? {
      wacc: marketImpliedWacc,
      terminalGrowth: marketImpliedTg
    } : null,
    warnings: {
      terminalHeavy: terminalPercent > 0.75,
      financialSector: isFinancialSector,
      reit: isReit,
      negativeFCF: baseFCF < 0,
      highGrowth: phase1Growth > 0.25,
      acquisitionGrowth: (manualRevenueGrowth > 0.25 || yahooRevenueGrowth > 0.25) && currentPrice < 100e9 ? 
        "Note: High revenue growth may include acquisitions. Organic growth is likely lower. Consider adjusting Phase 1 manually." : null
    },
    dataSources: {
      fcfSource,
      growthSource,
      manualRevenueGrowth: manualRevenueGrowth,
      yahooRevenueGrowth: yahooRevenueGrowth,
      earningsGrowth: earningsGrowth,
      betaSource: "yahoo_5yr_monthly",
      debtDataSource: totalDebt > 0 ? "financialData" : "estimated"
    }
  };
}

// Extract comprehensive metrics from Yahoo Finance quoteSummary data
async function fetchCompMetrics(ticker) {
  try {
    const data = await yahooFinance.quoteSummary(ticker, {
      modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'summaryProfile']
    });
    
    const p = data.price || {};
    const sd = data.summaryDetail || {};
    const ks = data.defaultKeyStatistics || {};
    const fd = data.financialData || {};
    const sp = data.summaryProfile || {};
    
    const price = yfNum(p.regularMarketPrice);
    const marketCap = yfNum(p.marketCap);
    const sharesOutstanding = yfNum(p.sharesOutstanding) || yfNum(ks.sharesOutstanding);
    const enterpriseValue = yfNum(ks.enterpriseValuationMRQ);
    
    // Valuation metrics with fallbacks
    let trailingPE = yfNum(sd.trailingPE);
    let forwardPE = yfNum(sd.forwardPE) || yfNum(ks.forwardPE);
    let pegRatio = yfNum(ks.pegRatio);
    let priceToSales = yfNum(sd.priceToSalesTrailing12Months);
    let priceToBook = yfNum(ks.priceToBook);
    let evToEbitda = yfNum(ks.enterpriseToEbitda);
    let evToRevenue = yfNum(ks.enterpriseToRevenue);
    
    // Fallback calculations
    const trailingEps = yfNum(ks.trailingEps);
    const forwardEps = yfNum(ks.forwardEps);
    const bookValuePerShare = yfNum(ks.bookValue);
    const totalRevenue = yfNum(fd.totalRevenue);
    const ebitda = yfNum(fd.ebitda);
    const totalDebt = yfNum(fd.totalDebt);
    const totalCash = yfNum(fd.totalCash);
    
    // Calculate missing metrics from available data
    if (!trailingPE && price && trailingEps && trailingEps > 0) {
      trailingPE = price / trailingEps;
    }
    if (!forwardPE && price && forwardEps && forwardEps > 0) {
      forwardPE = price / forwardEps;
    }
    if (!priceToSales && marketCap && totalRevenue && totalRevenue > 0) {
      priceToSales = marketCap / totalRevenue;
    }
    if (!priceToBook && price && bookValuePerShare && bookValuePerShare > 0) {
      priceToBook = price / bookValuePerShare;
    }
    if (!evToEbitda && enterpriseValue && ebitda && ebitda > 0) {
      evToEbitda = enterpriseValue / ebitda;
    }
    if (!evToRevenue && enterpriseValue && totalRevenue && totalRevenue > 0) {
      evToRevenue = enterpriseValue / totalRevenue;
    }
    if (!pegRatio && trailingPE && fd.earningsGrowth && yfNum(fd.earningsGrowth) > 0) {
      pegRatio = trailingPE / (yfNum(fd.earningsGrowth) * 100);
    }
    
    // Margins and growth (convert decimals to percentages)
    const grossMargin = yfNum(fd.grossMargins) !== null ? yfNum(fd.grossMargins) * 100 : null;
    const operatingMargin = yfNum(fd.operatingMargins) !== null ? yfNum(fd.operatingMargins) * 100 : null;
    const revenueGrowth = yfNum(fd.revenueGrowth) !== null ? yfNum(fd.revenueGrowth) * 100 : null;
    const earningsGrowth = yfNum(fd.earningsGrowth) !== null ? yfNum(fd.earningsGrowth) * 100 : null;
    const dividendYield = yfNum(sd.dividendYield) !== null ? yfNum(sd.dividendYield) * 100 : null;
    const roe = yfNum(fd.returnOnEquity);
    
    return {
      ticker,
      name: p.longName || p.shortName || ticker,
      sector: sp.sector || 'Unknown',
      industry: sp.industry || 'Unknown',
      price,
      marketCap,
      sharesOutstanding,
      enterpriseValue,
      trailingPE: trailingPE > 0 && trailingPE < 500 ? trailingPE : null,
      forwardPE: forwardPE > 0 && forwardPE < 500 ? forwardPE : null,
      pegRatio: pegRatio > 0 && pegRatio < 20 ? pegRatio : null,
      priceToSales: priceToSales > 0 && priceToSales < 100 ? priceToSales : null,
      priceToBook: priceToBook > 0 && priceToBook < 100 ? priceToBook : null,
      evToEbitda: evToEbitda > 0 && evToEbitda < 100 ? evToEbitda : null,
      evToRevenue: evToRevenue > 0 && evToRevenue < 50 ? evToRevenue : null,
      grossMargin,
      operatingMargin,
      revenueGrowth,
      earningsGrowth,
      dividendYield,
      roe,
      trailingEps,
      forwardEps,
      bookValuePerShare,
      totalRevenue,
      ebitda,
      totalDebt,
      totalCash
    };
  } catch (err) {
    console.log(`Failed to fetch metrics for ${ticker}: ${err.message}`);
    return null;
  }
}

// DCF endpoint
app.get('/api/dcf/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const data = await fetchQuoteData(ticker);
    const dcf = calculateDCF(data);
    
    res.json({
      success: true,
      ...dcf
    });
  } catch (error) {
    console.error(`Error calculating DCF for ${req.params.ticker}:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Comps endpoint
app.get('/api/comps/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    
    // Check cache
    const cached = COMPS_CACHE.get(ticker);
    if (cached && Date.now() - cached.timestamp < COMPS_CACHE_TTL) {
      return res.json({ ...cached.data, cached: true });
    }
    
    // Get peers from analysis engine
    const fullData = await fetchQuoteData(ticker);
    const { peers: peerTickers, source } = getPeers(ticker, fullData.industry, fullData.sector);
    
    // Fetch target and peer metrics using the dedicated function
    const [target, ...peerResults] = await Promise.all([
      fetchCompMetrics(ticker),
      ...peerTickers.map(t => fetchCompMetrics(t))
    ]);
    
    if (!target) {
      return res.status(500).json({ success: false, error: `Failed to fetch data for ${ticker}` });
    }
    
    const peers = peerResults.filter(p => p !== null);
    
    // Calculate comps
    const comps = calculateComps({
      ticker,
      name: fullData.name,
      industry: fullData.industry,
      sector: fullData.sector,
      ...target,
      peers,
      peerSource: source
    });
    
    const responseData = { success: true, ...comps };
    COMPS_CACHE.set(ticker, { data: responseData, timestamp: Date.now() });
    
    res.json(responseData);
  } catch (error) {
    console.error(`Error calculating comps for ${req.params.ticker}:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Network input endpoint
app.post('/api/analysis/:ticker/network-input', (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  const { networkEffectScore, label } = req.body;
  
  if (networkEffectScore === undefined || !label) {
    return res.status(400).json({ success: false, error: 'networkEffectScore and label required' });
  }
  
  NETWORK_INPUT_CACHE.set(ticker, { score: networkEffectScore, label, timestamp: Date.now() });
  
  res.json({ success: true, message: `Network effect input saved for ${ticker}` });
});

app.get('/api/analysis/:ticker/network-input', (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  const input = NETWORK_INPUT_CACHE.get(ticker);
  
  res.json({
    success: true,
    hasInput: !!input,
    input: input || null
  });
});

// =====================================================================
// BACKTEST FUNDAMENTAL SCORING
// =====================================================================

const TECH_SECTORS = ['technology', 'information technology', 'software', 'semiconductors', 'hardware'];
const HIGH_MARGIN_SOFTWARE = ['software', 'internet', 'cloud'];
const HIGH_MARGIN_HARDWARE = ['semiconductors', 'hardware', 'equipment'];
const HIGH_SWITCHING_SOFTWARE = ['software', 'enterprise software', 'saas', 'cloud'];
const HIGH_SWITCHING_FINANCIAL = ['banks', 'insurance', 'asset management', 'financial'];
const HIGH_SWITCHING_HEALTHCARE = ['healthcare', 'pharmaceuticals', 'biotechnology', 'medical devices'];
const HIGH_RD_INDUSTRIES = ['biotechnology', 'pharmaceuticals', 'software', 'semiconductors', 'technology hardware'];
const HIGH_BARRIER_DEFENSE = ['defense', 'aerospace', 'airlines'];
const HIGH_BARRIER_UTILITY = ['utilities', 'pipeline', 'infrastructure'];
const REGULATED_INDUSTRIES = ['banking', 'insurance', 'financial', 'utilities', 'healthcare'];

function calculateFundamentalScore(data, ticker) {
  try {
    const fd = data.financialData || {};
    const sd = data.summaryDetail || {};
    const ks = data.defaultKeyStatistics || {};
    const p = data.price || {};
    const sp = data.summaryProfile || {};

    const pct = {
      gm: (fd.grossMargins || 0) * 100,
      om: (fd.operatingMargins || 0) * 100,
      nm: (fd.netMargins || fd.profitMargins || 0) * 100,
      roe: (fd.returnOnEquity || 0) * 100,
      roa: (fd.returnOnAssets || 0) * 100,
      revGrowth: (fd.revenueGrowth || 0) * 100,
      earnGrowth: (fd.earningsGrowth || 0) * 100
    };

    // 1. BUFFETT QUALITY (0-100)
    let buffettScore = 0;
    const passChecks = [];

    // Owner earnings yield (simplified)
    const fcf = fd.freeCashFlow || 0;
    const marketCap = p.marketCap || 0;
    const ownerEarningsYield = marketCap > 0 ? (fcf / marketCap) * 100 : 0;
    if (ownerEarningsYield > 4.3) { buffettScore += 17; passChecks.push(true); }
    else if (ownerEarningsYield > 2) { buffettScore += 12; passChecks.push(true); }
    else if (ownerEarningsYield > 0) { buffettScore += 6; }

    // ROE
    if (pct.roe > 20) { buffettScore += 17; passChecks.push(true); }
    else if (pct.roe > 15) { buffettScore += 12; passChecks.push(true); }
    else if (pct.roe > 10) { buffettScore += 6; }

    // Margins
    if (pct.gm > 50) { buffettScore += 17; passChecks.push(true); }
    else if (pct.gm > 40) { buffettScore += 12; passChecks.push(true); }
    else if (pct.gm > 30) { buffettScore += 6; }

    // Debt/Equity
    const de = fd.debtToEquity || 0;
    if (de < 50) { buffettScore += 17; passChecks.push(true); }
    else if (de < 100) { buffettScore += 12; passChecks.push(true); }
    else if (de < 200) { buffettScore += 6; }

    // Earnings consistency
    if (pct.earnGrowth > 10) { buffettScore += 16; passChecks.push(true); }
    else if (pct.earnGrowth > 0) { buffettScore += 10; }
    else { buffettScore += 3; }

    // Buyback signal
    const repurchase = sd.payoutRatio || 0;
    if (repurchase < 0.3 && pct.roe > 15) { buffettScore += 16; passChecks.push(true); }
    else if (repurchase < 0.5) { buffettScore += 10; }

    buffettScore = Math.min(100, Math.max(0, buffettScore));

    // 2. MOAT SCORE (0-100)
    let moatScore = 0;

    // Supply side: margins + growth
    if (pct.gm > 50) moatScore += 20;
    else if (pct.gm > 40) moatScore += 15;
    else if (pct.gm > 30) moatScore += 10;

    if (pct.om > 25) moatScore += 15;
    else if (pct.om > 15) moatScore += 10;
    else if (pct.om > 5) moatScore += 5;

    if (pct.revGrowth > 15) moatScore += 10;
    else if (pct.revGrowth > 5) moatScore += 6;

    // Network effects signal (tech sector)
    const sector = (sp.sector || '').toLowerCase();
    const industry = (sp.industry || '').toLowerCase();
    if (TECH_SECTORS.some(t => sector.includes(t))) {
      if (industry.includes('software') || industry.includes('internet')) moatScore += 20;
      else if (industry.includes('cloud') || industry.includes('platform')) moatScore += 15;
      else moatScore += 8;
    }

    // Switching costs
    if (HIGH_SWITCHING_SOFTWARE.some(s => industry.includes(s))) moatScore += 15;
    if (HIGH_SWITCHING_FINANCIAL.some(s => sector.includes(s) || industry.includes(s))) moatScore += 12;
    if (HIGH_SWITCHING_HEALTHCARE.some(s => industry.includes(s))) moatScore += 10;

    // Learning curve / R&D
    if (HIGH_RD_INDUSTRIES.some(s => industry.includes(s))) {
      if (pct.gm > 50) moatScore += 15;
      else if (pct.gm > 30) moatScore += 8;
    }

    moatScore = Math.min(100, Math.max(0, moatScore));

    // 3. ROIC (simplified)
    const roa = pct.roa || 5;
    const assetTurnover = (fd.totalRevenue || 0) / (p.totalAssets || 1);
    const equity = marketCap / (p.priceToBook || 10);
    const roic = roa * assetTurnover || (pct.nm * assetTurnover) || roa;

    // WACC approximation
    const beta = sd.beta || 1;
    const costOfEquity = 0.043 + beta * 0.055;
    const roicSpread = roic - costOfEquity;

    let roicScore = 0;
    if (roicSpread >= 15) roicScore = 100;
    else if (roicSpread >= 10) roicScore = 85;
    else if (roicSpread >= 5) roicScore = 70;
    else if (roicSpread >= 2) roicScore = 50;
    else if (roicSpread >= 0) roicScore = 30;
    else roicScore = Math.max(0, 20 + roicSpread * 5);

    // 4. EARNINGS QUALITY (simplified)
    const opCash = fd.operatingCashflow || 0;
    const rev = fd.totalRevenue || 1;
    const accruals = Math.abs(pct.nm - (opCash / rev) * 100);
    let eqScore = 50;
    if (accruals < 5) eqScore += 25;
    else if (accruals < 10) eqScore += 15;
    else if (accruals > 20) eqScore -= 20;

    if (pct.nm > 15) eqScore += 15;
    else if (pct.nm > 10) eqScore += 8;

    if (pct.roe > 15) eqScore += 10;
    eqScore = Math.min(100, Math.max(0, eqScore));

    // 5. SHAREHOLDER YIELD (simplified)
    const divYield = (sd.dividendYield || 0) * 100;
    const payout = sd.payoutRatio || 0;
    const buybackYield = payout < 0.3 && pct.roe > 15 ? 2.5 : 0;
    const tsy = divYield + buybackYield;

    let tsyScore = 0;
    if (tsy >= 6) tsyScore = 100;
    else if (tsy >= 4) tsyScore = 80;
    else if (tsy >= 3) tsyScore = 65;
    else if (tsy >= 2) tsyScore = 50;
    else if (tsy >= 1) tsyScore = 30;
    else tsyScore = 15;

    // 6. GROWTH CONSTRAINTS (penalty)
    let constraintPenalty = 0;
    const pe = sd.forwardPE || ks.forwardPE || 0;

    // Valuation constraint
    if (pe > 40) constraintPenalty -= 3;
    else if (pe > 30) constraintPenalty -= 2;

    // Debt constraint
    if (de > 200) constraintPenalty -= 3;
    else if (de > 100) constraintPenalty -= 1;

    // Concentration constraint (revenue growth deceleration)
    if (pct.revGrowth < 2 && pct.earnGrowth < 0) constraintPenalty -= 2;

    // 7. AI DISRUPTION SIGNAL
    let aiBonus = 0;
    const aiThreat = ['software', 'internet', 'cloud', 'platform'].some(s => industry.includes(s));
    if (aiThreat && (industry.includes('enterprise') || industry.includes('legacy'))) aiBonus = -3;
    else if (aiThreat) aiBonus = 2;

    // FUNDAMENTAL COMPOSITE
    const fundamentalComposite = Math.max(0, Math.min(100,
      buffettScore * 0.25 +
      moatScore * 0.20 +
      roicScore * 0.20 +
      eqScore * 0.15 +
      tsyScore * 0.10 +
      (buffettScore + moatScore) / 2 * 0.10 +
      constraintPenalty +
      aiBonus
    ));

    return {
      ticker,
      name: p.longName || p.shortName || ticker,
      sector: sp.sector || '',
      industry: sp.industry || '',
      marketCap,
      buffettScore,
      moatScore,
      roicScore,
      roicSpread: parseFloat(roicSpread.toFixed(1)),
      eqScore,
      tsyScore,
      totalShareholderYield: parseFloat(tsy.toFixed(2)),
      constraintPenalty,
      aiBonus,
      fundamentalComposite: parseFloat(fundamentalComposite.toFixed(1)),
      forwardPE: sd.forwardPE || ks.forwardPE || 0,
      trailingPE: sd.trailingPE || 0,
      grossMargin: pct.gm,
      operatingMargin: pct.om,
      forwardEps: ks.forwardEps || 0,
      beta: sd.beta || 1
    };
  } catch (e) {
    return null;
  }
}

function calculateDynamicValuation(currentPrice, fundData, priceData, asOfDate) {
  let score = 50;
  let signals = 0;
  let totalSignal = 0;

  const available = priceData.filter(p => p.date <= asOfDate);
  const last252 = available.slice(-252);

  // Price vs 252-day average
  if (last252.length >= 200) {
    const avgPrice = last252.reduce((s, p) => s + p.close, 0) / last252.length;
    const priceVsAvg = (currentPrice - avgPrice) / avgPrice;

    if (priceVsAvg < -0.20) { totalSignal += 85; signals++; }
    else if (priceVsAvg < -0.10) { totalSignal += 70; signals++; }
    else if (priceVsAvg < 0) { totalSignal += 55; signals++; }
    else if (priceVsAvg < 0.10) { totalSignal += 45; signals++; }
    else if (priceVsAvg < 0.20) { totalSignal += 30; signals++; }
    else { totalSignal += 15; signals++; }
  }

  // Forward P/E signal
  if (fundData.forwardEps && fundData.forwardEps > 0) {
    const impliedPE = currentPrice / fundData.forwardEps;
    if (impliedPE < 15) { totalSignal += 90; signals++; }
    else if (impliedPE < 22) { totalSignal += 70; signals++; }
    else if (impliedPE < 30) { totalSignal += 50; signals++; }
    else if (impliedPE < 40) { totalSignal += 30; signals++; }
    else { totalSignal += 15; signals++; }
  }

  // Price vs 200-day MA
  const last200 = available.slice(-200);
  if (last200.length >= 180) {
    const ma200 = last200.reduce((s, p) => s + p.close, 0) / last200.length;
    const distFrom200 = (currentPrice - ma200) / ma200;

    if (distFrom200 < -0.15) { totalSignal += 80; signals++; }
    else if (distFrom200 < -0.05) { totalSignal += 65; signals++; }
    else if (distFrom200 < 0.10) { totalSignal += 50; signals++; }
    else if (distFrom200 < 0.25) { totalSignal += 35; signals++; }
    else { totalSignal += 15; signals++; }
  }

  const qualityAdjustment = (fundData.fundamentalComposite - 50) * 0.15;
  score = signals > 0 ? (totalSignal / signals) + qualityAdjustment : 50;
  score = Math.max(0, Math.min(100, score));

  return { score };
}

async function fetchFundamentals(ticker) {
  try {
    const result = await yahooFinance.quoteSummary(ticker, {
      modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'summaryProfile']
    });
    return calculateFundamentalScore(result, ticker);
  } catch (e) {
    console.error(`Failed fundamentals for ${ticker}: ${e.message}`);
    return null;
  }
}

function bt_rankFullComposite(universe, priceHistory, fundamentals, asOfDate) {
  const scores = [];

  for (const ticker of universe) {
    if (ticker === 'SPY' || !ticker) continue;

    const prices = priceHistory[ticker];
    const fundData = fundamentals[ticker];

    if (!prices || prices.length < 120 || !fundData) continue;

    const momentum = bt_calculateMomentum(prices, asOfDate, 6);
    if (!momentum) continue;

    const priceValue = bt_calculateValueSignal(prices, asOfDate);
    if (!priceValue) continue;

    const dynamicVal = calculateDynamicValuation(momentum.currentPrice, fundData, prices, asOfDate);

    const momNormalized = Math.max(0, Math.min(100, (momentum.finalMomentumScore + 1) * 33));

    const fullComposite = (
      fundData.fundamentalComposite * 0.30 +
      dynamicVal.score * 0.25 +
      momNormalized * 0.25 +
      priceValue.valueScore * 0.20
    );

    // Filters
    if (momentum.trendBonus <= -1 && priceValue.valueScore < 40) continue;
    if (momentum.annualizedVol > 0.80) continue;
    if (fundData.fundamentalComposite < 30) continue;
    if (fundData.constraintPenalty <= -7) continue;

    scores.push({
      ticker,
      name: fundData.name,
      sector: fundData.sector,
      fundamentalScore: fundData.fundamentalComposite,
      momentumScore: momNormalized,
      valuationScore: dynamicVal.score,
      priceValueScore: priceValue.valueScore,
      buffettScore: fundData.buffettScore,
      moatScore: fundData.moatScore,
      roicSpread: fundData.roicSpread,
      eqScore: fundData.eqScore,
      aiImpact: fundData.aiBonus > 0 ? 'up' : fundData.aiBonus < 0 ? 'down' : 'neutral',
      compositeScore: parseFloat(fullComposite.toFixed(1)),
      price: momentum.currentPrice,
      volatility: momentum.annualizedVol,
      momentum6m: momentum.rawMomentum,
      distFromHigh: priceValue.distFromHigh
    });
  }

  scores.sort((a, b) => b.compositeScore - a.compositeScore);
  return scores;
}

function bt_rankQualityMomentum(universe, priceHistory, fundamentals, asOfDate) {
  const scores = [];

  for (const ticker of universe) {
    if (ticker === 'SPY' || !ticker) continue;

    const prices = priceHistory[ticker];
    const fundData = fundamentals[ticker];

    if (!prices || prices.length < 120 || !fundData) continue;
    if (fundData.fundamentalComposite < 50) continue;
    if (fundData.constraintPenalty <= -7) continue;

    const momentum = bt_calculateMomentum(prices, asOfDate, 6);
    if (!momentum) continue;

    const momNormalized = Math.max(0, Math.min(100, (momentum.finalMomentumScore + 1) * 33));

    if (momentum.annualizedVol > 0.80) continue;

    scores.push({
      ticker,
      name: fundData.name,
      sector: fundData.sector,
      fundamentalScore: fundData.fundamentalComposite,
      momentumScore: momNormalized,
      compositeScore: momNormalized,
      price: momentum.currentPrice,
      volatility: momentum.annualizedVol,
      momentum6m: momentum.rawMomentum
    });
  }

  scores.sort((a, b) => b.compositeScore - a.compositeScore);
  return scores;
}

// =====================================================================
// BACKTEST ENDPOINT
// =====================================================================

const FUNDAMENTALS_CACHE = new Map();
const FUNDAMENTALS_CACHE_TTL = 12 * 60 * 60 * 1000;

const UNIVERSE_TICKERS = {
  sp500_top50: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'GOOG', 'BRK.B', 'LLY', 'AVGO', 'JPM', 'XOM', 'UNH', 'TSLA', 'V', 'JNJ', 'PG', 'MA', 'HD', 'CVX', 'MRK', 'ABBV', 'PEP', 'COST', 'KO', 'ADBE', 'ACN', 'TMO', 'MCD', 'CSCO', 'ABT', 'DHR', 'CRM', 'WMT', 'BAC', 'LIN', 'CMCSA', 'VRTX', 'NFLX', 'AMD', 'TXN', 'NEE', 'PM', 'ORCL', 'INTU', 'QCOM', 'AMGN', 'UPS', 'HON', 'RTX', 'LOW', 'IBM', 'SPY'],
  vgt: ['MSFT', 'AAPL', 'NVDA', 'AVGO', 'CRM', 'AMD', 'ADBE', 'CSCO', 'ACN', 'INTU', 'TXN', 'QCOM', 'IBM', 'NOW', 'SNOW', 'PANW', 'MU', 'AMAT', 'LRCX', 'KLAC', 'MPWR', 'CDNS', 'FTNT', 'ANET', 'ON', 'HPQ', 'DELL', 'NXPI', 'INTC', 'STX', 'WDC', 'SPY'],
  mag7: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'TSLA', 'SPY'],
  russell_growth: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'TSLA', 'AVGO', 'AMD', 'AMAT', 'NFLX', 'CRM', 'ADBE', 'NOW', 'INTU', 'QCOM', 'TXN', 'MU', 'AMGN', 'SPY'],
  dividend_aristocrats: ['MMM', 'ABT', 'ABBV', 'AFL', 'ADP', 'BALL', 'BAC', 'CAH', 'CCL', 'CAT', 'CB', 'CINF', 'CTAS', 'CVX', 'CLX', 'KO', 'CL', 'COP', 'CTSH', 'CVS', 'SPY']
};

function spearmanCorrelation(xs, ys) {
  if (xs.length !== ys.length || xs.length < 3) return 0;
  const n = xs.length;
  const rank = (arr) => {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    for (let i = 0; i < n; i++) ranks[sorted[i].i] = i + 1;
    return ranks;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  let sumD2 = 0;
  for (let i = 0; i < n; i++) sumD2 += (rx[i] - ry[i]) ** 2;
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

const COMPOSITE_WEIGHTS = { fundamental: 0.30, valuation: 0.25, momentum: 0.25, value: 0.20 };
const FACTOR_NAMES = ['fundamental', 'valuation', 'momentum', 'value'];

function computeFactorAttribution(factorSnapshots, priceHistory, rebalanceDates, sells, fundamentals) {
  if (!factorSnapshots || factorSnapshots.length < 2) return null;

  const periodData = [];
  for (let i = 0; i < factorSnapshots.length - 1; i++) {
    const snap = factorSnapshots[i];
    const nextDate = rebalanceDates[Math.min(i + 1, rebalanceDates.length - 1)];
    if (!nextDate || nextDate === snap.date) continue;

    const withReturns = [];
    for (const stock of snap.allRanked) {
      const prices = priceHistory[stock.ticker];
      if (!prices) continue;
      const entryPrice = stock.price;
      const exitPrice = getPrice(prices, nextDate);
      if (!entryPrice || !exitPrice || entryPrice <= 0) continue;
      const ret = (exitPrice - entryPrice) / entryPrice;
      withReturns.push({ ...stock, realized: ret });
    }
    if (withReturns.length >= 6) {
      periodData.push({ date: snap.date, nextDate, stocks: withReturns });
    }
  }

  if (periodData.length === 0) return null;

  // 1. Factor IC — average Spearman correlation per factor across periods
  const icSums = { fundamental: 0, valuation: 0, momentum: 0, value: 0 };
  const icCounts = { fundamental: 0, valuation: 0, momentum: 0, value: 0 };
  for (const pd of periodData) {
    const returns = pd.stocks.map(s => s.realized);
    for (const f of FACTOR_NAMES) {
      const scores = pd.stocks.map(s => s[f] ?? 0);
      const ic = spearmanCorrelation(scores, returns);
      if (isFinite(ic)) { icSums[f] += ic; icCounts[f]++; }
    }
  }
  const avgIC = {};
  for (const f of FACTOR_NAMES) {
    avgIC[f] = icCounts[f] > 0 ? icSums[f] / icCounts[f] : 0;
  }

  // 2. Factor spread — top-half vs bottom-half return per factor, averaged across periods
  const spreadSums = { fundamental: 0, valuation: 0, momentum: 0, value: 0 };
  const spreadCounts = { fundamental: 0, valuation: 0, momentum: 0, value: 0 };
  for (const pd of periodData) {
    for (const f of FACTOR_NAMES) {
      const sorted = [...pd.stocks].sort((a, b) => (b[f] ?? 0) - (a[f] ?? 0));
      const mid = Math.floor(sorted.length / 2);
      if (mid < 1) continue;
      const topAvg = sorted.slice(0, mid).reduce((s, x) => s + x.realized, 0) / mid;
      const botAvg = sorted.slice(mid).reduce((s, x) => s + x.realized, 0) / (sorted.length - mid);
      spreadSums[f] += topAvg - botAvg;
      spreadCounts[f]++;
    }
  }
  const avgSpread = {};
  for (const f of FACTOR_NAMES) {
    avgSpread[f] = spreadCounts[f] > 0 ? spreadSums[f] / spreadCounts[f] : 0;
  }

  // 3. Held-stock decomposition — factor contribution to actual portfolio profit
  const contribution = { fundamental: 0, valuation: 0, momentum: 0, value: 0, total: 0 };
  for (const sell of sells) {
    const factorScores = findFactorScores(factorSnapshots, sell.ticker, sell.date);
    if (!factorScores) continue;
    const dollarReturn = sell.holdingReturn * sell.proceeds;
    contribution.total += dollarReturn;
    const compositeSum = (factorScores.fundamental * COMPOSITE_WEIGHTS.fundamental) +
                         (factorScores.valuation * COMPOSITE_WEIGHTS.valuation) +
                         (factorScores.momentum * COMPOSITE_WEIGHTS.momentum) +
                         (factorScores.value * COMPOSITE_WEIGHTS.value);
    if (compositeSum > 0) {
      for (const f of FACTOR_NAMES) {
        const share = (factorScores[f] * COMPOSITE_WEIGHTS[f]) / compositeSum;
        contribution[f] += dollarReturn * share;
      }
    }
  }

  // 4. Suggested weights — blend IC-derived weights 50/50 with originals
  const positiveICs = {};
  for (const f of FACTOR_NAMES) positiveICs[f] = Math.max(avgIC[f], 0.01);
  const icTotal = FACTOR_NAMES.reduce((s, f) => s + positiveICs[f], 0);
  const icWeights = {};
  for (const f of FACTOR_NAMES) icWeights[f] = positiveICs[f] / icTotal;
  const suggestedWeights = {};
  for (const f of FACTOR_NAMES) {
    suggestedWeights[f] = parseFloat(((COMPOSITE_WEIGHTS[f] + icWeights[f]) / 2).toFixed(3));
  }
  const wSum = FACTOR_NAMES.reduce((s, f) => s + suggestedWeights[f], 0);
  for (const f of FACTOR_NAMES) suggestedWeights[f] = parseFloat((suggestedWeights[f] / wSum).toFixed(3));

  // 5. Build insight text
  const best = FACTOR_NAMES.reduce((a, b) => avgIC[a] > avgIC[b] ? a : b);
  const worst = FACTOR_NAMES.reduce((a, b) => avgIC[a] < avgIC[b] ? a : b);
  const bestLabel = { fundamental: 'Quality', valuation: 'Valuation', momentum: 'Momentum', value: 'Value' };
  let insight = `${bestLabel[best]} was the strongest signal (IC ${avgIC[best] >= 0 ? '+' : ''}${(avgIC[best]).toFixed(3)}, spread ${avgSpread[best] >= 0 ? '+' : ''}${(avgSpread[best] * 100).toFixed(1)}%/period).`;
  if (avgIC[worst] < 0.02) {
    insight += ` ${bestLabel[worst]} was weak (IC ${(avgIC[worst]).toFixed(3)}).`;
  }
  insight += ` Consider shifting weight toward ${bestLabel[best]} (${(COMPOSITE_WEIGHTS[best] * 100).toFixed(0)}% → ${(suggestedWeights[best] * 100).toFixed(0)}%).`;

  return {
    factors: FACTOR_NAMES.map(f => ({
      name: f,
      label: bestLabel[f],
      ic: parseFloat(avgIC[f].toFixed(4)),
      spread: parseFloat((avgSpread[f] * 100).toFixed(2)),
      contribution: parseFloat(contribution[f].toFixed(2)),
      originalWeight: COMPOSITE_WEIGHTS[f],
      suggestedWeight: suggestedWeights[f],
      color: { fundamental: '#22c55e', valuation: '#f59e0b', momentum: '#06b6d4', value: '#8b5cf6' }[f]
    })),
    totalContribution: parseFloat(contribution.total.toFixed(2)),
    periodsAnalyzed: periodData.length,
    avgStocksPerPeriod: Math.round(periodData.reduce((s, p) => s + p.stocks.length, 0) / periodData.length),
    insight
  };
}

function findFactorScores(factorSnapshots, ticker, sellDate) {
  for (let i = factorSnapshots.length - 1; i >= 0; i--) {
    if (factorSnapshots[i].date <= sellDate) {
      const stock = factorSnapshots[i].allRanked.find(s => s.ticker === ticker);
      if (stock) return stock;
    }
  }
  return null;
}

function subtractMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().split('T')[0];
}

function daysBetween(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

function standardDeviation(arr) {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const sqDiffs = arr.map(x => Math.pow(x - mean, 2));
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / arr.length);
}

function getPrice(priceData, date) {
  if (!priceData || priceData.length === 0) return null;
  const target = typeof date === 'string' ? date : date.toISOString().split('T')[0];
  for (let i = 0; i < priceData.length; i++) {
    if (priceData[i].date >= target) {
      return priceData[i].close;
    }
  }
  return priceData[priceData.length - 1]?.close || null;
}

function getRebalanceDates(startDate, endDate, frequency) {
  const dates = [];
  let current = new Date(startDate);
  
  while (current < new Date(endDate)) {
    if (frequency === 'monthly') {
      current.setMonth(current.getMonth() + 1);
    } else {
      current.setMonth(current.getMonth() + 3);
    }
    current.setDate(1);
    
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(Math.min(current.getDate(), 28)).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    
    if (dateStr < endDate) {
      dates.push(dateStr);
    }
  }
  
  return dates;
}

function bt_calculateMomentum(priceData, asOfDate, lookbackMonths = 6) {
  const available = priceData.filter(p => p.date <= asOfDate);
  if (available.length < 60) return null;
  
  const currentPrice = available[available.length - 1].close;
  
  const lookbackDate = subtractMonths(asOfDate, lookbackMonths);
  const lookbackEntry = available.find(p => p.date >= lookbackDate) || available[0];
  const lookbackPrice = lookbackEntry?.close;
  if (!lookbackPrice) return null;
  
  const rawMomentum = (currentPrice - lookbackPrice) / lookbackPrice;
  
  const lookbackPrices = available.filter(p => p.date >= lookbackDate);
  const dailyReturns = [];
  for (let i = 1; i < lookbackPrices.length; i++) {
    dailyReturns.push(Math.log(lookbackPrices[i].close / lookbackPrices[i - 1].close));
  }
  const stddev = standardDeviation(dailyReturns);
  const annualizedVol = stddev * Math.sqrt(252);
  
  const annualizedReturn = Math.pow(1 + rawMomentum, 12 / lookbackMonths) - 1;
  const riskAdjustedMomentum = annualizedVol > 0 ? annualizedReturn / annualizedVol : 0;
  
  const last50 = available.slice(-50);
  const last200 = available.slice(-200);
  const ma50 = last50.reduce((s, p) => s + p.close, 0) / last50.length;
  const ma200 = last200.length >= 200 
    ? last200.reduce((s, p) => s + p.close, 0) / last200.length 
    : null;
  
  let trendBonus = 0;
  if (ma200) {
    if (currentPrice > ma50 && ma50 > ma200) trendBonus = 2;
    else if (currentPrice > ma200) trendBonus = 1;
    else if (currentPrice < ma50 && ma50 < ma200) trendBonus = -1;
  }
  
  return {
    rawMomentum,
    annualizedReturn,
    annualizedVol,
    riskAdjustedMomentum,
    trendBonus,
    finalMomentumScore: riskAdjustedMomentum + trendBonus,
    currentPrice
  };
}

function bt_calculateValueSignal(priceData, asOfDate) {
  const available = priceData.filter(p => p.date <= asOfDate);
  if (available.length < 252) return null;
  
  const currentPrice = available[available.length - 1].close;
  
  const last252 = available.slice(-252);
  const high52w = Math.max(...last252.map(p => p.close));
  const distFromHigh = (currentPrice - high52w) / high52w;
  
  let valueScore;
  if (distFromHigh > -0.05) valueScore = 20;
  else if (distFromHigh > -0.15) valueScore = 40;
  else if (distFromHigh > -0.25) valueScore = 70;
  else if (distFromHigh > -0.35) valueScore = 60;
  else valueScore = 30;
  
  const last21 = available.slice(-21);
  const monthAgoPrice = last21[0]?.close;
  const recentMomentum = monthAgoPrice ? (currentPrice - monthAgoPrice) / monthAgoPrice : 0;
  
  if (recentMomentum > 0.02) valueScore += 15;
  else if (recentMomentum > 0) valueScore += 5;
  else valueScore -= 10;
  
  return {
    distFromHigh,
    recentMomentum,
    valueScore: Math.max(0, Math.min(100, valueScore))
  };
}

// ============================================
// BACKTEST RANKING FUNCTIONS (4 DISTINCT STRATEGIES)
// ============================================

function bt_rankMomentumOnly(universe, priceHistory, asOfDate) {
  const results = [];
  
  for (const ticker of universe) {
    if (ticker === 'SPY' || !ticker) continue;
    const prices = priceHistory[ticker];
    if (!prices || prices.length < 120) continue;
    
    const mom = bt_calculateMomentum(prices, asOfDate, 6);
    if (!mom) continue;
    if (mom.annualizedVol > 0.80) continue;
    
    const score = (mom.finalMomentumScore + 2) * 25; // scale to 0-100
    results.push({
      ticker,
      compositeScore: score,
      momentumScore: mom.finalMomentumScore,
      price: mom.currentPrice,
      volatility: mom.annualizedVol,
      strategy: 'momentum_only'
    });
  }
  
  results.sort((a, b) => b.compositeScore - a.compositeScore);
  return results;
}

function bt_rankMomentumValue(universe, priceHistory, asOfDate) {
  const results = [];
  
  for (const ticker of universe) {
    if (ticker === 'SPY' || !ticker) continue;
    const prices = priceHistory[ticker];
    if (!prices || prices.length < 120) continue;
    
    const mom = bt_calculateMomentum(prices, asOfDate, 6);
    const val = bt_calculateValueSignal(prices, asOfDate);
    if (!mom || !val) continue;
    if (mom.annualizedVol > 0.80) continue;
    if (mom.trendBonus < 0 && val.valueScore < 40) continue;
    
    const momNorm = Math.max(0, Math.min(100, (mom.finalMomentumScore + 1) * 33));
    const combined = momNorm * 0.60 + val.valueScore * 0.40;
    
    results.push({
      ticker,
      compositeScore: combined,
      momentumScore: momNorm,
      valueScore: val.valueScore,
      price: mom.currentPrice,
      volatility: mom.annualizedVol,
      strategy: 'momentum_value'
    });
  }
  
  results.sort((a, b) => b.compositeScore - a.compositeScore);
  return results;
}

function bt_rankQualityMomentumV2(universe, priceHistory, fundamentals, asOfDate) {
  const hasFund = fundamentals && Object.keys(fundamentals).length > 0;
  
  const results = [];
  let filteredCount = 0;
  let noFundCount = 0;
  let lowQualityCount = 0;
  
  for (const ticker of universe) {
    if (ticker === 'SPY' || !ticker) continue;
    const prices = priceHistory[ticker];
    if (!prices || prices.length < 120) continue;
    
    const fund = fundamentals?.[ticker];
    // QUALITY GATE: skip low quality
    if (!fund) {
      noFundCount++;
      filteredCount++;
      continue;
    }
    if (fund.fundamentalComposite < 50) {
      lowQualityCount++;
      filteredCount++;
      continue;
    }
    
    const mom = bt_calculateMomentum(prices, asOfDate, 6);
    if (!mom) continue;
    if (mom.annualizedVol > 0.80) continue;
    
    const score = (mom.finalMomentumScore + 2) * 25;
    results.push({
      ticker,
      compositeScore: score,
      momentumScore: mom.finalMomentumScore,
      fundamentalScore: fund.fundamentalComposite,
      price: mom.currentPrice,
      volatility: mom.annualizedVol,
      strategy: 'quality_momentum'
    });
  }
  
  results.sort((a, b) => b.compositeScore - a.compositeScore);
  return results;
}

function bt_rankFullCompositeV2(universe, priceHistory, fundamentals, asOfDate) {
  const hasFund = fundamentals && Object.keys(fundamentals).length > 0;
  
  const results = [];
  let filteredCount = 0;
  let noFundCount = 0;
  let lowQualityCount = 0;
  let constraintCount = 0;
  
  for (const ticker of universe) {
    if (ticker === 'SPY' || !ticker) continue;
    const prices = priceHistory[ticker];
    if (!prices || prices.length < 120) continue;
    
    const fund = fundamentals?.[ticker];
    if (!fund) {
      noFundCount++;
      filteredCount++;
      continue;
    }
    if (fund.fundamentalComposite < 30) {
      lowQualityCount++;
      filteredCount++;
      continue;
    }
    if (fund.constraintPenalty <= -7) {
      constraintCount++;
      filteredCount++;
      continue;
    }
    
    const mom = bt_calculateMomentum(prices, asOfDate, 6);
    const val = bt_calculateValueSignal(prices, asOfDate);
    if (!mom || !val) continue;
    if (mom.annualizedVol > 0.80) continue;
    
    const momNorm = Math.max(0, Math.min(100, (mom.finalMomentumScore + 1) * 33));
    const dynVal = calculateDynamicValuation(mom.currentPrice, fund, prices, asOfDate);
    
    // FULL COMPOSITE: 30% fundamental + 25% dyn valuation + 25% momentum + 20% price value
    const fullScore = (
      fund.fundamentalComposite * 0.30 +
      dynVal.score * 0.25 +
      momNorm * 0.25 +
      val.valueScore * 0.20
    );
    
    results.push({
      ticker,
      compositeScore: fullScore,
      fundamentalScore: fund.fundamentalComposite,
      momentumScore: momNorm,
      valuationScore: dynVal.score,
      valueScore: val.valueScore,
      price: mom.currentPrice,
      volatility: mom.annualizedVol,
      strategy: 'full_composite'
    });
  }
  
  results.sort((a, b) => b.compositeScore - a.compositeScore);
  return results;
}

function bt_rankStocks(universe, priceHistory, asOfDate, strategy = 'momentum_value') {
  const scores = [];
  
  for (const ticker of universe) {
    if (ticker === 'SPY' || ticker === ' ') continue;
    
    const prices = priceHistory[ticker];
    if (!prices || prices.length < 120) continue;
    
    const momentum = bt_calculateMomentum(prices, asOfDate, 6);
    const value = bt_calculateValueSignal(prices, asOfDate);
    
    if (!momentum || !value) continue;
    
    const momNormalized = Math.max(0, Math.min(100, (momentum.finalMomentumScore + 1) * 33));
    
    let combined;
    if (strategy === 'momentum') {
      combined = momNormalized;
    } else {
      combined = momNormalized * 0.6 + value.valueScore * 0.4;
    }
    
    if (momentum.trendBonus < 0 && value.valueScore < 40) continue;
    if (momentum.annualizedVol > 0.80) continue;
    
    scores.push({
      ticker,
      momentumScore: momNormalized,
      valueScore: value.valueScore,
      combinedScore: combined,
      price: momentum.currentPrice,
      volatility: momentum.annualizedVol
    });
  }
  
  scores.sort((a, b) => b.combinedScore - a.combinedScore);
  return scores;
}

async function bt_fetchPriceHistory(ticker, startDate, endDate) {
  try {
    const result = await yahooFinance.chart(ticker, {
      period1: startDate,
      period2: endDate,
      interval: '1d'
    });
    
    if (!result || !result.quotes || result.quotes.length === 0) {
      return null;
    }
    
    return result.quotes
      .filter(q => q.date && q.close)
      .map(q => ({
        date: typeof q.date === 'string' ? q.date.substring(0, 10) : q.date.toISOString().substring(0, 10),
        close: q.close
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch (err) {
    console.error(`Failed to fetch ${ticker}:`, err.message);
    return null;
  }
}

app.get('/api/backtest/:universeId', async (req, res) => {
  const { universeId } = req.params;
  const { 
    period = '3y',
    rebalanceFreq = 'monthly',
    topN = 10,
    strategy = 'momentum_value',
    initialCapital = 10000
  } = req.query;

  const strategyClean = (strategy || 'momentum_value').toLowerCase().trim();
  const capital = parseFloat(initialCapital) || 10000;
  
  const cacheKey = `${BACKTEST_CACHE_VERSION}-${universeId}-${period}-${rebalanceFreq}-${topN}-${strategyClean}-${capital}`;
  const cached = BACKTEST_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < BACKTEST_CACHE_TTL) {
    return res.json({ success: true, ...cached.data, cached: true });
  }
  
  const universe = UNIVERSE_TICKERS[universeId];
  if (!universe) {
    return res.status(400).json({ success: false, error: 'Unknown universe' });
  }
  
  const needsFundamentals = strategyClean === 'full_composite' || strategyClean === 'quality_momentum';
  
  const periodDays = { '1y': 365, '2y': 730, '3y': 1095, '5y': 1825 };
  const days = periodDays[period] || 1095;
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
  const lookbackStart = new Date(startDate.getTime() - 400 * 24 * 60 * 60 * 1000);
  const startDateStr = lookbackStart.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  const backtestStartDate = startDate.toISOString().split('T')[0];
  
  try {
    const tickersToFetch = [...new Set([...universe, 'SPY'])].filter(t => t && t.trim() !== '');
    const priceHistory = {};
    
    // Fetch price histories
    for (let i = 0; i < tickersToFetch.length; i++) {
      const ticker = tickersToFetch[i];
      const data = await bt_fetchPriceHistory(ticker, startDateStr, endDateStr);
      if (data) {
        priceHistory[ticker] = data;
      }
      if (i % 5 === 0) {
        await sleep(100);
      }
    }
    
    // Fetch fundamentals if needed
    let fundamentals = null;
    if (needsFundamentals) {
      fundamentals = {};
      const tickersForFundamentals = tickersToFetch.filter(t => t !== 'SPY');
      for (let i = 0; i < tickersForFundamentals.length; i++) {
        const ticker = tickersForFundamentals[i];
        const cachedFund = FUNDAMENTALS_CACHE.get(ticker);
        if (cachedFund && Date.now() - cachedFund.timestamp < FUNDAMENTALS_CACHE_TTL) {
          fundamentals[ticker] = cachedFund.data;
        } else {
          const fund = await fetchFundamentals(ticker);
          if (fund) {
            fundamentals[ticker] = fund;
            FUNDAMENTALS_CACHE.set(ticker, { data: fund, timestamp: Date.now() });
          }
        }
        if (i % 5 === 0) {
          await sleep(200);
        }
      }
      
    }
    
    // Generate rebalance dates
    const rebalanceDates = getRebalanceDates(backtestStartDate, endDateStr, rebalanceFreq);
    if (rebalanceDates.length < 2) {
      return res.status(400).json({ success: false, error: 'Insufficient rebalance dates' });
    }
    
    // Run backtest simulation
    let cash = capital;
    const holdings = {};
    const tradeLog = [];
    const rebalanceLog = [];
    const holdingsSnapshots = [];
    const factorSnapshots = [];
    
    const spyPrices = priceHistory['SPY'];
    const spyStartPrice = getPrice(spyPrices, rebalanceDates[0]);
    const spyShares = spyStartPrice ? capital / spyStartPrice : 0;
    
    holdingsSnapshots.push({ date: backtestStartDate, cash, holdings: {} });
    
    for (let i = 0; i < rebalanceDates.length; i++) {
      const date = rebalanceDates[i];
      
      let rankings;
      
      if (strategyClean === 'momentum') {
        rankings = bt_rankMomentumOnly(universe, priceHistory, date);
      } else if (strategyClean === 'momentum_value') {
        rankings = bt_rankMomentumValue(universe, priceHistory, date);
      } else if (strategyClean === 'quality_momentum') {
        rankings = bt_rankQualityMomentumV2(universe, priceHistory, fundamentals, date);
      } else if (strategyClean === 'full_composite') {
        rankings = bt_rankFullCompositeV2(universe, priceHistory, fundamentals, date);
      } else {
        rankings = bt_rankMomentumValue(universe, priceHistory, date);
      }
      
      if (strategyClean === 'full_composite') {
        factorSnapshots.push({
          date,
          allRanked: rankings.map(r => ({
            ticker: r.ticker,
            momentum: r.momentumScore,
            valuation: r.valuationScore,
            fundamental: r.fundamentalScore,
            value: r.valueScore,
            composite: r.compositeScore,
            price: r.price
          }))
        });
      }
      
      const topPicks = rankings.slice(0, parseInt(topN));
      
      let portfolioValue = cash;
      for (const [ticker, holding] of Object.entries(holdings)) {
        const price = getPrice(priceHistory[ticker], date);
        if (price) portfolioValue += holding.shares * price;
      }
      
      const targetAllocation = {};
      const positionSize = portfolioValue / topPicks.length;
      for (const pick of topPicks) {
        targetAllocation[pick.ticker] = {
          targetDollars: positionSize,
          score: pick.combinedScore || pick.compositeScore || 0,
          price: pick.price
        };
      }
      
      const trades = [];
      
      for (const [ticker, holding] of Object.entries(holdings)) {
        if (!targetAllocation[ticker]) {
          const sellPrice = getPrice(priceHistory[ticker], date);
          if (sellPrice) {
            const proceeds = holding.shares * sellPrice;
            const returnPct = (sellPrice - holding.entryPrice) / holding.entryPrice;
            cash += proceeds;
            trades.push({
              type: 'SELL', ticker, shares: holding.shares,
              price: sellPrice, proceeds,
              holdingReturn: returnPct,
              holdingDays: daysBetween(holding.entryDate, date)
            });
            delete holdings[ticker];
          }
        }
      }
      
      for (const [ticker, target] of Object.entries(targetAllocation)) {
        const currentPrice = getPrice(priceHistory[ticker], date);
        if (!currentPrice || currentPrice <= 0) continue;
        
        const currentValue = holdings[ticker] ? holdings[ticker].shares * currentPrice : 0;
        const targetValue = target.targetDollars;
        const diffValue = targetValue - currentValue;
        
        if (diffValue > 50) {
          const sharesToBuy = Math.floor(diffValue / currentPrice);
          if (sharesToBuy > 0 && cash >= sharesToBuy * currentPrice) {
            const cost = sharesToBuy * currentPrice;
            cash -= cost;
            
            if (holdings[ticker]) {
              const totalShares = holdings[ticker].shares + sharesToBuy;
              const avgPrice = (holdings[ticker].shares * holdings[ticker].entryPrice + cost) / totalShares;
              holdings[ticker] = { shares: totalShares, entryPrice: avgPrice, entryDate: holdings[ticker].entryDate };
            } else {
              holdings[ticker] = { shares: sharesToBuy, entryPrice: currentPrice, entryDate: date };
            }
            
            trades.push({
              type: 'BUY', ticker, shares: sharesToBuy,
              price: currentPrice, cost,
              score: target.score
            });
          }
        }
      }
      
      let postValue = cash;
      for (const [ticker, holding] of Object.entries(holdings)) {
        const price = getPrice(priceHistory[ticker], date);
        if (price) postValue += holding.shares * price;
      }
      
      rebalanceLog.push({
        date,
        portfolioValue: postValue,
        holdings: Object.keys(holdings),
        topPicks: topPicks.map(p => p.ticker),
        tradesExecuted: trades.length
      });
      
      tradeLog.push(...trades.map(t => ({ ...t, date })));
      
      const holdingsCopy = {};
      for (const [t, h] of Object.entries(holdings)) {
        holdingsCopy[t] = { shares: h.shares, entryPrice: h.entryPrice, entryDate: h.entryDate };
      }
      holdingsSnapshots.push({ date, cash, holdings: holdingsCopy });
    }
    
    // Build equity curve using snapshots so each period uses the actual holdings
    const allDates = spyPrices
      .filter(p => p.date >= backtestStartDate && p.date <= rebalanceDates[rebalanceDates.length - 1])
      .map(p => p.date);
    
    const dailyValues = [];
    let snapIdx = 0;
    for (const date of allDates) {
      while (snapIdx < holdingsSnapshots.length - 1 && holdingsSnapshots[snapIdx + 1].date <= date) {
        snapIdx++;
      }
      const snap = holdingsSnapshots[snapIdx];
      
      let dayValue = snap.cash;
      for (const [ticker, holding] of Object.entries(snap.holdings)) {
        const price = getPrice(priceHistory[ticker], date);
        if (price) dayValue += holding.shares * price;
      }
      
      const spyPrice = getPrice(spyPrices, date);
      const spyValue = spyShares * spyPrice;
      
      dailyValues.push({
        date,
        portfolio: dayValue,
        benchmark: spyValue
      });
    }
    
    // Calculate metrics
    const first = dailyValues[0];
    const last = dailyValues[dailyValues.length - 1];
    const years = daysBetween(first.date, last.date) / 365;
    
    const totalReturn = (last.portfolio - capital) / capital;
    const annualizedReturn = Math.pow(1 + totalReturn, 1 / years) - 1;
    
    const benchReturn = last.benchmark > 0 ? (last.benchmark - capital) / capital : 0;
    const benchAnnualized = Math.pow(1 + benchReturn, 1 / years) - 1;
    const alpha = annualizedReturn - benchAnnualized;
    
    const dailyReturns = [];
    const benchDailyReturns = [];
    for (let i = 1; i < dailyValues.length; i++) {
      dailyReturns.push(dailyValues[i].portfolio / dailyValues[i - 1].portfolio - 1);
      if (dailyValues[i].benchmark > 0 && dailyValues[i - 1].benchmark > 0) {
        benchDailyReturns.push(dailyValues[i].benchmark / dailyValues[i - 1].benchmark - 1);
      }
    }
    
    const annualizedVol = standardDeviation(dailyReturns) * Math.sqrt(252);
    const benchVol = benchDailyReturns.length > 0 ? standardDeviation(benchDailyReturns) * Math.sqrt(252) : 0;
    
    const riskFreeRate = 0.043;
    const sharpe = annualizedVol > 0 ? (annualizedReturn - riskFreeRate) / annualizedVol : 0;
    const benchSharpe = benchVol > 0 ? (benchAnnualized - riskFreeRate) / benchVol : 0;
    
    let peak = 0, maxDrawdown = 0;
    let benchPeak = 0, benchMaxDD = 0;
    for (const d of dailyValues) {
      if (d.portfolio > peak) peak = d.portfolio;
      const dd = (d.portfolio - peak) / peak;
      if (dd < maxDrawdown) maxDrawdown = dd;
      
      if (d.benchmark > benchPeak) benchPeak = d.benchmark;
      const bdd = (d.benchmark - benchPeak) / benchPeak;
      if (bdd < benchMaxDD) benchMaxDD = bdd;
    }
    
    const sells = tradeLog.filter(t => t.type === 'SELL');
    const winners = sells.filter(t => t.holdingReturn > 0);
    const winRate = sells.length > 0 ? winners.length / sells.length : 0;
    const avgWin = winners.length > 0 ? winners.reduce((s, t) => s + t.holdingReturn, 0) / winners.length : 0;
    const losers = sells.filter(t => t.holdingReturn <= 0);
    const avgLoss = losers.length > 0 ? losers.reduce((s, t) => s + t.holdingReturn, 0) / losers.length : 0;
    
    // Monthly returns
    const monthlyReturns = [];
    let currentMonthData = null;
    
    for (const d of dailyValues) {
      const month = d.date.substring(0, 7);
      if (!currentMonthData || currentMonthData.month !== month) {
        if (currentMonthData) monthlyReturns.push(currentMonthData);
        currentMonthData = {
          month,
          portfolioStart: d.portfolio,
          portfolioEnd: d.portfolio,
          benchStart: d.benchmark,
          benchEnd: d.benchmark
        };
      } else {
        currentMonthData.portfolioEnd = d.portfolio;
        currentMonthData.benchEnd = d.benchmark;
      }
    }
    if (currentMonthData) monthlyReturns.push(currentMonthData);
    
    const monthlyWithReturns = monthlyReturns.map(m => ({
      month: m.month,
      portfolio: ((m.portfolioEnd - m.portfolioStart) / m.portfolioStart) * 100,
      benchmark: ((m.benchEnd - m.benchStart) / m.benchStart) * 100
    })).filter(m => !isNaN(m.portfolio) && isFinite(m.portfolio));
    
    const monthsBeating = monthlyWithReturns.filter(m => m.portfolio > m.benchmark).length;
    const hitRate = monthlyWithReturns.length > 0 ? (monthsBeating / monthlyWithReturns.length) * 100 : 0;
    
    // Current holdings
    const currentHoldings = [];
    const lastDate = rebalanceDates[rebalanceDates.length - 1];
    for (const [ticker, holding] of Object.entries(holdings)) {
      const price = getPrice(priceHistory[ticker], lastDate);
      if (price) {
        currentHoldings.push({
          ticker,
          shares: holding.shares,
          entryPrice: holding.entryPrice,
          currentPrice: price,
          return: ((price - holding.entryPrice) / holding.entryPrice) * 100
        });
      }
    }
    
    let factorAttribution = null;
    if (strategyClean === 'full_composite' && factorSnapshots.length >= 2) {
      factorAttribution = computeFactorAttribution(
        factorSnapshots, priceHistory, rebalanceDates, sells, fundamentals
      );
    }

    const responseData = {
      strategy,
      universe: universeId,
      period,
      rebalanceFreq,
      topN: parseInt(topN),
      initialCapital: capital,
      factorAttribution,
      
      performance: {
        totalReturn: (totalReturn * 100).toFixed(2),
        annualizedReturn: (annualizedReturn * 100).toFixed(2),
        benchmarkReturn: (benchReturn * 100).toFixed(2),
        benchmarkAnnualized: (benchAnnualized * 100).toFixed(2),
        alpha: (alpha * 100).toFixed(2),
        sharpe: sharpe.toFixed(2),
        benchmarkSharpe: benchSharpe.toFixed(2),
        maxDrawdown: (maxDrawdown * 100).toFixed(2),
        benchmarkMaxDD: (benchMaxDD * 100).toFixed(2),
        annualizedVol: (annualizedVol * 100).toFixed(2),
        benchmarkVol: (benchVol * 100).toFixed(2),
        winRate: (winRate * 100).toFixed(1),
        avgWin: (avgWin * 100).toFixed(1),
        avgLoss: (avgLoss * 100).toFixed(1),
        hitRate: hitRate.toFixed(1),
        totalTrades: tradeLog.length,
        period: `${first.date} to ${last.date}`,
        years: years.toFixed(1)
      },
      
      equityCurve: dailyValues,
      monthlyReturns: monthlyWithReturns,
      trades: tradeLog,
      rebalances: rebalanceLog,
      currentHoldings
    };
    
    BACKTEST_CACHE.set(cacheKey, { data: responseData, timestamp: Date.now() });
    
    res.json({ success: true, ...responseData });
    
  } catch (error) {
    console.error('Backtest error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
