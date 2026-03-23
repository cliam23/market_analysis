import { useState, useEffect } from "react";
import { MONO, SANS } from "../lib/theme.js";
import PaperRebalanceReportBody from "./PaperRebalanceReportBody.jsx";

/**
 * Full-page rebalance report loaded via ?paperRebalance=YYYY-MM-DD (&paperRebalanceOcc=n for duplicate dates).
 */
export default function PaperRebalanceStandalone({ date, occurrence }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [rb, setRb] = useState(null);

  useEffect(() => {
    let aborted = false;
    (async () => {
      setLoading(true);
      setErr(null);
      setRb(null);
      const q = new URLSearchParams({ date });
      if (occurrence != null && occurrence !== "") {
        q.set("occurrence", String(occurrence));
      }
      try {
        const res = await fetch(`/api/paper-trade/rebalance-entry?${q}`);
        const data = await res.json().catch(() => ({}));
        if (aborted) return;
        if (!res.ok || !data.success) {
          setErr(data.error || `Request failed (${res.status})`);
        } else {
          setRb(data.rebalance);
        }
      } catch (e) {
        if (!aborted) setErr(e.message || "Network error");
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, [date, occurrence]);

  const backHref = typeof window !== "undefined" ? `${window.location.pathname}` : "/";

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "32px 24px 48px" }}>
      <a
        href={backHref}
        style={{
          fontSize: 12,
          color: "#818cf8",
          fontFamily: MONO,
          textDecoration: "none",
          display: "inline-block",
          marginBottom: 20
        }}
      >
        ← Back to app
      </a>

      <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 8px", fontFamily: SANS, color: "#f0f0f0" }}>
        Rebalance report — {date}
      </h1>
      <p style={{ fontSize: 12, color: "#888", margin: "0 0 24px", fontFamily: MONO, lineHeight: 1.5 }}>
        Linked from <strong style={{ color: "#c8c8c8" }}>Trading</strong> → Rebalance log (same entry as in the expandable row).
      </p>

      {loading && (
        <div style={{ fontSize: 13, color: "#888", fontFamily: MONO }}>Loading…</div>
      )}

      {!loading && err && (
        <div
          style={{
            padding: "14px 16px",
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 8,
            fontSize: 13,
            color: "#fca5a5",
            fontFamily: MONO
          }}
        >
          {err}
        </div>
      )}

      {!loading && !err && rb && <PaperRebalanceReportBody rb={rb} variant="page" />}
    </div>
  );
}
