export const APEX_THROUGHPUT_TARGETS = Object.freeze({
  downloadMbpsMin: 150,
  downloadMbpsStretch: 250,
  uploadMbpsMin: 25,
  uploadMbpsStretch: 40,
  rttMsMin: 25,
  rttMsMax: 50,
  videoResolutions: [720, 1080, 1440, 2160],
  storageRoot: process.env.APEX_MEDIA_ROOT || '/srv/apex/se-x/projects'
});

export function evaluateThroughput({ downloadMbps, uploadMbps, rttMs }) {
  return {
    download: { value: downloadMbps, meetsFloor: downloadMbps >= APEX_THROUGHPUT_TARGETS.downloadMbpsMin, reachesStretch: downloadMbps >= APEX_THROUGHPUT_TARGETS.downloadStretch },
    upload: { value: uploadMbps, meetsFloor: uploadMbps >= APEX_THROUGHPUT_TARGETS.uploadMbpsMin, reachesStretch: uploadMbps >= APEX_THROUGHPUT_TARGETS.uploadStretch },
    latency: { value: rttMs, withinTarget: rttMs >= APEX_THROUGHPUT_TARGETS.rttMsMin && rttMs <= APEX_THROUGHPUT_TARGETS.rttMsMax }
  };
}


export function chooseTransferProfile({ downloadMbps = 0, uploadMbps = 0, rttMs = Infinity, lossPct = 0 } = {}) {
  const d = Math.max(0, Number(downloadMbps) || 0);
  const u = Math.max(0, Number(uploadMbps) || 0);
  const r = Math.max(0, Number(rttMs) || 0);
  const loss = Math.max(0, Number(lossPct) || 0);
  const quality = loss > 2 || r > 150 ? 'conservative' : d >= 250 && u >= 40 && r <= 50 ? 'maximum' : 'balanced';
  return Object.freeze({
    mode: quality,
    parallelStreams: quality === 'maximum' ? 8 : quality === 'balanced' ? 4 : 2,
    chunkMiB: quality === 'maximum' ? 32 : quality === 'balanced' ? 16 : 4,
    retryLimit: quality === 'maximum' ? 4 : 7,
    verifySha256: true,
    preserveSource: true
  });
}

export function scoreNetworkPath({ downloadMbps = 0, uploadMbps = 0, rttMs = Infinity, lossPct = 0, network = 'other' } = {}) {
  const d = Math.max(0, Number(downloadMbps) || 0);
  const u = Math.max(0, Number(uploadMbps) || 0);
  const r = Math.max(0, Number(rttMs) || 0);
  const loss = Math.max(0, Number(lossPct) || 0);
  const networkBonus = network === '6g' ? 35 : network === 'starlink' ? 25 : network === 'wifi' ? 10 : 5;
  return Math.max(0, d * 0.5 + u * 0.8 + networkBonus - Math.min(100, r * 0.2) - loss * 10);
}


export function buildMultipathPlan({ paths = [], targetMbps = 250 } = {}) {
  const healthy = paths.filter(p => p?.healthy !== false).sort((a,b) => Number(b.score||0) - Number(a.score||0));
  if (!healthy.length) return Object.freeze({ mode: 'offline', lanes: [], targetMbps });
  const lanes = healthy.slice(0, 4).map((p, index) => Object.freeze({
    device: p.device,
    network: p.network,
    lane: index + 1,
    weight: Math.max(1, Math.round(Number(p.score || 1))),
    chunkMiB: index === 0 ? 32 : 16,
    verifySha256: true
  }));
  return Object.freeze({
    mode: lanes.length > 1 ? 'multipath' : 'single-path',
    targetMbps: Math.max(1, Number(targetMbps) || 250),
    lanes
  });
}

export function adaptTransferProfile({ previous, observedMbps = 0, lossPct = 0, rttMs = 0 } = {}) {
  const base = previous || chooseTransferProfile({});
  const throughput = Math.max(0, Number(observedMbps) || 0);
  const loss = Math.max(0, Number(lossPct) || 0);
  const rtt = Math.max(0, Number(rttMs) || 0);
  if (loss > 2 || rtt > 150) {
    return Object.freeze({ ...base, mode: 'conservative', parallelStreams: Math.max(1, Math.floor(base.parallelStreams / 2)), chunkMiB: Math.max(2, Math.floor(base.chunkMiB / 2)) });
  }
  if (throughput >= 250 && loss < 0.5 && rtt <= 50) {
    return Object.freeze({ ...base, mode: 'maximum', parallelStreams: Math.min(16, base.parallelStreams + 2), chunkMiB: Math.min(64, base.chunkMiB * 2) });
  }
  return base;
}


export function buildTransportTuning({ bandwidthMbps = 0, rttMs = 0, lossPct = 0 } = {}) {
  const bw = Math.max(0, Number(bandwidthMbps) || 0);
  const rtt = Math.max(0, Number(rttMs) || 0);
  const loss = Math.max(0, Number(lossPct) || 0);
  const clean = loss < 0.5 && rtt <= 50;
  return Object.freeze({
    connectionReuse: true,
    keepAlive: true,
    compression: false,
    parallelStreams: clean && bw >= 1000 ? 16 : clean && bw >= 250 ? 8 : loss > 2 || rtt > 150 ? 1 : 4,
    chunkMiB: clean && bw >= 1000 ? 64 : clean && bw >= 250 ? 32 : 8,
    maxInFlightMiB: clean && bw >= 1000 ? 512 : clean && bw >= 250 ? 256 : 64,
    retryBackoffMs: loss > 2 || rtt > 150 ? 250 : 50,
    checksum: 'sha256'
  });
}

export function calculateBandwidthDelayProduct({ bandwidthMbps = 0, rttMs = 0 } = {}) {
  const bw = Math.max(0, Number(bandwidthMbps) || 0);
  const rtt = Math.max(0, Number(rttMs) || 0);
  return (bw * 1_000_000 / 8) * (rtt / 1000);
}


export function buildAdaptiveTransferController({ initial = null, minStreams = 1, maxStreams = 16 } = {}) {
  let state = {
    parallelStreams: Math.max(minStreams, Math.min(maxStreams, Number(initial?.parallelStreams) || 4)),
    chunkMiB: Math.max(1, Number(initial?.chunkMiB) || 16),
    lastMbps: 0,
    lastLossPct: 0,
    lastRttMs: 0
  };
  return {
    observe({ observedMbps = 0, lossPct = 0, rttMs = 0 } = {}) {
      const mbps = Math.max(0, Number(observedMbps) || 0);
      const loss = Math.max(0, Number(lossPct) || 0);
      const rtt = Math.max(0, Number(rttMs) || 0);
      state = { ...state, lastMbps: mbps, lastLossPct: loss, lastRttMs: rtt };
      if (loss > 2 || rtt > 150) {
        state.parallelStreams = Math.max(minStreams, Math.ceil(state.parallelStreams / 2));
        state.chunkMiB = Math.max(4, Math.ceil(state.chunkMiB / 2));
      } else if (mbps >= 250 && loss < 0.5 && rtt <= 50) {
        state.parallelStreams = Math.min(maxStreams, state.parallelStreams + 2);
        state.chunkMiB = Math.min(64, state.chunkMiB * 2);
      }
      return Object.freeze({ ...state });
    },
    get state() { return Object.freeze({ ...state }); }
  };
}
