# Graph Report - /Users/mochi/.claude/projects  (2026-04-17)

## Corpus Check
- 2 files · ~137,315 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 51 nodes · 66 edges · 8 communities detected
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 7 edges (avg confidence: 0.78)
- Token cost: 4,200 input · 2,800 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Analysis Engine Core|Analysis Engine Core]]
- [[_COMMUNITY_Momentum & Market Data|Momentum & Market Data]]
- [[_COMMUNITY_Buffett Quality Scoring|Buffett Quality Scoring]]
- [[_COMMUNITY_Stock Universes|Stock Universes]]
- [[_COMMUNITY_Intrinsic Value & DCF|Intrinsic Value & DCF]]
- [[_COMMUNITY_Constraint Filters|Constraint Filters]]
- [[_COMMUNITY_Comps Cache|Comps Cache]]
- [[_COMMUNITY_Filesystem Cache|Filesystem Cache]]

## God Nodes (most connected - your core abstractions)
1. `GET /api/analysis/:ticker Endpoint` - 15 edges
2. `analysis-engine.js Module` - 10 edges
3. `calcBuffettScore Function` - 7 edges
4. `calcROIC Function` - 6 edges
5. `fetchQuoteData Function` - 6 edges
6. `UNIVERSES Stock Universe Config` - 6 edges
7. `calculateDCF Function` - 4 edges
8. `GET /api/quote/:ticker Endpoint` - 4 edges
9. `GET /api/momentum/:universeId Endpoint` - 4 edges
10. `server.js - Express API Server` - 3 edges

## Surprising Connections (you probably didn't know these)
- `calcROIC Function` --conceptually_related_to--> `Buyback Adjustment for Intrinsic Value`  [INFERRED]
  server.js → server.js  _Bridges community 2 → community 4_
- `server.js - Express API Server` --references--> `analysis-engine.js Module`  [EXTRACTED]
  server.js → server.js  _Bridges community 1 → community 0_
- `analysis-engine.js Module` --implements--> `safeNum (imported from analysis-engine)`  [EXTRACTED]
  server.js → server.js  _Bridges community 0 → community 2_
- `GET /api/analysis/:ticker Endpoint` --calls--> `calcIntrinsicValue Function`  [EXTRACTED]
  server.js → server.js  _Bridges community 4 → community 0_
- `GET /api/quote/:ticker Endpoint` --calls--> `fetchQuoteData Function`  [EXTRACTED]
  server.js → server.js  _Bridges community 1 → community 2_

## Hyperedges (group relationships)
- **Full Stock Analysis Pipeline (fetch → score → verdict)** — fetchquotedata_fn, calcbufettscore_fn, calcroic_fn, calcintrinsicvalue_fn, getverdict_fn [EXTRACTED 0.95]
- **DCF Valuation Component Set (growth phases, WACC, terminal value, sensitivity)** — calculatedcf_fn, wacc_concept, sensitivity_matrix_concept, buyback_adjustment_concept [EXTRACTED 0.90]
- **Analysis Engine Imported Function Suite** — calccalcmoatanalysis_imported, calcaidisruption_imported, calcrooicsensitivity_imported, calcprofitabilitypath_imported, calcgrowthconstraints_imported, calcearningsquality_imported, calctotalshareholderyyield_imported, calccomposite_imported [EXTRACTED 1.00]

## Communities

### Community 0 - "Analysis Engine Core"
Cohesion: 0.27
Nodes (12): analysis-engine.js Module, GET /api/analysis/:ticker Endpoint, calcAIDisruption (imported from analysis-engine), calcMoatAnalysis (imported from analysis-engine), calcComposite (imported from analysis-engine), calcEarningsQuality (imported from analysis-engine), calcEntryTiming Function, calcGrowthConstraints (imported from analysis-engine) (+4 more)

### Community 1 - "Momentum & Market Data"
Cohesion: 0.18
Nodes (12): GET /api/momentum/:universeId Endpoint, calculateMomentum Function, Earnings Cache Directory (.cache/earnings/), Express Framework, fetchHistoricalData Function, fetchQuoteData Function, MOMENTUM_CACHE In-Memory Cache, Momentum Score (Risk-Adjusted) (+4 more)

### Community 2 - "Buffett Quality Scoring"
Cohesion: 0.25
Nodes (11): GET /api/quote/:ticker Endpoint, Buffett Score - Value Investing Checklist, calcBuffettScore Function, calcProfitability Function, calcROIC Function, getVerdict Function, Margin of Safety, Owner Earnings Yield Scoring (+3 more)

### Community 3 - "Stock Universes"
Cohesion: 0.29
Nodes (7): GET /api/universe/:universeId Endpoint, Dividend Aristocrats Universe, Magnificent 7 Universe, Russell Growth Universe, S&P 500 Top 50 / Full Universe, UNIVERSES Stock Universe Config, VGT (Tech ETF) Universe

### Community 4 - "Intrinsic Value & DCF"
Cohesion: 0.33
Nodes (6): Buyback Adjustment for Intrinsic Value, calcIntrinsicValue Function, calculateDCF Function, Discounted Cash Flow (DCF) Model, Intrinsic Value Calculation (EPV/FCF/Graham), DCF Sensitivity Matrix (WACC x Terminal Growth)

### Community 5 - "Constraint Filters"
Cohesion: 1.0
Nodes (1): calcConstraints Function

### Community 6 - "Comps Cache"
Cohesion: 1.0
Nodes (1): COMPS_CACHE In-Memory Cache

### Community 7 - "Filesystem Cache"
Cohesion: 1.0
Nodes (1): Cache File Directory Listing (.cache/earnings, .cache/yahoo)

## Knowledge Gaps
- **17 isolated node(s):** `Express Framework`, `calcProfitability Function`, `calcConstraints Function`, `calcEntryTiming Function`, `GET /api/universe/:universeId Endpoint` (+12 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Constraint Filters`** (1 nodes): `calcConstraints Function`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Comps Cache`** (1 nodes): `COMPS_CACHE In-Memory Cache`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Filesystem Cache`** (1 nodes): `Cache File Directory Listing (.cache/earnings, .cache/yahoo)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `GET /api/analysis/:ticker Endpoint` connect `Analysis Engine Core` to `Momentum & Market Data`, `Buffett Quality Scoring`, `Intrinsic Value & DCF`?**
  _High betweenness centrality (0.345) - this node is a cross-community bridge._
- **Why does `fetchQuoteData Function` connect `Momentum & Market Data` to `Analysis Engine Core`, `Buffett Quality Scoring`?**
  _High betweenness centrality (0.232) - this node is a cross-community bridge._
- **Why does `calcBuffettScore Function` connect `Buffett Quality Scoring` to `Analysis Engine Core`?**
  _High betweenness centrality (0.116) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `fetchQuoteData Function` (e.g. with `Earnings Cache Directory (.cache/earnings/)` and `yfNum Helper - Yahoo Finance Number Extractor`) actually correct?**
  _`fetchQuoteData Function` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Express Framework`, `calcProfitability Function`, `calcConstraints Function` to the rest of the system?**
  _17 weakly-connected nodes found - possible documentation gaps or missing edges._