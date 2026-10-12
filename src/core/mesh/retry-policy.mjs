export function retryPolicy({ attempts = 3, baseDelayMs = 250, maxDelayMs = 10000 } = {}) {
  const max = Math.max(1, Math.floor(Number(attempts) || 1));
  return {
    attempts: max,
    delay(attempt) {
      const n = Math.max(0, Number(attempt) || 0);
      return Math.min(maxDelayMs, baseDelayMs * 2 ** n);
    }
  };
}
export default retryPolicy;
