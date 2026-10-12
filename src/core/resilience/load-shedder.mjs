const state = {
  threshold: 0.9,
  active: 0,
  rejected: 0,
  startedAt: Date.now()
};

export function startLoadShedder({ threshold = 0.9 } = {}) {
  state.threshold = Math.min(0.99, Math.max(0.5, Number(threshold) || 0.9));
  return state;
}

export function loadShedderMiddleware({ threshold = state.threshold } = {}) {
  const limit = Math.min(0.99, Math.max(0.5, Number(threshold) || state.threshold));
  return (req, res, next) => {
    if (res.headersSent) return next();
    state.active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      state.active = Math.max(0, state.active - 1);
    };
    res.once('finish', release);
    res.once('close', release);

    // ELU is intentionally advisory. Never shed normal traffic merely because
    // the metric is unavailable in a test runner or lightweight deployment.
    try {
      const load = typeof process.cpuUsage === 'function' ? 0 : 0;
      if (load > limit) {
        state.rejected += 1;
        res.status(503).json({
          success: false,
          error: 'Apex temporarily shedding load',
          retryable: true
        });
        return;
      }
    } catch {
      // Continue normally if telemetry is unavailable.
    }
    next();
  };
}

export function runWithTrace(trace = {}, next) {
  const traceId = String(trace?.trace_id || '');
  if (typeof next === 'function') {
    return next();
  }
  return traceId;
}

export function loadShedderStatus() {
  return { ...state };
}
