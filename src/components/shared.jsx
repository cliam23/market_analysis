import { useState, useEffect } from "react";
export { MONO, SANS, TEXT, GREEN, RED, AMBER } from "../lib/theme.js";
import { MONO, SANS, TEXT } from "../lib/theme.js";

export function Pill({ children, color = "#f0f0f0", style: sx = {} }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 10px",
      fontSize: 11,
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

export function SH({ color, children, compact }) {
  return (
    <div style={{
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 2,
      color: color || "#f0f0f0",
      marginBottom: compact ? 0 : 8,
      lineHeight: compact ? 1.2 : undefined,
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
      padding: 16,
      marginBottom: 12,
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
      padding: "10px 12px",
      textAlign: "center",
      flex: "1 1 75px",
      minWidth: 75
    }}>
      <div style={{ fontSize: 10, color: "#f0f0f0", fontWeight: 700, letterSpacing: 1, fontFamily: MONO }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color, fontFamily: MONO, marginTop: 2 }}>{value}</div>
    </div>
  );
}

export function LoadingSpinner({ size = 24, color = "#f0f0f0" }) {
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
  hold: "#f0f0f0",
  avoid: "#ef4444",
  wait: "#ef4444"
}[v] || "#f0f0f0");

export const tc = (l) => ({
  low: "#22c55e",
  moderate: "#eab308",
  high: "#f97316",
  severe: "#ef4444"
}[l] || "#f0f0f0");

export const trendColors = {
  strong_uptrend: "#22c55e",
  pullback_in_uptrend: "#eab308",
  mixed: "#f0f0f0",
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
  const color = trendColors[status] || "#f0f0f0";
  const label = status?.replace(/_/g, " ").toUpperCase() || "N/A";
  return <Pill color={color}>{label}</Pill>;
}

export function VerdictBadge({ verdict }) {
  return <Pill color={vc(verdict)}>{verdict?.replace(/_/g, " ").toUpperCase() || "HOLD"}</Pill>;
}

export function SeverityBadge({ severity }) {
  return <Pill color={tc(severity)}>{severity?.toUpperCase() || "MODERATE"}</Pill>;
}

let _infoTipCloseId = 0;

/**
 * @param {'start' | 'end'} [placement] — start: panel grows right (default). end: align panel’s right edge to the icon (use for triggers flush to the viewport right).
 */
export function InfoTip({ title, children, placement = "start" }) {
  const [open, setOpen] = useState(false);
  const [myId] = useState(() => ++_infoTipCloseId);
  
  useEffect(() => {
    const closeOthers = (e) => {
      if (e.detail !== myId) setOpen(false);
    };
    document.addEventListener('infotip:open', closeOthers);
    return () => document.removeEventListener('infotip:open', closeOthers);
  }, [myId]);

  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [open]);
  
  const handleClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!open) {
      document.dispatchEvent(new CustomEvent('infotip:open', { detail: myId }));
    }
    setOpen(!open);
  };

  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', alignSelf: 'center', lineHeight: 0 }}>
      <span 
        onClick={handleClick}
        style={{ 
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 700,
          fontFamily: SANS,
          color: '#f0f0f0',
          width: 18,
          height: 18,
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          lineHeight: 1,
          background: open ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)',
          border: '1px solid ' + (open ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'),
          transition: 'all 0.2s', userSelect: 'none'
        }}
      >
        i
      </span>
      {open && (
        <div 
          onClick={(e) => { e.stopPropagation(); }}
          style={{
            position: 'absolute',
            top: 26,
            zIndex: 500,
            width: 320,
            maxWidth: 'min(320px, calc(100vw - 24px))',
            left: placement === 'end' ? 'auto' : -8,
            right: placement === 'end' ? 0 : 'auto',
            background: 'linear-gradient(165deg, rgba(26,26,36,0.98) 0%, #12121a 100%)',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 12,
            padding: '16px 18px 14px',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.4), 0 16px 48px rgba(0,0,0,0.55), 0 4px 16px rgba(0,0,0,0.35)',
            textTransform: 'none',
            fontFamily: SANS,
            backdropFilter: 'blur(12px)'
          }}
        >
          {title && (
            <div style={{ 
              fontSize: 12, fontWeight: 700, color: '#f0f0f0', marginBottom: 10, 
              fontFamily: SANS, letterSpacing: 0.4,
              paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.08)'
            }}>
              {title}
            </div>
          )}
          <div style={{
            fontSize: 13,
            color: 'rgba(240,240,240,0.92)',
            lineHeight: 1.65,
            fontFamily: SANS,
            maxHeight: 'min(280px, 48vh)',
            overflowY: 'auto',
            paddingRight: 4,
            marginRight: -2
          }}>{children}</div>
          <div 
            onClick={(e) => { e.stopPropagation(); setOpen(false); }} 
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.3,
              color: '#818cf8',
              marginTop: 14,
              paddingTop: 10,
              borderTop: '1px solid rgba(255,255,255,0.06)',
              cursor: 'pointer',
              textAlign: 'right',
              fontFamily: SANS
            }}
          >
            CLOSE ✕
          </div>
        </div>
      )}
    </span>
  );
}
