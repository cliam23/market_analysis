import { useState, useMemo, useCallback } from "react";
import { InfoTip } from "./shared.jsx";
import { EDUCATION } from "../lib/education.js";

import { MONO } from "../lib/theme.js";

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

function SH({ color, children }) {
  return (
    <div style={{
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 2,
      color,
      marginBottom: 8,
      textTransform: "uppercase",
      fontFamily: MONO
    }}>
      {children}
    </div>
  );
}

function fmtBillions(val) {
  if (!val) return "$0";
  const absVal = Math.abs(val);
  if (absVal >= 1e12) return `$${(val / 1e12).toFixed(2)}T`;
  if (absVal >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (absVal >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  return `$${val.toFixed(0)}`;
}

function fmtPct(val) {
  if (val === null || val === undefined) return "0%";
  return `${(val * 100).toFixed(1)}%`;
}

function EditableInput({ value, onChange, min, max, step = 0.001, suffix = "%", label }) {
  const [localVal, setLocalVal] = useState((value * 100).toFixed(1));
  const [editing, setEditing] = useState(false);

  const handleBlur = () => {
    setEditing(false);
    const num = parseFloat(localVal) / 100;
    const clamped = Math.max(min || 0, Math.min(max || 1, num));
    onChange(clamped);
    setLocalVal((clamped * 100).toFixed(1));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO, textTransform: "uppercase" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type="text"
          value={localVal}
          onChange={e => setLocalVal(e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={handleBlur}
          onKeyDown={e => e.key === "Enter" && handleBlur()}
          style={{
            background: editing ? "rgba(255,255,255,0.06)" : "transparent",
            border: editing ? "1px solid rgba(255,255,255,0.2)" : "1px dashed #444",
            borderRadius: 4,
            padding: "4px 8px",
            color: "#f0f0f0",
            fontSize: 13,
            fontFamily: MONO,
            width: 60,
            outline: "none"
          }}
        />
        <span style={{ fontSize: 12, color: "#f0f0f0" }}>{suffix}</span>
      </div>
    </div>
  );
}

function WACCBreakdown({ components }) {
  if (!components) return null;
  const { riskFreeRate, equityRiskPremium, adjustedBeta, costOfEquity, costOfDebt, costOfDebtAfterTax, equityWeight, debtWeight } = components;
  
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: 10, marginTop: 8 }}>
      <div style={{ fontSize: 11, color: "#f0f0f0", marginBottom: 6, fontFamily: MONO }}>WACC COMPONENTS</div>
      <div style={{ fontSize: 12, color: "#f0f0f0", lineHeight: 1.6 }}>
        <div>Cost of Equity: {(costOfEquity * 100).toFixed(1)}%</div>
        <div style={{ fontSize: 11, color: "#f0f0f0", marginLeft: 10 }}>Rf {riskFreeRate * 100}% + β {adjustedBeta.toFixed(2)} × ERP {equityRiskPremium * 100}%</div>
        <div>Cost of Debt: {(costOfDebt * 100).toFixed(1)}% → {(costOfDebtAfterTax * 100).toFixed(1)}% after tax</div>
        <div>Capital: {(equityWeight * 100).toFixed(0)}% equity / {(debtWeight * 100).toFixed(0)}% debt</div>
      </div>
    </div>
  );
}

function recalculateDCF(inputs) {
  const { baseRevenue, baseFCFMargin, phase1Growth, phase2Growth, terminalGrowth, terminalFCFMargin, wacc, netCash, sharesOutstanding, currentPrice } = inputs;
  
  const projections = [];
  let prevRevenue = baseRevenue;
  
  const phase1Decay = phase1Growth * 0.04;
  const phase1EndRate = Math.max(phase1Growth - (phase1Decay * 4), terminalGrowth + 0.005);
  const phase2Target = terminalGrowth + 0.003;
  
  for (let year = 1; year <= 10; year++) {
    let growth, yearMargin;
    
    if (year <= 5) {
      growth = phase1Growth - (phase1Decay * (year - 1));
      growth = Math.max(growth, terminalGrowth + 0.005);
    } else {
      const fraction = (year - 5) / 5;
      growth = phase1EndRate - (phase1EndRate - phase2Target) * fraction;
    }
    
    yearMargin = year <= 5 ? baseFCFMargin : baseFCFMargin - (baseFCFMargin - terminalFCFMargin) * ((year - 5) / 5);
    const revenue = prevRevenue * (1 + growth);
    const fcf = revenue * yearMargin;
    const df = 1 / Math.pow(1 + wacc, year);
    const pv = fcf * df;
    
    projections.push({ year, revenue, growth, fcfMargin: yearMargin, fcf, discountFactor: df, presentValue: pv });
    prevRevenue = revenue;
  }
  
  // SANITY CHECK
  for (let i = 1; i < projections.length; i++) {
    if (projections[i].growth > projections[i-1].growth + 0.0001) {
      projections[i].growth = projections[i-1].growth - 0.001;
      projections[i].revenue = projections[i-1].revenue * (1 + projections[i].growth);
      projections[i].fcf = projections[i].revenue * projections[i].fcfMargin;
      projections[i].presentValue = projections[i].fcf * projections[i].discountFactor;
    }
  }
  
  const year10 = projections[9];
  const effectiveTg = Math.min(terminalGrowth, wacc - 0.01);
  const terminalFCF = year10.fcf * (1 + effectiveTg);
  const terminalValue = terminalFCF / (wacc - effectiveTg);
  const pvOfTerminal = terminalValue * year10.discountFactor;
  const pvOfFCFs = projections.reduce((s, p) => s + p.presentValue, 0);
  const enterpriseValue = pvOfFCFs + pvOfTerminal;
  const equityValue = Math.max(enterpriseValue + netCash, 0);
  const ivPerShare = sharesOutstanding > 0 ? equityValue / sharesOutstanding : 0;
  const upside = currentPrice > 0 ? (ivPerShare - currentPrice) / currentPrice : 0;
  
  // Sensitivity
  const waccRange = [0.08, 0.085, 0.09, 0.095, 0.10, 0.105, 0.11];
  const tgRange = [0.015, 0.02, 0.025, 0.03, 0.035];
  
  const matrix = waccRange.map(w => tgRange.map(tg => {
    const tgC = Math.min(tg, w - 0.01);
    let pv = 0, prevR = baseRevenue;
    let y10fcf = 0, y10df = 0;
    for (let y = 1; y <= 10; y++) {
      const g = y <= 5 
        ? phase1Growth - (phase1Decay * (y - 1))
        : phase1EndRate - (phase1EndRate - phase2Target) * ((y - 5) / 5);
      const gAdj = Math.max(g, phase2Target);
      const m = y <= 5 ? baseFCFMargin : baseFCFMargin - (baseFCFMargin - terminalFCFMargin) * ((y - 5) / 5);
      const rev = prevR * (1 + gAdj);
      const fcfVal = rev * m;
      const dfV = 1 / Math.pow(1 + w, y);
      pv += fcfVal * dfV;
      if (y === 10) { y10fcf = fcfVal; y10df = dfV; }
      prevR = rev;
    }
    const tv = (y10fcf * (1 + tgC)) / (w - tgC);
    const pvtv = tv * y10df;
    const ev = pv + pvtv + netCash;
    return Math.max(ev / sharesOutstanding, 0);
  }));
  
  return {
    projections,
    terminal: { terminalFCF, terminalValue, pvOfTerminal, percent: pvOfTerminal / (pvOfFCFs + pvOfTerminal) },
    valuation: { pvOfFCFs, pvOfTerminal, enterpriseValue, equityValue, ivPerShare, upside },
    sensitivity: { waccValues: waccRange, tgValues: tgRange, matrix }
  };
}

export default function DCFTab({ data }) {
  const [inputs, setInputs] = useState({
    phase1Growth: data.inputs.phase1Growth,
    phase2Growth: data.inputs.phase2Growth,
    terminalGrowth: data.inputs.terminalGrowthRate,
    terminalFCFMargin: data.inputs.fcfMarginTerminal,
    wacc: data.inputs.wacc
  });
  const [showWACC, setShowWACC] = useState(false);
  const [phase2Warning, setPhase2Warning] = useState(null);
  const [terminalWarning, setTerminalWarning] = useState(null);

  const handlePhase2Change = (value) => {
    if (value >= inputs.phase1Growth) {
      const corrected = Math.max(inputs.phase1Growth - 0.005, 0.01);
      setPhase2Warning(`Phase 2 must be below Phase 1 (${(inputs.phase1Growth * 100).toFixed(1)}%) — adjusted to ${(corrected * 100).toFixed(1)}%`);
      setInputs(i => ({ ...i, phase2Growth: corrected }));
    } else {
      setPhase2Warning(null);
      setInputs(i => ({ ...i, phase2Growth: value }));
    }
  };

  const handleTerminalChange = (value) => {
    if (value >= inputs.phase2Growth) {
      const corrected = Math.max(inputs.phase2Growth - 0.005, 0.01);
      setTerminalWarning(`Terminal must be below Phase 2 (${(inputs.phase2Growth * 100).toFixed(1)}%) — adjusted to ${(corrected * 100).toFixed(1)}%`);
      setInputs(i => ({ ...i, terminalGrowth: corrected }));
    } else {
      setTerminalWarning(null);
      setInputs(i => ({ ...i, terminalGrowth: value }));
    }
  };

  const calc = useMemo(() => {
    return recalculateDCF({
      baseRevenue: data.inputs.baseRevenue,
      baseFCFMargin: data.inputs.fcfMargin,
      phase1Growth: inputs.phase1Growth,
      phase2Growth: inputs.phase2Growth,
      terminalGrowth: inputs.terminalGrowth,
      terminalFCFMargin: inputs.terminalFCFMargin,
      wacc: inputs.wacc,
      netCash: data.inputs.netCash,
      sharesOutstanding: data.sharesOutstanding,
      currentPrice: data.currentPrice
    });
  }, [inputs, data]);

  const resetToDefaults = () => {
    setInputs({
      phase1Growth: data.inputs.phase1Growth,
      phase2Growth: data.inputs.phase2Growth,
      terminalGrowth: data.inputs.terminalGrowthRate,
      terminalFCFMargin: data.inputs.fcfMarginTerminal,
      wacc: data.inputs.wacc
    });
  };

  const cellColor = (iv) => {
    const upside = (iv - data.currentPrice) / data.currentPrice;
    if (upside > 0.3) return "rgba(34,197,94,0.3)";
    if (upside > 0) return "rgba(34,197,94,0.15)";
    if (upside > -0.1) return "rgba(250,204,21,0.15)";
    if (upside > -0.3) return "rgba(249,115,22,0.15)";
    return "rgba(239,68,68,0.15)";
  };

  const cellTextColor = (iv) => {
    const upside = (iv - data.currentPrice) / data.currentPrice;
    if (upside > 0.3) return "#4ade80";
    if (upside > 0) return "#86efac";
    if (upside > -0.1) return "#facc15";
    if (upside > -0.3) return "#fb923c";
    return "#f87171";
  };

  return (
    <div>
      {/* Warnings */}
      {(data.warnings?.terminalHeavy || data.warnings?.financialSector || data.warnings?.highGrowth || data.warnings?.acquisitionGrowth) && (
        <Box border="rgba(234,179,8,0.2)">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {data.warnings.terminalHeavy && (
              <div style={{ fontSize: 12, color: "#eab308", padding: "4px 8px", background: "rgba(234,179,8,0.1)", borderRadius: 4 }}>
                ⚠️ Terminal value is {(data.terminalValue?.terminalAsPercentOfTotal * 100).toFixed(0)}% of total — model is sensitive to long-term assumptions
              </div>
            )}
            {data.warnings.financialSector && (
              <div style={{ fontSize: 12, color: "#eab308", padding: "4px 8px", background: "rgba(234,179,8,0.1)", borderRadius: 4 }}>
                ℹ️ DCF less applicable for financial sector companies
              </div>
            )}
            {data.warnings.highGrowth && (
              <div style={{ fontSize: 12, color: "#eab308", padding: "4px 8px", background: "rgba(234,179,8,0.1)", borderRadius: 4 }}>
                High growth assumptions — verify sustainability
              </div>
            )}
            {data.warnings.acquisitionGrowth && (
              <div style={{ fontSize: 12, color: "#f97316", padding: "4px 8px", background: "rgba(249,115,22,0.1)", borderRadius: 4 }}>
                📈 {data.warnings.acquisitionGrowth}
              </div>
            )}
          </div>
        </Box>
      )}

      {/* Assumptions Panel */}
      <Box border="rgba(255,255,255,0.06)">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <SH color="#f0f0f0">ASSUMPTIONS</SH>
            <InfoTip title={EDUCATION.dcf.title}>{EDUCATION.dcf.content}</InfoTip>
          </div>
          <button onClick={resetToDefaults} style={{ fontSize: 11, padding: "4px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, color: "#f0f0f0", cursor: "pointer", fontFamily: MONO }}>
            RESET
          </button>
        </div>
        
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
          {/* Growth */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO, textTransform: "uppercase", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
              Growth
              <InfoTip title={EDUCATION.phaseGrowth.title}>{EDUCATION.phaseGrowth.content}</InfoTip>
            </div>
            <div style={{ fontSize: 11, color: "#f0f0f0" }}>Base Revenue: <span style={{ color: "#f0f0f0", fontFamily: MONO }}>{fmtBillions(data.inputs.baseRevenue)}</span></div>
            <div style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO }}>
              {data.dataSources?.growthSource === "manual_yoy" 
                ? `YoY (manual): ${(data.dataSources.manualRevenueGrowth * 100).toFixed(1)}%` 
                : data.dataSources?.growthSource === "yahoo_revenueGrowth" 
                  ? `Yahoo: ${(data.dataSources.yahooRevenueGrowth * 100).toFixed(1)}%`
                  : "Default 5%"}
            </div>
            <EditableInput
              label="Phase 1 (Yr 1-5)"
              value={inputs.phase1Growth}
              onChange={v => setInputs(i => ({ ...i, phase1Growth: v }))}
              min={0} max={0.35}
            />
            <EditableInput
              label="Phase 2 (Yr 6-10)"
              value={inputs.phase2Growth}
              onChange={handlePhase2Change}
              min={0} max={0.15}
            />
            {phase2Warning && (
              <div style={{ fontSize: 11, color: "#eab308", marginTop: -4 }}>{phase2Warning}</div>
            )}
            <EditableInput
              label="Terminal Growth"
              value={inputs.terminalGrowth}
              onChange={handleTerminalChange}
              min={0} max={0.05}
            />
            {terminalWarning && (
              <div style={{ fontSize: 11, color: "#eab308", marginTop: -4 }}>{terminalWarning}</div>
            )}
          </div>
          
          {/* Margins */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO, textTransform: "uppercase", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
              Margins
              <InfoTip title={EDUCATION.fcfMargin.title}>{EDUCATION.fcfMargin.content}</InfoTip>
            </div>
            <div style={{ fontSize: 11, color: "#f0f0f0" }}>Current FCF Margin: <span style={{ color: "#f0f0f0", fontFamily: MONO }}>{(data.inputs.fcfMargin * 100).toFixed(1)}%</span></div>
            <EditableInput
              label="Terminal FCF Margin"
              value={inputs.terminalFCFMargin}
              onChange={v => setInputs(i => ({ ...i, terminalFCFMargin: v }))}
              min={0.05} max={0.6}
            />
          </div>
          
          {/* WACC */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO, textTransform: "uppercase", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
              Discount Rate
              <InfoTip title={EDUCATION.wacc.title}>{EDUCATION.wacc.content}</InfoTip>
            </div>
            <EditableInput
              label="WACC"
              value={inputs.wacc}
              onChange={v => setInputs(i => ({ ...i, wacc: v }))}
              min={0.05} max={0.15}
            />
            <div style={{ fontSize: 11, color: "#f0f0f0", cursor: "pointer" }} onClick={() => setShowWACC(!showWACC)}>
              {showWACC ? "▼ Hide" : "▶ Show"} breakdown
            </div>
            {showWACC && <WACCBreakdown components={data.inputs.waccComponents} />}
          </div>
        </div>
      </Box>

      {/* Valuation Summary */}
      <Box border="rgba(34,197,94,0.2)">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO, marginBottom: 4 }}>INTRINSIC VALUE</div>
            <div style={{ fontSize: 36, fontWeight: 900, color: calc.valuation.upside >= 0 ? "#22c55e" : "#ef4444", fontFamily: MONO }}>
              ${calc.valuation.ivPerShare.toFixed(2)}
            </div>
            {data.valuation?.buybackAdjustedIV && (
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO }}>BUYBACK ADJ</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#f0f0f0", fontFamily: MONO }}>
                  ${data.valuation.buybackAdjustedIV.toFixed(2)}
                </div>
              </div>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO }}>CURRENT PRICE</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#f0f0f0", fontFamily: MONO }}>${data.currentPrice.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO }}>BASE UPSIDE</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: calc.valuation.upside >= 0 ? "#22c55e" : "#ef4444", fontFamily: MONO }}>
                  {calc.valuation.upside >= 0 ? "+" : ""}{(calc.valuation.upside * 100).toFixed(1)}%
                </div>
              </div>
              {data.valuation?.buybackAdjustedIV && data.valuation.buybackAdjustedUpside != null && (
                <div>
                  <div style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO }}>ADJ UPSIDE</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: data.valuation.buybackAdjustedUpside >= 0 ? "#22c55e" : "#ef4444", fontFamily: MONO }}>
                    {data.valuation.buybackAdjustedUpside >= 0 ? "+" : ""}{(data.valuation.buybackAdjustedUpside * 100).toFixed(1)}%
                  </div>
                </div>
              )}
            </div>
            <div style={{ fontSize: 12, color: "#f0f0f0" }}>
              Enterprise Value: {fmtBillions(calc.valuation.enterpriseValue)} | 
              {fmtBillions(data.inputs.netCash)} net {data.inputs.netCash >= 0 ? "cash" : "debt"}
              {data.valuation?.buybackYield > 0.01 && (
                <span style={{ color: "#f0f0f0" }}> | {(data.valuation.buybackYield * 100).toFixed(1)}% buyback yield</span>
              )}
            </div>
          </div>
        </div>
      </Box>

      {/* Projection Table */}
      <Box border="rgba(255,255,255,0.06)">
        <SH color="#f0f0f0">10-YEAR PROJECTIONS</SH>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: MONO }}>
            <thead>
              <tr style={{ color: "#f0f0f0", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                <th style={{ padding: "8px 6px", textAlign: "left" }}>Yr</th>
                <th style={{ padding: "8px 6px", textAlign: "right" }}>Revenue</th>
                <th style={{ padding: "8px 6px", textAlign: "right" }}>Growth</th>
                <th style={{ padding: "8px 6px", textAlign: "right" }}>FCF Margin</th>
                <th style={{ padding: "8px 6px", textAlign: "right" }}>FCF</th>
                <th style={{ padding: "8px 6px", textAlign: "right" }}>Discount Factor</th>
                <th style={{ padding: "8px 6px", textAlign: "right" }}>PV</th>
              </tr>
            </thead>
            <tbody>
              {calc.projections.map((p, i) => (
                <tr key={p.year} style={{ opacity: p.year > 5 ? 0.7 : 1, borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                  <td style={{ padding: "8px 6px", color: p.year > 5 ? "#888" : "#f0f0f0" }}>{p.year}</td>
                  <td style={{ padding: "8px 6px", textAlign: "right", color: "#f0f0f0" }}>{fmtBillions(p.revenue)}</td>
                  <td style={{ padding: "8px 6px", textAlign: "right", color: p.growth >= 0.08 ? "#4ade80" : "#888" }}>{(p.growth * 100).toFixed(1)}%</td>
                  <td style={{ padding: "8px 6px", textAlign: "right", color: "#f0f0f0" }}>{(p.fcfMargin * 100).toFixed(1)}%</td>
                  <td style={{ padding: "8px 6px", textAlign: "right", color: "#f0f0f0" }}>{fmtBillions(p.fcf)}</td>
                  <td style={{ padding: "8px 6px", textAlign: "right", color: "#f0f0f0" }}>{p.discountFactor.toFixed(3)}</td>
                  <td style={{ padding: "8px 6px", textAlign: "right", color: "#f0f0f0" }}>{fmtBillions(p.presentValue)}</td>
                </tr>
              ))}
              <tr style={{ background: "rgba(255,255,255,0.04)", fontWeight: 600 }}>
                <td style={{ padding: "10px 6px", color: "#f0f0f0" }}>TV</td>
                <td style={{ padding: "10px 6px", textAlign: "right", color: "#f0f0f0" }}>—</td>
                <td style={{ padding: "10px 6px", textAlign: "right", color: "#f0f0f0" }}>—</td>
                <td style={{ padding: "10px 6px", textAlign: "right", color: "#f0f0f0" }}>—</td>
                <td style={{ padding: "10px 6px", textAlign: "right", color: "#f0f0f0" }}>—</td>
                <td style={{ padding: "10px 6px", textAlign: "right", color: "#f0f0f0" }}>—</td>
                <td style={{ padding: "10px 6px", textAlign: "right", color: "#f0f0f0" }}>{fmtBillions(calc.terminal.pvOfTerminal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Box>

      {/* Sensitivity Table */}
      <Box border="rgba(234,179,8,0.15)">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <SH color="#eab308">SENSITIVITY ANALYSIS</SH>
          <InfoTip title={EDUCATION.sensitivityTable.title}>{EDUCATION.sensitivityTable.content}</InfoTip>
        </div>
        <div style={{ fontSize: 12, color: "#f0f0f0", marginBottom: 10 }}>
          Intrinsic value per share at different WACC × Terminal Growth assumptions
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 11, fontFamily: MONO }}>
            <thead>
              <tr>
                <th style={{ padding: "6px", color: "#f0f0f0" }}></th>
                {calc.sensitivity.tgValues.map(tg => (
                  <th key={tg} style={{ padding: "6px 10px", textAlign: "center", color: "#f0f0f0" }}>TG {(tg * 100).toFixed(1)}%</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calc.sensitivity.matrix.map((row, wi) => (
                <tr key={wi}>
                  <td style={{ padding: "6px 10px", color: "#f0f0f0", textAlign: "right" }}>WACC {(calc.sensitivity.waccValues[wi] * 100).toFixed(1)}%</td>
                  {row.map((iv, ti) => {
                    const isCurrent = Math.abs(inputs.wacc - calc.sensitivity.waccValues[wi]) < 0.003 &&
                                     Math.abs(inputs.terminalGrowth - calc.sensitivity.tgValues[ti]) < 0.003;
                    const isMarket = data.marketImplied && 
                                     Math.abs(data.marketImplied.wacc - calc.sensitivity.waccValues[wi]) < 0.003 &&
                                     Math.abs(data.marketImplied.terminalGrowth - calc.sensitivity.tgValues[ti]) < 0.003;
                    return (
                      <td key={ti} style={{
                        padding: "6px 10px",
                        textAlign: "center",
                        background: isMarket ? "rgba(250,204,21,0.25)" : cellColor(iv),
                        color: isMarket ? "#eab308" : cellTextColor(iv),
                        fontWeight: isCurrent || isMarket ? 700 : 400,
                        border: isCurrent ? "2px solid #f0f0f0" : (isMarket ? "2px dashed #eab308" : "1px solid rgba(255,255,255,0.05)"),
                        borderRadius: 4,
                        minWidth: 60
                      }}>
                        ${iv.toFixed(0)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.marketImplied && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#f0f0f0" }}>
            Market price implies ~{(data.marketImplied.wacc * 100).toFixed(1)}% WACC and {(data.marketImplied.terminalGrowth * 100).toFixed(1)}% terminal growth
          </div>
        )}
      </Box>

      {/* Data Source */}
      <Box border="rgba(255,255,255,0.05)">
        <div style={{ fontSize: 11, color: "#f0f0f0", fontFamily: MONO }}>
          <div style={{ marginBottom: 4 }}>DATA SOURCE: {data.dataSources?.fcfSource?.toUpperCase()?.replace("_", " ")}</div>
          <div style={{ color: "#f0f0f0", fontSize: 10 }}>
            This DCF uses a two-phase growth model. Phase 1 (years 1-5) uses near-term growth estimates, 
            Phase 2 (6-10) fades toward the terminal rate. Terminal value uses Gordon Growth Model.
          </div>
        </div>
      </Box>
    </div>
  );
}
