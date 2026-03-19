import { useState } from "react";
import { LoadingSpinner, fmtPrice, fmtPct, vc } from "./shared.jsx";

export default function SearchView({ onSelectTicker }) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    setLoading(true);
    setError(null);
    onSelectTicker(query.trim().toUpperCase());
  };

  return (
    <div style={{ marginBottom: 24 }}>
      <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, maxWidth: 500 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter ticker symbol (e.g., AAPL)"
          style={{
            flex: 1,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            padding: "10px 14px",
            color: "#f0f0f0",
            fontSize: 14,
            fontFamily: "'IBM Plex Mono', monospace",
            outline: "none"
          }}
          autoFocus
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          style={{
            padding: "10px 20px",
            background: loading ? "rgba(129,140,248,0.1)" : "rgba(129,140,248,0.15)",
            border: "1px solid rgba(129,140,248,0.3)",
            borderRadius: 6,
            color: loading ? "#555" : "#818cf8",
            fontSize: 12,
            fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer",
            fontFamily: "'IBM Plex Mono', monospace"
          }}
        >
          {loading ? <LoadingSpinner size={16} /> : "SEARCH"}
        </button>
      </form>
      
      {error && (
        <div style={{
          marginTop: 12,
          padding: "10px 14px",
          background: "rgba(239,68,68,0.1)",
          border: "1px solid rgba(239,68,68,0.3)",
          borderRadius: 6,
          color: "#ef4444",
          fontSize: 12
        }}>
          {error}
        </div>
      )}
    </div>
  );
}
