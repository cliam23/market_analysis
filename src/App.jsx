import { useState, useEffect, lazy, Suspense } from "react";
import { apiFetch } from "./lib/api.js";
import SearchView from "./components/SearchView.jsx";
import DashboardTab from "./components/DashboardTab.jsx";
import BacktestTab from "./components/BacktestTab.jsx";
import RLTab from "./components/RLTab.jsx";
import PaperTradeTab from "./components/PaperTradeTab.jsx";
import AlphaLabTab from "./components/AlphaLabTab.jsx";
import OptionsTab from "./components/OptionsTab.jsx";
import AboutTab from "./components/AboutTab.jsx";
import PaperRebalanceStandalone from "./components/PaperRebalanceStandalone.jsx";
import Sidebar, { SidebarStandalone } from "./components/Sidebar.jsx";
import { pushRecentTicker } from "./lib/recentTickers.js";
const AnalysisDetail = lazy(() => import("./components/AnalysisDetail.jsx"));

function parsePaperReportFromSearch() {
  try {
    const p = new URLSearchParams(window.location.search);
    const d = p.get("paperRebalance");
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.trim())) return null;
    return { date: d.trim(), occurrence: p.get("paperRebalanceOcc") };
  } catch {
    return null;
  }
}

export default function App() {
  const [paperReport, setPaperReport] = useState(parsePaperReportFromSearch);
  const [tab, setTab] = useState("dashboard");
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [backendConnected, setBackendConnected] = useState(true);

  useEffect(() => {
    checkBackend();
    const interval = setInterval(checkBackend, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const sync = () => setPaperReport(parsePaperReportFromSearch());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const checkBackend = async () => {
    try {
      const res = await apiFetch("/api/health", { method: "GET" });
      setBackendConnected(res.ok);
    } catch {
      setBackendConnected(false);
    }
  };

  const handleSelectTicker = (ticker) => {
    pushRecentTicker(ticker);
    setSelectedTicker(ticker);
    setTab("search");
  };

  const handleBack = () => {
    setSelectedTicker(null);
  };

  const goDashboard = () => {
    const u = new URL(window.location.href);
    u.search = "";
    window.history.pushState({}, "", u);
    setPaperReport(null);
    setTab("dashboard");
  };

  if (paperReport) {
    return (
      <div className="ma-app-shell">
        <SidebarStandalone onHome={goDashboard} />
        <div className="ma-main">
          <div className="ma-main__inner">
            <PaperRebalanceStandalone date={paperReport.date} occurrence={paperReport.occurrence} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ma-app-shell">
      <Sidebar tab={tab} setTab={setTab} />
      <div className="ma-main">
        <div className="ma-main__inner">
          {!backendConnected && (
            <div className="ma-backend-banner">
              Backend not connected — start with <strong>npm run dev:all</strong>
            </div>
          )}
          <div style={{ display: tab === "dashboard" ? "block" : "none" }}>
            <DashboardTab setTab={setTab} />
          </div>

          <div style={{ display: tab === "search" ? "block" : "none" }}>
            <div style={{ display: selectedTicker ? "none" : "block" }}>
              <SearchView
                onSelectTicker={handleSelectTicker}
                visible={tab === "search" && !selectedTicker}
              />
            </div>
            {selectedTicker && (
              <Suspense fallback={<div className="ma-suspend-fallback">Loading analysis...</div>}>
                <AnalysisDetail ticker={selectedTicker} onBack={handleBack} onAnalyzeTicker={handleSelectTicker} />
              </Suspense>
            )}
          </div>

          <div style={{ display: tab === "backtest" ? "block" : "none" }}>
            <BacktestTab />
          </div>

          <div style={{ display: tab === "papertrade" ? "block" : "none" }}>
            <PaperTradeTab visible={tab === "papertrade"} onOpenTicker={handleSelectTicker} />
          </div>

          <div style={{ display: tab === "alphalab" ? "block" : "none" }}>
            <AlphaLabTab visible={tab === "alphalab"} />
          </div>

          <div style={{ display: tab === "options" ? "block" : "none" }}>
            <OptionsTab visible={tab === "options"} />
          </div>

          <div style={{ display: tab === "rl" ? "block" : "none" }}>
            <RLTab />
          </div>

          <div style={{ display: tab === "about" ? "block" : "none" }}>
            <AboutTab setTab={setTab} backendConnected={backendConnected} />
          </div>

          <div className="ma-footer-tiny">
            Educational tool · Not financial advice. Market data from Yahoo Finance. Verify independently.
          </div>
        </div>
      </div>
    </div>
  );
}
