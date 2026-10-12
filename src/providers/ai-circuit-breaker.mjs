class CircuitBreaker {
  constructor({ failureThreshold = 5, resetTimeoutMs = 10000, maxResetTimeoutMs = 120000, jitterMs = 2000 } = {}) {
    this.failureThreshold = Math.max(1, failureThreshold);
    this.resetTimeoutMs = Math.max(100, resetTimeoutMs);
    this.maxResetTimeoutMs = Math.max(this.resetTimeoutMs, maxResetTimeoutMs);
    this.jitterMs = Math.max(0, jitterMs);
    this.failures = 0;
    this.state = 'closed';
    this.openedAt = 0;
    this.currentResetTimeoutMs = this.resetTimeoutMs;
  }

  async execute(operation) {
    const now = Date.now();
    if (this.state === 'open') {
      const wait = this.currentResetTimeoutMs + Math.floor(Math.random() * (this.jitterMs + 1));
      if (now - this.openedAt < wait) {
        throw new Error('Circuit breaker is open');
      }
      this.state = 'half-open';
    }

    try {
      const result = await operation();
      this.failures = 0;
      this.state = 'closed';
      this.currentResetTimeoutMs = this.resetTimeoutMs;
      return result;
    } catch (error) {
      this.failures += 1;
      if (this.state === 'half-open' || this.failures >= this.failureThreshold) {
        this.state = 'open';
        this.openedAt = Date.now();
        this.currentResetTimeoutMs = Math.min(this.maxResetTimeoutMs, Math.max(this.resetTimeoutMs, this.currentResetTimeoutMs * 2));
      }
      throw error;
    }
  }

  status() {
    return {
      state: this.state,
      failures: this.failures,
      openedAt: this.openedAt || null,
      resetTimeoutMs: this.currentResetTimeoutMs
    };
  }
}

export function createAiCircuitBreakerRegistry(options = {}) {
  const breakers = new Map();
  const get = (provider) => {
    const key = String(provider || 'unknown');
    if (!breakers.has(key)) breakers.set(key, new CircuitBreaker(options));
    return breakers.get(key);
  };
  return {
    get,
    status: () => Object.fromEntries([...breakers.entries()].map(([key, breaker]) => [key, breaker.status()]))
  };
}
