import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

export const traceStorage = new AsyncLocalStorage();

export function runWithTrace(context, fn) {
  const base = traceStorage.getStore() || {};
  return traceStorage.run({ ...base, ...context }, fn);
}

export function traceContext() {
  return traceStorage.getStore() || {};
}

export function log(level, message, fields = {}) {
  const ctx = traceContext();
  const payload = { ...ctx, ...fields, message: String(message) };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

let currentElu = 0;
let lastElu = performance.eventLoopUtilization();

export function startLoadShedder({ intervalMs = 1000, threshold = 0.9 } = {}) {
  const timer = setInterval(() => {
    const now = performance.eventLoopUtilization();
    currentElu = performance.eventLoopUtilization(now, lastElu).utilization;
    lastElu = now;
  }, Math.max(250, intervalMs));
  timer.unref?.();
  return () => clearInterval(timer);
}

export function loadShedderMiddleware({ threshold = 0.9 } = {}) {
  return (req, res, next) => {
    if (currentElu > threshold) {
      res.set("Retry-After", "2");
      return res.status(503).json({ success: false, error: "SYSTEM_AT_CAPACITY" });
    }
    next();
  };
}

export function eventLoopUtilization() {
  return currentElu;
}
