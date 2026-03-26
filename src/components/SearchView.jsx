import { useState } from "react";
import { Box, SH } from "./shared.jsx";

import { MONO } from "../lib/theme.js";

export default function SearchView({ onSelectTicker }) {
  const [query, setQuery] = useState("");

  const handleSearch = (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    onSelectTicker(query.trim().toUpperCase());
  };

  return (
    <div>
      <Box style={{ marginBottom: 16 }}>
        <SH>Search</SH>
        <form
          onSubmit={handleSearch}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 8,
            alignItems: "center",
            width: "100%",
            maxWidth: "100%",
            boxSizing: "border-box"
          }}
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter ticker symbol (e.g., AAPL)"
            style={{
              minWidth: 0,
              width: "100%",
              boxSizing: "border-box",
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
              flexShrink: 0,
              background: !query.trim() ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 6,
              color: "#f0f0f0",
              fontSize: 13,
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
