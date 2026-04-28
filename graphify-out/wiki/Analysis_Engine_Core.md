# Analysis Engine Core

> 12 nodes · cohesion 0.27

## Key Concepts

- **GET /api/analysis/:ticker Endpoint** (15 connections) — `server.js`
- **analysis-engine.js Module** (10 connections) — `server.js`
- **calcAIDisruption (imported from analysis-engine)** (2 connections) — `server.js`
- **calcMoatAnalysis (imported from analysis-engine)** (2 connections) — `server.js`
- **calcComposite (imported from analysis-engine)** (2 connections) — `server.js`
- **calcEarningsQuality (imported from analysis-engine)** (2 connections) — `server.js`
- **calcGrowthConstraints (imported from analysis-engine)** (2 connections) — `server.js`
- **calcProfitabilityPath (imported from analysis-engine)** (2 connections) — `server.js`
- **calcROICSensitivity (imported from analysis-engine)** (2 connections) — `server.js`
- **calcTotalShareholderYield (imported from analysis-engine)** (2 connections) — `server.js`
- **calcEntryTiming Function** (1 connections) — `server.js`
- **NETWORK_INPUT_CACHE In-Memory Cache** (1 connections) — `server.js`

## Relationships

- No strong cross-community connections detected

## Source Files

- `server.js`

## Audit Trail

- EXTRACTED: 43 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*