export function safeNum(val, def = 0) {
  if (val === null || val === undefined) return def;
  const n = Number(val);
  return isNaN(n) ? def : n;
}

export function calcBuffettScore(data) {
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
  const grossMargin = safeNum(data.grossMargin) * 100;
  const operatingMargin = safeNum(data.operatingMargin) * 100;
  const profitMargin = safeNum(data.profitMargin) * 100;
  const roe = safeNum(data.roe) * 100;
  const payoutRatio = safeNum(data.payoutRatio) * 100;
  const repurchase = safeNum(data.repurchaseOfStock);
  const forwardPE = safeNum(data.forwardPE);
  const totalRevenue = safeNum(data.totalRevenue);
  const netIncome = safeNum(data.netIncome);

  const calcGrossMargin = grossMargin !== 0 ? grossMargin : (totalRevenue > 0 && safeNum(data.grossProfit) !== 0 ? (data.grossProfit / totalRevenue) * 100 : 0);
  const calcOperatingMargin = operatingMargin !== 0 ? operatingMargin : (totalRevenue > 0 && operatingMargin !== 0 ? (data.operatingIncome / totalRevenue) * 100 : 0);
  const calcProfitMargin = profitMargin !== 0 ? profitMargin : (totalRevenue > 0 && netIncome !== 0 ? (netIncome / totalRevenue) * 100 : 0);
  const calcROE = roe !== 0 ? roe : (netIncome !== 0 && sharesOutstanding > 0 && price > 0 ? (netIncome / (sharesOutstanding * price * 0.3)) * 100 : 0);

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
  
  const buybackSub = repurchase < 0 ? 3.75 : 1;
  
  let payoutSub = 0;
  if (payoutRatio < 40) payoutSub = 3.75;
  else if (payoutRatio < 60) payoutSub = 2.5;
  else if (payoutRatio < 80) payoutSub = 1.25;
  
  const insiderSub = 0.5;
  const mqScore = Math.round(roeSub + buybackSub + payoutSub + insiderSub);
  
  scores.managementQuality = mqScore;
  criteria.managementQuality = {
    pass: mqScore >= 9,
    roe: calcROE.toFixed(1),
    buyback: repurchase < 0 ? 'Yes' : 'No',
    payout: payoutRatio.toFixed(0) + '%',
    insider: 'N/A'
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

export function calcROIC(data) {
  const price = safeNum(data.price);
  const sharesOutstanding = safeNum(data.sharesOutstanding);
  const operatingIncome = safeNum(data.operatingIncome);
  const totalDebt = safeNum(data.totalDebt);
  const shareholderEquity = safeNum(data.shareholderEquity);
  const totalRevenue = safeNum(data.totalRevenue);
  const totalAssets = safeNum(data.totalAssets);
  const beta = safeNum(data.beta, 1);
  const netIncome = safeNum(data.netIncome);
  
  const investedCapital = totalDebt + (shareholderEquity || netIncome * 10);
  const roic = investedCapital > 0 ? (operatingIncome / investedCapital) * 100 : 
               (netIncome > 0 && totalAssets > 0 ? (netIncome / totalAssets) * 100 : 0);
  
  let wacc = 9.5;
  if (beta < 0.8) wacc = 8;
  else if (beta > 1.2) wacc = 11;
  
  const spread = roic - wacc;
  
  const nopatMargin = totalRevenue > 0 ? (operatingIncome / totalRevenue) * 100 : 
                      safeNum(data.operatingMargin) * 100 || safeNum(data.profitMargin) * 100 * 0.7;
  const assetTurnover = totalAssets > 0 ? totalRevenue / totalAssets : 
                       (totalRevenue > 0 && price > 0 ? totalRevenue / (sharesOutstanding * price) : 0);
  
  let trend = 'Weak';
  const effRoe = roic > 0 ? roic : safeNum(data.roe) * 100;
  if (effRoe > 20) trend = 'Strong';
  else if (effRoe >= 15) trend = 'Solid';
  else if (effRoe >= 10) trend = 'Moderate';
  
  let lever = 'Maintain operational excellence';
  if (nopatMargin < 15 && assetTurnover > 1.0) lever = 'Margin expansion';
  else if (nopatMargin > 15 && assetTurnover < 0.8) lever = 'Capital efficiency';
  else if (nopatMargin < 15 && assetTurnover < 0.8) lever = 'Margin expansion';
  
  let newROIC = roic;
  if (lever === 'Margin expansion' && nopatMargin > 0) {
    const improvedMargin = nopatMargin + 2;
    newROIC = (improvedMargin / 100) * (assetTurnover || 1) * 100;
  } else if (lever === 'Capital efficiency' && assetTurnover > 0) {
    const improvedTurnover = assetTurnover + 0.1;
    newROIC = nopatMargin / 100 * improvedTurnover * 100;
  }
  
  return { 
    roic: roic.toFixed(1), 
    wacc, 
    spread: spread.toFixed(1), 
    nopatMargin: nopatMargin.toFixed(1), 
    assetTurnover: assetTurnover.toFixed(2), 
    trend, 
    lever, 
    newROIC: newROIC.toFixed(1) 
  };
}

export function calcProfitability(data) {
  const grossMargin = safeNum(data.grossMargin) * 100 || (data.grossProfit && data.totalRevenue > 0 ? (data.grossProfit / data.totalRevenue) * 100 : 0);
  const beta = safeNum(data.beta, 1);
  const operatingMargin = safeNum(data.operatingMargin) * 100 || (data.operatingIncome && data.totalRevenue > 0 ? (data.operatingIncome / data.totalRevenue) * 100 : 0);
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

export function calcConstraints(data) {
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

export function calcEntryTiming(data) {
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
  
  let maScore = 4;
  if (twoHundredDayMA > 0) {
    const maDistance = ((price - twoHundredDayMA) / twoHundredDayMA) * 100;
    if (maDistance > 10) maScore = 0;
    else if (maDistance >= -10) maScore = 2;
    else if (maDistance >= -15) maScore = 3;
  }
  
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
  
  return { week52: week52Score, ma: maScore, mos: mosScore, pe: peScore, total, signal, distance: distanceFromHigh.toFixed(1), maDistance: twoHundredDayMA > 0 ? (((price - twoHundredDayMA) / twoHundredDayMA) * 100).toFixed(1) : 'N/A' };
}

export function calcIntrinsicValue(data, wacc, mosValue) {
  const price = safeNum(data.price);
  const forwardEPS = safeNum(data.forwardEPS);
  const trailingEPS = safeNum(data.trailingEPS);
  const freeCashflow = safeNum(data.freeCashflow);
  const sharesOutstanding = safeNum(data.sharesOutstanding);
  const bookValue = safeNum(data.bookValue);
  const beta = safeNum(data.beta, 1);
  const totalRevenue = safeNum(data.totalRevenue);
  const netIncome = safeNum(data.netIncome);
  
  let waccRate = wacc || 9.5;
  if (beta < 0.8) waccRate = 8;
  else if (beta > 1.3) waccRate = 11;
  
  const eps = forwardEPS > 0 ? forwardEPS : (trailingEPS > 0 ? trailingEPS : 0);
  
  const epvMultiplier = Math.min(1 / (waccRate / 100), 15);
  const totalCash = safeNum(data.totalCash);
  const totalDebt = safeNum(data.totalDebt);
  const netCashPerShare = sharesOutstanding > 0 ? (totalCash - totalDebt) / sharesOutstanding : 0;
  const epvValue = eps * epvMultiplier + netCashPerShare;
  
  const fcfPerShare = sharesOutstanding > 0 ? freeCashflow / sharesOutstanding : 
                     (totalRevenue > 0 ? freeCashflow / totalRevenue * 0.1 : 0);
  const fcfValue = waccRate > 0 && fcfPerShare > 0 ? fcfPerShare / (waccRate / 100) : 0;
  
  const bvps = bookValue > 0 ? bookValue : (sharesOutstanding > 0 ? netIncome / sharesOutstanding * 3 : price * 0.3);
  const grahamValue = eps > 0 && bvps > 0 ? Math.sqrt(22.5 * eps * bvps) : 0;
  
  const validValues = [epvValue, fcfValue, grahamValue].filter(v => v > 0 && !isNaN(v));
  const avgIV = validValues.length > 0 ? validValues.reduce((a, b) => a + b, 0) / validValues.length : epvValue;
  
  const undervaluation = price > 0 && avgIV > 0 ? ((avgIV - price) / price) * 100 : 0;
  
  return {
    epv: epvValue > 0 ? epvValue.toFixed(2) : 'N/A',
    fcf: fcfValue > 0 ? fcfValue.toFixed(2) : 'N/A',
    graham: grahamValue > 0 && !isNaN(grahamValue) ? grahamValue.toFixed(2) : 'N/A',
    avg: avgIV > 0 ? avgIV.toFixed(2) : 'N/A',
    undervaluation: undervaluation.toFixed(1)
  };
}

export function getVerdict(buffettTotal) {
  if (buffettTotal >= 70) return 'strong_buy';
  if (buffettTotal >= 50) return 'buy';
  if (buffettTotal >= 30) return 'hold';
  return 'avoid';
}

export function runFullAnalysis(tickerData) {
  const buffett = calcBuffettScore(tickerData);
  const roic = calcROIC(tickerData);
  const profitability = calcProfitability(tickerData);
  const constraints = calcConstraints(tickerData);
  const entry = calcEntryTiming(tickerData, { marginOfSafety: buffett.criteria.marginOfSafety?.value });
  const iv = calcIntrinsicValue(tickerData, buffett.wacc);
  
  const verdict = getVerdict(buffett.total);
  
  return {
    buffett,
    roic,
    profitability,
    constraints,
    entry,
    intrinsicValue: iv,
    verdict,
    price: tickerData.price,
    name: tickerData.name || tickerData.ticker
  };
}
