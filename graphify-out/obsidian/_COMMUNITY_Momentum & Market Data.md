---
type: community
cohesion: 0.18
members: 12
---

# Momentum & Market Data

**Cohesion:** 0.18 - loosely connected
**Members:** 12 nodes

## Members
- [[Earnings Cache Directory (.cacheearnings)]] - data - .cache/earnings/
- [[Express Framework]] - code - server.js
- [[GET apimomentumuniverseId Endpoint]] - code - server.js
- [[MOMENTUM_CACHE In-Memory Cache]] - code - server.js
- [[Momentum Score (Risk-Adjusted)]] - code - server.js
- [[Yahoo Chart Cache Directory (.cacheyahoo)]] - data - .cache/yahoo/
- [[calculateMomentum Function]] - code - server.js
- [[fetchHistoricalData Function]] - code - server.js
- [[fetchQuoteData Function]] - code - server.js
- [[server.js - Express API Server]] - code - server.js
- [[yahoo-finance2 Library]] - code - server.js
- [[yfNum Helper - Yahoo Finance Number Extractor]] - code - server.js

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Momentum_&_Market_Data
SORT file.name ASC
```

## Connections to other communities
- 2 edges to [[_COMMUNITY_Analysis Engine Core]]
- 1 edge to [[_COMMUNITY_Buffett Quality Scoring]]

## Top bridge nodes
- [[fetchQuoteData Function]] - degree 6, connects to 2 communities
- [[server.js - Express API Server]] - degree 3, connects to 1 community