const OPEN = "OPEN";
const HALF_OPEN = "HALF_OPEN";
const CLOSED = "CLOSED";

function numeric(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export class AiCircuitOpenError extends Error {
  constructor(provider, retryAt) {
    super("CIRCUIT_OPEN: " + provider + " is temporarily unavailable.");
    this.name = "AiCircuitOpenError";
    this.code = "AI_CIRCUIT_OPEN";
    this.provider = provider;
    this.retryAt = retryAt;
    this.retryable = true;
  }
}

export class AiCircuitBreaker {
  constructor({ provider = "unknown", failureThreshold = 5, resetTimeoutMs = 10_000, maxResetTimeoutMs = 120_000, jitterMs = 2_000, now = () => Date.now(), random = Math.random } = {}) {
    this.provider = provider;
    this.failureThreshold = Math.max(1, Math.floor(numeric(failureThreshold, 5)));
    this.resetTimeoutMs = Math.max(100, numeric(resetTimeoutMs, 10_000));
    this.maxResetTimeoutMs = Math.max(this.resetTimeoutMs, numeric(maxResetTimeoutMs, 120_000));
    this.jitterMs = Math.max(0, numeric(jitterMs, 2_000));
    this.now = now;
    this.random = random;
    this.failureCount = 0;
    this.state = CLOSED;
    this.nextAttemptTime = 0;
    this.probeInFlight = false;
  }
  getState() { return this.state; }
  snapshot() { return { provider: this.provider, state: this.state, failureCount: this.failureCount, nextAttemptTime: this.nextAttemptTime }; }
  async execute(operation) {
    if (typeof operation !== "function") throw new TypeError("Circuit operation must be a function.");
    const now = this.now();
    if (this.state === OPEN) {
      if (now < this.nextAttemptTime) throw new AiCircuitOpenError(this.provider, this.nextAttemptTime);
      this.state = HALF_OPEN;
    }
    if (this.state === HALF_OPEN) {
      if (this.probeInFlight) throw new AiCircuitOpenError(this.provider, this.nextAttemptTime);
      this.probeInFlight = true;
    }
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    } finally {
      if (this.state !== HALF_OPEN) this.probeInFlight = false;
    }
  }
  onSuccess() { this.failureCount = 0; this.state = CLOSED; this.nextAttemptTime = 0; this.probeInFlight = false; }
  onFailure(error) {
    this.probeInFlight = false;
    const status = Number(error?.status ?? error?.statusCode);
    const retryable = status === 429 || status >= 500 || error?.code === "UND_ERR_CONNECT_TIMEOUT" || error?.code === "ECONNRESET" || error?.code === "ETIMEDOUT";
    if (!retryable) { if (this.state === HALF_OPEN) this.state = CLOSED; return; }
    this.failureCount += 1;
    if (this.state === HALF_OPEN || this.failureCount >= this.failureThreshold) {
      const exponent = Math.max(0, this.failureCount - this.failureThreshold);
      const base = Math.min(this.maxResetTimeoutMs, this.resetTimeoutMs * (2 ** exponent));
      const retryAfterMs = Number(error?.retryAfterMs);
      const serverDelay = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 0;
      this.state = OPEN;
      this.nextAttemptTime = this.now() + Math.max(base + this.jitterMs * this.random(), serverDelay);
    }
  }
}

export function createAiCircuitBreakerRegistry(options = {}) {
  const breakers = new Map();
  return {
    get(provider) {
      if (!breakers.has(provider)) breakers.set(provider, new AiCircuitBreaker({ ...options, provider }));
      return breakers.get(provider);
    },
    snapshot() { return Object.fromEntries([...breakers].map(([name, breaker]) => [name, breaker.snapshot()])); }
  };
}

export { CLOSED, OPEN, HALF_OPEN };