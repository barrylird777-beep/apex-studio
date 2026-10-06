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
let pressureSamples = 0;
let recoverySamples = 0;

export function startLoadShedder({ intervalMs = 1000, threshold = 0.9, recoveryThreshold = 0.75 } = {}) {
  const pressureThreshold = Math.max(0.5, Math.min(0.99, Number(threshold) || 0.9));
  const recovery = Math.max(0.1, Math.min(pressureThreshold, Number(recoveryThreshold) || 0.75));
  const timer = setInterval(() => {
    const now = performance.eventLoopUtilization();
    const sample = performance.eventLoopUtilization(now, lastElu).utilization;
    lastElu = now;
    if (sample >= pressureThreshold) { pressureSamples++; recoverySamples = 0; }
    else if (sample <= recovery) { recoverySamples++; pressureSamples = 0; }
    else { pressureSamples = Math.max(0, pressureSamples - 1); recoverySamples = 0; }
    if (pressureSamples >= 2) currentElu = sample;
    else if (recoverySamples >= 2) currentElu = sample;
    else currentElu = Math.max(0, Math.min(1, currentElu * 0.7 + sample * 0.3));
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
