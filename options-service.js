/**
 * Options data abstraction: Tradier sandbox when TRADIER_SANDBOX_TOKEN is set, else mock.
 * Toggle live vs mock by setting the env var (no code changes).
 */

const _t = process.env.TRADIER_SANDBOX_TOKEN;
const TRADIER_SANDBOX_TOKEN = _t != null && String(_t).trim() !== '' ? String(_t).trim() : null;
const TRADIER_BASE = 'https://sandbox.tradier.com/v1';
export const USE_MOCK = TRADIER_SANDBOX_TOKEN == null;

if (USE_MOCK) {
  console.log('[Options] No TRADIER_SANDBOX_TOKEN — running in mock mode');
} else {
  console.log('[Options] Tradier sandbox API enabled (chains/expirations use live sandbox)');
}

/**
 * buildOCCSymbol — builds the OCC option symbol required by Tradier.
 *
 * Format: {TICKER}{YY}{MM}{DD}{C/P}{8-digit strike × 1000, zero-padded}
 * Example: AAPL240119C00150000 = AAPL, Jan 19 2024, Call, $150.00 strike
 *
 * @param {string} ticker      e.g. "COST"
 * @param {string} expiration  e.g. "2026-05-29"  (YYYY-MM-DD)
 * @param {string} optionType  "call" or "put"
 * @param {number} strike      e.g. 1025
 * @returns {string|null}
 */
function buildOCCSymbol(ticker, expiration, optionType, strike) {
  if (!ticker || !expiration || !optionType || strike == null) return null;
  try {
    const root = String(ticker).replace(/-/g, '').toUpperCase();
    const d = new Date(expiration);
    const yy = String(d.getUTCFullYear()).slice(2);
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const cp = optionType.toLowerCase().startsWith('c') ? 'C' : 'P';
    const stk = String(Math.round(Number(strike) * 1000)).padStart(8, '0');
    return `${root}${yy}${mm}${dd}${cp}${stk}`;
  } catch {
    return null;
  }
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function daysBetween(a, b) {
  const ua = new Date(a);
  const ub = new Date(b);
  ua.setUTCHours(0, 0, 0, 0);
  ub.setUTCHours(0, 0, 0, 0);
  return Math.round((ub - ua) / (1000 * 60 * 60 * 24));
}

function mix01(...parts) {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export function mockIvRank(ticker) {
  const t = String(ticker || 'X').toUpperCase();
  const seed = (t.charCodeAt(0) || 65) + (t.charCodeAt(t.length - 1) || 65);
  return Math.round((seed * 7 + 23) % 100);
}

export function mockOptionsChain(ticker, currentPrice, iv = 0.3) {
  const today = new Date();
  const expirations = [addDays(today, 14), addDays(today, 30), addDays(today, 60), addDays(today, 90)];

  const strikeSet = new Set();
  for (let pct = -0.2; pct <= 0.2 + 1e-9; pct += 0.05) {
    strikeSet.add(Math.round((currentPrice * (1 + pct)) / 5) * 5);
  }
  const strikes = [...strikeSet].sort((a, b) => a - b);

  const chain = [];
  const px = Math.max(0.01, Number(currentPrice) || 100);

  for (const exp of expirations) {
    const expIso = exp.toISOString().split('T')[0];
    const dte = Math.max(1, daysBetween(today, exp));

    for (const strike of strikes) {
      if (strike <= 0) continue;
      const moneyness = px / strike;
      const timeValue = iv * Math.sqrt(dte / 365);

      const callDelta =
        moneyness > 1
          ? Math.min(0.95, 0.5 + (moneyness - 1) * 2)
          : Math.max(0.05, 0.5 - (1 - moneyness) * 2);
      const putDelta = callDelta - 1;

      const callPrice = Math.max(
        0.01,
        (px - strike) * Math.max(0, callDelta) + px * timeValue * 0.4
      );
      const putPrice = Math.max(
        0.01,
        (strike - px) * Math.max(0, -putDelta) + px * timeValue * 0.4
      );

      const gamma =
        Math.exp(-(Math.log(moneyness) ** 2) / (2 * timeValue * timeValue)) /
        (px * timeValue * Math.sqrt(2 * Math.PI));
      const theta = -(px * iv * gamma) / (2 * Math.sqrt(dte / 365)) / 365;
      const vega = (px * Math.sqrt(dte / 365) * gamma) / 100;

      const spreadC = callPrice * 0.02;
      const spreadP = putPrice * 0.02;

      const rndIvC = iv + (mix01(ticker, expIso, strike, 'call', 'iv') - 0.5) * 0.05;
      const rndIvP = iv + (mix01(ticker, expIso, strike, 'put', 'iv') - 0.5) * 0.05;

      chain.push({
        ticker,
        expiration: expIso,
        strike,
        dte,
        type: 'call',
        bid: Math.max(0.01, callPrice - spreadC),
        ask: callPrice + spreadC,
        mid: parseFloat(callPrice.toFixed(4)),
        optionSymbol: buildOCCSymbol(ticker, expIso, 'call', strike),
        iv: rndIvC,
        delta: callDelta,
        gamma,
        theta,
        vega,
        openInterest: Math.floor(mix01(ticker, expIso, strike, 'call', 'oi') * 5000) + 100,
        volume: Math.floor(mix01(ticker, expIso, strike, 'call', 'vol') * 1000)
      });

      chain.push({
        ticker,
        expiration: expIso,
        strike,
        dte,
        type: 'put',
        bid: Math.max(0.01, putPrice - spreadP),
        ask: putPrice + spreadP,
        mid: parseFloat(putPrice.toFixed(4)),
        optionSymbol: buildOCCSymbol(ticker, expIso, 'put', strike),
        iv: rndIvP,
        delta: putDelta,
        gamma,
        theta,
        vega,
        openInterest: Math.floor(mix01(ticker, expIso, strike, 'put', 'oi') * 5000) + 100,
        volume: Math.floor(mix01(ticker, expIso, strike, 'put', 'vol') * 1000)
      });
    }
  }
  return chain;
}

async function tradierGet(path, params = {}) {
  const url = new URL(TRADIER_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${TRADIER_SANDBOX_TOKEN}`,
      Accept: 'application/json'
    }
  });
  if (!res.ok) throw new Error(`Tradier ${path} → ${res.status}`);
  return res.json();
}

async function tradierPost(path, body = {}) {
  const params = new URLSearchParams(body);
  const res = await fetch(TRADIER_BASE + path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TRADIER_SANDBOX_TOKEN}`,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });
  if (!res.ok) throw new Error(`Tradier POST ${path} → ${res.status}`);
  return res.json();
}

function normalizeOptionRow(ticker, o) {
  const exp = o.expiration_date || o.expiration;
  const typ = String(o.option_type || o.type || 'call').toLowerCase();
  const bid = Number(o.bid) || 0;
  const ask = Number(o.ask) || 0;
  const strike = Number(o.strike);
  const lastNum = Number(o.last);
  const midFromQuote =
    bid > 0 && ask > 0
      ? (bid + ask) / 2
      : Number.isFinite(lastNum) && lastNum > 0
        ? lastNum
        : bid > 0
          ? bid
          : ask > 0
            ? ask
            : null;
  const optType = typ === 'put' ? 'put' : 'call';
  const g = o.greeks || {};
  return {
    ticker,
    expiration: exp,
    strike,
    dte: daysBetween(new Date(), new Date(exp)),
    type: optType,
    bid,
    ask,
    mid: (() => {
      if (midFromQuote != null && midFromQuote > 0) return parseFloat(midFromQuote.toFixed(2));
      if (bid > 0 && ask > 0) return parseFloat(((bid + ask) / 2).toFixed(2));
      if (ask > 0) return parseFloat(ask.toFixed(2));
      if (bid > 0) return parseFloat(bid.toFixed(2));
      return null;
    })(),
    optionSymbol: buildOCCSymbol(ticker, exp, optType, strike),
    iv: g.smv_vol != null ? Number(g.smv_vol) : Number(o.implied_volatility) || 0,
    delta: g.delta != null ? Number(g.delta) : 0,
    gamma: g.gamma != null ? Number(g.gamma) : 0,
    theta: g.theta != null ? Number(g.theta) : 0,
    vega: g.vega != null ? Number(g.vega) : 0,
    openInterest: Number(o.open_interest) || 0,
    volume: Number(o.volume) || 0
  };
}

async function getLiveOptionsChain(ticker, expiration) {
  const data = await tradierGet('/markets/options/chains', {
    symbol: ticker,
    expiration,
    greeks: 'true'
  });
  const raw = data?.options?.option;
  const options = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return options.map((o) => normalizeOptionRow(ticker, o));
}

async function getLiveExpirations(ticker) {
  const data = await tradierGet('/markets/options/expirations', {
    symbol: ticker,
    includeAllRoots: 'true'
  });
  const dates = data?.expirations?.date;
  return Array.isArray(dates) ? dates : dates ? [dates] : [];
}

/**
 * @param {string} ticker
 * @param {number} currentPrice
 * @param {string|null} expiration - Tradier expiration YYYY-MM-DD or null
 * @param {{ liveChainMode?: 'single'|'multi' }} [opts]
 */
export async function getOptionsChain(ticker, currentPrice, expiration = null, opts = {}) {
  const liveChainMode = opts.liveChainMode ?? 'multi';

  if (USE_MOCK) {
    const iv = mockIvRank(ticker) / 100 * 0.4 + 0.15;
    return mockOptionsChain(ticker, currentPrice, iv);
  }

  const exps = await getLiveExpirations(ticker);
  if (!exps.length) return [];

  if (expiration) {
    return getLiveOptionsChain(ticker, expiration);
  }

  const today = new Date();
  const pickTarget = () =>
    exps.find((e) => daysBetween(today, new Date(e)) >= 25) ?? exps[0];

  if (liveChainMode === 'single') {
    const target = pickTarget();
    return getLiveOptionsChain(ticker, target);
  }

  const target = pickTarget();
  const want = new Set([target]);
  for (const e of exps) {
    const d = daysBetween(today, new Date(e));
    if (d >= 14 && d <= 120) want.add(e);
    if (want.size >= 6) break;
  }
  const list = [...want].slice(0, 6);
  const out = [];
  for (const e of list) {
    try {
      out.push(...(await getLiveOptionsChain(ticker, e)));
    } catch {
      /* skip bad slice */
    }
  }
  return out;
}

export async function getIvRank(ticker) {
  if (USE_MOCK) return mockIvRank(ticker);
  // Tradier doesn't expose IV rank; placeholder until 52w IV history is wired
  return mockIvRank(ticker);
}

export function buildOsiSymbol({ ticker, expiration, optionType, strike }) {
  return buildOCCSymbol(
    String(ticker || '').replace(/-/g, '').toUpperCase(),
    expiration,
    optionType === 'call' ? 'call' : 'put',
    strike
  );
}

const TRADIER_ACCOUNT_ID =
  process.env.TRADIER_ACCOUNT_ID || process.env.TRADIER_SANDBOX_ACCOUNT || 'SANDBOX_ACCOUNT';

export async function submitPaperOrder(order) {
  const osi = order.osiSymbol || buildOsiSymbol(order);

  if (USE_MOCK) {
    return {
      id: `MOCK-${Date.now()}`,
      status: 'filled',
      fillPrice: order.price,
      filledAt: new Date().toISOString()
    };
  }

  return tradierPost(`/accounts/${encodeURIComponent(TRADIER_ACCOUNT_ID)}/orders`, {
    class: 'option',
    symbol: order.ticker,
    option_symbol: osi,
    side: order.action,
    quantity: String(order.quantity),
    type: 'limit',
    price: String(order.price),
    duration: 'day'
  });
}
