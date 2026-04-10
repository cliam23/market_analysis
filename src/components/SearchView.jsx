import { useState } from "react";
import { Box, SH } from "./shared.jsx";

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
            className="ma-input ma-mono"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter ticker symbol (e.g., AAPL)"
            style={{
              minWidth: 0,
              width: "100%",
              boxSizing: "border-box",
              fontSize: 14
            }}
            autoFocus
          />
          <button type="submit" disabled={!query.trim()} className="ma-btn-primary ma-mono">
            Analyze
          </button>
        </form>
      </Box>
    </div>
  );
}
