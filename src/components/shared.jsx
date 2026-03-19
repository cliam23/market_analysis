export const MONO = "'IBM Plex Mono', monospace";
export const SANS = "'DM Sans', sans-serif";

export function Pill({ children, color = "#818cf8", style: sx = {} }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: 0.8,
      borderRadius: 3,
      background: color + "15",
      border: "1px solid " + color + "35",
      color,
      fontFamily: MONO,
      textTransform: "uppercase",
      whiteSpace: "nowrap",
      ...sx
    }}>
      {children}
    </span>
  );
}

export function Ring({ value, max = 100, size = 52, sw = 4, color }) {
  const r = (size - sw) / 2;
  const ci = 2 * Math.PI * r;
  const p = Math.min(value / max, 1);
  const c = color || (value >= 75 ? "#22c55e" : value >= 50 ? "#eab308" : "#ef4444");
  
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={sw} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={c}
        strokeWidth={sw}
        strokeDasharray={ci}
        strokeDashoffset={ci * (1 - p)}
        strokeLinecap="round"
        transform={"rotate(-90 " + size / 2 + " " + size / 2 + ")"}
        style={{ transition: "stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)" }}
      />
      <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central" fill={c} fontSize={size * 0.26} fontWeight="800" fontFamily={MONO}>
        {value}
      </text>
    </svg>
  );
}

export function SH({ color, children }) {
  return (
    <div style={{
      fontSize: 9,
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

export function Box({ border, children, style: sx = {} }) {
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

export function Met({ label, value, color = "#f0f0f0" }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      borderRadius: 6,
      padding: "8px 10px",
      textAlign: "center",
      flex: "1 1 75px",
      minWidth: 75
    }}>
      <div style={{ fontSize: 8, color: "#555", fontWeight: 700, letterSpacing: 1, fontFamily: MONO }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color, fontFamily: MONO, marginTop: 2 }}>{value}</div>
    </div>
  );
}

export function LoadingSpinner({ size = 24, color = "#818cf8" }) {
  return (
    <div style={{
      width: size,
      height: size,
      border: `2px solid ${color}30`,
      borderTopColor: color,
      borderRadius: "50%",
      animation: "spin 1s linear infinite"
    }} />
  );
}

export const vc = (v) => ({
  strong_buy: "#22c55e",
  buy: "#4ade80",
  buy_zone: "#4ade80",
  accumulate: "#eab308",
  hold: "#94a3b8",
  avoid: "#ef4444",
  wait: "#ef4444"
}[v] || "#888");

export const tc = (l) => ({
  low: "#22c55e",
  moderate: "#eab308",
  high: "#f97316",
  severe: "#ef4444"
}[l] || "#888");

export const trendColors = {
  strong_uptrend: "#22c55e",
  pullback_in_uptrend: "#eab308",
  mixed: "#94a3b8",
  downtrend: "#ef4444"
};

export function fmtCap(b) {
  const n = parseFloat(b);
  if (!n) return "";
  return n >= 1000 ? "$" + (n / 1000).toFixed(1) + "T" : "$" + n.toFixed(0) + "B";
}

export function fmtPrice(price) {
  if (!price) return "—";
  return "$" + parseFloat(price).toFixed(2);
}

export function fmtPct(pct, signed = false) {
  if (!pct && pct !== 0) return "—";
  const val = parseFloat(pct);
  const sign = signed && val > 0 ? "+" : "";
  return sign + val.toFixed(1) + "%";
}

export function TrendBadge({ status }) {
  const color = trendColors[status] || "#888";
  const label = status?.replace(/_/g, " ").toUpperCase() || "N/A";
  return <Pill color={color}>{label}</Pill>;
}

export function VerdictBadge({ verdict }) {
  return <Pill color={vc(verdict)}>{verdict?.replace(/_/g, " ").toUpperCase() || "HOLD"}</Pill>;
}

export function SeverityBadge({ severity }) {
  return <Pill color={tc(severity)}>{severity?.toUpperCase() || "MODERATE"}</Pill>;
}

import { useState, useEffect } from "react";

export function InfoTip({ title, children }) {
  const [open, setOpen] = useState(false);
  
  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [open]);
  
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <span 
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(!open); }}
        style={{ 
          cursor: 'pointer', fontSize: 11, color: open ? '#818cf8' : '#555', marginLeft: 6,
          width: 16, height: 16, borderRadius: '50%', display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center',
          background: open ? 'rgba(129,140,248,0.2)' : 'rgba(255,255,255,0.03)',
          border: '1px solid ' + (open ? 'rgba(129,140,248,0.4)' : 'rgba(255,255,255,0.08)'),
          transition: 'all 0.2s', userSelect: 'none'
        }}
      >
        i
      </span>
      {open && (
        <div 
          onClick={(e) => { e.stopPropagation(); }}
          style={{
            position: 'absolute', top: 26, left: -10, zIndex: 100,
            width: 320, maxWidth: '85vw',
            background: '#141420', border: '1px solid rgba(129,140,248,0.25)',
            borderRadius: 10, padding: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            animation: 'fadeUp 0.2s ease-out'
          }}
        >
          {title && (
            <div style={{ 
              fontSize: 10, fontWeight: 700, color: '#818cf8', marginBottom: 10, 
              fontFamily: MONO, letterSpacing: 1, textTransform: 'uppercase',
              paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.06)'
            }}>
              {title}
            </div>
          )}
          <div style={{ fontSize: 12, color: '#b0b0b0', lineHeight: 1.7 }}>{children}</div>
          <div 
            onClick={(e) => { e.stopPropagation(); setOpen(false); }} 
            style={{ fontSize: 10, color: '#555', marginTop: 12, cursor: 'pointer', textAlign: 'right' }}
          >
            close ✕
          </div>
        </div>
      )}
    </span>
  );
}
