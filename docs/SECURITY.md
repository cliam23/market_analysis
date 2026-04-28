# Security notes & review checklist

This document summarizes how the **Market Analysis** stack handles untrusted input and common web risks. It is **not** a formal penetration-test report.

---

## SQL injection

**Risk: low — no SQL database in the main app.**  
Market data and portfolios are handled via **Yahoo Finance**, **in-memory caches**, and **JSON files** on disk. There are **no** string-concatenated SQL queries in the Node codebase.

**Recommendation:** If you add SQLite/Postgres later, use **parameterized queries** only.

---

## Cross-site scripting (XSS)

**Risk: low for default React usage.**  
React escapes text in JSX. **Avoid** `dangerouslySetInnerHTML** or raw `innerHTML` when rendering user or API-controlled strings.

**Recommendation:** Audit any future rich-text or markdown renderers; use a sanitization library if HTML is required.

---

## Command injection

**Risk: low for current ML spawn paths.**  
Python is invoked via `child_process.spawn` with:

- **Executable:** `resolvePythonInterpreter()` → env `PYTHON`, repo `.venv`, or `python3` (not user-controlled path segments from HTTP).
- **Arguments:** fixed script paths (`ML_PREDICT_SCRIPT`, `ML_WORKER_SCRIPT`) under repo root — **not** built from request query strings.

Payloads are passed on **stdin** as JSON, not embedded in a shell command.

**Recommendations:**

- Keep **`PYTHON`** env to a trusted interpreter path in production.
- Do **not** change spawn to `shell: true` with interpolated user input.
- Cap payload size / row counts for ML batch calls if exposing the API publicly.

---

## Authentication & authorization

**Risk: high if API is exposed to the internet.**  
The API is designed as a **local / trusted-network** tool. There is **no** built-in auth on most routes.

**Recommendations for remote access:**

- Put **reverse proxy** auth (TLS, Basic, OAuth2 proxy, VPN).
- Rate-limit `/api/backtest`, `/api/rl/train`, `/api/diagnostics/*` (expensive).
- Do not bind `0.0.0.0` without a firewall.

---

## Secrets

- **`FRED_API_KEY`**, Yahoo usage, and any future keys belong in **`.env`** (never committed — see `.gitignore`).
- **`paper-portfolio*.json`** can hold capital and positions — treat disk access as sensitive.

---

## Dependency supply chain

Run **`npm audit`** periodically; pin major upgrades after testing (especially `express`, `yahoo-finance2`).

---

## Summary table

| Area | Assessment |
|------|--------------|
| SQL injection | N/A today; use parameters if DB added |
| XSS | Rely on React escaping; audit custom HTML |
| Command injection | Spawn uses fixed scripts; keep `shell: false` |
| Auth | None by design — protect at network edge |
| Secrets | `.env` + gitignore |

For **data integrity** (golden tests, caches), see **[DATA_CONTRACTS.md](./DATA_CONTRACTS.md)**.
