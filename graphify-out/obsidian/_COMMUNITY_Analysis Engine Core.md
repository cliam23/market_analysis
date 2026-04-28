---
type: community
cohesion: 0.27
members: 12
---

# Analysis Engine Core

**Cohesion:** 0.27 - loosely connected
**Members:** 12 nodes

## Members
- [[GET apianalysisticker Endpoint]] - code - server.js
- [[NETWORK_INPUT_CACHE In-Memory Cache]] - code - server.js
- [[analysis-engine.js Module]] - code - server.js
- [[calcAIDisruption (imported from analysis-engine)]] - code - server.js
- [[calcComposite (imported from analysis-engine)]] - code - server.js
- [[calcEarningsQuality (imported from analysis-engine)]] - code - server.js
- [[calcEntryTiming Function]] - code - server.js
- [[calcGrowthConstraints (imported from analysis-engine)]] - code - server.js
- [[calcMoatAnalysis (imported from analysis-engine)]] - code - server.js
- [[calcProfitabilityPath (imported from analysis-engine)]] - code - server.js
- [[calcROICSensitivity (imported from analysis-engine)]] - code - server.js
- [[calcTotalShareholderYield (imported from analysis-engine)]] - code - server.js

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Analysis_Engine_Core
SORT file.name ASC
```

## Connections to other communities
- 4 edges to [[_COMMUNITY_Buffett Quality Scoring]]
- 2 edges to [[_COMMUNITY_Momentum & Market Data]]
- 1 edge to [[_COMMUNITY_Intrinsic Value & DCF]]

## Top bridge nodes
- [[GET apianalysisticker Endpoint]] - degree 15, connects to 3 communities
- [[analysis-engine.js Module]] - degree 10, connects to 2 communities