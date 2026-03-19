// =====================================================================
// INDUSTRY CLASSIFICATION MAPS
// =====================================================================

const VERY_HIGH_SWITCHING = [
  "Software—Application", "Software—Infrastructure", "Information Technology Services",
  "Financial Data & Stock Exchanges", "Health Care Plans", "Banks—Diversified", "Aerospace & Defense"
];

const HIGH_SWITCHING = [
  "Semiconductors", "Medical Devices", "Medical Instruments & Supplies",
  "Diagnostics & Research", "Banks—Regional", "Insurance—Life", "Insurance—Diversified",
  "Scientific & Technical Instruments", "Specialty Chemicals"
];

const MODERATE_SWITCHING = [
  "Communication Equipment", "Electronic Components", "Consulting Services",
  "Staffing & Employment Services", "Industrial Distribution", "Auto Parts", "Building Products"
];

const STRONG_NETWORK = [
  "Internet Content & Information", "Internet Retail", "Financial Data & Stock Exchanges",
  "Credit Services", "Electronic Gaming & Multimedia"
];

const MODERATE_NETWORK = [
  "Software—Infrastructure", "Software—Application", "Communication Services",
  "Advertising Agencies", "Banks—Diversified", "Insurance—Diversified"
];

const HIGH_RD = [
  "Drug Manufacturers—General", "Biotechnology", "Semiconductors", "Semiconductor Equipment",
  "Software—Application", "Software—Infrastructure", "Aerospace & Defense",
  "Medical Devices", "Diagnostics & Research"
];

const MODERATE_RD = [
  "Auto Manufacturers", "Specialty Chemicals", "Communication Equipment",
  "Electronic Components", "Scientific & Technical Instruments", "Medical Instruments & Supplies"
];

const HIGH_BARRIER = [
  "Drug Manufacturers—General", "Biotechnology", "Aerospace & Defense", "Banks—Diversified",
  "Insurance—Diversified", "Utilities—Regulated Electric", "Utilities—Regulated Water",
  "Utilities—Regulated Gas", "Oil & Gas Integrated", "Railroads", "Health Care Plans", "Medical Devices"
];

const MODERATE_BARRIER = [
  "Semiconductors", "Semiconductor Equipment", "Auto Manufacturers", "Banks—Regional",
  "Insurance—Life", "Diagnostics & Research", "Specialty Chemicals", "Airports & Air Services",
  "Integrated Freight & Logistics"
];

const SCALE_ADVANTAGE = [
  "Discount Stores", "Home Improvement Retail", "Internet Retail", "Warehousing & Storage",
  "Integrated Freight & Logistics", "Railroads", "Utilities—Regulated Electric",
  "Oil & Gas Integrated", "Grocery Stores"
];

const AI_THREAT_SEVERE = [
  "Broadcasting", "Publishing", "Advertising Agencies", "Staffing & Employment Services",
  "Education & Training Services"
];

const AI_THREAT_HIGH = [
  "Consulting Services", "Information Technology Services", "Software—Application",
  "Insurance—Life", "Banks—Regional", "Telecom Services", "Media—Diversified", "Entertainment"
];

const AI_THREAT_MODERATE = [
  "Software—Infrastructure", "Financial Data & Stock Exchanges", "Health Care Plans",
  "Drug Manufacturers—General", "Specialty Retail", "Restaurants", "Auto Manufacturers",
  "Semiconductors", "Internet Content & Information", "Internet Retail", "Credit Services",
  "Banks—Diversified", "Medical Devices", "Diagnostics & Research"
];

const AI_OPP_MASSIVE = [
  "Semiconductors", "Semiconductor Equipment", "Software—Infrastructure",
  "Software—Application", "Internet Content & Information", "Electronic Gaming & Multimedia"
];

const AI_OPP_SIGNIFICANT = [
  "Drug Manufacturers—General", "Biotechnology", "Diagnostics & Research",
  "Financial Data & Stock Exchanges", "Internet Retail", "Auto Manufacturers",
  "Aerospace & Defense", "Medical Devices", "Information Technology Services"
];

const AI_OPP_MODERATE = [
  "Banks—Diversified", "Credit Services", "Insurance—Diversified", "Health Care Plans",
  "Consulting Services", "Specialty Chemicals", "Communication Equipment", "Industrial Distribution"
];

const SECTOR_RISK = {
  "Technology": { severity: "moderate", description: "Rapid innovation cycles and AI disruption create constant competitive pressure" },
  "Healthcare": { severity: "moderate", description: "Regulatory risk and patent cliffs are structural industry challenges" },
  "Financial Services": { severity: "moderate", description: "Interest rate sensitivity and regulatory changes impact profitability" },
  "Consumer Cyclical": { severity: "moderate", description: "Consumer spending sensitivity and brand competition" },
  "Energy": { severity: "high", description: "Commodity price volatility and energy transition headwinds" },
  "Real Estate": { severity: "moderate", description: "Interest rate sensitivity and remote work structural shifts" },
  "Communication Services": { severity: "moderate", description: "Content costs and advertiser cyclicality" },
  "Industrials": { severity: "low", description: "Established competitive positions with long replacement cycles" },
  "Consumer Defensive": { severity: "low", description: "Stable demand and strong brand loyalty provide resilience" },
  "Utilities": { severity: "low", description: "Regulated returns and essential service demand" },
  "Basic Materials": { severity: "moderate", description: "Commodity price exposure and cyclical demand" }
};

// =====================================================================
// PEER COMPARISON MAPS
// =====================================================================

const PEER_MAP = {
  // Mega-cap tech
  "AAPL": ["MSFT", "GOOGL", "AMZN", "META", "NVDA", "AVGO"],
  "MSFT": ["AAPL", "GOOGL", "AMZN", "ORCL", "CRM", "ADBE"],
  "GOOGL": ["META", "AMZN", "MSFT", "SNAP", "PINS", "TTD", "ROKU"],
  "AMZN": ["WMT", "SHOP", "MELI", "SE", "GOOGL", "MSFT"],
  "META": ["GOOGL", "SNAP", "PINS", "TTD", "ROKU", "RBLX"],
  "NVDA": ["AMD", "INTC", "AVGO", "QCOM", "TXN", "MRVL"],
  "TSLA": ["TM", "GM", "F", "RIVN", "LCID", "HMC"],
  
  // Financials
  "JPM": ["BAC", "WFC", "GS", "MS", "C", "USB"],
  "V": ["MA", "AXP", "PYPL", "SQ", "FIS", "GPN"],
  "BRK-B": ["JPM", "BAC", "GS", "MET", "PRU", "AIG"],
  
  // Healthcare
  "UNH": ["HUM", "CI", "ELV", "CNC", "MOH"],
  "LLY": ["NVO", "JNJ", "PFE", "MRK", "ABBV", "AZN"],
  "JNJ": ["PFE", "MRK", "ABBV", "LLY", "AZN", "BMY"],
  
  // Consumer
  "KO": ["PEP", "MNST", "KDP", "STZ", "CELH"],
  "PG": ["CL", "KMB", "CHD", "CLX", "EL"],
  "MCD": ["SBUX", "YUM", "CMG", "QSR", "DPZ"],
  "WMT": ["COST", "TGT", "AMZN", "DG", "DLTR"],
  "COST": ["WMT", "TGT", "DG", "DLTR", "KR"],
  
  // Semiconductors
  "AMD": ["NVDA", "INTC", "QCOM", "AVGO", "TXN", "MRVL"],
  "AVGO": ["QCOM", "TXN", "ADI", "MCHP", "NXPI"],
  
  // Software
  "CRM": ["NOW", "WDAY", "HUBS", "VEEV", "ZS", "DDOG"],
  "ADBE": ["CRM", "INTU", "ANSS", "CDNS", "SNPS"],
  "NOW": ["CRM", "WDAY", "DDOG", "ZS", "NET", "TEAM"],
  
  // Industrials
  "CAT": ["DE", "PCAR", "CMI", "URI", "EMR"],
  "GE": ["HON", "RTX", "LMT", "BA", "NOC"],
  
  // Energy
  "XOM": ["CVX", "COP", "SLB", "EOG", "MPC"],
  
  // REITs
  "AMT": ["CCI", "SBAC", "PLD", "EQIX", "DLR", "O"]
};

const INDUSTRY_TICKERS = {
  "Software—Application": ["CRM", "ADBE", "INTU", "NOW", "WDAY", "HUBS", "VEEV", "ZS", "DDOG", "TEAM", "SNOW", "PLTR", "FICO"],
  "Software—Infrastructure": ["MSFT", "ORCL", "PANW", "CRWD", "NET", "FTNT", "ZS", "MDB", "ESTC"],
  "Semiconductors": ["NVDA", "AMD", "INTC", "AVGO", "QCOM", "TXN", "ADI", "MRVL", "MCHP", "NXPI", "ON", "SWKS"],
  "Internet Content & Information": ["GOOGL", "META", "SNAP", "PINS", "TTD", "ROKU", "SPOT", "RDDT"],
  "Internet Retail": ["AMZN", "SHOP", "MELI", "SE", "ETSY", "CHWY", "W"],
  "Consumer Electronics": ["AAPL", "LOGI"],
  "Banks—Diversified": ["JPM", "BAC", "WFC", "C", "GS", "MS"],
  "Banks—Regional": ["USB", "PNC", "TFC", "FITB", "MTB", "HBAN"],
  "Credit Services": ["V", "MA", "AXP", "PYPL", "SQ", "FIS", "GPN", "AFRM"],
  "Drug Manufacturers—General": ["LLY", "JNJ", "MRK", "ABBV", "PFE", "AZN", "BMY", "NVO"],
  "Biotechnology": ["AMGN", "GILD", "VRTX", "REGN", "BIIB", "MRNA"],
  "Health Care Plans": ["UNH", "HUM", "CI", "ELV", "CNC", "MOH"],
  "Restaurants": ["MCD", "SBUX", "YUM", "CMG", "QSR", "DPZ", "CAVA"],
  "Discount Stores": ["WMT", "COST", "TGT", "DG", "DLTR", "BJ"],
  "Auto Manufacturers": ["TSLA", "TM", "GM", "F", "RIVN", "LCID", "HMC"],
  "Aerospace & Defense": ["RTX", "LMT", "BA", "NOC", "GD", "TDG", "HWM"],
  "Oil & Gas Integrated": ["XOM", "CVX", "COP", "SLB", "EOG", "MPC"],
  "Beverages—Non-Alcoholic": ["KO", "PEP", "MNST", "KDP", "CELH"],
  "Household & Personal Products": ["PG", "CL", "KMB", "CHD", "CLX", "EL"],
  "Financial Data & Stock Exchanges": ["CME", "ICE", "SPGI", "MCO", "MSCI", "NDAQ"],
  "Information Technology Services": ["ACN", "IBM", "CTSH", "WIT", "INFY", "EPAM"],
  "Engineering & Construction": ["FIX", "EME", "PWR", "MTZ", "ACM", "DY", "APG", "J", "KBR", "TPC"],
  "Building Products": ["LPX", "AZEK", "TREX", "AWI", "JELD", "MAS", "FBHS", "SWK"],
  "Specialty Industrial Machinery": ["AME", "ROP", "IEX", "NDSN", "MIDD", "FELE", "CW"],
  "Electrical Equipment & Parts": ["ETN", "EMR", "ROK", "AME", "GNRC", "AYI", "HUBB"],
  "Farm & Heavy Construction Machinery": ["CAT", "DE", "AGCO", "CNHI", "MTW", "TEX"],
  "Waste Management": ["WM", "RSG", "CWST", "GFL", "CLH"],
  "Trucking": ["ODFL", "SAIA", "XPO", "JBHT", "WERN", "KNX", "SNDR"],
  "Airlines": ["DAL", "UAL", "LUV", "AAL", "JBLU", "ALK", "SAVE"]
};

const SECTOR_FALLBACKS = {
  "Technology": ["AAPL", "MSFT", "GOOGL", "NVDA", "AVGO", "CRM", "ADBE"],
  "Healthcare": ["UNH", "LLY", "JNJ", "MRK", "ABBV", "PFE", "TMO"],
  "Financial Services": ["JPM", "V", "MA", "BAC", "GS", "SPGI", "BLK"],
  "Consumer Cyclical": ["AMZN", "TSLA", "HD", "MCD", "NKE", "SBUX", "BKNG"],
  "Consumer Defensive": ["PG", "KO", "PEP", "WMT", "COST", "CL"],
  "Energy": ["XOM", "CVX", "COP", "SLB", "EOG", "MPC"],
  "Industrials": ["CAT", "GE", "HON", "UPS", "RTX", "DE", "LMT"],
  "Communication Services": ["GOOGL", "META", "DIS", "NFLX", "T", "VZ"],
  "Utilities": ["NEE", "DUK", "SO", "D", "AEP", "SRE"],
  "Real Estate": ["AMT", "PLD", "EQIX", "SPG", "O", "DLR"],
  "Basic Materials": ["LIN", "APD", "SHW", "ECL", "FCX", "NEM"]
};

function normalizeIndustryName(name) {
  if (!name) return "";
  return name
    .replace(/[–—]/g, "-")  // any dash to hyphen
    .replace(/[^\w\s-]/g, "")  // remove special chars
    .replace(/\s+/g, " ") // multiple spaces to single
    .trim()
    .toLowerCase();
}

function getPeers(ticker, industry, sector) {
  // Layer 1: Hardcoded peers
  if (PEER_MAP[ticker]) {
    return { peers: PEER_MAP[ticker], source: "hardcoded" };
  }
  
  // Layer 2: Industry-based peers (with flexible matching)
  const normalizedIndustry = normalizeIndustryName(industry);
  if (normalizedIndustry) {
    // Try exact normalized match first
    const exactKey = Object.keys(INDUSTRY_TICKERS).find(key => 
      normalizeIndustryName(key) === normalizedIndustry
    );
    if (exactKey) {
      const peers = INDUSTRY_TICKERS[exactKey].filter(p => p !== ticker).slice(0, 7);
      if (peers.length >= 3) {
        return { peers, source: "industry" };
      }
    }
    
    // Try partial match (industry name contains or is contained by key)
    const partialMatch = Object.keys(INDUSTRY_TICKERS).find(key => {
      const normalizedKey = normalizeIndustryName(key);
      // Check if key words are in industry or vice versa
      const keyWords = normalizedKey.split(/\s+/).filter(w => w.length > 2);
      const indWords = normalizedIndustry.split(/\s+/).filter(w => w.length > 2);
      return keyWords.some(kw => indWords.includes(kw)) || 
             indWords.some(iw => normalizedKey.includes(iw) && iw.length > 3);
    });
    
    if (partialMatch) {
      const peers = INDUSTRY_TICKERS[partialMatch].filter(p => p !== ticker).slice(0, 7);
      if (peers.length >= 3) {
        return { peers, source: "industry" };
      }
    }
  }
  
  // Layer 3: Sector fallback
  if (sector && SECTOR_FALLBACKS[sector]) {
    const peers = SECTOR_FALLBACKS[sector].filter(p => p !== ticker).slice(0, 7);
    return { peers, source: "sector_fallback" };
  }
  
  // Last resort: mega-cap tech
  return { peers: ["AAPL", "MSFT", "GOOGL", "AMZN", "META"], source: "default" };
}

function calculatePeerStats(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: sorted[Math.floor(sorted.length / 2)],
    mean: sum / sorted.length,
    p25: sorted[Math.floor(sorted.length * 0.25)],
    p75: sorted[Math.floor(sorted.length * 0.75)]
  };
}

function calculatePercentile(targetValue, peerValues) {
  if (peerValues.length === 0) return 50;
  const countBelow = peerValues.filter(v => v < targetValue).length;
  return Math.round((countBelow / peerValues.length) * 100);
}

function getVerdictLabel(percentile) {
  if (percentile <= 20) return "very_cheap";
  if (percentile <= 40) return "cheap";
  if (percentile <= 60) return "fair";
  if (percentile <= 80) return "expensive";
  return "very_expensive";
}

function calculateComps(data) {
  const ticker = data.ticker;
  const name = data.name;
  const industry = data.industry || "";
  const sector = data.sector || "";
  const peers = data.peers || [];
  const peerSource = data.peerSource || "unknown";
  
  // Extract target metrics (values already processed from fetchCompMetrics)
  const target = {
    ticker,
    name,
    marketCap: safeNum(data.marketCap),
    currentPrice: safeNum(data.price),
    trailingPE: data.trailingPE,
    forwardPE: data.forwardPE,
    pegRatio: data.pegRatio,
    priceToSales: data.priceToSales,
    priceToBook: data.priceToBook,
    evToEbitda: data.evToEbitda,
    evToRevenue: data.evToRevenue,
    grossMargin: safeNum(data.grossMargin),
    operatingMargin: safeNum(data.operatingMargin),
    revenueGrowth: safeNum(data.revenueGrowth),
    dividendYield: safeNum(data.dividendYield),
    sharesOutstanding: safeNum(data.sharesOutstanding),
    revenue: safeNum(data.totalRevenue),
    netIncome: safeNum(data.netIncome),
    freeCashflow: safeNum(data.freeCashflow),
    totalDebt: safeNum(data.totalDebt),
    totalCash: safeNum(data.totalCash),
    ebitda: safeNum(data.ebitda),
    trailingEps: safeNum(data.trailingEps),
    forwardEps: safeNum(data.forwardEps),
    bookValuePerShare: safeNum(data.bookValuePerShare),
    enterpriseValue: safeNum(data.enterpriseValue),
    roe: safeNum(data.roe)
  };
  
  // Detect P/B distortion (buyback-heavy companies with depleted book equity)
  const isPBDistorted = (
    target.priceToBook > 20 &&
    (target.roe > 1.0 || (target.bookValuePerShare > 0 && target.bookValuePerShare < 10))
  );
  
  const isPBSoftCapped = (
    target.priceToBook > 15 &&
    target.roe > 0.40 &&
    !isPBDistorted
  );
  
  if (isPBDistorted) {
    target.priceToBook_excluded = true;
    target.priceToBook_reason = `Excluded — distorted by share buybacks (book value: $${target.bookValuePerShare?.toFixed(0) || '?'}/share)`;
  } else if (isPBSoftCapped) {
    target.priceToBook_softCapped = true;
    target.priceToBook_reason = "P/B elevated by high ROE — percentile capped";
  }
  
  // Process peers (values already processed from fetchCompMetrics)
  const processedPeers = peers.map(p => ({
    ticker: p.ticker,
    name: p.name,
    marketCap: safeNum(p.marketCap),
    currentPrice: safeNum(p.price),
    trailingPE: p.trailingPE,
    forwardPE: p.forwardPE,
    pegRatio: p.pegRatio,
    priceToSales: p.priceToSales,
    priceToBook: p.priceToBook,
    evToEbitda: p.evToEbitda,
    evToRevenue: p.evToRevenue,
    grossMargin: safeNum(p.grossMargin),
    operatingMargin: safeNum(p.operatingMargin),
    revenueGrowth: safeNum(p.revenueGrowth),
    dividendYield: safeNum(p.dividendYield),
    sharesOutstanding: safeNum(p.sharesOutstanding),
    revenue: safeNum(p.totalRevenue),
    ebitda: safeNum(p.ebitda),
    totalDebt: safeNum(p.totalDebt),
    totalCash: safeNum(p.totalCash)
  }));
  
  // Calculate peer statistics for each metric
  const metrics = ["trailingPE", "forwardPE", "pegRatio", "priceToSales", "priceToBook", "evToEbitda", "evToRevenue"];
  const metricResults = {};
  const allPercentiles = [];
  
  for (const metric of metrics) {
    // Skip P/B if excluded
    if (metric === "priceToBook" && isPBDistorted) {
      metricResults[metric] = {
        targetValue: target.priceToBook,
        peerMedian: null,
        excluded: true,
        excludedReason: target.priceToBook_reason,
        percentile: null,
        verdict: "excluded",
        premiumToMedian: null,
        explanation: `P/B ratio excluded — distorted by share buybacks. Book value per share is ~$${target.bookValuePerShare?.toFixed(0)} due to heavy repurchases.`
      };
      continue;
    }
    
    const peerValues = processedPeers.map(p => p[metric]).filter(v => v !== null && v !== undefined && v > 0);
    const stats = calculatePeerStats(peerValues);
    const targetValue = target[metric];
    
    if (stats && targetValue !== null && targetValue !== undefined) {
      let percentile = calculatePercentile(targetValue, peerValues);
      const premiumToMedian = stats.median > 0 ? ((targetValue / stats.median) - 1) * 100 : 0;
      
      // Soft cap: cap P/B percentile at 75 if elevated by high ROE
      if (metric === "priceToBook" && isPBSoftCapped) {
        percentile = Math.min(percentile, 75);
      }
      
      allPercentiles.push(percentile);
      
      metricResults[metric] = {
        targetValue,
        peerMedian: stats.median,
        peerMean: stats.mean,
        peerMin: stats.min,
        peerMax: stats.max,
        p25: stats.p25,
        p75: stats.p75,
        percentile,
        softCapped: metric === "priceToBook" && isPBSoftCapped,
        verdict: getVerdictLabel(percentile),
        premiumToMedian,
        explanation: generateMetricExplanation(ticker, metric, targetValue, stats, percentile, premiumToMedian)
      };
    } else {
      metricResults[metric] = {
        targetValue: targetValue || null,
        peerMedian: stats?.median || null,
        peerMean: stats?.mean || null,
        percentile: 50,
        verdict: "unknown",
        premiumToMedian: 0,
        explanation: "Insufficient data for comparison"
      };
    }
  }
  
  // Composite score (already excludes P/B if distorted since we don't push to allPercentiles)
  const avgPercentile = allPercentiles.length > 0 
    ? allPercentiles.reduce((a, b) => a + b, 0) / allPercentiles.length 
    : 50;
  const relativeValueScore = Math.round(100 - avgPercentile);
  
  // Growth context
  const targetGrowth = target.revenueGrowth || 0;
  const medianPeerGrowth = calculatePeerStats(processedPeers.map(p => p.revenueGrowth).filter(v => v !== null))?.median || 0;
  const targetForwardPE = target.forwardPE || 0;
  const medianPeerPE = metricResults.forwardPE?.peerMedian || 0;
  const growthGap = medianPeerGrowth - targetGrowth;
  
  let growthContext = "fairly_priced";
  if (targetGrowth > medianPeerGrowth && targetForwardPE > medianPeerPE * 1.15) {
    growthContext = "premium_justified";
  } else if (targetGrowth < medianPeerGrowth && targetForwardPE > medianPeerPE * 1.10) {
    growthContext = "premium_unjustified";
  } else if (targetGrowth > medianPeerGrowth * 1.10 && targetForwardPE < medianPeerPE) {
    growthContext = "discount_opportunity";
  }
  
  // Growth differential note (for peer groups with very different growth rates)
  let growthDifferentialNote = null;
  if (growthGap > 10) {
    growthDifferentialNote = `Note: Peer group median revenue growth (${medianPeerGrowth.toFixed(0)}%) is significantly higher than ${ticker}'s (${targetGrowth.toFixed(0)}%). Higher-growth companies naturally trade at higher multiples, so some valuation premium for peers is expected. P/S and EV/Revenue ratios normalize for growth differences and may be more meaningful here.`;
  }
  
  // Composite verdict
  let compositeVerdict = "fairly_valued";
  if (relativeValueScore >= 65) compositeVerdict = "very_cheap";
  else if (relativeValueScore >= 55) compositeVerdict = "cheap";
  else if (relativeValueScore <= 35) compositeVerdict = "very_expensive";
  else if (relativeValueScore <= 45) compositeVerdict = "expensive";
  
  // Summary
  const summary = generateSummary(ticker, compositeVerdict, growthContext, avgPercentile, industry, target, processedPeers);
  
  // Implied fair value
  const impliedFV = calculateImpliedFairValue(target, metricResults, isPBDistorted);
  
  // Comparison table
  const compTable = [
    { ...target, isTarget: true },
    ...processedPeers.map(p => ({ ...p, isTarget: false }))
  ].sort((a, b) => b.marketCap - a.marketCap);
  
  return {
    ticker,
    name,
    industry,
    peerSource,
    target,
    peers: processedPeers,
    metrics: metricResults,
    composite: {
      relativeValueScore,
      averagePercentile: Math.round(avgPercentile),
      verdict: compositeVerdict,
      growthContext,
      growthDifferentialNote,
      summary
    },
    impliedFairValue: impliedFV,
    compTable
  };
}

function generateMetricExplanation(ticker, metric, targetValue, stats, percentile, premiumToMedian) {
  const metricNames = {
    trailingPE: "trailing P/E",
    forwardPE: "forward P/E",
    pegRatio: "PEG ratio",
    priceToSales: "P/S",
    priceToBook: "P/B",
    evToEbitda: "EV/EBITDA",
    evToRevenue: "EV/Revenue"
  };
  
  const verdict = getVerdictLabel(percentile);
  const valuationText = verdict === "very_cheap" || verdict === "cheap" ? "below" : verdict === "very_expensive" || verdict === "expensive" ? "above" : "near";
  const comparison = premiumToMedian >= 0 ? `${premiumToMedian.toFixed(1)}% premium to median` : `${Math.abs(premiumToMedian).toFixed(1)}% discount to median`;
  
  return `${ticker} trades at ${targetValue.toFixed(1)}x ${metricNames[metric]}, ${valuationText} the peer median of ${stats.median.toFixed(1)}x. This places it at the ${percentile}th percentile — ${verdict.replace("_", " ")}. ${comparison}.`;
}

function generateSummary(ticker, compositeVerdict, growthContext, avgPercentile, industry, target, peers) {
  const verdictText = compositeVerdict.replace("_", " ");
  let growthNote = "";
  
  if (growthContext === "premium_justified") {
    growthNote = "Higher multiples are supported by superior growth.";
  } else if (growthContext === "premium_unjustified") {
    growthNote = "The premium is not clearly justified by growth metrics.";
  } else if (growthContext === "discount_opportunity") {
    growthNote = "The discount is notable given above-median growth, suggesting potential undervaluation.";
  } else {
    growthNote = "Valuation is broadly in line with peers given the growth profile.";
  }
  
  return `${ticker} trades at a ${verdictText} to ${industry} peers on most metrics. ${growthNote}`;
}

function calculateImpliedFairValue(target, metrics, isPBDistorted = false) {
  const results = {};
  
  // Forward P/E implied (primary method)
  if (metrics.forwardPE?.peerMedian && target.forwardEps > 0) {
    results.fromForwardPE = metrics.forwardPE.peerMedian * target.forwardEps;
  }
  
  // Trailing P/E implied
  if (metrics.trailingPE?.peerMedian && target.trailingEps > 0) {
    results.fromTrailingPE = metrics.trailingPE.peerMedian * target.trailingEps;
  }
  
  // P/B implied (skip if distorted by buybacks)
  if (!isPBDistorted && metrics.priceToBook?.peerMedian && target.bookValuePerShare > 0) {
    results.fromPB = metrics.priceToBook.peerMedian * target.bookValuePerShare;
  }
  
  // P/S implied
  if (metrics.priceToSales?.peerMedian && target.sharesOutstanding > 0 && target.revenue > 0) {
    const revenuePerShare = target.revenue / target.sharesOutstanding;
    results.fromPS = metrics.priceToSales.peerMedian * revenuePerShare;
  }
  
  // EV/EBITDA implied
  if (metrics.evToEbitda?.peerMedian && target.ebitda > 0 && target.sharesOutstanding > 0) {
    const impliedEV = metrics.evToEbitda.peerMedian * target.ebitda;
    const netDebt = (target.totalDebt || 0) - (target.totalCash || 0);
    const impliedEquity = impliedEV - netDebt;
    if (impliedEquity > 0) {
      results.fromEV = impliedEquity / target.sharesOutstanding;
    }
  }
  
  // Use median of available methods (need at least 1 valid)
  const values = Object.values(results).filter(v => v > 0 && isFinite(v));
  const median = values.length > 0 
    ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] 
    : 0;
  const upside = target.currentPrice > 0 && median > 0 ? ((median - target.currentPrice) / target.currentPrice) * 100 : 0;
  
  return {
    ...results,
    median,
    upside,
    currentPrice: target.currentPrice,
    methodCount: values.length,
    pbExcluded: isPBDistorted
  };
}

// =====================================================================
// HELPER FUNCTIONS
// =====================================================================

function safeNum(val, def = 0) {
  if (val === null || val === undefined || isNaN(val)) return def;
  return val;
}

function matchIndustry(industry, list) {
  if (!industry) return false;
  const lower = industry.toLowerCase();
  return list.some(i => lower.includes(i.toLowerCase()));
}

function billions(val) {
  if (!val) return 0;
  return (val / 1e9).toFixed(1);
}

// =====================================================================
// SECTION 1: MOAT ANALYSIS
// =====================================================================

function calcSupplySideEconomies(data) {
  const companyName = data.name || "The company";
  const revenueGrowth = safeNum(data.revenueGrowth, 0) * 100;
  const earningsGrowth = safeNum(data.earningsGrowth, 0) * 100;
  const grossMargin = safeNum(data.grossMargin, 0);
  const operatingMargin = safeNum(data.operatingMargin, 0);
  const totalRevenue = safeNum(data.totalRevenue, 0);
  const beta = safeNum(data.beta, 1);
  
  const hasTrendData = data.dataQuality?.incomeStatementAvailable;
  
  // A. Scale efficiency: earnings growth vs revenue growth (operating leverage)
  const leverageDelta = earningsGrowth - revenueGrowth;
  let scoreA = 0;
  if (leverageDelta > 10) scoreA = 8;
  else if (leverageDelta > 5) scoreA = 6;
  else if (leverageDelta > 0) scoreA = 4;
  else if (leverageDelta > -5) scoreA = 2;
  
  // B. Gross margin quality level
  let scoreB = 0;
  if (grossMargin >= 0.60) scoreB = 6;
  else if (grossMargin >= 0.45) scoreB = 4;
  else if (grossMargin >= 0.30) scoreB = 2;
  
  // C. Operating leverage signal: earnings growing faster than revenue + healthy margins
  let scoreC = 0;
  if (earningsGrowth > revenueGrowth && operatingMargin > 0.20) scoreC = 6;
  else if (earningsGrowth > revenueGrowth && operatingMargin > 0.10) scoreC = 4;
  else if (earningsGrowth > 0) scoreC = 2;
  
  // D. Revenue scale
  let scoreD = 0;
  if (totalRevenue > 100e9) scoreD = 5;
  else if (totalRevenue > 50e9) scoreD = 4;
  else if (totalRevenue > 20e9) scoreD = 3;
  else if (totalRevenue > 5e9) scoreD = 2;
  else if (totalRevenue > 1e9) scoreD = 1;
  
  const totalScore = Math.min(scoreA + scoreB + scoreC + scoreD, 25);
  
  let strength = "none";
  if (totalScore >= 20) strength = "strong";
  else if (totalScore >= 13) strength = "moderate";
  else if (totalScore >= 6) strength = "weak";
  
  const scaleNote = totalRevenue > 100e9 ? "at massive scale" : totalRevenue > 20e9 ? "at significant scale" : "at current scale";
  const marginQuality = grossMargin >= 0.50 ? "strong" : grossMargin >= 0.35 ? "solid" : "moderate";
  const trendNote = hasTrendData ? "" : " (YoY growth rates; multi-year historical data unavailable)";
  
  const explanation = `${companyName} ${strength === "strong" ? "has strong" : strength === "moderate" ? "shows moderate" : strength === "weak" ? "has weak" : "lacks"} supply-side economies of scale. Revenue growing at ${revenueGrowth.toFixed(1)}% with earnings growing at ${earningsGrowth.toFixed(1)}% — ${leverageDelta >= 0 ? "positive" : "negative"} ${Math.abs(leverageDelta).toFixed(1)}% operating leverage. ${marginQuality} gross margins of ${(grossMargin * 100).toFixed(1)}% and operating margins of ${(operatingMargin * 100).toFixed(1)}% at ${scaleNote}.${trendNote}`;
  
  return {
    score: totalScore,
    maxScore: 25,
    strength,
    present: totalScore >= 13,
    explanation,
    details: {
      leverageDelta: leverageDelta.toFixed(1),
      revenueGrowth: revenueGrowth.toFixed(1),
      earningsGrowth: earningsGrowth.toFixed(1),
      grossMargin: (grossMargin * 100).toFixed(1),
      operatingMargin: (operatingMargin * 100).toFixed(1),
      scaleRevenue: billions(totalRevenue),
      trendDataAvailable: hasTrendData
    }
  };
}

function calcNetworkEffects(data, userInput = null) {
  const companyName = data.name || "The company";
  const industry = data.industry || "";
  const marketCap = safeNum(data.marketCap, 0);
  const sector = (data.sector || "").toLowerCase();
  
  let scoreA = 1;
  if (matchIndustry(industry, STRONG_NETWORK)) scoreA = 7;
  else if (matchIndustry(industry, MODERATE_NETWORK)) scoreA = 4;
  
  const revGrowth = safeNum(data.revenueGrowth, 0) * 100;
  const gmTrend = safeNum(data.gmTrend, 0);
  let scoreB = 0;
  if (revGrowth > 10 && gmTrend > 1) scoreB = 4;
  else if (revGrowth > 5 && gmTrend > 0) scoreB = 2;
  
  let scoreC = 0;
  if (marketCap > 500e9 && (sector.includes("tech") || sector.includes("communication"))) scoreC = 4;
  else if (marketCap > 100e9 && matchIndustry(industry, [...STRONG_NETWORK, ...MODERATE_NETWORK])) scoreC = 3;
  else if (marketCap > 50e9 && matchIndustry(industry, [...STRONG_NETWORK, ...MODERATE_NETWORK])) scoreC = 2;
  
  const algorithmicScore = Math.min(scoreA + scoreB + scoreC, 15);
  const userScore = userInput?.score || 0;
  const totalScore = algorithmicScore + userScore;
  const maxScore = userInput ? 25 : 15;
  
  let strength = "none";
  if (totalScore >= 20) strength = "strong";
  else if (totalScore >= 13) strength = "moderate";
  else if (totalScore >= 6) strength = "weak";
  
  const networkType = matchIndustry(industry, STRONG_NETWORK) ? "strong" : matchIndustry(industry, MODERATE_NETWORK) ? "moderate" : "limited";
  const growthSignal = revGrowth > 5 && gmTrend > 0 ? "Revenue growth with simultaneous margin expansion is consistent with network dynamics." : "Financial trends do not strongly indicate network effects.";
  const userNote = userInput ? `User assessment: ${userInput.label} network effects.` : "Awaiting user product-level assessment.";
  
  const explanation = `${companyName} ${strength !== "none" ? "shows" : "has limited"} demand-side economies of scale. ${industry} suggests ${networkType} network potential. ${growthSignal} ${userNote}`;
  
  return {
    score: totalScore,
    maxScore,
    strength,
    present: totalScore >= 13,
    explanation,
    details: {
      algorithmicScore,
      industrySignal: scoreA,
      growthMarginSignal: scoreB,
      scaleSignal: scoreC,
      userInputProvided: !!userInput,
      userLabel: userInput?.label || null
    }
  };
}

function calcLearningCurve(data) {
  const companyName = data.name || "The company";
  const industry = data.industry || "";
  const marketCap = safeNum(data.marketCap, 0);
  const grossMargin = safeNum(data.grossMargin, 0);
  const beta = safeNum(data.beta, 1);
  const hasTrendData = data.dataQuality?.incomeStatementAvailable;
  
  let scoreA = 0;
  if (matchIndustry(industry, HIGH_RD)) {
    if (grossMargin > 0.60) scoreA = 7;
    else if (grossMargin > 0.40) scoreA = 5;
    else scoreA = 3;
  } else if (matchIndustry(industry, MODERATE_RD)) {
    scoreA = grossMargin > 0.50 ? 4 : 2;
  }
  
  let scoreB = 0;
  if (marketCap > 200e9) scoreB = 6;
  else if (marketCap > 100e9) scoreB = 5;
  else if (marketCap > 50e9) scoreB = 4;
  else if (marketCap > 20e9) scoreB = 3;
  else if (marketCap > 5e9) scoreB = 2;
  else scoreB = 1;
  
  // C. Margin sustainability proxy (no multi-year data available)
  // High margins + low volatility = sustained; high margins + high volatility = potentially fragile
  let scoreC = 0;
  if (grossMargin > 0.55 && beta < 1.0) scoreC = 6;  // High margin + low volatility
  else if (grossMargin > 0.55) scoreC = 5;
  else if (grossMargin > 0.40 && beta < 1.2) scoreC = 4;
  else if (grossMargin > 0.40) scoreC = 3;
  else if (grossMargin > 0.25) scoreC = 2;
  else scoreC = 1;
  
  let scoreD = 0;
  if (matchIndustry(industry, HIGH_BARRIER)) scoreD = 6;
  else if (matchIndustry(industry, MODERATE_BARRIER)) scoreD = 3;
  else scoreD = 1;
  
  const totalScore = Math.min(scoreA + scoreB + scoreC + scoreD, 25);
  
  let strength = "none";
  if (totalScore >= 20) strength = "strong";
  else if (totalScore >= 13) strength = "moderate";
  else if (totalScore >= 6) strength = "weak";
  
  let rdNote = "";
  if (matchIndustry(industry, HIGH_RD)) rdNote = `In ${industry}, cumulative R&D creates knowledge barriers new entrants cannot replicate.`;
  else if (matchIndustry(industry, HIGH_BARRIER)) rdNote = `${industry} requires regulatory approvals and expertise that take years to develop.`;
  else rdNote = `${industry} has limited knowledge barriers.`;
  
  const sustainedNote = hasTrendData 
    ? "Historical margin data confirms sustained high margins." 
    : `Current margins of ${(grossMargin * 100).toFixed(1)}% ${beta < 1.0 ? "with low volatility (beta " + beta.toFixed(2) + ") suggest sustainable advantages." : "though elevated beta (" + beta.toFixed(2) + ") suggests some margin stability risk."}`;
  
  const explanation = `${companyName} has ${strength} learning curve advantages. ${rdNote} ${sustainedNote}`;
  
  return {
    score: totalScore,
    maxScore: 25,
    strength,
    present: totalScore >= 13,
    explanation,
    details: {
      rdIndustry: matchIndustry(industry, HIGH_RD),
      barrierIndustry: matchIndustry(industry, [...HIGH_BARRIER, ...MODERATE_BARRIER]),
      sustainedMargins: grossMargin > 0.50 && beta < 1.2,
      currentGrossMargin: (grossMargin * 100).toFixed(1),
      beta: beta.toFixed(2),
      trendDataAvailable: hasTrendData
    }
  };
}

function calcSwitchingCosts(data) {
  const companyName = data.name || "The company";
  const industry = data.industry || "";
  const grossMargin = safeNum(data.grossMargin, 0);
  const operatingMargin = safeNum(data.operatingMargin, 0);
  const roe = safeNum(data.roe, 0);
  const revenueGrowth = safeNum(data.revenueGrowth, 0);
  const earningsGrowth = safeNum(data.earningsGrowth, 0);
  
  let scoreA = 1;
  if (matchIndustry(industry, VERY_HIGH_SWITCHING)) scoreA = 10;
  else if (matchIndustry(industry, HIGH_SWITCHING)) scoreA = 7;
  else if (matchIndustry(industry, MODERATE_SWITCHING)) scoreA = 4;
  
  let scoreB = 0;
  if (grossMargin > 0.60 && operatingMargin > 0.25) scoreB = 6;
  else if (grossMargin > 0.50 && operatingMargin > 0.18) scoreB = 4;
  else if (grossMargin > 0.40 && operatingMargin > 0.12) scoreB = 2;
  
  let scoreC = 0;
  if (roe > 0.25) scoreC = 5;
  else if (roe > 0.18) scoreC = 4;
  else if (roe > 0.12) scoreC = 2;
  
  // D. Revenue stability proxy - use YoY growth instead of multi-year
  let scoreD = 0;
  if (revenueGrowth > 0 && earningsGrowth > 0) scoreD = 4;  // Both growing = strong retention
  else if (revenueGrowth > 0) scoreD = 3;  // Revenue growing even if earnings pressured
  else if (revenueGrowth > -0.05) scoreD = 1;  // Small decline
  else scoreD = 0;  // Significant decline
  
  const totalScore = Math.min(scoreA + scoreB + scoreC + scoreD, 25);
  
  let strength = "none";
  if (totalScore >= 20) strength = "strong";
  else if (totalScore >= 13) strength = "moderate";
  else if (totalScore >= 6) strength = "weak";
  
  const industryLevel = matchIndustry(industry, VERY_HIGH_SWITCHING) ? "Very High" : 
                       matchIndustry(industry, HIGH_SWITCHING) ? "High" : 
                       matchIndustry(industry, MODERATE_SWITCHING) ? "Moderate" : "Low";
  
  let switchNote = "";
  if (industryLevel !== "Low") {
    if (industry.toLowerCase().includes("software")) switchNote = "enterprise software requires deep workflow integration and data migration";
    else if (industry.toLowerCase().includes("bank") || industry.toLowerCase().includes("financial")) switchNote = "financial relationships involve complex regulatory and data transfer processes";
    else if (industry.toLowerCase().includes("aerospace") || industry.toLowerCase().includes("defense")) switchNote = "defense contracts span multiple years with specialized requirements";
    else if (industry.toLowerCase().includes("medical") || industry.toLowerCase().includes("device")) switchNote = "medical devices require FDA-specific approvals tied to specific products";
    else switchNote = "established business relationships create meaningful switching friction";
  }
  
  const marginNote = grossMargin > 0.50 ? `${(grossMargin * 100).toFixed(0)}% gross margins suggest customers pay premium rather than switch.` : "";
  const retentionNote = revenueGrowth > 0 ? `YoY revenue growth of ${(revenueGrowth * 100).toFixed(1)}% indicates strong customer retention.` : `Revenue declining ${(Math.abs(revenueGrowth) * 100).toFixed(1)}% YoY may indicate retention challenges.`;
  
  const explanation = `${companyName} benefits from ${strength} switching costs. ${industryLevel !== "Low" ? `${industry} creates structural switching costs — ${switchNote}.` : `${industry} offers relatively easy substitution.`} ${marginNote} ${retentionNote}`;
  
  return {
    score: totalScore,
    maxScore: 25,
    strength,
    present: totalScore >= 13,
    explanation,
    details: {
      industryLevel,
      grossMargin: (grossMargin * 100).toFixed(1),
      operatingMargin: (operatingMargin * 100).toFixed(1),
      roe: (roe * 100).toFixed(1),
      revenueGrowth: (revenueGrowth * 100).toFixed(1),
      earningsGrowth: (earningsGrowth * 100).toFixed(1)
    }
  };
}

function calcEarningsQuality(data) {
  const companyName = data.name || "The company";
  
  const netIncome = data.netIncome || 0;
  const totalRevenue = data.totalRevenue || 0;
  const fcf = data.freeCashflow || 0;
  const operatingCF = data.operatingCashflow || 0;
  const capex = data.capitalExpenditures || 0;
  const grossMargin = safeNum(data.grossMargin, 0);
  const operatingMargin = safeNum(data.operatingMargin, 0);
  const profitMargin = safeNum(data.profitMargin, 0);
  const roe = safeNum(data.roe, 0);
  const beta = safeNum(data.beta, 1);
  const trailingEPS = safeNum(data.trailingEPS, 0);
  const forwardEPS = safeNum(data.forwardEPS, 0);
  const revenueGrowth = safeNum(data.revenueGrowth, 0);
  const earningsGrowth = safeNum(data.earningsGrowth, 0);
  const payoutRatio = safeNum(data.payoutRatio, 0);
  const dividendYield = safeNum(data.dividendYield, 0);
  const debtToEquity = safeNum(data.debtToEquity, 0);
  const currentRatio = safeNum(data.currentRatio, 0);
  const ebitda = data.ebitda || 0;
  const repurchaseOfStock = safeNum(data.repurchaseOfStock, 0);
  const roic = safeNum(data.roic, 0);
  const wacc = safeNum(data.wacc, 9.5);
  
  const flags = [];
  let dataSourceNote = null;
  
  // === COMPONENT 1: ACCRUAL RATIO (0-20 pts) ===
  let accrualRatio = null;
  let accrualSource = "cashflowStatement";
  
  if (operatingCF !== 0 && netIncome !== 0) {
    accrualRatio = (netIncome - operatingCF) / Math.abs(netIncome);
  } else if (ebitda > 0 && netIncome > 0) {
    const ebitdaToNI = ebitda / netIncome;
    accrualRatio = 1.0 - (ebitdaToNI * 0.5);
    accrualSource = "estimated_from_ebitda";
    dataSourceNote = "Cashflow data limited — accrual ratio estimated from EBITDA";
  }
  
  let accrualScore = 10;
  let accrualLabel = "Aligned";
  if (accrualRatio !== null) {
    if (accrualRatio <= -0.3) { accrualScore = 20; accrualLabel = "Cash-Backed"; }
    else if (accrualRatio <= -0.1) { accrualScore = 17; accrualLabel = "Cash-Backed"; }
    else if (accrualRatio <= 0.05) { accrualScore = 14; accrualLabel = "Aligned"; }
    else if (accrualRatio <= 0.15) { accrualScore = 10; accrualLabel = "Moderate Accruals"; }
    else if (accrualRatio <= 0.30) { accrualScore = 6; accrualLabel = "High Accruals"; }
    else { accrualScore = 2; accrualLabel = "High Accruals"; }
    
    if (accrualRatio < -0.2) {
      flags.push({ type: "positive", message: `Cash flow exceeds earnings by ${Math.abs(accrualRatio * 100).toFixed(0)}% — earnings are conservatively stated` });
    } else if (accrualRatio > 0.25) {
      flags.push({ type: "warning", message: `Accrual ratio of ${(accrualRatio * 100).toFixed(0)}% suggests earnings exceed cash flow` });
    }
  }
  
  // === COMPONENT 2: FCF CONVERSION (0-20 pts) ===
  let fcfConversion = null;
  let fcfConversionScore = 10;
  let fcfConversionLabel = "Moderate";
  let fcfConversionSource = "actual";
  
  if (fcf !== 0 && netIncome > 0) {
    fcfConversion = fcf / netIncome;
  } else if (ebitda > 0 && netIncome > 0) {
    const estimatedFCF = ebitda * 0.65;
    fcfConversion = estimatedFCF / netIncome;
    fcfConversionSource = "estimated";
  }
  
  if (fcfConversion !== null) {
    if (netIncome < 0 && fcf > 0) {
      fcfConversionScore = 18;
      fcfConversionLabel = "Excellent";
    } else if (fcfConversion >= 1.2) { fcfConversionScore = 20; fcfConversionLabel = "Excellent"; }
    else if (fcfConversion >= 1.0) { fcfConversionScore = 17; fcfConversionLabel = "Excellent"; }
    else if (fcfConversion >= 0.8) { fcfConversionScore = 14; fcfConversionLabel = "Good"; }
    else if (fcfConversion >= 0.6) { fcfConversionScore = 10; fcfConversionLabel = "Moderate"; }
    else if (fcfConversion >= 0.4) { fcfConversionScore = 6; fcfConversionLabel = "Poor"; }
    else { fcfConversionScore = 2; fcfConversionLabel = "Poor"; }
    
    if (fcfConversion > 1.1) {
      flags.push({ type: "positive", message: `FCF conversion of ${(fcfConversion * 100).toFixed(0)}% — capital-light model generates more cash than earnings` });
    } else if (fcfConversion < 0.5) {
      flags.push({ type: "warning", message: `Only ${(fcfConversion * 100).toFixed(0)}% of earnings convert to free cash flow` });
    }
  }
  
  // === COMPONENT 3: EARNINGS STABILITY (0-20 pts) ===
  let epsScore = 4;
  if (trailingEPS > 0 && forwardEPS > 0) {
    const epsGrowth = (forwardEPS - trailingEPS) / Math.abs(trailingEPS);
    if (epsGrowth >= 0 && epsGrowth <= 0.25) epsScore = 7;
    else if (epsGrowth > 0.25 && epsGrowth <= 0.5) epsScore = 5;
    else if (epsGrowth > 0.5) epsScore = 3;
    else if (epsGrowth < 0 && epsGrowth >= -0.15) epsScore = 5;
    else epsScore = 2;
  }
  
  let betaScore = 5;
  if (beta <= 0.7) betaScore = 7;
  else if (beta <= 0.9) betaScore = 6;
  else if (beta <= 1.1) betaScore = 5;
  else if (beta <= 1.3) betaScore = 4;
  else if (beta <= 1.6) betaScore = 3;
  else betaScore = 1;
  
  let marginScore = 4;
  if (grossMargin > 0.5 && operatingMargin > 0.2) marginScore = 6;
  else if (grossMargin > 0.4 && operatingMargin > 0.15) marginScore = 5;
  else if (grossMargin > 0.3 && operatingMargin > 0.1) marginScore = 4;
  else if (grossMargin > 0.2 && operatingMargin > 0.05) marginScore = 3;
  else marginScore = 1;
  
  const stabilityScore = epsScore + betaScore + marginScore;
  let stabilityLabel = "Moderate";
  if (stabilityScore >= 16) stabilityLabel = "Very Stable";
  else if (stabilityScore >= 12) stabilityLabel = "Stable";
  else if (stabilityScore >= 8) stabilityLabel = "Moderate";
  else stabilityLabel = "Volatile";
  
  // === COMPONENT 4: REVENUE QUALITY (0-20 pts) ===
  let gmScore = 5;
  if (grossMargin >= 0.6) gmScore = 7;
  else if (grossMargin >= 0.45) gmScore = 6;
  else if (grossMargin >= 0.35) gmScore = 5;
  else if (grossMargin >= 0.25) gmScore = 3;
  else if (grossMargin >= 0.15) gmScore = 2;
  else gmScore = 1;
  
  let growthQualityScore = 5;
  if (earningsGrowth > revenueGrowth && revenueGrowth > 0) growthQualityScore = 7;
  else if (earningsGrowth > 0 && revenueGrowth > 0) growthQualityScore = 5;
  else if (revenueGrowth > 0 && earningsGrowth <= 0) growthQualityScore = 2;
  else if (revenueGrowth <= 0 && earningsGrowth > 0) growthQualityScore = 4;
  else if (revenueGrowth <= 0 && earningsGrowth <= 0) growthQualityScore = 1;
  
  let roeScore = 5;
  const roePct = roe * 100;
  if (roePct >= 15 && roePct <= 40) roeScore = 6;
  else if (roePct >= 10 && roePct <= 60) roeScore = 5;
  else if (roePct >= 5 && roePct <= 100) roeScore = 3;
  else if (roePct > 100) roeScore = 2;
  else roeScore = 1;
  
  const revenueQualityScore = gmScore + growthQualityScore + roeScore;
  let revenueQualityLabel = "Average";
  if (revenueQualityScore >= 16) revenueQualityLabel = "High Quality";
  else if (revenueQualityScore >= 12) revenueQualityLabel = "Good";
  else if (revenueQualityScore >= 8) revenueQualityLabel = "Average";
  else revenueQualityLabel = "Low Quality";
  
  // === COMPONENT 5: CAPITAL ALLOCATION (0-20 pts) ===
  const roicSpread = roic - wacc;
  let roicScore = 4;
  if (roicSpread >= 20) roicScore = 8;
  else if (roicSpread >= 10) roicScore = 6;
  else if (roicSpread >= 5) roicScore = 4;
  else if (roicSpread >= 0) roicScore = 2;
  else roicScore = 0;
  
  const hasBuybacks = repurchaseOfStock < 0 || (roe > 0.4);
  let returnScore = 4;
  if (hasBuybacks && payoutRatio < 0.6 && payoutRatio > 0) returnScore = 6;
  else if (hasBuybacks && payoutRatio >= 0.6) returnScore = 4;
  else if (!hasBuybacks && dividendYield * 100 > 1.5) returnScore = 4;
  else if (!hasBuybacks && payoutRatio < 0.3) returnScore = 3;
  else if (payoutRatio > 0.9) returnScore = 1;
  else returnScore = 2;
  
  let debtScore = 5;
  if ((debtToEquity === 0 || debtToEquity === null) && currentRatio > 1.5) debtScore = 6;
  else if (debtToEquity < 50 && currentRatio > 1.5) debtScore = 6;
  else if (debtToEquity < 100 && currentRatio > 1.0) debtScore = 5;
  else if (debtToEquity < 150 && currentRatio > 0.8) debtScore = 3;
  else if (debtToEquity < 200) debtScore = 2;
  else debtScore = 1;
  
  const capAllocationScore = roicScore + returnScore + debtScore;
  let capAllocationLabel = "Average";
  if (capAllocationScore >= 16) capAllocationLabel = "Excellent";
  else if (capAllocationScore >= 12) capAllocationLabel = "Good";
  else if (capAllocationScore >= 8) capAllocationLabel = "Average";
  else capAllocationLabel = "Poor";
  
  if (roicSpread > 15) {
    flags.push({ type: "positive", message: `ROIC spread of +${roicSpread.toFixed(1)}% demonstrates exceptional value creation` });
  } else if (roicSpread < 0) {
    flags.push({ type: "warning", message: `Negative ROIC spread — returns below cost of capital` });
  }
  
  // === TOTAL SCORE ===
  const totalScore = Math.min(accrualScore + fcfConversionScore + stabilityScore + revenueQualityScore + capAllocationScore, 100);
  
  let grade = "C";
  if (totalScore >= 80) grade = "A";
  else if (totalScore >= 65) grade = "B";
  else if (totalScore >= 50) grade = "C";
  else if (totalScore >= 35) grade = "D";
  else grade = "F";
  
  // Generate summary
  let summary = "";
  if (totalScore >= 80) {
    summary = `${companyName}'s earnings are high quality — strongly backed by cash flow with a ${accrualRatio !== null ? (accrualRatio * 100).toFixed(0) + "%" : "estimated"} accrual ratio and ${fcfConversion !== null ? (fcfConversion * 100).toFixed(0) + "%" : "estimated"}% FCF conversion.`;
  } else if (totalScore >= 65) {
    summary = `${companyName} has good earnings quality. ${fcfConversionLabel === "Excellent" || fcfConversionLabel === "Good" ? "Strong FCF conversion stands out." : accrualLabel === "Cash-Backed" ? "Cash-backed earnings are a positive." : "Several areas show quality."} ${stabilityLabel === "Volatile" ? "Earnings volatility warrants monitoring." : ""}`;
  } else if (totalScore >= 50) {
    summary = `${companyName} has average earnings quality. ${accrualScore < 10 ? "High accruals suggest caution. " : ""}${fcfConversionScore < 10 ? "FCF conversion could be better. " : ""}Monitor for signs of deterioration.`;
  } else {
    summary = `${companyName}'s earnings quality raises concerns. ${accrualScore < 10 ? "Accrual ratio of " + (accrualRatio !== null ? (accrualRatio * 100).toFixed(0) + "%" : "unknown") + " suggests potential overstatement. " : ""}${fcfConversionScore < 10 ? "Poor cash conversion raises questions about earnings reliability." : ""}`;
  }
  
  // Key insight
  let keyInsight = "";
  if (accrualRatio !== null && accrualRatio < -0.2) {
    keyInsight = "Earnings are conservatively stated — cash flow significantly exceeds reported profits.";
  } else if (accrualRatio !== null && accrualRatio > 0.25) {
    keyInsight = `⚠️ High accrual ratio of ${(accrualRatio * 100).toFixed(0)}% suggests earnings may overstate real cash generation.`;
  } else if (fcfConversion !== null && fcfConversion > 1.1) {
    keyInsight = `Capital-light model — generates ${(fcfConversion * 100).toFixed(0)}% of earnings as free cash flow.`;
  } else if (fcfConversion !== null && fcfConversion < 0.5) {
    keyInsight = `⚠️ Poor cash conversion — only ${(fcfConversion * 100).toFixed(0)}% of earnings become free cash flow.`;
  } else if (roicSpread > 15) {
    keyInsight = `Exceptional capital allocation — reinvesting at ${roicSpread.toFixed(1)}% above cost of capital.`;
  } else if (roicSpread < 0) {
    keyInsight = `⚠️ Value destruction — returns on capital below cost of capital.`;
  } else {
    keyInsight = `Earnings quality is ${grade === "A" || grade === "B" ? "solid" : grade === "C" ? "adequate" : "concerning"} with no major red flags.`;
  }
  
  return {
    score: totalScore,
    grade,
    summary,
    keyInsight,
    components: {
      accruals: {
        score: accrualScore,
        maxScore: 20,
        accrualRatio: accrualRatio !== null ? parseFloat(accrualRatio.toFixed(3)) : null,
        label: accrualLabel,
        source: accrualSource
      },
      fcfConversion: {
        score: fcfConversionScore,
        maxScore: 20,
        conversionRate: fcfConversion !== null ? parseFloat(fcfConversion.toFixed(2)) : null,
        label: fcfConversionLabel,
        source: fcfConversionSource
      },
      earningsStability: {
        score: stabilityScore,
        maxScore: 20,
        epsGrowthRate: trailingEPS > 0 && forwardEPS > 0 ? parseFloat(((forwardEPS - trailingEPS) / trailingEPS).toFixed(2)) : null,
        beta: parseFloat(beta.toFixed(2)),
        label: stabilityLabel
      },
      revenueQuality: {
        score: revenueQualityScore,
        maxScore: 20,
        label: revenueQualityLabel
      },
      capitalAllocation: {
        score: capAllocationScore,
        maxScore: 20,
        roicSpread: parseFloat(roicSpread.toFixed(1)),
        label: capAllocationLabel
      }
    },
    flags,
    dataSourceNote
  };
}

function calcMoatAnalysis(data, networkInput = null) {
  const companyName = data.name || "The company";
  const supplySide = calcSupplySideEconomies(data);
  const networkEffects = calcNetworkEffects(data, networkInput);
  const learningCurve = calcLearningCurve(data);
  const switchingCosts = calcSwitchingCosts(data);
  
  const categories = { supplySide, networkEffects, learningCurve, switchingCosts };
  const totalRaw = supplySide.score + networkEffects.score + learningCurve.score + switchingCosts.score;
  const maxPossible = networkInput ? 100 : 90;
  const moatScore = Math.round(totalRaw / maxPossible * 100);
  
  const moatType = moatScore >= 70 ? "wide" : moatScore >= 45 ? "narrow" : "none";
  
  const sortedCategories = Object.entries(categories)
    .sort((a, b) => b[1].score - a[1].score);
  const topTwo = sortedCategories.slice(0, 2);
  
  const catLabels = {
    supplySide: "Supply-Side Economies",
    networkEffects: "Network Effects",
    learningCurve: "Learning Curve",
    switchingCosts: "Switching Costs"
  };
  
  const moatNarrative = `${companyName} possesses a ${moatType} economic moat (score: ${moatScore}/100). Strongest advantages: ${catLabels[topTwo[0][0]]} (${topTwo[0][1].strength}) and ${catLabels[topTwo[1][0]]} (${topTwo[1][1].strength}). ${topTwo[0][1].explanation.split(".")[0]}.`;
  
  return {
    moat_score: moatScore,
    moat_type: moatType,
    moat_narrative: moatNarrative,
    categories: {
      supply_side: supplySide,
      network_effects: networkEffects,
      learning_curve: learningCurve,
      switching_costs: switchingCosts
    }
  };
}

// =====================================================================
// SECTION 2: AI DISRUPTION
// =====================================================================

function calcAIDisruption(data) {
  const companyName = data.name || "The company";
  const industry = data.industry || "";
  
  let threatLevel = "low";
  if (matchIndustry(industry, AI_THREAT_SEVERE)) threatLevel = "severe";
  else if (matchIndustry(industry, AI_THREAT_HIGH)) threatLevel = "high";
  else if (matchIndustry(industry, AI_THREAT_MODERATE)) threatLevel = "moderate";
  
  let oppLevel = "minimal";
  if (matchIndustry(industry, AI_OPP_MASSIVE)) oppLevel = "massive";
  else if (matchIndustry(industry, AI_OPP_SIGNIFICANT)) oppLevel = "significant";
  else if (matchIndustry(industry, AI_OPP_MODERATE)) oppLevel = "moderate";
  
  let netImpact = "neutral";
  if (oppLevel === "massive" && (threatLevel === "low" || threatLevel === "moderate")) netImpact = "strong_tailwind";
  else if (oppLevel === "significant" && threatLevel === "low") netImpact = "tailwind";
  else if (oppLevel === "massive" && (threatLevel === "high" || threatLevel === "severe")) netImpact = "tailwind";
  else if (oppLevel === "significant" && threatLevel === "high") netImpact = "neutral";
  else if (oppLevel === "moderate" && threatLevel === "moderate") netImpact = "neutral";
  else if (oppLevel === "moderate" && (threatLevel === "high" || threatLevel === "severe")) netImpact = "headwind";
  else if (oppLevel === "minimal" && (threatLevel === "high" || threatLevel === "severe")) netImpact = "strong_headwind";
  else if (oppLevel === "minimal" && threatLevel === "moderate") netImpact = "headwind";
  
  const threatTemplates = {
    severe: `${industry} faces severe AI disruption. Core functions are directly automatable, threatening the fundamental value proposition.`,
    high: `${industry} faces significant AI disruption. AI can automate key workflows, potentially compressing margins and reducing demand.`,
    moderate: `AI presents manageable disruption to ${industry}. Some processes will be automated, but core value chain has structural resistance.`,
    low: `${industry} has limited AI disruption risk. Physical infrastructure, regulatory moats, and tangible assets provide insulation.`
  };
  
  const oppTemplates = {
    massive: `${companyName} is positioned as a primary AI beneficiary. ${industry} companies can leverage AI to expand TAM and create new revenue streams.`,
    significant: `AI offers meaningful opportunities for ${companyName} to enhance operations, accelerate R&D, and develop AI-enhanced premium products.`,
    moderate: `${companyName} can use AI to improve efficiency and customer experience, though AI won't fundamentally transform the business model.`,
    minimal: `AI offers limited transformative potential for ${industry}. Benefits are primarily operational efficiency gains.`
  };
  
  const netNotes = {
    strong_tailwind: "Opportunity significantly outweighs disruption risk.",
    tailwind: "AI opportunity provides meaningful upside potential.",
    neutral: "AI creates both challenges and opportunities that roughly balance.",
    headwind: "Disruption risk outpaces the company's ability to leverage AI for growth.",
    strong_headwind: "AI disruption poses significant structural threat."
  };
  
  return {
    threat_level: threatLevel,
    opportunity_level: oppLevel,
    net_impact: netImpact,
    threat_analysis: threatTemplates[threatLevel],
    opportunity_analysis: oppTemplates[oppLevel],
    net_assessment: `${companyName} faces a ${netImpact.replace("_", " ")} from AI. ${netNotes[netImpact]}`
  };
}

// =====================================================================
// SECTION 3: ROIC SENSITIVITY
// =====================================================================

function calcROICSensitivity(data) {
  // All inputs are already in percentage form (from calcROIC)
  const nopatMarginPct = safeNum(data.nopatMargin, 0);  // e.g., 27.9 for 27.9%
  const assetTurnover = safeNum(data.assetTurnover, 0);  // e.g., 2.33 (no units)
  const currentRoicPct = safeNum(data.roic, 0);  // e.g., 68.2 for 68.2%
  const grossMarginPct = safeNum(data.grossMargin, 0) * 100;  // Convert to percentage
  const operatingMarginPct = safeNum(data.operatingMargin, 0) * 100;  // Convert to percentage
  const forwardEPS = safeNum(data.forwardEPS, 0);
  const trailingEPS = safeNum(data.trailingEPS, 0);
  const taxRate = 0.21;
  
  // Work in DECIMALS internally to avoid unit confusion
  const nopatMargin = nopatMarginPct / 100;  // e.g., 0.279
  const currentRoic = currentRoicPct / 100;  // e.g., 0.682
  
  // Calculate new ROIC for each lever
  // Lever A: Gross Margin +200bps (+2 percentage points)
  const newNopatMarginA = nopatMargin + (0.02 * (1 - taxRate));  // Add 2% GM * (1-tax)
  const newRoicA = newNopatMarginA * assetTurnover;
  const deltaA = newRoicA - currentRoic;
  
  // Lever B: OpEx Efficiency +150bps (+1.5 percentage points)
  const newNopatMarginB = nopatMargin + (0.015 * (1 - taxRate));
  const newRoicB = newNopatMarginB * assetTurnover;
  const deltaB = newRoicB - currentRoic;
  
  // Lever C: Asset Turnover +0.1x
  const newRoicC = nopatMargin * (assetTurnover + 0.1);
  const deltaC = newRoicC - currentRoic;
  
  // Lever D: Working Capital +0.05x
  const newRoicD = nopatMargin * (assetTurnover + 0.05);
  const deltaD = newRoicD - currentRoic;
  
  const levers = [
    {
      name: "Gross Margin Expansion (+200bps)",
      metric: "grossMargin",
      current: grossMarginPct.toFixed(1) + "%",
      target: (grossMarginPct + 2).toFixed(1) + "%",
      roicImpact: "+" + (deltaA * 100).toFixed(1) + "%",
      roicDelta: (deltaA * 100).toFixed(1),
      newRoic: (newRoicA * 100).toFixed(1)
    },
    {
      name: "OpEx Efficiency (+150bps)",
      metric: "operatingMargin",
      current: operatingMarginPct.toFixed(1) + "%",
      target: (operatingMarginPct + 1.5).toFixed(1) + "%",
      roicImpact: "+" + (deltaB * 100).toFixed(1) + "%",
      roicDelta: (deltaB * 100).toFixed(1),
      newRoic: (newRoicB * 100).toFixed(1)
    },
    {
      name: "Asset Turnover (+0.1x)",
      metric: "assetTurnover",
      current: assetTurnover.toFixed(2) + "x",
      target: (assetTurnover + 0.1).toFixed(2) + "x",
      roicImpact: "+" + (deltaC * 100).toFixed(1) + "%",
      roicDelta: (deltaC * 100).toFixed(1),
      newRoic: (newRoicC * 100).toFixed(1)
    },
    {
      name: "Working Capital (+0.05x)",
      metric: "workingCapital",
      current: assetTurnover.toFixed(2) + "x",
      target: (assetTurnover + 0.05).toFixed(2) + "x",
      roicImpact: "+" + (deltaD * 100).toFixed(1) + "%",
      roicDelta: (deltaD * 100).toFixed(1),
      newRoic: (newRoicD * 100).toFixed(1)
    }
  ];
  
  const sortedLevers = [...levers].sort((a, b) => parseFloat(b.roicDelta) - parseFloat(a.roicDelta));
  const primaryIndex = levers.findIndex(l => l.name === sortedLevers[0].name);
  const secondaryIndex = levers.findIndex(l => l.name === sortedLevers[1].name);
  
  const primaryName = sortedLevers[0].name;
  let probability = "medium";
  let timeline = "18-36 months";
  
  if (primaryName.includes("Gross Margin")) {
    probability = grossMarginPct < 40 ? "high" : grossMarginPct > 60 ? "low" : "medium";
  } else if (primaryName.includes("OpEx")) {
    probability = operatingMarginPct < 15 ? "high" : operatingMarginPct > 25 ? "low" : "medium";
  } else {
    probability = assetTurnover < 0.8 ? "high" : assetTurnover > 1.5 ? "low" : "medium";
  }
  
  if (probability === "high" && forwardEPS > trailingEPS) timeline = "12-18 months";
  else if (probability === "low") timeline = "36+ months or unlikely";
  
  let managementAction = "No clear evidence of lever-pulling";
  if (forwardEPS > trailingEPS) {
    const growth = ((forwardEPS - trailingEPS) / trailingEPS * 100).toFixed(0);
    if (growth > 10) {
      managementAction = `Management guiding for meaningful earnings growth of ${growth}%, suggesting active pursuit of ${primaryName.split("(")[0].trim()}`;
    } else {
      managementAction = `Modest growth guidance of ${growth}% suggests incremental improvement`;
    }
  }
  
  let decompositionInsight = "";
  if (nopatMargin > assetTurnover * 0.15) decompositionInsight += "This is a margin-led business.";
  else if (assetTurnover > 1.2 && nopatMargin < 0.15) decompositionInsight += "This is a turnover-led business.";
  else decompositionInsight += "This is a balanced business.";
  
  decompositionInsight += ` NOPAT margin of ${nopatMarginPct.toFixed(1)}% is ${nopatMarginPct > 20 ? "strong" : nopatMarginPct > 12 ? "solid" : "thin"} while asset turnover of ${assetTurnover.toFixed(2)}x is ${assetTurnover > 1.2 ? "efficient" : assetTurnover > 0.7 ? "moderate" : "capital-heavy"}.`;
  
  return {
    levers,
    primaryLever: {
      index: primaryIndex,
      name: primaryName,
      probability,
      managementAction,
      timeline
    },
    secondaryLever: {
      index: secondaryIndex,
      name: sortedLevers[1].name
    },
    decompositionInsight
  };
}

// =====================================================================
// SECTION 4: PROFITABILITY PATH
// =====================================================================

function calcProfitabilityPath(data) {
  // Convert decimals to percentages - financialData returns decimals (e.g., 0.473 = 47.3%)
  const companyName = data.name || "The company";
  const grossMargin = safeNum(data.grossMargin, 0) * 100;
  const beta = safeNum(data.beta, 1);
  const operatingMargin = safeNum(data.operatingMargin, 0) * 100;
  const freeCashflow = safeNum(data.freeCashflow, 0);
  const netIncome = safeNum(data.netIncome, 0);
  
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
  
  const subScores = [
    { name: "Recurring Revenue", score: recurring, max: 25, weakness: recurring < 15 },
    { name: "Earnings Stability", score: stability, max: 25, weakness: stability < 15 },
    { name: "Margin Quality", score: margin, max: 25, weakness: margin < 15 },
    { name: "FCF Conversion", score: conversion, max: 25, weakness: conversion < 15 }
  ];
  
  const weakest = subScores.filter(s => s.weakness);
  const strongest = subScores.filter(s => s.score >= 20);
  
  let pathDescription = "";
  if (total >= 80 && grossMargin > 50 && fcfRatio > 0.8) {
    pathDescription = `${companyName} has a highly predictable profitability path. ${grossMargin.toFixed(0)}% gross margins with ${(fcfRatio * 100).toFixed(0)}% FCF conversion indicates recurring-like revenue with strong visibility.`;
  } else if (total >= 60 && operatingMargin > 15) {
    pathDescription = `${companyName} shows solid profitability predictability. ${operatingMargin.toFixed(0)}% operating margins provide a buffer, though ${weakest[0]?.name || "revenue quality"} is the area to watch.`;
  } else if (total >= 40) {
    pathDescription = `${companyName} has moderate predictability. ${weakest.slice(0, 2).map(w => w.name).join(" and ")} introduce uncertainty, though ${strongest[0]?.name || "scale"} provides a foundation.`;
  } else {
    pathDescription = `${companyName} has low predictability. ${weakest[0]?.name || "Multiple factors"} create uncertainty. Earnings trajectory is uncertain.`;
  }
  
  let bullMilestone = "";
  if (subScores[0].weakness) bullMilestone = "Improving FCF conversion above 80% would confirm operational leverage translating to cash";
  else if (subScores[2].weakness) bullMilestone = "Expanding operating margins above 15% would signal sustainable pricing power";
  else if (subScores[1].weakness) bullMilestone = "Reducing beta below 1.0 would attract institutional capital and improve multiple";
  else bullMilestone = "Growing gross margins above 50% would suggest shift toward higher-quality revenue";
  
  let bearRisk = "";
  const debtToEquity = safeNum(data.debtToEquity, 0);
  if (debtToEquity > 100) bearRisk = `Leverage of ${debtToEquity.toFixed(0)}% D/E could amplify losses in a downturn`;
  else if (operatingMargin < 10) bearRisk = `Thin ${operatingMargin.toFixed(0)}% margins leave little room for error`;
  else bearRisk = "Macro headwinds or sector rotation could pressure the stock";
  
  return {
    predictability_score: total,
    sub_scores: subScores,
    path_description: pathDescription,
    bull_milestone: bullMilestone,
    bear_risk: bearRisk,
    gross_margin_trend: safeNum(data.gmTrend, 0) >= 0 ? "expanding" : "contracting",
    fcf_conversion: `${(fcfRatio * 100).toFixed(0)}%`,
    earnings_volatility: beta <= 1 ? "low" : beta <= 1.5 ? "moderate" : "high"
  };
}

// =====================================================================
// SECTION 5: GROWTH CONSTRAINTS
// =====================================================================

function calcGrowthConstraints(data, moatScore = 0) {
  const companyName = data.name || "The company";
  const forwardPE = safeNum(data.forwardPE, 0);
  const priceToSales = safeNum(data.priceToSales, 0);
  const debtToEquity = safeNum(data.debtToEquity, 0);
  const currentRatio = safeNum(data.currentRatio, 0);
  const forwardEPS = safeNum(data.forwardEPS, 0);
  const trailingEPS = safeNum(data.trailingEPS, 0);
  const peg = safeNum(data.pegRatio, 0);
  const sector = data.sector || "";
  const marketCap = safeNum(data.marketCap, 0);
  // Convert decimals to percentages
  const grossMargin = safeNum(data.grossMargin, 0) * 100;
  const operatingMargin = safeNum(data.operatingMargin, 0) * 100;
  const gmTrend = safeNum(data.gmTrend, 0);
  
  // 5A. Valuation
  let valSeverity = "low";
  if (forwardPE > 35 || priceToSales > 12) valSeverity = "high";
  else if (forwardPE > 28 || priceToSales > 8) valSeverity = "moderate";
  
  const valDesc = valSeverity === "high" ? "Premium valuation prices in significant growth, leaving minimal margin for error." :
                  valSeverity === "moderate" ? "Elevated but not extreme given growth profile." :
                  "Reasonable valuation provides margin of safety.";
  
  const valMitigation = forwardEPS > trailingEPS ? 
    `Earnings growth of ${((forwardEPS / trailingEPS - 1) * 100).toFixed(0)}% can grow into valuation over 12-24 months` :
    "No near-term catalyst to justify multiple";
  
  // 5B. Debt
  let debtSeverity = "low";
  if (debtToEquity > 200) debtSeverity = "high";
  else if (debtToEquity > 100) debtSeverity = "moderate";
  
  if (currentRatio < 1.0 && debtSeverity !== "high") debtSeverity = "moderate";
  else if (currentRatio < 1.0) debtSeverity = "high";
  
  const debtDesc = `Debt-to-equity of ${debtToEquity.toFixed(0)} with ${currentRatio.toFixed(2)} current ratio.`;
  const debtMitigation = data.totalCash > data.totalDebt * 0.5 ? 
    `Strong cash position of $${billions(data.totalCash)}B partially offsets debt` :
    "Limited cash cushion";
  
  // 5C. Growth
  let growthSeverity = "low";
  if (forwardEPS < trailingEPS) growthSeverity = "high";
  else if (peg > 2.5) growthSeverity = "moderate";
  else if (peg > 1.5) growthSeverity = "low";
  
  const growthDesc = `Forward EPS $${forwardEPS.toFixed(2)} vs trailing $${trailingEPS.toFixed(2)}. PEG ratio ${peg.toFixed(1)}.`;
  const roicSpread = safeNum(data.roic, 0) - safeNum(data.wacc, 0);
  const growthMitigation = roicSpread > 10 ? 
    `Strong ${roicSpread.toFixed(0)}% ROIC spread suggests reinvestment can drive organic growth` :
    "Limited reinvestment returns";
  
  // 5D. Sector Risk
  const sectorRiskData = SECTOR_RISK[sector] || { severity: "moderate", description: "Sector-specific risks apply" };
  const sectorMitigation = moatScore >= 70 ? "Wide moat provides strong competitive insulation" :
                          moatScore >= 45 ? "Narrow moat offers some protection" :
                          "Limited competitive protection";
  
  // 5E. Concentration
  let concSeverity = "low";
  let concDesc = "Diversified operations at scale reduce concentration risk";
  if (marketCap < 2e9) { concSeverity = "high"; concDesc = "Small cap companies typically face significant concentration risk"; }
  else if (marketCap < 10e9) { concSeverity = "moderate"; concDesc = "Smaller scale increases likelihood of customer or product concentration"; }
  
  // 5F. Margin Pressure
  let marginSeverity = "low";
  let marginDesc = `Healthy margins of ${grossMargin.toFixed(0)}% gross / ${operatingMargin.toFixed(0)}% operating provide resilience`;
  if (grossMargin < 30 && operatingMargin < 10) {
    marginSeverity = "high";
    marginDesc = `Thin margins of ${grossMargin.toFixed(0)}% gross / ${operatingMargin.toFixed(0)}% operating leave minimal buffer`;
  } else if (grossMargin < 40 && operatingMargin < 15) {
    marginSeverity = "moderate";
    marginDesc = "Moderate margins face competitive pressure risk";
  }
  
  const marginMitigation = gmTrend > 0 ? "Margins trending upward suggests improving position" : "Stable or declining margins warrant monitoring";
  
  const constraints = [
    { name: "Valuation", type: "valuation", severity: valSeverity, description: `Trading at ${forwardPE.toFixed(0)}x forward earnings and ${priceToSales.toFixed(1)}x revenue. ${valDesc}`, mitigation: valMitigation, timeline: "" },
    { name: "Debt Level", type: "balance_sheet", severity: debtSeverity, description: debtDesc, mitigation: debtMitigation, timeline: "" },
    { name: "Growth Rate", type: "growth", severity: growthSeverity, description: growthDesc, mitigation: growthMitigation, timeline: "" },
    { name: "Sector Risk", type: "competitive", severity: sectorRiskData.severity, description: sectorRiskData.description, mitigation: sectorMitigation, timeline: "" },
    { name: "Concentration", type: "concentration", severity: concSeverity, description: concDesc, mitigation: "Diversification strategy and customer base monitoring recommended", timeline: "" },
    { name: "Margin Pressure", type: "margin_pressure", severity: marginSeverity, description: marginDesc, mitigation: marginMitigation, timeline: "" }
  ];
  
  const severities = constraints.map(c => c.severity);
  const overallSeverity = severities.includes("high") ? "high" : severities.includes("moderate") ? "moderate" : "low";
  
  const highConstraints = constraints.filter(c => c.severity === "high").map(c => c.name);
  const netAssessment = `${companyName} faces ${overallSeverity} growth constraints. ${highConstraints.length > 0 ? "Primary concerns: " + highConstraints.join(", ") + "." : ""}`;
  
  return {
    overall_severity: overallSeverity,
    net_assessment: netAssessment,
    constraints
  };
}

// =====================================================================
// TOTAL SHAREHOLDER YIELD
// =====================================================================

function calcTotalShareholderYield(data, intrinsicValueData = {}) {
  const companyName = data.name || "The company";
  
  const currentPrice = safeNum(data.price, 0);
  const sharesOutstanding = safeNum(data.sharesOutstanding, 0);
  const marketCap = currentPrice * sharesOutstanding;
  
  const dividendYieldRaw = safeNum(data.dividendYield, 0);
  const dividendRate = safeNum(data.dividendRate, 0);
  const payoutRatio = safeNum(data.payoutRatio, 0);
  const repurchaseOfStock = safeNum(data.repurchaseOfStock, 0);
  const freeCashflow = safeNum(data.freeCashflow, 0);
  const operatingCashflow = safeNum(data.operatingCashflow, 0);
  const capitalExpenditures = safeNum(data.capitalExpenditures, 0);
  const roe = safeNum(data.roe, 0);
  const bookValue = safeNum(data.bookValue, 0);
  const marginOfSafety = safeNum(intrinsicValueData?.undervaluation, 0);
  const roicSpread = safeNum(data.roicSpread || (data.roic - data.wacc), 0);
  const totalDebt = safeNum(data.totalDebt, 0);
  const totalCash = safeNum(data.totalCash, 0);
  
  const dividendYieldPct = dividendYieldRaw * 100;
  
  let annualDividendAmount = null;
  if (dividendRate > 0 && sharesOutstanding > 0) {
    annualDividendAmount = dividendRate * sharesOutstanding;
  }
  
  let buybackAmount = null;
  let buybackYield = 0;
  let buybackEstimated = false;
  let netDilution = 0;
  
  // === BUYBACK DETECTION ===
  // Method 1: Direct cashflow data
  const hasBuybacks_cf = repurchaseOfStock < 0;
  const buybackAmount_cf = hasBuybacks_cf ? Math.abs(repurchaseOfStock) : 0;

  // Method 2: ROE/book value proxy (lowered threshold from 40% to 30%)
  const roePct = roe * 100;
  const bv = bookValue > 0 ? bookValue : 999;
  const hasBuybacks_proxy = (roePct > 30 && bv < 40);

  // Method 3: Low payout ratio + profitable = likely buying back
  // If paying out < 30% of earnings as dividends and generating profits, where's the rest going? Buybacks.
  const netIncome = data.netIncome || data.netIncomeAvg || 0;
  const hasBuybacks_payout = (payoutRatio > 0 && payoutRatio < 0.30 && netIncome > 0 && marketCap > 0);

  // Combined detection
  const hasBuybacks = hasBuybacks_cf || hasBuybacks_proxy || hasBuybacks_payout;

  // Calculate yield
  if (hasBuybacks_cf) {
    buybackAmount = Math.abs(repurchaseOfStock);
    buybackYield = marketCap > 0 ? (buybackAmount / marketCap) * 100 : 0;
    buybackEstimated = false;
  } else if (hasBuybacks_proxy || hasBuybacks_payout) {
    // Estimate: assume company returns ~50% of earnings not paid as dividends via buybacks
    const dividendsPaid = dividendRate * sharesOutstanding;
    const retainedEarnings = Math.max(netIncome - dividendsPaid, 0);
    buybackAmount = Math.max(retainedEarnings * 0.50, 0); // conservative: 50% of retained
    buybackYield = marketCap > 0 ? (buybackAmount / marketCap) * 100 : 0;
    buybackEstimated = true;
  } else {
    buybackAmount = 0;
    buybackYield = 0;
    buybackEstimated = false;
  }
  
  let debtPaydownYield = 0;
  let debtPaydownAmount = 0;
  let debtIncreaseYield = 0;
  let debtIncreaseAmount = 0;
  let debtPaydownEstimated = false;
  
  const netDebtChange = safeNum(data.netDebtChange, null);
  if (netDebtChange !== null) {
    if (netDebtChange < 0) {
      debtPaydownAmount = Math.abs(netDebtChange);
      debtPaydownYield = marketCap > 0 ? (debtPaydownAmount / marketCap) * 100 : 0;
    } else if (netDebtChange > 0) {
      debtIncreaseAmount = netDebtChange;
      debtIncreaseYield = marketCap > 0 ? (debtIncreaseAmount / marketCap) * 100 : 0;
    }
  } else {
    debtPaydownEstimated = true;
  }
  
  const totalYield = dividendYieldPct + buybackYield + debtPaydownYield;
  const netYield = totalYield - debtIncreaseYield;
  
  let category = "growth_reinvestor";
  if (totalYield >= 6) category = "exceptional_returner";
  else if (totalYield >= 4) category = "strong_returner";
  else if (totalYield >= 2) category = "moderate_returner";
  else if (totalYield >= 0.5) category = "minimal_returner";
  
  const treasuryYield = 4.3;
  const yieldVsTreasury = totalYield - treasuryYield;
  
  const totalReturnAmount = (annualDividendAmount || 0) + Math.abs(buybackAmount || 0) + debtPaydownAmount;
  const returnCoverage = totalReturnAmount > 0 && freeCashflow > 0 ? freeCashflow / totalReturnAmount : null;
  
  let yieldScore = 0;
  let yieldLevelScore = 0;
  let sustainabilityScore = 0;
  let buybackEffectivenessScore = 0;
  let dividendGrowthScore = 0;
  
  if (totalYield >= 8) yieldLevelScore = 25;
  else if (totalYield >= 6) yieldLevelScore = 22;
  else if (totalYield >= 4) yieldLevelScore = 18;
  else if (totalYield >= 3) yieldLevelScore = 15;
  else if (totalYield >= 2) yieldLevelScore = 12;
  else if (totalYield >= 1) yieldLevelScore = 8;
  else if (totalYield >= 0.5) yieldLevelScore = 5;
  else yieldLevelScore = 2;
  
  if (returnCoverage !== null) {
    // Base score from coverage ratio
    let sustainScore;
    if (returnCoverage >= 2.0) sustainScore = 25;
    else if (returnCoverage >= 1.5) sustainScore = 22;
    else if (returnCoverage >= 1.2) sustainScore = 18;
    else if (returnCoverage >= 1.0) sustainScore = 15;
    else if (returnCoverage >= 0.8) sustainScore = 10;
    else sustainScore = 5;
    
    // BUT: if total yield is very low, high coverage is less meaningful
    // It's easy to "sustain" a 0.5% yield — that doesn't deserve 25/25
    if (totalYield < 1.0 && sustainScore > 15) {
      sustainScore = 15; // cap at 15 for trivially low yields
    }
    sustainabilityScore = sustainScore;
  } else {
    sustainabilityScore = 10; // no returns = neutral sustainability
  }
  
  if (Math.abs(buybackYield) > 0.5) {
    const mos = -marginOfSafety;
    if (mos < 0) buybackEffectivenessScore = 25;
    else if (mos < 15) buybackEffectivenessScore = 20;
    else if (mos < 30) buybackEffectivenessScore = 12;
    else if (mos < 50) buybackEffectivenessScore = 6;
    else buybackEffectivenessScore = 2;
  } else {
    buybackEffectivenessScore = 15;
  }
  
  const payoutPct = payoutRatio * 100;
  if (dividendYieldPct > 0 && payoutRatio > 0) {
    if (payoutPct < 40) dividendGrowthScore = 25;
    else if (payoutPct < 60) dividendGrowthScore = 20;
    else if (payoutPct < 80) dividendGrowthScore = 12;
    else dividendGrowthScore = 5;
  } else if (dividendYieldPct > 0) {
    dividendGrowthScore = 15;
  } else if (buybackYield > 2) {
    dividendGrowthScore = 20;
  } else if (roicSpread > 10) {
    dividendGrowthScore = 20;
  } else {
    dividendGrowthScore = 10;
  }
  
  // Calculate raw quality score
  const rawQualityScore = yieldLevelScore + sustainabilityScore + buybackEffectivenessScore + dividendGrowthScore;
  
  // GATE: if total yield is very low, the quality of that yield matters less
  // You can have perfect quality on a 0.5% yield — it's still only 0.5%
  if (totalYield < 1.0) {
    yieldScore = Math.min(rawQualityScore, 40);
  } else if (totalYield < 2.0) {
    yieldScore = Math.min(rawQualityScore, 60);
  } else if (totalYield < 3.0) {
    yieldScore = Math.min(rawQualityScore, 80);
  } else {
    yieldScore = rawQualityScore;
  }
  
  const flags = [];
  if (marginOfSafety < -25 && buybackYield > 1) {
    flags.push({ type: "warning", message: "Share buybacks occurring above estimated intrinsic value — reduces capital allocation efficiency" });
  }
  if (returnCoverage !== null && returnCoverage < 0.8) {
    flags.push({ type: "warning", message: "Total returns exceed free cash flow — may be funding returns with debt or cash reserves" });
  }
  if (debtIncreaseYield > 0 && dividendYieldPct > 0) {
    flags.push({ type: "info", message: "Company is simultaneously borrowing and paying dividends — net yield may overstate true return" });
  }
  if (netDilution > 0) {
    flags.push({ type: "info", message: "Net share dilution from stock compensation offsetting buybacks" });
  }
  if (buybackEstimated) {
    flags.push({ type: "info", message: `Buyback yield estimated (${hasBuybacks_payout ? 'payout ratio' : 'ROE proxy'})` });
  }
  if (totalYield < 1.0 && rawQualityScore > yieldScore) {
    flags.push({ type: "info", message: "Quality score capped due to low total yield" });
  }
  
  let summary = "";
  if (category === "exceptional_returner") {
    summary = `${companyName} returns an exceptional ${totalYield.toFixed(1)}% to shareholders annually: ${dividendYieldPct.toFixed(1)}% dividends + ${buybackYield.toFixed(1)}% buybacks${debtPaydownYield > 0 ? ` + ${debtPaydownYield.toFixed(1)}% debt paydown` : ''}. This ${yieldVsTreasury > 0 ? 'exceeds' : 'trails'} the 10-year Treasury yield of 4.3% by ${Math.abs(yieldVsTreasury).toFixed(1)} percentage points${returnCoverage !== null && returnCoverage >= 1.5 ? ', and is well-covered by free cash flow' : ''}.`;
  } else if (category === "strong_returner") {
    summary = `${companyName} delivers a solid ${totalYield.toFixed(1)}% total shareholder yield, primarily through ${buybackYield > dividendYieldPct ? 'share buybacks' : 'dividends'}. ${returnCoverage !== null && returnCoverage >= 1.2 ? 'FCF comfortably covers these returns.' : 'Monitor FCF coverage as returns consume a significant portion of cash generation.'}`;
  } else if (category === "moderate_returner") {
    summary = `${companyName} returns a moderate ${totalYield.toFixed(1)}% to shareholders. The yield is ${buybackYield > dividendYieldPct ? 'predominantly through buybacks' : 'dividend-focused'}. ${returnCoverage !== null && returnCoverage >= 1.0 ? 'FCF coverage is adequate.' : 'Coverage may be tight — monitor sustainability.'}`;
  } else if (category === "minimal_returner") {
    summary = `${companyName} returns minimal cash to shareholders (${totalYield.toFixed(1)}% yield). ${buybackYield > dividendYieldPct ? 'Buybacks are the primary return mechanism.' : 'Dividends are the primary return mechanism.'}${buybackEstimated && buybackYield > 0 ? ' (buybacks estimated).' : ''}`;
  } else {
    summary = `${companyName} returns minimal cash to shareholders (${totalYield.toFixed(1)}% yield), instead reinvesting in growth. ${roicSpread > 10 ? `Given the strong ${roicSpread.toFixed(0)}% ROIC spread, this reinvestment strategy is creating significant value.` : 'The effectiveness of this reinvestment depends on maintaining returns above cost of capital.'}`;
  }
  
  return {
    dividendYield: parseFloat(dividendYieldPct.toFixed(2)),
    buybackYield: parseFloat(buybackYield.toFixed(2)),
    debtPaydownYield: parseFloat(debtPaydownYield.toFixed(2)),
    debtIncreaseYield: parseFloat(debtIncreaseYield.toFixed(2)),
    totalYield: parseFloat(totalYield.toFixed(2)),
    netYield: parseFloat(netYield.toFixed(2)),
    dividendAmount: annualDividendAmount,
    buybackAmount: buybackAmount,
    debtPaydownAmount: debtPaydownAmount,
    debtIncreaseAmount: debtIncreaseAmount,
    totalReturnAmount: totalReturnAmount,
    category,
    yieldVsTreasury: parseFloat(yieldVsTreasury.toFixed(2)),
    returnCoverage: returnCoverage !== null ? parseFloat(returnCoverage.toFixed(2)) : null,
    qualityScore: yieldScore,
    qualityScoreRaw: rawQualityScore,
    qualityScoreCapped: rawQualityScore !== yieldScore,
    qualityComponents: {
      yieldLevel: { score: yieldLevelScore, maxScore: 25, detail: `${totalYield.toFixed(1)}% total yield` },
      sustainability: { 
        score: sustainabilityScore, 
        maxScore: 25, 
        detail: returnCoverage !== null ? `${returnCoverage.toFixed(1)}x FCF coverage` : "Unable to calculate"
      },
      buybackEffectiveness: { 
        score: buybackEffectivenessScore, 
        maxScore: 25, 
        detail: buybackYield > 0.5 
          ? (marginOfSafety < 0 ? `Buying at ${Math.abs(marginOfSafety).toFixed(0)}% discount to IV` : `Buying at ${marginOfSafety.toFixed(0)}% premium to IV`)
          : "No significant buybacks"
      },
      dividendGrowth: {
        score: dividendGrowthScore,
        maxScore: 25,
        detail: dividendYieldPct > 0 
          ? `${payoutPct.toFixed(0)}% payout ratio — ${payoutPct < 40 ? 'significant room to grow' : payoutPct < 60 ? 'moderate growth potential' : 'limited growth potential'}`
          : roicSpread > 10 ? `High ${roicSpread.toFixed(0)}% ROIC spread justifies reinvestment` : "No dividend"
      }
    },
    flags,
    buybackEstimated,
    debtPaydownEstimated,
    netDilution: netDilution > 0 ? netDilution : 0,
    summary
  };
}

// =====================================================================
// COMPOSITE SCORE
// =====================================================================

function calcComposite({
  buffettChecklist,
  moatAnalysis,
  intrinsicValue,
  roicTree,
  earningsQuality,
  entryTiming,
  totalShareholderYield,
  growthConstraints,
  aiDisruption,
  fundamentals,
  price
}) {
  const components = [];
  
  // 1. BUFFETT QUALITY (already 0-100)
  const buffettScore = safeNum(buffettChecklist?.total, null);
  if (buffettScore != null) {
    components.push({ name: "Quality", score: Math.max(0, Math.min(100, buffettScore)), weight: 0.20, source: "buffettChecklist" });
  }
  
  // 2. MOAT DURABILITY (already 0-100)
  const moatScore = safeNum(moatAnalysis?.moat_score, null);
  if (moatScore != null) {
    components.push({ name: "Moat", score: Math.max(0, Math.min(100, moatScore)), weight: 0.15, source: "moat" });
  }
  
  // 3. VALUATION ATTRACTIVENESS
  let valuationScore = null;
  const marginOfSafety = parseFloat(intrinsicValue?.undervaluation) || 0;
  
  let mosPoints = 0;
  if (marginOfSafety >= 30) mosPoints = 35;
  else if (marginOfSafety >= 20) mosPoints = 30;
  else if (marginOfSafety >= 10) mosPoints = 25;
  else if (marginOfSafety >= 0) mosPoints = 18;
  else if (marginOfSafety >= -10) mosPoints = 12;
  else if (marginOfSafety >= -25) mosPoints = 6;
  else if (marginOfSafety >= -50) mosPoints = 3;
  else mosPoints = 0;
  
  let dcfPoints = 0;
  const dcfUpside = (parseFloat(intrinsicValue?.dcfUpside) || 0) * 100;
  if (dcfUpside >= 30) dcfPoints = 30;
  else if (dcfUpside >= 15) dcfPoints = 25;
  else if (dcfUpside >= 5) dcfPoints = 20;
  else if (dcfUpside >= 0) dcfPoints = 15;
  else if (dcfUpside >= -15) dcfPoints = 10;
  else if (dcfUpside >= -30) dcfPoints = 5;
  else dcfPoints = 0;
  
  valuationScore = mosPoints + dcfPoints;
  valuationScore = Math.max(0, Math.min(100, valuationScore));
  
  components.push({ name: "Valuation", score: valuationScore, weight: 0.20, source: "calculated" });
  
  // 4. ROIC SPREAD
  const spread = safeNum(roicTree?.spread, 0);
  let roicScore = 0;
  if (spread >= 25) roicScore = 100;
  else if (spread >= 20) roicScore = 90;
  else if (spread >= 15) roicScore = 80;
  else if (spread >= 10) roicScore = 70;
  else if (spread >= 5) roicScore = 55;
  else if (spread >= 2) roicScore = 40;
  else if (spread >= 0) roicScore = 25;
  else roicScore = Math.max(0, 25 + spread * 5);
  
  components.push({ name: "ROIC", score: roicScore, weight: 0.10, source: "roicTree" });
  
  // 5. EARNINGS QUALITY
  const eqScore = safeNum(earningsQuality?.score, null);
  if (eqScore != null) {
    components.push({ name: "Earnings Quality", score: Math.max(0, Math.min(100, eqScore)), weight: 0.10, source: "earningsQuality" });
  }
  
  // 6. MOMENTUM & TIMING
  const entryTotal = safeNum(entryTiming?.total, 0);
  const entryPts = (entryTotal / 17) * 50;
  
  const distFromHigh = Math.abs(safeNum(entryTiming?.distance, 0));
  let techPts = 0;
  if (distFromHigh <= 5) techPts = 15;
  else if (distFromHigh <= 15) techPts = 30;
  else if (distFromHigh <= 25) techPts = 50;
  else if (distFromHigh <= 40) techPts = 40;
  else techPts = 20;
  
  const maDist = safeNum(entryTiming?.maDistance, 0);
  if (maDist > 0) {
    if (maDist <= 10) techPts += 15;
    else if (maDist <= 30) techPts += 5;
  } else {
    if (Math.abs(maDist) <= 10) techPts += 20;
    else techPts += 10;
  }
  
  const momentumScore = Math.min(100, entryPts + techPts);
  components.push({ name: "Momentum", score: momentumScore, weight: 0.10, source: "calculated" });
  
  // 7. TOTAL SHAREHOLDER YIELD
  const tsyYield = safeNum(totalShareholderYield?.totalYield, 0);
  let tsyScore = 0;
  if (tsyYield >= 8) tsyScore = 100;
  else if (tsyYield >= 6) tsyScore = 85;
  else if (tsyYield >= 4) tsyScore = 70;
  else if (tsyYield >= 3) tsyScore = 55;
  else if (tsyYield >= 2) tsyScore = 40;
  else if (tsyYield >= 1) tsyScore = 25;
  else if (tsyYield >= 0.5) tsyScore = 15;
  else tsyScore = 5;
  
  const fcfCoverage = safeNum(totalShareholderYield?.returnCoverage, null);
  if (fcfCoverage !== null) {
    if (fcfCoverage < 0.8) tsyScore = tsyScore * 0.6;
    else if (fcfCoverage < 1.0) tsyScore = tsyScore * 0.8;
  }
  
  components.push({ name: "Shareholder Yield", score: tsyScore, weight: 0.05, source: "totalShareholderYield" });
  
  // 8. QUALITY FLOOR (extra weight on business quality)
  if (buffettScore != null && moatScore != null) {
    const qualityFloor = (buffettScore + moatScore) / 2;
    components.push({ name: "Quality Floor", score: qualityFloor, weight: 0.10, source: "calculated" });
  }
  
  // Renormalize weights if some components missing
  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  if (Math.abs(totalWeight - 1.0) > 0.01) {
    const scale = 1.0 / totalWeight;
    components.forEach(c => c.adjustedWeight = c.weight * scale);
  }
  
  // Calculate weighted contributions
  components.forEach(c => {
    c.weighted = c.score * (c.adjustedWeight || c.weight);
  });
  
  const rawScore = components.reduce((sum, c) => sum + c.weighted, 0);
  
  // 9. CONSTRAINT PENALTIES
  let constraintPenalty = 0;
  const severity = growthConstraints?.overall_severity;
  if (severity === "critical") constraintPenalty = -10;
  else if (severity === "high") constraintPenalty = -7;
  else if (severity === "moderate") constraintPenalty = -3;
  
  if (entryTiming?.overextendedWarning) constraintPenalty -= 3;
  
  const aiImpact = aiDisruption?.net_impact;
  if (aiImpact === "strong_headwind") constraintPenalty -= 3;
  else if (aiImpact === "headwind") constraintPenalty -= 1;
  
  // Final composite
  let compositeScore = Math.max(0, Math.min(100, Math.round(rawScore + constraintPenalty)));
  
  // Grade and label
  let grade, label, color;
  if (compositeScore >= 80) { grade = "A"; label = "STRONG BUY"; color = "#22c55e"; }
  else if (compositeScore >= 70) { grade = "A-"; label = "BUY"; color = "#4ade80"; }
  else if (compositeScore >= 60) { grade = "B+"; label = "ACCUMULATE"; color = "#86efac"; }
  else if (compositeScore >= 55) { grade = "B"; label = "LEAN BUY"; color = "#eab308"; }
  else if (compositeScore >= 45) { grade = "C+"; label = "HOLD"; color = "#eab308"; }
  else if (compositeScore >= 35) { grade = "C"; label = "LEAN SELL"; color = "#f97316"; }
  else if (compositeScore >= 25) { grade = "D"; label = "SELL"; color = "#ef4444"; }
  else { grade = "F"; label = "STRONG SELL"; color = "#dc2626"; }
  
  // Safety override: extreme overvaluation should never be BUY
  if (marginOfSafety < -50) { label = "AVOID"; color = "#dc2626"; }
  else if (marginOfSafety < -25 && (label === "STRONG BUY" || label === "BUY")) { label = "HOLD"; color = "#eab308"; }
  
  // Strengths and weaknesses
  const sorted = [...components].sort((a, b) => b.score - a.score);
  const strengths = sorted.slice(0, 2).map(s => {
    let insight = "";
    if (s.name === "ROIC") insight = `Exceptional ${roicTree?.spread}% spread — reinvestment creates significant value`;
    else if (s.name === "Quality") insight = `${buffettScore}/100 Buffett checklist score — strong fundamentals`;
    else if (s.name === "Moat") insight = `${moatScore}/100 moat score — ${moatAnalysis?.moat_type} competitive moat`;
    else if (s.name === "Valuation") insight = `${marginOfSafety >= 0 ? marginOfSafety + "% undervalued" : Math.abs(marginOfSafety) + "% overvalued"} — ${valuationScore}/100 valuation score`;
    else if (s.name === "Earnings Quality") insight = `Grade ${earningsQuality?.grade} earnings — ${earningsQuality?.keyInsight?.slice(0, 50) || "strong cash backing"}`;
    else if (s.name === "Momentum") insight = `${entryTiming?.signal?.replace(/_/g, " ")} entry timing signal`;
    else if (s.name === "Shareholder Yield") insight = `${tsyYield}% total yield — ${totalShareholderYield?.category?.replace(/_/g, " ")}`;
    else if (s.name === "Quality Floor") insight = `Combined quality indicator at ${s.score}/100`;
    return { name: s.name, score: s.score, insight };
  });
  
  const weaknesses = sorted.slice(-2).map(s => {
    let insight = "";
    if (s.name === "Valuation") insight = `Trading at ${Math.abs(marginOfSafety)}% ${marginOfSafety < 0 ? "premium" : "discount"} to intrinsic value`;
    else if (s.name === "ROIC") insight = `${roicTree?.spread}% spread — ROIC near or below cost of capital`;
    else if (s.name === "Momentum") insight = `${entryTiming?.signal?.replace(/_/g, " ")} — ${entryTiming?.overextendedWarning || "weak technical setup"}`;
    else if (s.name === "Shareholder Yield") insight = `${tsyYield}% total yield — ${tsyYield < 1 ? "minimal" : "moderate"} capital return`;
    else insight = `Score of ${s.score}/100 indicates room for improvement`;
    return { name: s.name, score: s.score, insight };
  });
  
  // Narrative
  let narrative = `Strongest attributes: ${strengths[0]?.name} (${strengths[0]?.score}/100) and ${strengths[1]?.name} (${strengths[1]?.score}/100). `;
  narrative += `Key concerns: ${weaknesses[0]?.name} (${weaknesses[0]?.score}/100) and ${weaknesses[1]?.name} (${weaknesses[1]?.score}/100). `;
  
  if (valuationScore > 70) narrative += "Attractive valuation provides margin of safety. ";
  else if (valuationScore < 30) narrative += "Rich valuation limits upside and increases risk. ";
  
  if (momentumScore > 70) narrative += "Positive technical momentum supports entry timing.";
  else if (momentumScore < 30) narrative += "Weak momentum suggests waiting for a better entry point.";
  
  // Catalysts
  const catalysts = {};
  if (valuationScore < 50) {
    const priceTarget = price * (1 - marginOfSafety / 100);
    catalysts.toReachBuy = `A ${Math.abs(Math.round(marginOfSafety * 0.5))}% price decline would push valuation score above 50, likely raising composite to 65+.`;
  }
  if (compositeScore < 70 && marginOfSafety < 0) {
    catalysts.toReachStrongBuy = `Would need price to decline to ~$${Math.max(1, Math.round(price * 0.7))} for significant margin of safety while maintaining quality scores.`;
  }
  
  return {
    score: compositeScore,
    grade,
    label,
    color,
    components: components.map(c => ({
      name: c.name,
      score: c.score,
      weight: Math.round((c.adjustedWeight || c.weight) * 100),
      weighted: parseFloat(c.weighted.toFixed(1))
    })),
    constraintPenalty,
    rawScore: parseFloat(rawScore.toFixed(1)),
    finalScore: compositeScore,
    strengths,
    weaknesses,
    narrative,
    catalysts,
    marginOfSafety: parseFloat(marginOfSafety.toFixed(1)),
    valuationScore
  };
}

// =====================================================================
// EXPORTS
// =====================================================================

export {
  // Industry maps
  VERY_HIGH_SWITCHING, HIGH_SWITCHING, MODERATE_SWITCHING,
  STRONG_NETWORK, MODERATE_NETWORK,
  HIGH_RD, MODERATE_RD,
  HIGH_BARRIER, MODERATE_BARRIER,
  SCALE_ADVANTAGE,
  AI_THREAT_SEVERE, AI_THREAT_HIGH, AI_THREAT_MODERATE,
  AI_OPP_MASSIVE, AI_OPP_SIGNIFICANT, AI_OPP_MODERATE,
  SECTOR_RISK,
  
  // Helper functions
  safeNum, matchIndustry, billions,
  
  // Scoring functions
  calcSupplySideEconomies,
  calcNetworkEffects,
  calcLearningCurve,
  calcSwitchingCosts,
  calcMoatAnalysis,
  calcAIDisruption,
  calcROICSensitivity,
  calcProfitabilityPath,
  calcGrowthConstraints,
  calcEarningsQuality,
  calcTotalShareholderYield,
  calcComposite,

  // Peer comparison functions
  PEER_MAP, INDUSTRY_TICKERS, SECTOR_FALLBACKS,
  getPeers,
  calculatePeerStats,
  calculatePercentile,
  getVerdictLabel,
  calculateComps,
  generateMetricExplanation,
  generateSummary,
  calculateImpliedFairValue
};
