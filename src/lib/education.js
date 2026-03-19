// Educational content for InfoTip system
// Each entry has a title and content (plain-English explanation)

export const EDUCATION = {
  // === COMPOSITE SCORE ===
  compositeScore: {
    title: "Composite Score",
    content: "The composite score combines every analysis signal into one number (0-100). It weights: Quality (20%) — Buffett checklist fundamentals. Moat (15%) — competitive advantage durability. Valuation (20%) — is the price right? ROIC (10%) — value creation from reinvestment. Earnings Quality (10%) — are earnings real and sustainable? Momentum (10%) — technical timing. Shareholder Yield (5%) — capital return to owners. Quality Floor (10%) — extra weight on business quality. Constraints apply a penalty of up to -10 points for severe growth limitations."
  },

  // === OVERVIEW TAB ===
  buffettChecklist: {
    title: "Buffett Checklist",
    content: "Warren Buffett's investment framework distilled into 6 measurable criteria. A score of 75+ indicates a business Buffett would likely consider owning. The checklist emphasizes quality of the business (moat, simplicity, management) alongside valuation (owner earnings yield, margin of safety). A high-quality business at a fair price beats a fair business at a great price."
  },
  ownerEarningsYield: {
    title: "Owner Earnings Yield",
    content: "Buffett's preferred measure of what a business actually earns for its owners. It equals net income plus depreciation minus capital expenditures — the cash left over after maintaining the business. We divide this by market cap to get a yield, then compare it to the 'risk-free' 10-year Treasury rate (~4.3%). If the owner earnings yield is higher than the Treasury, you're being compensated for the risk of owning the stock. 2x the Treasury rate is excellent."
  },
  marginOfSafety: {
    title: "Margin of Safety",
    content: "Benjamin Graham's most important concept: only buy when the price is significantly below your estimate of intrinsic value. The gap between intrinsic value and market price is your 'margin of safety' — your buffer against being wrong. A 15-25% margin is generally considered adequate. Negative means the stock trades above estimated intrinsic value (overvalued)."
  },
  earningsConsistency: {
    title: "Earnings Consistency",
    content: "Buffett prefers companies with predictable, steadily growing earnings. We check 4 signals: Is forward EPS above trailing? Are operating margins positive? Are net margins positive? Is the PEG ratio reasonable (between 0 and 2)? Companies with all 4 positive have the earnings consistency Buffett looks for."
  },
  managementQuality: {
    title: "Management Quality",
    content: "Good managers allocate capital wisely: they earn high returns on equity (ROE > 15%), buy back shares when undervalued, maintain reasonable payout ratios, and own meaningful stakes in the company. We can't measure integrity from numbers alone, but these financial fingerprints correlate with skilled, aligned management."
  },
  businessSimplicity: {
    title: "Business Simplicity",
    content: "Buffett avoids businesses he doesn't understand. We use gross margin as a proxy — companies with high gross margins (> 40%) typically have straightforward value propositions and pricing power. A consumer staple with 60% margins is 'simpler' than a commodity producer with 10% margins, because the product's value is clearer and more defensible."
  },
  durableAdvantage: {
    title: "Durable Competitive Advantage",
    content: "The most important question: will this company still be dominant in 10 years? We look for three simultaneous signals — ROE above 15%, operating margin above 15%, and gross margin above 40%. Having all three suggests structural advantages that competitors can't easily erode. Having none suggests a commodity business."
  },
  entryTiming: {
    title: "Entry Timing",
    content: "Even great businesses can be bad investments at the wrong price. Entry timing combines technical signals (how far below the 52-week high, position relative to 200-day moving average) with valuation signals (margin of safety, forward P/E). A high score means the stock is both fundamentally attractive and technically at a good entry point. This is about timing the purchase, not timing the market."
  },
  intrinsicValue: {
    title: "Intrinsic Value",
    content: "The estimated 'true worth' of the business, independent of its stock price. We calculate three estimates and take the median: EPV (Earnings Power Value — what the current earnings stream is worth), FCF method (free cash flow divided by required return), and an earnings multiple method. No single method is perfect, which is why we triangulate. The gap between intrinsic value and market price is your margin of safety."
  },
  earningsQuality: {
    title: "Earnings Quality",
    content: "Not all earnings are equal. A company can report $10 in earnings per share while generating only $4 in actual cash — the gap is 'accruals' (accounting entries that aren't yet cash). Historically, companies with high accruals underperform because the earnings eventually disappoint. This score measures how 'real' the earnings are by checking cash flow backing, stability, revenue quality, and capital allocation discipline. Grade A means earnings are trustworthy; Grade F means proceed with extreme caution."
  },
  accrualRatio: {
    title: "Accrual Ratio",
    content: "The gap between reported earnings and actual cash flow, as a percentage of earnings. NEGATIVE is good — it means cash flow EXCEEDS reported earnings (conservative accounting). POSITIVE means earnings exceed cash flow — the company is recognizing revenue or deferring costs in ways that flatter the income statement. The Sloan Accrual Anomaly, published in 1996, found that companies with high accruals consistently underperform. This is one of the most persistent signals in finance."
  },
  fcfConversion: {
    title: "FCF Conversion",
    content: "What percentage of net income becomes free cash flow (cash from operations minus capital expenditures)? Over 100% means the company generates MORE cash than it reports in profits — typical of capital-light businesses like software companies. Below 50% means significant cash is being consumed by capex or working capital, so the 'profits' aren't really available to shareholders."
  },
  earningsStability: {
    title: "Earnings Stability",
    content: "Volatile earnings are harder to predict and more likely to disappoint. We measure stability through EPS growth consistency (is growth steady or erratic?), stock beta (lower beta = more stable business), and margin levels (high margins = pricing power = stable earnings). A utility company scores higher here than a biotech."
  },
  revenueQuality: {
    title: "Revenue Quality",
    content: "High-quality revenue comes from repeat customers paying for something they need, with margins expanding as the company grows. Low-quality revenue comes from one-time sales, discounting to win deals, or acquisitions that temporarily inflate the top line. We check: are margins high (suggesting sticky revenue)? Are earnings growing faster than revenue (margin expansion)? Is ROE in a sustainable range?"
  },
  capitalAllocation: {
    title: "Capital Allocation Quality",
    content: "The CEO's most important job is deciding where to invest the company's cash. Good allocators invest at returns above their cost of capital (positive ROIC spread), return excess cash to shareholders through buybacks and dividends, and maintain conservative debt levels. A 20% ROIC on 9% WACC means every dollar reinvested creates $0.11 of value. A 5% ROIC on 10% WACC destroys value."
  },

  // === MOAT TAB ===
  economicMoat: {
    title: "Economic Moat",
    content: "An economic moat is a structural competitive advantage that protects a company's profits from competition — like a castle's moat protects against invaders. Companies with wide moats can sustain high returns on capital for decades. We evaluate four sources of moats: supply-side economies of scale, demand-side economies of scale (network effects), learning curve advantages, and switching costs. A wide moat (score 70+) means multiple strong advantages; narrow (45+) means some protection; none means competitors can easily enter."
  },
  supplySide: {
    title: "Supply-Side Economies of Scale",
    content: "As a company grows, its cost per unit decreases because fixed costs (R&D, headquarters, technology) are spread over more revenue. We measure this by comparing revenue growth to cost growth — if revenue grows faster than costs, the company has scale advantages. Expanding margins over time confirm this. Walmart and Amazon benefit enormously from supply-side scale. The key question: does getting bigger make the company more efficient?"
  },
  networkEffects: {
    title: "Demand-Side Economies of Scale",
    content: "Network effects exist when a product becomes more valuable as more people use it. Visa's payment network is more useful to merchants because 4 billion cards are in circulation, and more useful to cardholders because millions of merchants accept it. This creates a virtuous cycle that's nearly impossible for competitors to break. Social networks, marketplaces, and payment systems have the strongest network effects. Most physical products (cars, clothing) have none."
  },
  learningCurve: {
    title: "Learning Curve / Accumulated Advantage",
    content: "Some companies have built something over decades that a new competitor simply cannot replicate quickly — cumulative R&D (pharmaceutical patents), operational expertise (semiconductor manufacturing), regulatory approvals (banking licenses), or massive datasets. Intel spent 50+ years refining chip fabrication. A startup can't shortcut that. We measure this through R&D intensity, regulatory barriers, sustained margin levels, and sheer scale."
  },
  switchingCosts: {
    title: "High Switching Costs",
    content: "Switching costs are the pain (time, money, disruption) a customer faces when moving to a competitor. Enterprise software has extremely high switching costs — migrating from SAP requires years of work. Bank accounts have moderate switching costs — it's annoying but possible. Restaurants have zero switching costs — you just eat somewhere else. High switching costs let companies maintain pricing power because customers would rather pay more than endure the switch."
  },
  aiDisruption: {
    title: "AI Disruption Assessment",
    content: "Every company will be affected by AI — some positively, some negatively. We assess two dimensions: THREAT (can AI automate or replace what this company does?) and OPPORTUNITY (can AI create new revenue or reduce costs for this company?). A semiconductor company has high opportunity (selling AI chips) and moderate threat (AI could automate chip design). A staffing agency has severe threat (AI replaces hiring) and minimal opportunity. The NET IMPACT tells you whether AI is a tailwind or headwind."
  },

  // === ROIC TAB ===
  roic: {
    title: "Return on Invested Capital",
    content: "ROIC measures how much profit a company generates for every dollar of capital invested in the business. It decomposes into NOPAT Margin (how much profit per dollar of revenue, after tax) × Asset Turnover (how much revenue per dollar of invested capital). A high-ROIC company is a money machine — it's either very profitable per sale OR very efficient with its assets, or both. The WACC (Weighted Average Cost of Capital) is the minimum return investors require. ROIC above WACC = value creation. Below = value destruction."
  },
  nopatMargin: {
    title: "NOPAT Margin",
    content: "Net Operating Profit After Tax as a percentage of revenue. This is how much of every dollar of revenue becomes actual profit after paying operating costs and taxes (but before interest on debt). A 25% NOPAT margin means the company keeps $0.25 of every $1 in revenue. Software companies often have 25-35% NOPAT margins. Retailers might have 3-5%. Higher is better, but compare within industries."
  },
  assetTurnover: {
    title: "Asset Turnover",
    content: "Revenue divided by invested capital — how efficiently the company uses its assets to generate sales. A turnover of 2.0x means the company generates $2 of revenue for every $1 of capital deployed. Retail businesses have high turnover (lots of sales, thin margins). Software companies have lower turnover but higher margins. ROIC = margin × turnover, so a company can achieve high ROIC through either path."
  },
  roicSpread: {
    title: "ROIC Spread",
    content: "ROIC minus WACC — the single most important number for value creation. Positive spread means every dollar reinvested creates value. Negative spread means the company is destroying shareholder wealth with every investment. A 20%+ spread is exceptional. 10%+ is strong. 0-5% is barely covering costs. Negative means the company would create more value by returning all capital to shareholders instead of reinvesting."
  },
  sensitivityLevers: {
    title: "ROIC Sensitivity Levers",
    content: "We test four hypothetical improvements and measure which one moves ROIC the most: gross margin expansion (+200bps), operating expense efficiency (+150bps), asset turnover improvement (+0.1x), and working capital optimization (+0.05x). The PRIMARY LEVER is the change that would have the biggest impact — this tells you where management should focus. If margin expansion is the primary lever and management is guiding for margin improvement, that's a positive signal."
  },
  profitabilityPath: {
    title: "Profitability Path",
    content: "How predictable is this company's future profitability? We score four factors: Recurring Revenue (high gross margins suggest sticky, repeatable revenue), Earnings Stability (low beta and steady margins), Margin Quality (strong operating margins), and FCF Conversion (earnings translating to real cash). A predictability score of 80+ means you can forecast this company's earnings with reasonable confidence. Below 40 means earnings could swing dramatically."
  },

  // === DCF TAB ===
  dcf: {
    title: "Discounted Cash Flow",
    content: "DCF is the fundamental valuation method: a company is worth the sum of all future cash flows it will generate, discounted back to today. We project 10 years of free cash flow, then add a 'terminal value' for everything beyond year 10. The discount rate (WACC) reflects the risk — higher risk = higher discount = lower present value. DCF is powerful but sensitive to assumptions — a small change in growth rate or WACC can swing the valuation 30%+. Use the sensitivity table to understand the range."
  },
  wacc: {
    title: "Weighted Average Cost of Capital",
    content: "WACC is the blended return that debt and equity investors require to fund the company. It combines the Cost of Equity (what stock investors expect, calculated using the Capital Asset Pricing Model — risk-free rate + beta × equity risk premium) and the Cost of Debt (interest rate on borrowings, tax-adjusted). A lower WACC means the company is perceived as less risky, which makes future cash flows worth more today. Apple's WACC (~9.5%) is lower than a startup's (~15%) because Apple is far less risky."
  },
  terminalValue: {
    title: "Terminal Value",
    content: "We can't project cash flows forever, so after year 10 we calculate a 'terminal value' — what the company is worth assuming it grows at a constant rate forever (the terminal growth rate, typically 2-3% = nominal GDP). The terminal value often represents 50-70% of total DCF value, which is why the terminal growth rate is so important. If terminal value exceeds 75%, the model is telling you: 'most of the value depends on what happens after year 10' — which is inherently uncertain."
  },
  phaseGrowth: {
    title: "Two-Phase Growth",
    content: "Most companies grow fast initially and slow down as they mature. Phase 1 (years 1-5) uses near-term growth estimates from analyst data or trailing performance. Phase 2 (years 6-10) fades growth down toward the long-term terminal rate. This S-curve deceleration reflects reality — no company grows at 20% forever. The growth rate is the single most impactful assumption in the model."
  },
  sensitivityTable: {
    title: "Sensitivity Analysis",
    content: "Because DCF is only as good as its assumptions, the sensitivity table shows what the stock would be worth under different WACC and terminal growth combinations. Each cell is a different 'scenario.' The highlighted cell shows your current assumptions. The cell closest to the current stock price tells you what the MARKET is implicitly assuming — which is often the most valuable insight."
  },
  reverseDCF: {
    title: "Reverse DCF",
    content: "Instead of asking 'what is this stock worth?', reverse DCF asks 'what is the market ALREADY pricing in?' We take today's stock price as given and solve backwards for the growth rate, FCF margin, or discount rate that would justify that price. This tells you exactly what bet you're making by buying at the current price. If the implied growth rate is 25% and the company has never grown above 15%, the market is pricing in acceleration that may not materialize."
  },
  fcfMargin: {
    title: "FCF Margin",
    content: "Free cash flow as a percentage of revenue. This tells you how much of each dollar of revenue actually becomes cash that can be returned to shareholders or reinvested. Software companies often have 25-35% FCF margins (high margins, low capex). Retailers might have 3-5% (thin margins, heavy capex for stores). Higher FCF margins mean more flexibility — the company can return more cash to shareholders, pay down debt, or weather economic downturns."
  },
  growthRate: {
    title: "Revenue Growth Rate",
    content: "The annual rate at which the company's revenue is growing. We use a combination of trailing growth from financial statements and analyst estimates. Growth rates fade over time as the company matures — a company growing 30% at $1B in revenue won't sustain that at $100B. We apply size-based caps: large companies (>200B) are capped at 15% because sheer size makes high growth difficult."
  },

  // === COMPS TAB ===
  comps: {
    title: "Peer Comparables",
    content: "The market prices stocks relatively, not absolutely. A stock at 30x earnings might be cheap if its peers trade at 50x, or expensive if peers trade at 20x. Comparable analysis compares the target stock's valuation multiples against a group of similar companies. The percentile tells you where the stock ranks — low percentile = cheaper than most peers (potentially undervalued), high percentile = more expensive (potentially overvalued or higher quality)."
  },
  trailingPE: {
    title: "Trailing P/E Ratio",
    content: "The most common valuation metric: stock price divided by earnings per share over the past 12 months. A P/E of 25x means investors pay $25 for every $1 of annual earnings. Higher P/E can mean the stock is expensive OR that investors expect fast growth. Lower P/E can mean it's cheap OR that growth is slowing. Always compare P/E within the same industry — tech companies typically trade at higher P/E than banks because they grow faster."
  },
  forwardPE: {
    title: "Forward P/E",
    content: "Price divided by NEXT year's estimated earnings. More useful than trailing P/E because stocks are priced on future expectations, not past results. A stock with high trailing P/E but low forward P/E is expected to grow earnings significantly. If the forward P/E is much lower than trailing P/E, the market is expecting earnings acceleration."
  },
  pegRatio: {
    title: "PEG Ratio",
    content: "P/E divided by earnings growth rate. Normalizes valuation for growth speed. PEG of 1.0 means you're paying a 'fair' price for the growth. Below 1.0 suggests you're getting growth cheaply. Above 2.0 suggests you're overpaying for the growth rate. Peter Lynch popularized this metric as a quick value screen. Note: PEG works best for growing companies, not mature or cyclical businesses."
  },
  evToEbitda: {
    title: "Enterprise Value to EBITDA",
    content: "Enterprise Value (market cap + debt - cash) divided by EBITDA (earnings before interest, taxes, depreciation, amortization). Often preferred over P/E because it's capital-structure neutral — it doesn't matter if a company is funded with debt or equity. Useful for comparing companies with different leverage. A lower ratio indicates better value. EV/EBITDA of 10x means it would take 10 years of EBITDA to pay back the enterprise value."
  },
  priceToSales: {
    title: "Price-to-Sales Ratio",
    content: "Stock price divided by revenue per share. Useful for companies that aren't yet profitable (like early-stage tech or biotech). A P/S of 10x means investors pay $10 for every $1 of annual revenue. Lower is generally cheaper, but must compare within industries — software companies trade at much higher P/S than retailers because software has higher margins."
  },
  priceToBook: {
    title: "Price-to-Book Ratio",
    content: "Stock price divided by book value per share (assets minus liabilities). Represents what investors pay for $1 of net assets. P/B of 1x means the stock trades at book value. P/B above 3-4x suggests investors are paying a premium for intangible value (brand, technology, growth). P/B below 1x could indicate undervaluation or problems. Note: companies with heavy buybacks can have depleted book value even when healthy — we exclude P/B in these cases."
  },
  impliedFairValue: {
    title: "Comps-Implied Fair Value",
    content: "What this stock would be worth if it traded at the same multiples as its peers. We calculate an implied price from each metric (P/E, EV/EBITDA, P/S, etc.) using peer median multiples, then take the median of all methods. The gap between implied value and current price tells you how much the market's premium or discount is versus the peer group. If implied FV is $150 and stock is $200, it's trading 33% above peer-implied value."
  },
  relativeValueScore: {
    title: "Relative Value Score",
    content: "A composite score (0-100) that summarizes how the stock compares to peers across all valuation metrics. 50 = average valuation. Above 55 = cheap relative to peers. Below 45 = expensive. This score is useful for comparing stocks within a sector — a 60 on relative value means it's cheaper than 60% of peers."
  },

  // === TSY ===
  totalShareholderYield: {
    title: "Total Shareholder Yield",
    content: "Total Shareholder Yield measures ALL the ways a company returns cash to you as a shareholder: dividends (direct cash payments), share buybacks (reducing share count so your ownership percentage grows), and debt paydown (reducing risk and increasing equity value). Dividend yield alone misses 60-70% of the picture for many companies. Apple's dividend yield is 0.5%, but its total return to shareholders is ~4.5% when buybacks are included."
  },
  tsyDividends: {
    title: "Dividend Yield",
    content: "Cash payments made directly to shareholders, typically quarterly. Dividend yield = annual dividend per share ÷ stock price. Dividends are the most visible form of return but often the smallest for growth companies. Mature companies like utilities and staples tend to have higher dividend yields."
  },
  tsyBuybacks: {
    title: "Share Buybacks",
    content: "When a company repurchases its own shares, the remaining shares each represent a larger ownership percentage. If a company buys back 3% of its shares annually, your ownership grows by 3% even if you don't buy more stock. Buybacks are tax-advantaged vs dividends (you only pay tax when you sell) and are now the dominant form of capital return for large US companies."
  },
  tsyDebtPaydown: {
    title: "Debt Paydown",
    content: "Reducing debt increases the equity value of the company and lowers financial risk. While less visible than dividends, debt paydown directly benefits shareholders by reducing interest expense (increasing future earnings) and reducing bankruptcy risk (increasing the appropriate valuation multiple)."
  },
  tsyFcfCoverage: {
    title: "FCF Coverage",
    content: "How many times free cash flow covers total shareholder returns. Coverage above 1.5x means the company can comfortably sustain its return program. Below 1.0x means it's returning more than it generates — potentially borrowing or spending cash reserves to fund returns, which is unsustainable long-term."
  },

  // === RISKS TAB ===
  growthConstraints: {
    title: "Growth Constraints",
    content: "Every company faces limits on how fast it can grow. We evaluate six categories: Valuation (is the stock priced for perfection?), Debt (does leverage limit flexibility?), Growth Deceleration (is growth slowing?), Sector Risk (industry-specific headwinds), Concentration (revenue dependency), and Margin Pressure (competitive pressure on profits). High overall constraint severity means the stock needs everything to go right. The 'bull milestone' shows what would need to happen for the stock to re-rate higher; 'bear risk' shows what could go wrong."
  },
  valuationConstraint: {
    title: "Valuation Constraint",
    content: "If a stock trades at 40x forward earnings, the market is pricing in significant future growth. This leaves little room for error — any disappointment leads to multiple compression. High P/E with slowing growth is a dangerous combination. The mitigation: if forward earnings are growing faster than trailing, the valuation may be justified by future growth."
  },
  debtConstraint: {
    title: "Debt Level Constraint",
    content: "High debt constrains flexibility — the company must service debt payments regardless of business conditions. In a downturn, high-debt companies may be forced to cut dividends, sell assets, or raise capital at bad prices. The mitigation: if the company has strong cash flow and a current ratio above 1.5, it can service its debt even in tough times."
  },
  sectorRisk: {
    title: "Sector Risk",
    content: "Every industry has structural headwinds or tailwinds. Technology faces rapid innovation risk. Healthcare faces regulatory risk. Energy faces commodity price volatility. We assess whether the company's sector has high, moderate, or low structural challenges. A wide moat (from the Moat tab) can mitigate sector risk — strong competitive advantages protect against industry headwinds."
  },
  marginPressure: {
    title: "Margin Pressure Risk",
    content: "If gross margins are thin (below 30%) or operating margins are low (below 10%), there's little room for error. Competitors can undercut prices, input costs can rise, or demand can soften — any of these could push the company into losses. The mitigation: if margins are expanding over time, the company is gaining pricing power. If contracting, the moat may be eroding."
  }
};
