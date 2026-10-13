import { safeOutboundFetch } from "../security/safe-outbound-fetch.mjs";

const RETRYABLE_GATEWAY_STATUSES = new Set([502, 503, 504]);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function retryAfterMs(response, now = Date.now()) {
  const header = response?.headers?.get?.('retry-after');
  if (!header) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(5000, seconds * 1000));
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, Math.min(5000, date - now)) : 0;
}

/**
 * Fetch with bounded retries for transient upstream gateway failures.
 * Retries only HTTP 502/503/504 responses; caller receives the final response
 * unchanged after retries are exhausted. Defaults are three retries (four
 * attempts), 500ms exponential base, bounded jitter, and a 4s backoff cap.
 */
export async function fetchWithRetry(url, options = {}, {
  timeoutMs = 12000,
  maxRetries = 3,
  baseDelayMs = 500,
  maxDelayMs = 4000,
  fetchImpl = safeOutboundFetch,
  sleepImpl = sleep,
  random = Math.random
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch implementation is unavailable');
  const retries = Math.max(0, Math.min(3, Math.floor(Number(maxRetries) || 0)));

  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const parentSignal = options.signal;
    const abortFromParent = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) controller.abort(parentSignal.reason);
    else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Upstream request timed out')), Math.max(1, timeoutMs));
    let response;
    try {
      response = await fetchImpl(url, { ...options, signal: controller.signal });
    } catch (error) {
      throw error;
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    }

    if (!RETRYABLE_GATEWAY_STATUSES.has(response.status) || attempt >= retries) return response;
    try { await response.body?.cancel?.(); } catch {}
    const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
    const jittered = Math.floor(exponential * (0.5 + Math.max(0, Math.min(1, random()))));
    const delay = Math.max(jittered, retryAfterMs(response));
    await sleepImpl(Math.min(maxDelayMs, delay));
  }
}
