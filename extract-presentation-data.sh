#!/bin/bash
# ============================================================
# MARKET ANALYSIS — PRESENTATION DATA EXTRACTION
# Run this from your project root with the server live.
# Dumps everything into presentation-data.json
# Takes ~3-4 minutes (oracle runs 48 backtests)
# Usage: bash extract-presentation-data.sh
# ============================================================

BASE="http://localhost:3001"
OUT="presentation-data.json"

echo "Extracting presentation data..."
echo "Server: $BASE"
echo "Output: $OUT"
echo ""

# ── 1. RL Agent Status ──────────────────────────────────────
echo "[1/9] RL agent status..."
RL_STATUS=$(curl -sS "$BASE/api/rl/status")

# ── 2. Backtest — Rules-based Top 50 ───────────────────────
echo "[2/9] Backtest rules-based top50..."
BT_RULES_50=$(curl -sS "$BASE/api/backtest/sp500_top50?period=3y&rebalanceFreq=bimonthly&topN=15&strategy=full_composite&rlAgent=false")

# ── 3. Backtest — RL Top 50 ─────────────────────────────────
echo "[3/9] Backtest RL top50..."
BT_RL_50=$(curl -sS "$BASE/api/backtest/sp500_top50?period=3y&rebalanceFreq=bimonthly&topN=15&strategy=full_composite&rlAgent=true")

# ── 4. Backtest — Rules-based Top 150 ───────────────────────
echo "[4/9] Backtest rules-based top150..."
BT_RULES_150=$(curl -sS "$BASE/api/backtest/sp500_top150?period=3y&rebalanceFreq=bimonthly&topN=15&strategy=full_composite&rlAgent=false")

# ── 5. Backtest — RL Top 150 ────────────────────────────────
echo "[5/9] Backtest RL top150..."
BT_RL_150=$(curl -sS "$BASE/api/backtest/sp500_top150?period=3y&rebalanceFreq=bimonthly&topN=15&strategy=full_composite&rlAgent=true")

# ── 6. Paper Portfolio Top 50 ───────────────────────────────
echo "[6/9] Paper portfolio top50..."
PAPER_50=$(curl -sS "$BASE/api/paper-trade/portfolio?universe=sp500_top50")

# ── 7. Paper Portfolio Top 150 ──────────────────────────────
echo "[7/9] Paper portfolio top150..."
PAPER_150=$(curl -sS "$BASE/api/paper-trade/portfolio?universe=sp500_top150")

# ── 8. Oracle Lower Bound ───────────────────────────────────
echo "[8/9] Oracle evaluation (takes ~2 min)..."
ORACLE=$(curl -sS "$BASE/api/rl/oracle?period=3y&universeId=sp500_top50&rebalanceFreq=bimonthly&topN=15" -m 300)

# ── 9. Forward Confidence ───────────────────────────────────
echo "[9/9] Forward confidence..."
FORWARD=$(curl -sS -X POST "$BASE/api/diagnostics/forward-confidence" \
  -H "Content-Type: application/json" \
  -d '{"universeId":"sp500_top50","period":"3y","rebalanceFreq":"bimonthly","topN":15}' \
  -m 120)

# ── Agent JSON snapshots ─────────────────────────────────────
echo "Reading agent files..."
AGENT_50_RAW=$(cat rl-agent-top50.json 2>/dev/null || cat rl-agent.json 2>/dev/null || echo "null")
AGENT_150_RAW=$(cat rl-agent-top150.json 2>/dev/null || echo "null")

# Extract Q-table summary stats (min, max, spread, non-default count)
AGENT_50_STATS=$(echo "$AGENT_50_RAW" | jq '{
  alpha: .alpha,
  beta: .beta,
  rho: .rho,
  epsilon: .epsilon,
  totalUpdates: .totalUpdates,
  statesVisited: .statesVisited,
  initValue: .initValue,
  minQ: (.Q | min),
  maxQ: (.Q | max),
  spread: ((.Q | max) - (.Q | min)),
  qTableLength: (.Q | length)
}' 2>/dev/null || echo '{"error":"agent file not found"}')

AGENT_150_STATS=$(echo "$AGENT_150_RAW" | jq '{
  alpha: .alpha,
  beta: .beta,
  rho: .rho,
  epsilon: .epsilon,
  totalUpdates: .totalUpdates,
  statesVisited: .statesVisited,
  initValue: .initValue,
  minQ: (.Q | min),
  maxQ: (.Q | max),
  spread: ((.Q | max) - (.Q | min)),
  qTableLength: (.Q | length)
}' 2>/dev/null || echo '{"error":"agent file not found"}')

# ── Rebalance logs (for regime performance charts) ───────────
REBALANCE_LOG_RL=$(echo "$BT_RL_50" | jq '[.rebalanceLog[] | {
  date,
  regime,
  portfolioReturn: .portfolioReturn,
  benchmarkReturn: .benchmarkReturn,
  alpha: (.portfolioReturn - .benchmarkReturn),
  rlExposure: .rlAgent.exposure,
  rlPositionCount: .rlAgent.positionCount,
  rlSizingMethod: .rlAgent.sizingMethod,
  bullFloorApplied: .rlAgent.bullFloorApplied,
  topScore: .avgTopScore
}]' 2>/dev/null || echo '[]')

REBALANCE_LOG_RULES=$(echo "$BT_RULES_50" | jq '[.rebalanceLog[] | {
  date,
  regime,
  portfolioReturn: .portfolioReturn,
  benchmarkReturn: .benchmarkReturn,
  alpha: (.portfolioReturn - .benchmarkReturn)
}]' 2>/dev/null || echo '[]')

# ── Equity curves ────────────────────────────────────────────
EQUITY_CURVE_RL=$(echo "$BT_RL_50" | jq '[.equityCurve[] | {date: .date, value: .value, benchmark: .benchmark}]' 2>/dev/null || echo '[]')
EQUITY_CURVE_RULES=$(echo "$BT_RULES_50" | jq '[.equityCurve[] | {date: .date, value: .value, benchmark: .benchmark}]' 2>/dev/null || echo '[]')

# ── Factor attribution ───────────────────────────────────────
FACTOR_ATTR=$(echo "$BT_RL_50" | jq '.factorAttribution // []' 2>/dev/null || echo '[]')

# ── Regime distribution ──────────────────────────────────────
REGIME_DIST=$(echo "$BT_RL_50" | jq '.regimeDistribution // {}' 2>/dev/null || echo '{}')

# ── Monthly returns heatmap data ─────────────────────────────
MONTHLY_RETURNS=$(echo "$BT_RL_50" | jq '.monthlyReturns // []' 2>/dev/null || echo '[]')

# ── Paper trade positions ────────────────────────────────────
PAPER_POSITIONS=$(echo "$BT_RL_50" | jq '.positions // []' 2>/dev/null || echo '[]')

# ── Assemble final JSON ──────────────────────────────────────
echo "Assembling output..."

jq -n \
  --argjson rl_status "$RL_STATUS" \
  --argjson bt_rules_50 "$BT_RULES_50" \
  --argjson bt_rl_50 "$BT_RL_50" \
  --argjson bt_rules_150 "$BT_RULES_150" \
  --argjson bt_rl_150 "$BT_RL_150" \
  --argjson paper_50 "$PAPER_50" \
  --argjson paper_150 "$PAPER_150" \
  --argjson oracle "$ORACLE" \
  --argjson forward "$FORWARD" \
  --argjson agent_50_stats "$AGENT_50_STATS" \
  --argjson agent_150_stats "$AGENT_150_STATS" \
  --argjson rebalance_log_rl "$REBALANCE_LOG_RL" \
  --argjson rebalance_log_rules "$REBALANCE_LOG_RULES" \
  --argjson equity_curve_rl "$EQUITY_CURVE_RL" \
  --argjson equity_curve_rules "$EQUITY_CURVE_RULES" \
  --argjson factor_attr "$FACTOR_ATTR" \
  --argjson regime_dist "$REGIME_DIST" \
  --argjson monthly_returns "$MONTHLY_RETURNS" \
  '{
    meta: {
      extractedAt: (now | todate),
      serverBase: "http://localhost:3001"
    },
    agentStatus: $rl_status,
    agentStats: {
      top50: $agent_50_stats,
      top150: $agent_150_stats
    },
    backtest: {
      top50: {
        rules: {
          performance: $bt_rules_50.performance,
          regimePerformance: ($bt_rules_50.regimePerformance // null)
        },
        rl: {
          performance: $bt_rl_50.performance,
          regimePerformance: ($bt_rl_50.regimePerformance // null)
        }
      },
      top150: {
        rules: {
          performance: $bt_rules_150.performance,
          regimePerformance: ($bt_rules_150.regimePerformance // null)
        },
        rl: {
          performance: $bt_rl_150.performance,
          regimePerformance: ($bt_rl_150.regimePerformance // null)
        }
      }
    },
    paperTrade: {
      top50: $paper_50,
      top150: $paper_150
    },
    oracle: $oracle,
    forwardConfidence: $forward,
    charts: {
      equityCurveRL: $equity_curve_rl,
      equityCurveRules: $equity_curve_rules,
      rebalanceLogRL: $rebalance_log_rl,
      rebalanceLogRules: $rebalance_log_rules,
      factorAttribution: $factor_attr,
      regimeDistribution: $regime_dist,
      monthlyReturns: $monthly_returns
    }
  }' > "$OUT"

echo ""
echo "Done. Output written to $OUT"
echo ""
echo "Quick validation:"
jq '{
  extractedAt: .meta.extractedAt,
  rlStatus: .agentStatus.coveragePct,
  top50_rl_alpha: .backtest.top50.rl.performance.alpha,
  top50_rules_alpha: .backtest.top50.rules.performance.alpha,
  top150_rl_alpha: .backtest.top150.rl.performance.alpha,
  top150_rules_alpha: .backtest.top150.rules.performance.alpha,
  paperTop50Return: .paperTrade.top50.portfolio.summary.totalReturn,
  oracleAction: .oracle.oracle.actionIdx,
  equityCurvePoints: (.charts.equityCurveRL | length),
  rebalanceLogPoints: (.charts.rebalanceLogRL | length)
}' "$OUT"
