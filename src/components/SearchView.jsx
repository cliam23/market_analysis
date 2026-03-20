import { useState } from "react";
import { Box, SH } from "./shared.jsx";

const MONO = "'IBM Plex Mono', monospace";

export default function SearchView({ onSelectTicker }) {
  const [query, setQuery] = useState("");

  const handleSearch = (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    onSelectTicker(query.trim().toUpperCase());
  };

  return (
    <div>
      <Box border="rgba(129,140,248,0.1)" style={{ marginBottom: 16 }}>
        <SH color="#818cf8">Search</SH>
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
              fontFamily: MONO,
              outline: "none"
            }}
            autoFocus
          />
          <button
            type="submit"
            disabled={!query.trim()}
            style={{
              padding: "10px 20px",
              background: "rgba(129,140,248,0.15)",
              border: "1px solid rgba(129,140,248,0.3)",
              borderRadius: 6,
              color: !query.trim() ? "#555" : "#818cf8",
              fontSize: 12,
              fontWeight: 700,
              cursor: !query.trim() ? "not-allowed" : "pointer",
              fontFamily: MONO
            }}
          >
            ANALYZE
          </button>
        </form>
      </Box>
    </div>
  );
}
