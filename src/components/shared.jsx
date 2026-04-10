import { useState, useEffect } from "react";
export { MONO, SANS, TEXT, GREEN, RED, AMBER } from "../lib/theme.js";
import { SANS } from "../lib/theme.js";

/** Primary run / scan / cancel actions: dedicated row, right-aligned (Backtest, Rankings, Search, etc.). */
export const RUN_ACTION_BAR_STYLE = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 12,
  width: "100%",
  boxSizing: "border-box"
};

/** Verdict → pill variant (semantic). */
export const verdictVariant = (v) =>
  ({
    strong_buy: "green",
    buy: "green",
    buy_zone: "green",
    accumulate: "amber",
    hold: "neutral",
    avoid: "red",
    wait: "red"
  }[v] || "neutral");

/** Threat / severity → pill variant. */
export const severityVariant = (level) =>
  ({
    low: "green",
    moderate: "amber",
    high: "amber",
    severe: "red"
  }[level] || "neutral");

export function Pill({ children, variant = "neutral", style: sx = {}, title, ...rest }) {
  return (
    <span className={`ma-pill ma-pill--${variant}`} style={sx} title={title} {...rest}>
      {children}
    </span>
  );
}

export function Ring({ value, max = 100, size = 52, sw = 4, color }) {
  const r = (size - sw) / 2;
  const ci = 2 * Math.PI * r;
  const p = Math.min(value / max, 1);
  const c = color || (value >= 75 ? "var(--color-positive)" : value >= 50 ? "var(--color-amber)" : "var(--color-negative)");

  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-border)" strokeWidth={sw} />
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
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill={c}
        fontSize={size * 0.26}
        fontWeight="800"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {value}
      </text>
    </svg>
  );
}

export function SH({ color, children, compact }) {
  return (
    <div
      className={"ma-sh" + (compact ? " ma-sh--compact" : "")}
      style={color ? { color } : undefined}
    >
      {children}
    </div>
  );
}

export function Box({ border, children, style: sx = {} }) {
  return (
    <div
      className="ma-card"
      style={{
        ...(border ? { borderColor: border } : {}),
        ...sx
      }}
    >
      {children}
    </div>
  );
}

export function Met({ label, value, color }) {
  return (
    <div
      style={{
        background: "var(--color-surface-elevated)",
        borderRadius: 6,
        padding: "10px 12px",
        textAlign: "center",
        flex: "1 1 75px",
        minWidth: 75,
        border: "1px solid var(--color-border)"
      }}
    >
      <div
        className="ma-field-label"
        style={{ marginBottom: 2 }}
      >
        {label}
      </div>
      <div
        className="ma-num ma-mono"
        style={{
          fontSize: 16,
          fontWeight: 800,
          color: color || "var(--color-text-primary)",
          marginTop: 2
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function LoadingSpinner({ size = 24, color }) {
  const c = color || "var(--color-text-muted)";
  return (
    <div
      style={{
        width: size,
        height: size,
        border: `2px solid var(--color-border)`,
        borderTopColor: c,
        borderRadius: "50%",
        animation: "spin 1s linear infinite"
      }}
    />
  );
}

export const trendColors = {
  strong_uptrend: "var(--color-positive)",
  pullback_in_uptrend: "var(--color-amber)",
  mixed: "var(--color-text-muted)",
  downtrend: "var(--color-negative)"
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
  const map = {
    strong_uptrend: "green",
    pullback_in_uptrend: "amber",
    mixed: "neutral",
    downtrend: "red"
  };
  const variant = map[status] || "neutral";
  const label = status?.replace(/_/g, " ").toUpperCase() || "N/A";
  return <Pill variant={variant}>{label}</Pill>;
}

export function VerdictBadge({ verdict }) {
  return (
    <Pill variant={verdictVariant(verdict)}>
      {verdict?.replace(/_/g, " ").toUpperCase() || "HOLD"}
    </Pill>
  );
}

export function SeverityBadge({ severity }) {
  return (
    <Pill variant={severityVariant(severity)}>
      {severity?.toUpperCase() || "MODERATE"}
    </Pill>
  );
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
    document.addEventListener("infotip:open", closeOthers);
    return () => document.removeEventListener("infotip:open", closeOthers);
  }, [myId]);

  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [open]);

  const handleClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!open) {
      document.dispatchEvent(new CustomEvent("infotip:open", { detail: myId }));
    }
    setOpen(!open);
  };

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", alignSelf: "center", lineHeight: 0 }}>
      <span
        onClick={handleClick}
        className={"ma-infotip-trigger" + (open ? " ma-infotip-trigger--open" : "")}
      >
        i
      </span>
      {open && (
        <div
          onClick={(e) => {
            e.stopPropagation();
          }}
          className="ma-infotip-panel"
          style={{
            left: placement === "end" ? "auto" : -8,
            right: placement === "end" ? 0 : "auto"
          }}
        >
          {title && <div className="ma-infotip-panel__title">{title}</div>}
          <div className="ma-infotip-panel__body">{children}</div>
          <div
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            className="ma-infotip-panel__close"
          >
            CLOSE ✕
          </div>
        </div>
      )}
    </span>
  );
}
