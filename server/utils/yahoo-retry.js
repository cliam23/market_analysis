/**
 * Retry wrapper for yahoo-finance2 calls (and any Yahoo HTTP errors) when rate-limited.
 */

/** Detect Yahoo / Edge CDN rate-limit errors from yahoo-finance2 or similar. */
export function isYahooRateLimitError(err) {
  if (!err) return false;
  const status = err.status ?? err.statusCode;
  if (status === 429 || status === '429') return true;
  const msg = String(err.message ?? err.error ?? err.description ?? err);
  if (/too many requests|(^|\s)429(\s|$)|rate limit|edge:/i.test(msg)) return true;
  return false;
}

/**
 * @param {() => Promise<unknown>} fn - async work (usually fetchWithTimeout(() => yahooFinance...))
 * @param {{ maxRetries?: number }} [opts]
 */
export async function withYahooRetry(fn, opts = {}) {
  const maxRetries = opts.maxRetries ?? 4;
  let lastErr;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isYahooRateLimitError(err) || attempt === maxRetries - 1) {
        throw err;
      }
      const wait = 2 ** attempt * 2000;
      console.warn(
        `[Yahoo] Rate limited, retrying in ${wait}ms (attempt ${attempt + 1}/${maxRetries}): ${String(err?.message || err).slice(0, 160)}`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr ?? new Error('Yahoo request failed after retries');
}
