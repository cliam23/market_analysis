import { useState, useEffect, lazy, Suspense } from "react";
import SearchView from "./components/SearchView.jsx";
import BacktestTab from "./components/BacktestTab.jsx";
const RankingsView = lazy(() => import("./components/RankingsView.jsx"));
const AnalysisDetail = lazy(() => import("./components/AnalysisDetail.jsx"));

const MONO = "'IBM Plex Mono', monospace";
const SANS = "'DM Sans', sans-serif";

export default function App() {
  const [tab, setTab] = useState("search");
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [view, setView] = useState("list");
  const [backendConnected, setBackendConnected] = useState(true);
  const [rankingsKey, setRankingsKey] = useState(0);

  useEffect(() => {
    checkBackend();
    const interval = setInterval(checkBackend, 30000);
    return () => clearInterval(interval);
  }, []);

  const checkBackend = async () => {
    try {
      const res = await fetch("/api/health", { method: "GET" });
      setBackendConnected(res.ok);
    } catch {
      setBackendConnected(false);
    }
  };

  const handleSelectTicker = (ticker) => {
    setSelectedTicker(ticker);
    setView("detail");
  };

  const handleBack = () => {
    setView("list");
    setSelectedTicker(null);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#07070c", color: "#f0f0f0", fontFamily: SANS }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        *::-webkit-scrollbar { width: 4px; height: 4px; }
        *::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        *:focus { outline: none; }
        * { box-sizing: border-box; }
        body { margin: 0; }
      `}</style>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 5, color: "#818cf8", marginBottom: 5, fontFamily: MONO }}>
            VALUE SIGNAL PRO
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>
            Buffett-Grade Analysis Engine
          </h1>
          <p style={{ fontSize: 10, color: "#444", marginTop: 5, fontFamily: MONO }}>
            Real-time Analysis · Momentum Rankings · Strategy Backtest
          </p>
        </div>

        {/* Connection Status */}
        {!backendConnected && (
          <div style={{
            padding: "10px 14px",
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 6,
            marginBottom: 16,
            fontSize: 11,
            color: "#ef4444",
            fontFamily: MONO
          }}>
            ⚠ Backend not connected — start with <strong>npm run dev:all</strong>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: 4, width: "fit-content" }}>
          <button
            onClick={() => { setTab("search"); setView("list"); setSelectedTicker(null); }}
            style={{
              padding: "10px 20px",
              background: tab === "search" ? "rgba(129,140,248,0.15)" : "transparent",
              border: "none",
              borderRadius: 6,
              color: tab === "search" ? "#f0f0f0" : "#555",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: MONO,
              display: "flex",
              alignItems: "center",
              gap: 6
            }}
          >
            <span>🔍</span> Search
          </button>
          <button
            onClick={() => { setTab("backtest"); setView("list"); setSelectedTicker(null); }}
            style={{
              padding: "10px 20px",
              background: tab === "backtest" ? "rgba(129,140,248,0.15)" : "transparent",
              border: "none",
              borderRadius: 6,
              color: tab === "backtest" ? "#f0f0f0" : "#555",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: MONO,
              display: "flex",
              alignItems: "center",
              gap: 6
            }}
          >
            <span>Backtest</span>
          </button>
          <button
            onClick={() => { setTab("rankings"); setView("list"); setSelectedTicker(null); setRankingsKey(k => k + 1); }}
            style={{
              padding: "10px 20px",
              background: tab === "rankings" ? "rgba(129,140,248,0.15)" : "transparent",
              border: "none",
              borderRadius: 6,
              color: tab === "rankings" ? "#f0f0f0" : "#555",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: MONO,
              display: "flex",
              alignItems: "center",
              gap: 6
            }}
          >
            <span>📊</span> Momentum Rankings
          </button>
        </div>

        {/* Content */}
        <Suspense fallback={<div style={{ textAlign: "center", padding: 40, color: "#555", fontFamily: MONO, fontSize: 11 }}>Loading...</div>}>
          {view === "detail" && selectedTicker ? (
            <AnalysisDetail ticker={selectedTicker} onBack={handleBack} />
          ) : (
            <>
              {tab === "search" && (
                <SearchView onSelectTicker={handleSelectTicker} key="search" />
              )}
              {tab === "backtest" && (
                <BacktestTab />
              )}
              {tab === "rankings" && (
                <RankingsView onSelectTicker={handleSelectTicker} key={`rankings-${rankingsKey}`} />
              )}
            </>
          )}
        </Suspense>

        {/* Footer */}
        <div style={{
          marginTop: 40,
          paddingTop: 20,
          borderTop: "1px solid rgba(255,255,255,0.05)",
          textAlign: "center"
        }}>
          <div style={{ fontSize: 9, color: "#333", fontFamily: MONO, lineHeight: 1.8 }}>
            <p style={{ margin: "0 0 5px" }}>Educational tool · Not financial advice · Verify independently</p>
            <p style={{ margin: 0 }}>
              Powered by Yahoo Finance · Analysis algorithms from Buffett methodology
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
