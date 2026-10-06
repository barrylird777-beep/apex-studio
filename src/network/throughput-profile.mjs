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
