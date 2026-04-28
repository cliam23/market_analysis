---
type: community
cohesion: 0.25
members: 11
---

# Buffett Quality Scoring

**Cohesion:** 0.25 - loosely connected
**Members:** 11 nodes

## Members
- [[Buffett Score - Value Investing Checklist]] - code - server.js
- [[GET apiquoteticker Endpoint]] - code - server.js
- [[Margin of Safety]] - code - server.js
- [[Owner Earnings Yield Scoring]] - code - server.js
- [[ROIC - Return on Invested Capital]] - code - server.js
- [[WACC - Weighted Average Cost of Capital]] - code - server.js
- [[calcBuffettScore Function]] - code - server.js
- [[calcProfitability Function]] - code - server.js
- [[calcROIC Function]] - code - server.js
- [[getVerdict Function]] - code - server.js
- [[safeNum (imported from analysis-engine)]] - code - server.js

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Buffett_Quality_Scoring
SORT file.name ASC
```

## Connections to other communities
- 4 edges to [[_COMMUNITY_Analysis Engine Core]]
- 3 edges to [[_COMMUNITY_Intrinsic Value & DCF]]
- 1 edge to [[_COMMUNITY_Momentum & Market Data]]

## Top bridge nodes
- [[calcROIC Function]] - degree 6, connects to 2 communities
- [[calcBuffettScore Function]] - degree 7, connects to 1 community
- [[GET apiquoteticker Endpoint]] - degree 4, connects to 1 community
- [[getVerdict Function]] - degree 3, connects to 1 community
- [[WACC - Weighted Average Cost of Capital]] - degree 3, connects to 1 community