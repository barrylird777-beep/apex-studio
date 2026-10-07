const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

export function calculateBandwidthDelayProduct({ bandwidthMbps = 0, rttMs = 0 } = {}) {
  return Math.max(0, Number(bandwidthMbps) * 1e6 / 8 * (Number(rttMs) / 1000));
}

export function chooseTransferProfile({ downloadMbps = 0, uploadMbps = 0, rttMs = 50, lossPct = 0 } = {}) {
  const bandwidth = Math.max(Number(downloadMbps) || 0, Number(uploadMbps) || 0);
  const loss = Number(lossPct) || 0;
  const mode = bandwidth >= 100 && loss < 1 ? 'maximum' : bandwidth >= 20 && loss < 3 ? 'balanced' : 'safe';
  const parallelStreams = mode === 'maximum' ? 8 : mode === 'balanced' ? 4 : 2;
  return Object.freeze({
    mode,
    parallelStreams,
    chunkMiB: mode === 'maximum' ? 32 : mode === 'balanced' ? 16 : 8,
    verifySha256: true,
    rttMs: Number(rttMs) || 0,
    lossPct: loss
  });
}

export function buildMultipathPlan({ paths = [] } = {}) {
  const lanes = paths.filter(path => path?.healthy !== false).sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)).map(path => ({
    ...path,
    verifySha256: true
  }));
  return Object.freeze({ mode: lanes.length > 1 ? 'multipath' : 'single-path', lanes });
}

export function adaptTransferProfile({ previous, observedMbps = 0, lossPct = 0, rttMs = 0 } = {}) {
  const base = previous || chooseTransferProfile({ downloadMbps: observedMbps, rttMs, lossPct });
  const congested = Number(lossPct) >= 2 || Number(rttMs) >= 150;
  const clean = Number(lossPct) < 1 && Number(observedMbps) >= 250 && Number(rttMs) <= 60;
  const parallelStreams = clamp((base.parallelStreams || 2) + (clean ? 2 : congested ? -2 : 0), 1, 16);
  return Object.freeze({ ...base, parallelStreams, rttMs: Number(rttMs) || 0, lossPct: Number(lossPct) || 0 });
}

export function buildTransportTuning({ bandwidthMbps = 0, rttMs = 0, lossPct = 0 } = {}) {
  const parallelStreams = bandwidthMbps >= 500 && lossPct < 1 ? 16 : bandwidthMbps >= 100 && lossPct < 2 ? 8 : 2;
  const bdpMiB = calculateBandwidthDelayProduct({ bandwidthMbps, rttMs }) / (1024 * 1024);
  return Object.freeze({ parallelStreams, maxInFlightMiB: parallelStreams >= 16 ? 512 : Math.max(32, Math.ceil(bdpMiB * 2)), bdpMiB });
}

export function buildAdaptiveTransferController(options = {}) {
  const raw = options.initial;
  const initial = typeof raw === 'number'
    ? { parallelStreams: Math.max(1, raw), chunkMiB: 16 }
    : { parallelStreams: Math.max(1, Number(raw?.parallelStreams) || 4), chunkMiB: Math.max(1, Number(raw?.chunkMiB) || 16) };
  let state = Object.freeze({ ...initial });
  return Object.freeze({
    get state() { return state; },
    observe({ observedMbps = 0, lossPct = 0, rttMs = 0 } = {}) {
      const congested = Number(lossPct) >= 2 || Number(rttMs) >= 150 || Number(observedMbps) < 100;
      const accelerating = Number(lossPct) < 1 && Number(observedMbps) >= 250 && Number(rttMs) <= 60;
      state = Object.freeze({
        parallelStreams: congested ? Math.max(1, Math.ceil(state.parallelStreams / 2)) : clamp(state.parallelStreams + (accelerating ? 2 : 0), 1, 16),
        chunkMiB: congested ? Math.max(4, Math.floor(state.chunkMiB / 2)) : clamp(state.chunkMiB + (accelerating ? 16 : 0), 4, 64)
      });
      return state;
    }
  });
}
