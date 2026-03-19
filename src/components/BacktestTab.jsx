import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, ComposedChart, Bar } from "recharts";

const MONO = "'IBM Plex Mono', monospace";
const SANS = "'DM Sans', sans-serif";

function Box({ border, children, style: sx = {} }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.02)",
      border: "1px solid " + (border || "rgba(255,255,255,0.06)"),
      borderRadius: 10,
      padding: 14,
      marginBottom: 10,
      ...sx
    }}>
      {children}
    </div>
  );
}

function Select({ value, onChange, options, label, style }) {
  return (
    <div style={style}>
      {label && <div style={{ fontSize: 9, color: "#555", fontWeight: 700, letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>{label}</div>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6,
          padding: "8px 12px",
          color: "#f0f0f0",
          fontSize: 12,
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
      <div style={{ fontSize: 8, color: "#555", fontWeight: 700, letterSpacing: 1, marginBottom: 6, fontFamily: MONO }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: displayColor, fontFamily: MONO }}>
        {value}
      </div>
      {subValue && (
        <div style={{ fontSize: 10, color: compareColor || "#666", marginTop: 4, fontFamily: MONO }}>
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
      fontSize: 11
    }}>
      <div style={{ color: "#888", marginBottom: 6 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: ${p.value?.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
        </div>
      ))}
    </div>
  );
}

export default function BacktestTab() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [showTrades, setShowTrades] = useState(false);
  
  const [settings, setSettings] = useState({
    universe: "sp500_top50",
    period: "3y",
    rebalanceFreq: "monthly",
    topN: "10",
    strategy: "momentum_value",
    initialCapital: "10000"
  });
  
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
    { id: "full_composite", label: "Full Composite (Buffett)" },
    { id: "quality_momentum", label: "Quality + Momentum" }
  ];
  
  const runBacktest = async () => {
    setLoading(true);
    setError(null);
    setResults(null);
    
    try {
      const params = new URLSearchParams({
        period: settings.period,
        rebalanceFreq: settings.rebalanceFreq,
        topN: settings.topN,
        strategy: settings.strategy,
        initialCapital: settings.initialCapital,
        _t: Date.now() // cache bust
      });
      
      console.log('[Frontend] Running backtest with settings:', settings);
      
      const response = await fetch(`/api/backtest/${settings.universe}?${params}`);
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || "Backtest failed");
      }
      
      setResults(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
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
      <Box border="rgba(129,140,248,0.1)" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Select
            label="UNIVERSE"
            value={settings.universe}
            onChange={(v) => setSettings(s => ({ ...s, universe: v }))}
            options={universeOptions}
          />
          <Select
            label="PERIOD"
            value={settings.period}
            onChange={(v) => setSettings(s => ({ ...s, period: v }))}
            options={periodOptions}
          />
          <Select
            label="REBALANCE"
            value={settings.rebalanceFreq}
            onChange={(v) => setSettings(s => ({ ...s, rebalanceFreq: v }))}
            options={freqOptions}
          />
          <Select
            label="HOLD TOP"
            value={settings.topN}
            onChange={(v) => setSettings(s => ({ ...s, topN: v }))}
            options={topNOptions}
          />
          <Select
            label="STRATEGY"
            value={settings.strategy}
            onChange={(v) => setSettings(s => ({ ...s, strategy: v }))}
            options={strategyOptions}
          />
          <button
            onClick={runBacktest}
            disabled={loading}
            style={{
              padding: "10px 24px",
              background: loading ? "rgba(129,140,248,0.1)" : "rgba(129,140,248,0.15)",
              border: "1px solid rgba(129,140,248,0.3)",
              borderRadius: 6,
              color: loading ? "#555" : "#818cf8",
              fontSize: 12,
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: MONO
            }}
          >
            {loading ? "RUNNING..." : "RUN BACKTEST"}
          </button>
        </div>
      </Box>
      
      {settings.strategy === 'full_composite' && (
        <Box border="rgba(250,204,21,0.15)" style={{ background: "rgba(250,204,21,0.03)", marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: "#facc15", fontWeight: 700, marginBottom: 6, fontFamily: MONO }}>
            FUNDAMENTAL DATA ASSUMPTION
          </div>
          <div style={{ fontSize: 10, color: "#888", lineHeight: 1.6, fontFamily: "sans-serif" }}>
            The Full Composite strategy uses fundamental scores (Buffett Quality, Moat, ROIC, Earnings Quality, Shareholder Yield) 
            that are point-in-time approximations. For this backtest, fundamental data is fetched once at the start and held 
            stable throughout the simulation period to prevent look-ahead bias. This is a conservative assumption — in reality, 
            fundamentals evolve and quality signals shift over time.
          </div>
        </Box>
      )}
      
      {loading && (
        <Box border="rgba(129,140,248,0.1)" style={{ textAlign: "center", padding: "40px" }}>
          <div style={{ color: "#888", fontFamily: MONO, fontSize: 12 }}>
            Fetching historical data and running simulation...
          </div>
        </Box>
      )}
      
      {error && (
        <Box border="rgba(239,68,68,0.3)" style={{ background: "rgba(239,68,68,0.05)" }}>
          <div style={{ color: "#ef4444", fontSize: 12 }}>Error: {error}</div>
        </Box>
      )}
      
      {results && !loading && (
        <>
          {/* Performance Summary */}
          <Box border="rgba(129,140,248,0.15)">
            <div style={{ fontSize: 10, fontWeight: 700, color: "#818cf8", marginBottom: 12, fontFamily: MONO, letterSpacing: 1 }}>
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
          </Box>
          
          {/* Factor Attribution for Full Composite */}
          {results.strategy === 'full_composite' && results.factorAttribution && (
            <Box border="rgba(129,140,248,0.15)">
              <div style={{ fontSize: 10, fontWeight: 700, color: "#818cf8", marginBottom: 12, fontFamily: MONO, letterSpacing: 1 }}>
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
                      borderLeft: `3px solid ${f.color}`
                    }}>
                      <div style={{ fontSize: 9, color: "#666", fontWeight: 700, letterSpacing: 1, marginBottom: 8, fontFamily: MONO }}>
                        {f.label.toUpperCase()}
                      </div>
                      
                      <div style={{ display: "flex", gap: 16, marginBottom: 8 }}>
                        <div>
                          <div style={{ fontSize: 8, color: "#555", fontFamily: MONO }}>IC</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: icColor, fontFamily: MONO }}>
                            {f.ic >= 0 ? "+" : ""}{f.ic.toFixed(3)}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 8, color: "#555", fontFamily: MONO }}>SPREAD</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: spreadColor, fontFamily: MONO }}>
                            {f.spread >= 0 ? "+" : ""}{f.spread.toFixed(1)}%
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 8, color: "#555", fontFamily: MONO }}>$ CONTRIB</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: f.contribution >= 0 ? "#22c55e" : "#ef4444", fontFamily: MONO }}>
                            ${Math.abs(f.contribution) >= 1000 ? (f.contribution / 1000).toFixed(1) + "k" : f.contribution.toFixed(0)}
                          </div>
                        </div>
                      </div>
                      
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontFamily: MONO }}>
                        <span style={{ color: "#555" }}>{(f.originalWeight * 100).toFixed(0)}%</span>
                        <span style={{ color: deltaColor, fontWeight: 700 }}>
                          {weightDelta > 0.005 ? "\u2192" : weightDelta < -0.005 ? "\u2192" : "="} {(f.suggestedWeight * 100).toFixed(0)}%
                        </span>
                        {Math.abs(weightDelta) > 0.005 && (
                          <span style={{ color: deltaColor, fontSize: 9 }}>
                            ({weightDelta > 0 ? "+" : ""}{(weightDelta * 100).toFixed(0)})
                          </span>
                        )}
                      </div>
                      
                      <div style={{ height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2, marginTop: 8, overflow: "hidden" }}>
                        <div style={{
                          height: "100%",
                          width: `${Math.min(Math.max(f.ic * 500 + 50, 5), 100)}%`,
                          background: f.color,
                          borderRadius: 2,
                          transition: "width 0.3s ease"
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              
              <div style={{
                background: "rgba(129,140,248,0.05)",
                border: "1px solid rgba(129,140,248,0.1)",
                borderRadius: 6,
                padding: "10px 14px",
                fontSize: 11,
                color: "#aaa",
                lineHeight: 1.6,
                fontFamily: SANS
              }}>
                {results.factorAttribution.insight}
                <span style={{ color: "#555", fontSize: 10, display: "block", marginTop: 4 }}>
                  IC = rank correlation between factor score and realized return. Spread = avg return of top-half minus bottom-half stocks by factor. Based on {results.factorAttribution.avgStocksPerPeriod} eligible stocks per period.
                </span>
              </div>
            </Box>
          )}
          
          {/* Equity Curve */}
          <Box border="rgba(129,140,248,0.15)">
            <div style={{ fontSize: 10, fontWeight: 700, color: "#818cf8", marginBottom: 12, fontFamily: MONO, letterSpacing: 1 }}>
              EQUITY CURVE — $10,000 INVESTED
            </div>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={results.equityCurve}>
                  <defs>
                    <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#818cf8" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#818cf8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis 
                    dataKey="date" 
                    tick={{ fill: "#555", fontSize: 9, fontFamily: MONO }}
                    tickFormatter={(v) => v.substring(5)}
                    interval="preserveStartEnd"
                  />
                  <YAxis 
                    tick={{ fill: "#555", fontSize: 9, fontFamily: MONO }}
                    tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`}
                    domain={['dataMin - 1000', 'dataMax + 1000']}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area 
                    type="monotone" 
                    dataKey="portfolio" 
                    stroke="#818cf8" 
                    fill="url(#portfolioGradient)" 
                    strokeWidth={2}
                    name="Portfolio"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="benchmark" 
                    stroke="#555" 
                    strokeWidth={1}
                    dot={false}
                    name="Benchmark (SPY)"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 8, justifyContent: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 16, height: 3, background: "#818cf8", borderRadius: 2 }} />
                <span style={{ fontSize: 10, color: "#888", fontFamily: MONO }}>Strategy</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 16, height: 1, background: "#555" }} />
                <span style={{ fontSize: 10, color: "#888", fontFamily: MONO }}>SPY Benchmark</span>
              </div>
            </div>
          </Box>
          
          {/* Monthly Returns Heatmap */}
          <Box border="rgba(129,140,248,0.15)">
            <div style={{ fontSize: 10, fontWeight: 700, color: "#818cf8", marginBottom: 12, fontFamily: MONO, letterSpacing: 1 }}>
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
                      <div style={{ fontSize: 8, color: "#666", fontFamily: MONO }}>{m.month.substring(5)}</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color, fontFamily: MONO }}>
                        {portNum >= 0 ? "+" : ""}{portNum.toFixed(1)}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Box>
          
          {/* Trade Log */}
          <Box border="rgba(129,140,248,0.15)">
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
              <div style={{ fontSize: 10, fontWeight: 700, color: "#818cf8", fontFamily: MONO, letterSpacing: 1 }}>
                TRADE LOG — {results.trades.length} TRADES
              </div>
              <span style={{ color: "#555", fontSize: 12 }}>{showTrades ? "▲" : "▼"}</span>
            </div>
            
            {showTrades && (
              <div style={{ overflowX: "auto", maxHeight: 400, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: MONO }}>
                  <thead>
                    <tr style={{ background: "rgba(255,255,255,0.02)" }}>
                      <th style={{ padding: "8px 10px", textAlign: "left", color: "#555" }}>Date</th>
                      <th style={{ padding: "8px 10px", textAlign: "left", color: "#555" }}>Action</th>
                      <th style={{ padding: "8px 10px", textAlign: "left", color: "#555" }}>Ticker</th>
                      <th style={{ padding: "8px 10px", textAlign: "right", color: "#555" }}>Shares</th>
                      <th style={{ padding: "8px 10px", textAlign: "right", color: "#555" }}>Price</th>
                      <th style={{ padding: "8px 10px", textAlign: "right", color: "#555" }}>Value</th>
                      <th style={{ padding: "8px 10px", textAlign: "right", color: "#555" }}>Return</th>
                      <th style={{ padding: "8px 10px", textAlign: "right", color: "#555" }}>Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.trades.slice(0, 100).map((t, i) => (
                      <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
                        <td style={{ padding: "8px 10px", color: "#888" }}>{t.date}</td>
                        <td style={{ 
                          padding: "8px 10px", 
                          color: t.type === "BUY" ? "#60a5fa" : t.holdingReturn > 0 ? "#22c55e" : "#ef4444",
                          fontWeight: 700
                        }}>
                          {t.type}
                        </td>
                        <td style={{ padding: "8px 10px", color: "#f0f0f0", fontWeight: 600 }}>{t.ticker}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#888" }}>{t.shares}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#888" }}>${t.price?.toFixed(2)}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#888" }}>
                          ${(t.cost || t.proceeds)?.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                        <td style={{ 
                          padding: "8px 10px", 
                          textAlign: "right",
                          color: t.holdingReturn > 0 ? "#22c55e" : t.holdingReturn < 0 ? "#ef4444" : "#888"
                        }}>
                          {t.holdingReturn != null ? `${(t.holdingReturn * 100).toFixed(1)}%` : "-"}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#888" }}>
                          {t.holdingDays || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {results.trades.length > 100 && (
                  <div style={{ textAlign: "center", color: "#555", fontSize: 10, padding: 8 }}>
                    Showing 100 of {results.trades.length} trades
                  </div>
                )}
              </div>
            )}
          </Box>
          
          {/* Disclaimer */}
          <Box border="rgba(250,204,21,0.15)" style={{ background: "rgba(250,204,21,0.03)" }}>
            <div style={{ fontSize: 10, color: "#facc15", fontWeight: 700, marginBottom: 8, fontFamily: MONO }}>
              DISCLAIMER
            </div>
            <div style={{ fontSize: 10, color: "#888", lineHeight: 1.6, fontFamily: "sans-serif" }}>
              Past performance does not predict future results. This backtest uses historical data with adjusted prices 
              and simulated execution. Real trading involves slippage, commissions, taxes, and liquidity constraints 
              not modeled here. This is an educational tool for understanding strategy behavior, not a guarantee of 
              future returns.
            </div>
          </Box>
        </>
      )}
      
      {!results && !loading && !error && (
        <Box border="rgba(129,140,248,0.1)" style={{ textAlign: "center", padding: "60px 20px" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>Backtest</div>
          <div style={{ fontSize: 12, color: "#555", marginBottom: 8 }}>Run a walk-forward backtest to measure strategy performance</div>
          <div style={{ fontSize: 10, color: "#444" }}>Configure settings above and click "Run Backtest" to begin</div>
        </Box>
      )}
    </div>
  );
}
