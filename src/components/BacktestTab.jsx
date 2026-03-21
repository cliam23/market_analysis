import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, ComposedChart, Bar } from "recharts";

import { MONO, SANS } from "../lib/theme.js";

function Box({ border, children, style: sx = {} }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.02)",
      border: "1px solid " + (border || "rgba(255,255,255,0.06)"),
      borderRadius: 10,
      padding: 16,
      marginBottom: 12,
      ...sx
    }}>
      {children}
    </div>
  );
}

function Select({ value, onChange, options, label, style }) {
  return (
    <div style={style}>
      {label && <div style={{ fontSize: 10, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>{label}</div>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6,
          padding: "8px 12px",
          color: "#f0f0f0",
          fontSize: 13,
          fontFamily: MONO,
          cursor: "pointer"
        }}
      >
        {options.map(o => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function MetricCard({ label, value, subValue, color, compareColor }) {
  const isPositive = parseFloat(value) >= 0;
  const displayColor = color || (isPositive ? "#22c55e" : "#ef4444");
  
  return (
    <div style={{ 
      background: "rgba(255,255,255,0.03)", 
      borderRadius: 8, 
      padding: "12px 16px", 
      textAlign: "center",
      flex: "1 1 120px"
    }}>
      <div style={{ fontSize: 10, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 6, fontFamily: MONO }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: displayColor, fontFamily: MONO }}>
        {value}
      </div>
      {subValue && (
        <div style={{ fontSize: 11, color: compareColor || "#666", marginTop: 4, fontFamily: MONO }}>
          vs {subValue}
        </div>
      )}
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  
  return (
    <div style={{ 
      background: "rgba(20,20,20,0.95)", 
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: 8,
      padding: 12,
      fontFamily: MONO,
      fontSize: 12
    }}>
      <div style={{ color: "#f0f0f0", marginBottom: 6 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: ${p.value?.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
        </div>
      ))}
    </div>
  );
}

const COMPOSITE_FAMILY = ["full_composite", "full_composite_aggressive", "full_composite_turbo"];
function isCompositeFamily(s) {
  return COMPOSITE_FAMILY.includes(s);
}

export default function BacktestTab() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [showTrades, setShowTrades] = useState(false);
  const [compareSnaps, setCompareSnaps] = useState({ full_composite: null, full_composite_aggressive: null });
  
  const [settings, setSettings] = useState({
    universe: "sp500_top50",
    period: "3y",
    rebalanceFreq: "monthly",
    topN: "10",
    strategy: "momentum_value",
    initialCapital: "10000"
  });

  const updateSetting = (key, value) => {
    setSettings(s => ({ ...s, [key]: value }));
    setResults(null);
    setError(null);
  };
  
  const universeOptions = [
    { id: "sp500_top50", label: "S&P 500 Top 50" },
    { id: "vgt", label: "VGT (Tech)" },
    { id: "mag7", label: "Mag 7" },
    { id: "russell_growth", label: "Russell Growth" },
    { id: "dividend_aristocrats", label: "Dividend Aristocrats" }
  ];
  
  const periodOptions = [
    { id: "1y", label: "1 Year" },
    { id: "2y", label: "2 Years" },
    { id: "3y", label: "3 Years" },
    { id: "5y", label: "5 Years" }
  ];
  
  const freqOptions = [
    { id: "monthly", label: "Monthly" },
    { id: "quarterly", label: "Quarterly" }
  ];
  
  const topNOptions = [
    { id: "5", label: "5" },
    { id: "10", label: "10" },
    { id: "15", label: "15" },
    { id: "20", label: "20" }
  ];
  
  const strategyOptions = [
    { id: "momentum", label: "Momentum Only" },
    { id: "momentum_value", label: "Momentum + Value" },
    { id: "full_composite", label: "Full Composite" },
    { id: "full_composite_aggressive", label: "Full Composite (Aggressive)" },
    { id: "full_composite_turbo", label: "Full Composite (Turbo — max risk)" },
    { id: "quality_momentum", label: "Quality + Momentum" }
  ];
  
  const [optimizing, setOptimizing] = useState(false);

  const runBacktest = async (optimize = false) => {
    if (optimize) setOptimizing(true);
    else { setLoading(true); setResults(null); }
    setError(null);
    
    try {
      const params = new URLSearchParams({
        period: settings.period,
        rebalanceFreq: settings.rebalanceFreq,
        topN: settings.topN,
        strategy: settings.strategy,
        initialCapital: settings.initialCapital,
        optimize: optimize ? 'true' : 'false',
        _t: Date.now()
      });
      
      const response = await fetch(`/api/backtest/${settings.universe}?${params}`);
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || "Backtest failed");
      }
      
      setResults(data);
      const strat = (data.strategy || "").toLowerCase().trim();
      if (strat === "full_composite" || strat === "full_composite_aggressive") {
        setCompareSnaps((prev) => ({
          ...prev,
          [strat]: {
            performance: data.performance,
            strategy: strat,
            universe: data.universe,
            period: data.period
          }
        }));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setOptimizing(false);
    }
  };

  const resetOptimization = async () => {
    try {
      await fetch('/api/optimization/reset', { method: 'POST' });
      if (results) runBacktest(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const freezeOptimization = async () => {
    try {
      await fetch('/api/optimization/freeze', { method: 'POST' });
      if (results) runBacktest(false);
    } catch (err) {
      setError(err.message);
    }
  };
  
  const formatValue = (val) => {
    const num = parseFloat(val);
    const sign = num >= 0 ? "+" : "";
    return `${sign}${num.toFixed(1)}%`;
  };
  
  const getAlphaColor = (alpha) => {
    const num = parseFloat(alpha);
    if (num > 3) return "#22c55e";
    if (num > 0) return "#4ade80";
    if (num > -3) return "#eab308";
    return "#ef4444";
  };
  
  return (
    <div style={{ animation: "fadeUp 0.3s ease-out" }}>
      {/* Controls */}
      <Box style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Select
            label="UNIVERSE"
            value={settings.universe}
            onChange={(v) => updateSetting('universe', v)}
            options={universeOptions}
          />
          <Select
            label="PERIOD"
            value={settings.period}
            onChange={(v) => updateSetting('period', v)}
            options={periodOptions}
          />
          <Select
            label="REBALANCE"
            value={settings.rebalanceFreq}
            onChange={(v) => updateSetting('rebalanceFreq', v)}
            options={freqOptions}
          />
          <Select
            label="HOLD TOP"
            value={settings.topN}
            onChange={(v) => updateSetting('topN', v)}
            options={topNOptions}
          />
          <Select
            label="STRATEGY"
            value={settings.strategy}
            onChange={(v) => updateSetting('strategy', v)}
            options={strategyOptions}
          />
          <button
            onClick={() => runBacktest(false)}
            disabled={loading || optimizing}
            style={{
              padding: "10px 24px",
              background: loading ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 6,
              color: loading ? "#555" : "#f0f0f0",
              fontSize: 13,
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: MONO
            }}
          >
            {loading ? "RUNNING..." : "RUN BACKTEST"}
          </button>
          {isCompositeFamily(settings.strategy) && (
            <button
              onClick={() => runBacktest(true)}
              disabled={loading || optimizing || (results?.optimizationStatus?.frozen)}
              style={{
                padding: "10px 24px",
                background: optimizing ? "rgba(255,255,255,0.04)" : results?.optimizationStatus?.frozen ? "rgba(255,255,255,0.02)" : "rgba(59,130,246,0.15)",
                border: `1px solid ${results?.optimizationStatus?.frozen ? "rgba(255,255,255,0.06)" : "rgba(59,130,246,0.3)"}`,
                borderRadius: 6,
                color: optimizing ? "#555" : results?.optimizationStatus?.frozen ? "#444" : "#60a5fa",
                fontSize: 13,
                fontWeight: 700,
                cursor: (loading || optimizing || results?.optimizationStatus?.frozen) ? "not-allowed" : "pointer",
                fontFamily: MONO
              }}
            >
              {optimizing ? "OPTIMIZING..." : results?.optimizationStatus?.frozen ? "WEIGHTS FROZEN" : "OPTIMIZE WEIGHTS"}
            </button>
          )}
        </div>
      </Box>
      
      {isCompositeFamily(settings.strategy) && (
        <Box style={{ background: "rgba(234,179,8,0.04)", marginBottom: 16, borderColor: "rgba(234,179,8,0.15)" }}>
          <div style={{ fontSize: 11, color: "#eab308", fontWeight: 700, marginBottom: 6, fontFamily: MONO }}>
            FUNDAMENTAL DATA ASSUMPTION
          </div>
          <div style={{ fontSize: 12, color: "#f0f0f0", lineHeight: 1.6, fontFamily: "sans-serif" }}>
            {settings.strategy === "full_composite_turbo" ? (
              <>
                Turbo is maximum risk: almost no quality floor, wide volatility allowance, and faster stop/regime reactions.
                Fundamentals are still loaded for scoring weights where used, but filters are largely disabled. Not suitable
                for capital you cannot afford to lose.
              </>
            ) : (
              <>
                The Full Composite strategy uses fundamental scores (Buffett Quality, Moat, ROIC, Earnings Quality, Shareholder Yield)
                that are point-in-time approximations. For this backtest, fundamental data is fetched once at the start and held
                stable throughout the simulation period to prevent look-ahead bias. This is a conservative assumption — in reality,
                fundamentals evolve and quality signals shift over time.
              </>
            )}
          </div>
        </Box>
      )}
      
      {loading && (
        <Box style={{ textAlign: "center", padding: "40px" }}>
          <div style={{ color: "#f0f0f0", fontFamily: MONO, fontSize: 13 }}>
            Fetching historical data and running simulation...
          </div>
        </Box>
      )}
      
      {error && (
        <Box style={{ background: "rgba(239,68,68,0.05)", borderColor: "rgba(239,68,68,0.2)" }}>
          <div style={{ color: "#ef4444", fontSize: 13 }}>Error: {error}</div>
        </Box>
      )}
      
      {results && !loading && (
        <>
          {/* Performance Summary */}
          <Box>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f0f0", marginBottom: 12, fontFamily: MONO, letterSpacing: 1 }}>
              PERFORMANCE SUMMARY — {results.period} ({results.performance.years} years)
            </div>
            
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <MetricCard 
                label="TOTAL RETURN" 
                value={formatValue(results.performance.totalReturn)}
                subValue={formatValue(results.performance.benchmarkReturn) + " benchmark"}
                color={parseFloat(results.performance.totalReturn) >= parseFloat(results.performance.benchmarkReturn) ? "#22c55e" : "#ef4444"}
              />
              <MetricCard 
                label="ANNUALIZED" 
                value={formatValue(results.performance.annualizedReturn)}
                subValue={formatValue(results.performance.benchmarkAnnualized) + " benchmark"}
                color={parseFloat(results.performance.annualizedReturn) >= parseFloat(results.performance.benchmarkAnnualized) ? "#22c55e" : "#ef4444"}
              />
              <MetricCard 
                label="ALPHA" 
                value={formatValue(results.performance.alpha)}
                color={getAlphaColor(results.performance.alpha)}
              />
              <MetricCard 
                label="SHARPE" 
                value={results.performance.sharpe}
                subValue={results.performance.benchmarkSharpe + " bench"}
                color={parseFloat(results.performance.sharpe) >= parseFloat(results.performance.benchmarkSharpe) ? "#22c55e" : "#ef4444"}
              />
            </div>
            
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <MetricCard 
                label="MAX DRAWDOWN" 
                value={results.performance.maxDrawdown + "%"}
                subValue={results.performance.benchmarkMaxDD + "% benchmark"}
                color={parseFloat(results.performance.maxDrawdown) > parseFloat(results.performance.benchmarkMaxDD) ? "#ef4444" : "#22c55e"}
              />
              <MetricCard 
                label="VOLATILITY" 
                value={results.performance.annualizedVol + "%"}
                subValue={results.performance.benchmarkVol + "% benchmark"}
                color={parseFloat(results.performance.annualizedVol) <= parseFloat(results.performance.benchmarkVol) ? "#22c55e" : "#888"}
              />
              <MetricCard 
                label="WIN RATE" 
                value={results.performance.winRate + "%"}
                color={parseFloat(results.performance.winRate) >= 50 ? "#22c55e" : "#eab308"}
              />
              <MetricCard 
                label="HIT RATE" 
                value={results.performance.hitRate + "%"}
                subValue="months beat benchmark"
                color={parseFloat(results.performance.hitRate) >= 50 ? "#22c55e" : "#888"}
              />
            </div>

            {results.performance.aggressiveMetrics && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f0f0", marginBottom: 10, fontFamily: MONO, letterSpacing: 1 }}>
                  AGGRESSIVE / TURBO RISK METRICS
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <MetricCard label="BETA VS BENCHMARK" value={String(results.performance.aggressiveMetrics.betaVsBenchmark)} subValue="1.00 = market" color="#60a5fa" />
                  <MetricCard label="UP CAPTURE" value={results.performance.aggressiveMetrics.captureRatioUp + "%"} subValue="vs up months" color={parseFloat(results.performance.aggressiveMetrics.captureRatioUp) >= 100 ? "#22c55e" : "#eab308"} />
                  <MetricCard label="DOWN CAPTURE" value={results.performance.aggressiveMetrics.captureRatioDown + "%"} subValue="vs down months" color={parseFloat(results.performance.aggressiveMetrics.captureRatioDown) <= 100 ? "#22c55e" : "#ef4444"} />
                  <MetricCard label="TURNOVER" value={results.performance.aggressiveMetrics.turnoverPct + "%"} subValue="trades / (rebal × N)" color="#888" />
                  <MetricCard label="AVG HOLDING" value={results.performance.aggressiveMetrics.avgHoldingPeriod + " d"} subValue="exit trades" color="#888" />
                </div>
              </div>
            )}
          </Box>

          {compareSnaps.full_composite && compareSnaps.full_composite_aggressive
            && compareSnaps.full_composite.universe === compareSnaps.full_composite_aggressive.universe
            && compareSnaps.full_composite.period === compareSnaps.full_composite_aggressive.period && (
            <Box>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f0f0", marginBottom: 12, fontFamily: MONO, letterSpacing: 1 }}>
                STRATEGY COMPARISON (last conservative vs aggressive runs, same universe and period)
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: MONO, fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", color: "#888" }}>
                      <th style={{ textAlign: "left", padding: "8px 6px" }}>Metric</th>
                      <th style={{ textAlign: "right", padding: "8px 6px" }}>Conservative</th>
                      <th style={{ textAlign: "right", padding: "8px 6px" }}>Aggressive</th>
                      <th style={{ textAlign: "right", padding: "8px 6px" }}>Benchmark</th>
                    </tr>
                  </thead>
                  <tbody style={{ color: "#f0f0f0" }}>
                    {[
                      ["Total return %", "totalReturn", "totalReturn", "benchmarkReturn"],
                      ["Annualized %", "annualizedReturn", "annualizedReturn", "benchmarkAnnualized"],
                      ["Alpha %", "alpha", "alpha", null],
                      ["Sharpe", "sharpe", "sharpe", "benchmarkSharpe"],
                      ["Max DD %", "maxDrawdown", "maxDrawdown", "benchmarkMaxDD"],
                      ["Win rate %", "winRate", "winRate", null],
                      ["Hit rate %", "hitRate", "hitRate", null]
                    ].map(([label, cKey, aKey, bKey]) => {
                      const c = compareSnaps.full_composite.performance;
                      const a = compareSnaps.full_composite_aggressive.performance;
                      return (
                        <tr key={label} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          <td style={{ padding: "6px" }}>{label}</td>
                          <td style={{ textAlign: "right", padding: "6px" }}>{c[cKey]}{cKey !== "sharpe" ? "%" : ""}</td>
                          <td style={{ textAlign: "right", padding: "6px" }}>{a[aKey]}{aKey !== "sharpe" ? "%" : ""}</td>
                          <td style={{ textAlign: "right", padding: "6px" }}>{bKey ? `${c[bKey]}${bKey !== "benchmarkSharpe" ? "%" : ""}` : "—"}</td>
                        </tr>
                      );
                    })}
                    {compareSnaps.full_composite_aggressive.performance.aggressiveMetrics && (
                      <>
                        <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          <td style={{ padding: "6px" }}>Beta</td>
                          <td style={{ textAlign: "right", padding: "6px" }}>—</td>
                          <td style={{ textAlign: "right", padding: "6px" }}>{compareSnaps.full_composite_aggressive.performance.aggressiveMetrics.betaVsBenchmark}</td>
                          <td style={{ textAlign: "right", padding: "6px" }}>1.00</td>
                        </tr>
                        <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          <td style={{ padding: "6px" }}>Up capture %</td>
                          <td style={{ textAlign: "right", padding: "6px" }}>—</td>
                          <td style={{ textAlign: "right", padding: "6px" }}>{compareSnaps.full_composite_aggressive.performance.aggressiveMetrics.captureRatioUp}</td>
                          <td style={{ textAlign: "right", padding: "6px" }}>100</td>
                        </tr>
                        <tr>
                          <td style={{ padding: "6px" }}>Down capture %</td>
                          <td style={{ textAlign: "right", padding: "6px" }}>—</td>
                          <td style={{ textAlign: "right", padding: "6px" }}>{compareSnaps.full_composite_aggressive.performance.aggressiveMetrics.captureRatioDown}</td>
                          <td style={{ textAlign: "right", padding: "6px" }}>100</td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </Box>
          )}
          
          {/* Risk Management Summary */}
          {results.riskManagement && (results.riskManagement.regimeSummary || results.riskManagement.totalStopsTriggered > 0) && (
            <Box>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f0f0", marginBottom: 12, fontFamily: MONO, letterSpacing: 1 }}>
                RISK MANAGEMENT
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {results.riskManagement.regimeSummary && (
                  <>
                    <MetricCard
                      label="AVG EXPOSURE"
                      value={(results.riskManagement.regimeSummary.avgExposure * 100).toFixed(0) + "%"}
                      subValue={results.riskManagement.regimeSummary.totalPeriods + " rebalances"}
                      color={results.riskManagement.regimeSummary.avgExposure >= 0.9 ? "#22c55e" : "#eab308"}
                    />
                    {Object.entries(results.riskManagement.regimeSummary.regimes).map(([regime, count]) => (
                      <MetricCard
                        key={regime}
                        label={regime.toUpperCase().replace('_', ' ')}
                        value={count + "x"}
                        color={regime === 'strong_bull' ? "#22c55e" : regime === 'bear' ? "#ef4444" : regime === 'normal' ? "#888" : "#eab308"}
                      />
                    ))}
                  </>
                )}
                <MetricCard
                  label="STOP-LOSSES"
                  value={results.riskManagement.totalStopsTriggered}
                  subValue={results.performance.totalStops > 0 ? "positions exited early" : "none triggered"}
                  color={results.riskManagement.totalStopsTriggered === 0 ? "#22c55e" : "#eab308"}
                />
              </div>
              {results.riskManagement.stopsDetail.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 11, fontFamily: MONO, color: "#888" }}>
                  Stops: {results.riskManagement.stopsDetail.map(s => `${s.ticker} ${s.return}`).join(', ')}
                </div>
              )}
            </Box>
          )}

          {/* Optimization Dashboard for Full Composite */}
          {isCompositeFamily(results.strategy) && results.optimizationStatus && (() => {
            const os = results.optimizationStatus;
            const opt = results.optimization;
            const frozen = os.frozen;
            const round = os.round;
            const maxR = os.maxRounds;
            const labels = { fundamental: 'Quality', dcf: 'DCF', valuation: 'Valuation', momentum: 'Momentum', value: 'Value' };
            const pct = Math.round((round / maxR) * 100);

            return (
              <Box style={{ borderColor: frozen ? "rgba(239,68,68,0.2)" : opt?.status === 'accepted' ? "rgba(34,197,94,0.2)" : opt?.status === 'rejected' ? "rgba(234,179,8,0.2)" : "rgba(255,255,255,0.06)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f0f0", fontFamily: MONO, letterSpacing: 1 }}>
                    WEIGHT OPTIMIZATION STATUS
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={resetOptimization} style={{ padding: "4px 12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4, color: "#f0f0f0", fontSize: 10, fontFamily: MONO, cursor: "pointer" }}>
                      RESET TO DEFAULTS
                    </button>
                    {!frozen && (
                      <button onClick={freezeOptimization} style={{ padding: "4px 12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4, color: "#f0f0f0", fontSize: 10, fontFamily: MONO, cursor: "pointer" }}>
                        FREEZE WEIGHTS
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: "#f0f0f0", fontFamily: MONO, whiteSpace: "nowrap" }}>
                    Round {round}/{maxR}
                  </div>
                  <div style={{ flex: 1, height: 8, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: frozen ? "#ef4444" : "#60a5fa", borderRadius: 4, transition: "width 0.3s ease" }} />
                  </div>
                  <div style={{ fontSize: 11, color: frozen ? "#ef4444" : "#f0f0f0", fontFamily: MONO, whiteSpace: "nowrap" }}>
                    {frozen ? "Frozen" : `${maxR - round} remaining`}
                  </div>
                </div>

                {os.stability && (
                  <div style={{ fontSize: 11, color: os.stability.stable ? "#22c55e" : "#eab308", fontFamily: MONO, marginBottom: 10 }}>
                    Stability: {os.stability.message} (max variance: {os.stability.maxVariance}%)
                  </div>
                )}

                <div style={{ fontSize: 10, fontWeight: 700, color: "#f0f0f0", fontFamily: MONO, letterSpacing: 1, marginBottom: 6 }}>
                  ACTIVE WEIGHTS
                </div>
                <div style={{ display: "flex", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
                  {Object.entries(results.activeWeights).map(([f, w]) => (
                    <div key={f} style={{ fontSize: 12, fontFamily: MONO, color: "#f0f0f0" }}>
                      {labels[f] || f}: <span style={{ fontWeight: 700 }}>{(w * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>

                {opt && opt.status === 'accepted' && opt.previousWeights && opt.newWeights && (
                  <div style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: 6, padding: 12, marginBottom: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#22c55e", fontFamily: MONO, letterSpacing: 1, marginBottom: 8 }}>
                      OPTIMIZATION ACCEPTED — ROUND {opt.round}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 6 }}>
                      {Object.keys(opt.newWeights).map(f => {
                        const prev = opt.previousWeights[f] || 0;
                        const next = opt.newWeights[f] || 0;
                        const delta = next - prev;
                        const deltaColor = delta > 0.005 ? "#22c55e" : delta < -0.005 ? "#ef4444" : "#666";
                        return (
                          <div key={f} style={{ fontSize: 11, fontFamily: MONO, color: "#f0f0f0" }}>
                            {labels[f] || f}: {(prev * 100).toFixed(0)}%
                            <span style={{ color: deltaColor, fontWeight: 700 }}> → {(next * 100).toFixed(0)}%</span>
                            {Math.abs(delta) > 0.005 && <span style={{ color: deltaColor, fontSize: 10 }}> ({delta > 0 ? "+" : ""}{(delta * 100).toFixed(0)})</span>}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 11, color: "#f0f0f0", marginTop: 8, fontFamily: MONO }}>{opt.reason}</div>
                  </div>
                )}

                {opt && opt.status === 'rejected' && (
                  <div style={{ background: "rgba(234,179,8,0.05)", border: "1px solid rgba(234,179,8,0.15)", borderRadius: 6, padding: 12, marginBottom: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#eab308", fontFamily: MONO, letterSpacing: 1, marginBottom: 6 }}>
                      OPTIMIZATION REJECTED
                    </div>
                    <div style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO }}>{opt.reason}</div>
                  </div>
                )}

                {opt && opt.status === 'capped' && (
                  <div style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 6, padding: 12, marginBottom: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#ef4444", fontFamily: MONO, letterSpacing: 1, marginBottom: 6 }}>
                      OPTIMIZATION COMPLETE ({maxR}/{maxR} ROUNDS)
                    </div>
                    <div style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO }}>
                      Weights are frozen to prevent overfitting. Click "Reset to Defaults" for 5 new rounds.
                    </div>
                  </div>
                )}

                {opt && opt.validation && (
                  <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 6, padding: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#f0f0f0", fontFamily: MONO, letterSpacing: 1, marginBottom: 8 }}>
                      OUT-OF-SAMPLE VALIDATION
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 10, color: "#888", fontFamily: MONO }}>Train Sharpe</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: "#f0f0f0", fontFamily: MONO }}>{opt.validation.trainSharpe}</div>
                        <div style={{ fontSize: 9, color: "#666", fontFamily: MONO }}>{opt.validation.trainPeriod}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: "#888", fontFamily: MONO }}>Test Sharpe (default)</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: "#f0f0f0", fontFamily: MONO }}>{opt.validation.testDefaultSharpe}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: "#888", fontFamily: MONO }}>Test Sharpe (optimized)</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: opt.validation.oosAccepted ? "#22c55e" : "#ef4444", fontFamily: MONO }}>{opt.validation.testOptimizedSharpe}</div>
                      </div>
                    </div>
                    <div style={{ marginTop: 10, display: "flex", gap: 16 }}>
                      <div style={{ fontSize: 11, fontFamily: MONO, color: "#f0f0f0" }}>
                        Sharpe decay: <span style={{ fontWeight: 700, color: opt.validation.sharpeDecay < 20 ? "#22c55e" : opt.validation.sharpeDecay < 50 ? "#eab308" : "#ef4444" }}>{opt.validation.sharpeDecay}%</span>
                        <span style={{ color: "#666", fontSize: 10 }}> ({opt.validation.sharpeDecay < 20 ? "real signal" : opt.validation.sharpeDecay < 50 ? "mixed" : "overfitting"})</span>
                      </div>
                      <div style={{ fontSize: 11, fontFamily: MONO, color: "#f0f0f0" }}>
                        OOS Return: <span style={{ fontWeight: 700, color: opt.validation.testOptimizedReturn > opt.validation.testDefaultReturn ? "#22c55e" : "#ef4444" }}>
                          {opt.validation.testOptimizedReturn > 0 ? "+" : ""}{opt.validation.testOptimizedReturn}%
                        </span>
                        <span style={{ color: "#666", fontSize: 10 }}> vs {opt.validation.testDefaultReturn > 0 ? "+" : ""}{opt.validation.testDefaultReturn}% default</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 9, color: "#555", fontFamily: MONO, marginTop: 8 }}>
                      {opt.validation.testPeriod}
                    </div>
                  </div>
                )}
              </Box>
            );
          })()}

          {isCompositeFamily(results.strategy) && results.factorAttribution && (
            <Box>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f0f0", marginBottom: 12, fontFamily: MONO, letterSpacing: 1 }}>
                FACTOR ATTRIBUTION — {results.factorAttribution.periodsAnalyzed} PERIODS ANALYZED
              </div>
              
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginBottom: 14 }}>
                {results.factorAttribution.factors.map(f => {
                  const icColor = f.ic > 0.05 ? "#22c55e" : f.ic > 0 ? "#eab308" : "#ef4444";
                  const spreadColor = f.spread > 0 ? "#22c55e" : "#ef4444";
                  const weightDelta = f.suggestedWeight - f.originalWeight;
                  const deltaColor = weightDelta > 0.02 ? "#22c55e" : weightDelta < -0.02 ? "#ef4444" : "#888";
                  return (
                    <div key={f.name} style={{
                      background: "rgba(255,255,255,0.02)",
                      borderRadius: 8,
                      padding: "12px 14px",
                      borderLeft: "3px solid rgba(255,255,255,0.15)"
                    }}>
                      <div style={{ fontSize: 10, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, marginBottom: 8, fontFamily: MONO }}>
                        {f.label.toUpperCase()}
                      </div>
                      
                      <div style={{ display: "flex", gap: 16, marginBottom: 8 }}>
                        <div>
                          <div style={{ fontSize: 10, color: "#f0f0f0", fontFamily: MONO }}>IC</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: icColor, fontFamily: MONO }}>
                            {f.ic >= 0 ? "+" : ""}{f.ic.toFixed(3)}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: "#f0f0f0", fontFamily: MONO }}>SPREAD</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: spreadColor, fontFamily: MONO }}>
                            {f.spread >= 0 ? "+" : ""}{f.spread.toFixed(1)}%
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: "#f0f0f0", fontFamily: MONO }}>$ CONTRIB</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: f.contribution >= 0 ? "#22c55e" : "#ef4444", fontFamily: MONO }}>
                            ${Math.abs(f.contribution) >= 1000 ? (f.contribution / 1000).toFixed(1) + "k" : f.contribution.toFixed(0)}
                          </div>
                        </div>
                      </div>
                      
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: MONO }}>
                        <span style={{ color: "#f0f0f0" }}>{(f.originalWeight * 100).toFixed(0)}%</span>
                        <span style={{ color: deltaColor, fontWeight: 700 }}>
                          {weightDelta > 0.005 ? "\u2192" : weightDelta < -0.005 ? "\u2192" : "="} {(f.suggestedWeight * 100).toFixed(0)}%
                        </span>
                        {Math.abs(weightDelta) > 0.005 && (
                          <span style={{ color: deltaColor, fontSize: 10 }}>
                            ({weightDelta > 0 ? "+" : ""}{(weightDelta * 100).toFixed(0)})
                          </span>
                        )}
                      </div>
                      
                      <div style={{ height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2, marginTop: 8, overflow: "hidden" }}>
                        <div style={{
                          height: "100%",
                          width: `${Math.min(Math.max(f.ic * 500 + 50, 5), 100)}%`,
                          background: "rgba(255,255,255,0.2)",
                          borderRadius: 2,
                          transition: "width 0.3s ease"
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              
              <div style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 6,
                padding: "10px 14px",
                fontSize: 12,
                color: "#f0f0f0",
                lineHeight: 1.6,
                fontFamily: SANS
              }}>
                {results.factorAttribution.insight}
                <span style={{ color: "#f0f0f0", fontSize: 11, display: "block", marginTop: 4 }}>
                  IC = rank correlation between factor score and realized return. Spread = avg return of top-half minus bottom-half stocks by factor. Based on {results.factorAttribution.avgStocksPerPeriod} eligible stocks per period.
                </span>
              </div>
            </Box>
          )}
          
          {/* Equity Curve */}
          <Box>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f0f0", marginBottom: 12, fontFamily: MONO, letterSpacing: 1 }}>
              EQUITY CURVE — $10,000 INVESTED
            </div>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={results.equityCurve}>
                  <defs>
                    <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f0f0f0" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="#f0f0f0" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis 
                    dataKey="date" 
                    tick={{ fill: "#f0f0f0", fontSize: 10, fontFamily: MONO }}
                    tickFormatter={(v) => {
                      const d = new Date(v + "T00:00:00");
                      const m = d.toLocaleString("en-US", { month: "short" });
                      return `${m} '${String(d.getFullYear()).slice(2)}`;
                    }}
                    minTickGap={60}
                  />
                  <YAxis 
                    tick={{ fill: "#f0f0f0", fontSize: 10, fontFamily: MONO }}
                    tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`}
                    domain={['dataMin - 1000', 'dataMax + 1000']}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area 
                    type="monotone" 
                    dataKey="portfolio" 
                    stroke="#f0f0f0" 
                    fill="url(#portfolioGradient)" 
                    strokeWidth={2}
                    name="Portfolio"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="benchmark" 
                    stroke="#f0f0f0" 
                    strokeWidth={1}
                    dot={false}
                    name="Benchmark (SPY)"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 8, justifyContent: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 16, height: 3, background: "#f0f0f0", borderRadius: 2 }} />
                <span style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO }}>Strategy</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 16, height: 1, background: "#f0f0f0" }} />
                <span style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO }}>SPY Benchmark</span>
              </div>
            </div>
          </Box>
          
          {/* Monthly Returns Heatmap */}
          <Box>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f0f0", marginBottom: 12, fontFamily: MONO, letterSpacing: 1 }}>
              MONTHLY RETURNS
            </div>
            <div style={{ overflowX: "auto" }}>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", minWidth: 600 }}>
                {results.monthlyReturns.map((m, i) => {
                  const portNum = parseFloat(m.portfolio);
                  const color = portNum > 0 ? "#22c55e" : "#ef4444";
                  const intensity = Math.min(Math.abs(portNum) / 10, 1);
                  return (
                    <div
                      key={i}
                      style={{
                        width: 60,
                        padding: "6px 4px",
                        borderRadius: 4,
                        background: portNum > 0 ? `rgba(34,197,94,${intensity * 0.3})` : `rgba(239,68,68,${intensity * 0.3})`,
                        border: `1px solid ${color}30`,
                        textAlign: "center",
                        cursor: "default"
                      }}
                      title={`${m.month}: Portfolio ${m.portfolio.toFixed(1)}%, Benchmark ${m.benchmark.toFixed(1)}%`}
                    >
                      <div style={{ fontSize: 10, color: "#f0f0f0", fontFamily: MONO }}>{m.month.substring(5)}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color, fontFamily: MONO }}>
                        {portNum >= 0 ? "+" : ""}{portNum.toFixed(1)}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Box>
          
          {/* Trade Log */}
          <Box>
            <div 
              onClick={() => setShowTrades(!showTrades)}
              style={{ 
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: showTrades ? 12 : 0
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f0f0", fontFamily: MONO, letterSpacing: 1 }}>
                TRADE LOG — {results.trades.length} TRADES{results.performance.totalStops > 0 ? ` (${results.performance.totalStops} stops)` : ''}
              </div>
              <span style={{ color: "#f0f0f0", fontSize: 12 }}>{showTrades ? "▲" : "▼"}</span>
            </div>
            
            {showTrades && (
              <div style={{ overflowX: "auto", maxHeight: 400, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: MONO }}>
                  <thead>
                    <tr style={{ background: "rgba(255,255,255,0.02)" }}>
                      <th style={{ padding: "8px 10px", textAlign: "left", color: "#f0f0f0" }}>Date</th>
                      <th style={{ padding: "8px 10px", textAlign: "left", color: "#f0f0f0" }}>Action</th>
                      <th style={{ padding: "8px 10px", textAlign: "left", color: "#f0f0f0" }}>Ticker</th>
                      <th style={{ padding: "8px 10px", textAlign: "right", color: "#f0f0f0" }}>Shares</th>
                      <th style={{ padding: "8px 10px", textAlign: "right", color: "#f0f0f0" }}>Price</th>
                      <th style={{ padding: "8px 10px", textAlign: "right", color: "#f0f0f0" }}>Value</th>
                      <th style={{ padding: "8px 10px", textAlign: "right", color: "#f0f0f0" }}>Return</th>
                      <th style={{ padding: "8px 10px", textAlign: "right", color: "#f0f0f0" }}>Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.trades.slice(0, 100).map((t, i) => (
                      <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
                        <td style={{ padding: "8px 10px", color: "#f0f0f0" }}>{t.date}</td>
                        <td style={{ 
                          padding: "8px 10px", 
                          color: t.type === "BUY" ? "#60a5fa" : t.type === "STOP" ? "#f97316" : t.type === "REENTRY" ? "#a78bfa" : t.holdingReturn > 0 ? "#22c55e" : "#ef4444",
                          fontWeight: 700
                        }}>
                          {t.type}
                        </td>
                        <td style={{ padding: "8px 10px", color: "#f0f0f0", fontWeight: 600 }}>{t.ticker}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#f0f0f0" }}>{t.shares}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#f0f0f0" }}>${t.price?.toFixed(2)}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#f0f0f0" }}>
                          ${(t.cost || t.proceeds)?.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                        <td style={{ 
                          padding: "8px 10px", 
                          textAlign: "right",
                          color: t.holdingReturn > 0 ? "#22c55e" : t.holdingReturn < 0 ? "#ef4444" : "#888"
                        }}>
                          {t.holdingReturn != null ? `${(t.holdingReturn * 100).toFixed(1)}%` : "-"}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#f0f0f0" }}>
                          {t.holdingDays || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {results.trades.length > 100 && (
                  <div style={{ textAlign: "center", color: "#f0f0f0", fontSize: 11, padding: 8 }}>
                    Showing 100 of {results.trades.length} trades
                  </div>
                )}
              </div>
            )}
          </Box>
          
          {/* Disclaimer */}
          <Box style={{ background: "rgba(234,179,8,0.04)", borderColor: "rgba(234,179,8,0.15)" }}>
            <div style={{ fontSize: 11, color: "#eab308", fontWeight: 700, marginBottom: 8, fontFamily: MONO }}>
              DISCLAIMER
            </div>
            <div style={{ fontSize: 12, color: "#f0f0f0", lineHeight: 1.6, fontFamily: "sans-serif" }}>
              Past performance does not predict future results. This backtest uses historical data with adjusted prices 
              and simulated execution. Real trading involves slippage, commissions, taxes, and liquidity constraints 
              not modeled here. This is an educational tool for understanding strategy behavior, not a guarantee of 
              future returns.
            </div>
          </Box>
        </>
      )}
      
      {!results && !loading && !error && (
        <Box style={{ textAlign: "center", padding: "60px 20px" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>Backtest</div>
          <div style={{ fontSize: 13, color: "#f0f0f0", marginBottom: 8 }}>Run a walk-forward backtest to measure strategy performance</div>
          <div style={{ fontSize: 12, color: "#f0f0f0" }}>Configure settings above and click "Run Backtest" to begin</div>
        </Box>
      )}
    </div>
  );
}
