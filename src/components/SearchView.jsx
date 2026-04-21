import { useState, useEffect, useCallback } from "react";
import { Search } from "lucide-react";
import { apiFetch } from "../lib/api.js";
import { readRecentTickers } from "../lib/recentTickers.js";

export default function SearchView({ onSelectTicker, visible = true }) {
  const [query, setQuery] = useState("");
  const [holdings, setHoldings] = useState([]);
  const [recent, setRecent] = useState(() => readRecentTickers());
  const [portfolioErr, setPortfolioErr] = useState(null);

  const refreshRecent = useCallback(() => setRecent(readRecentTickers()), []);

  /** Re-sync from localStorage whenever the empty search screen is shown (component stays mounted while analysis is open). */
  useEffect(() => {
    if (!visible) return;
    setRecent(readRecentTickers());
  }, [visible]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/paper-trade/portfolio?universe=sp500_top150");
        const json = await res.json();
        if (cancelled) return;
        if (!json.success || !json.portfolio?.holdings) {
          setHoldings([]);
          return;
        }
        const sorted = [...json.portfolio.holdings].sort(
          (a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0)
        );
        setHoldings(sorted);
        setPortfolioErr(null);
      } catch {
        if (!cancelled) {
          setHoldings([]);
          setPortfolioErr("Could not load portfolio chips");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runTicker = (raw) => {
    const t = String(raw || "")
      .trim()
      .toUpperCase();
    if (!t) return;
    onSelectTicker(t);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    runTicker(query);
  };

  return (
    <div className="ma-search-empty">
      <div className="ma-search-hero">
        <form onSubmit={handleSearch}>
          <div className="ma-search-input-wrap">
            <Search className="ma-search-icon" size={20} strokeWidth={2} aria-hidden />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value.toUpperCase())}
              placeholder="Search any ticker…"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              autoFocus
            />
            <button type="submit" disabled={!query.trim()} className="ma-btn-primary ma-mono ma-search-submit">
              Analyze
            </button>
          </div>
        </form>
        <p className="ma-search-hint">Press Enter or click Analyze to research</p>
      </div>

      <div className="ma-search-section">
        <div className="ma-search-section__label">Quick access · Your portfolio holdings</div>
        {portfolioErr && <p className="ma-search-muted">{portfolioErr}</p>}
        <div className="ma-search-chips">
          {holdings.length === 0 && !portfolioErr ? (
            <span className="ma-search-muted">No positions loaded yet.</span>
          ) : (
            holdings.map((h) => (
              <button
                key={h.ticker}
                type="button"
                className="ma-search-chip"
                onClick={() => runTicker(h.ticker)}
              >
                {h.ticker}
              </button>
            ))
          )}
        </div>
        <p className="ma-search-muted">Click any ticker to analyze it instantly</p>
      </div>

      <div className="ma-search-section">
        <div className="ma-search-section__label">Recent searches</div>
        {recent.length === 0 ? (
          <p className="ma-search-muted">Your recent tickers will appear here.</p>
        ) : (
          <div className="ma-search-recent">
            {recent.map((t, i) => (
              <span key={t + i}>
                {i > 0 && <span className="ma-search-muted"> · </span>}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setQuery(t);
                    runTicker(t);
                    refreshRecent();
                  }}
                >
                  {t}
                </a>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
