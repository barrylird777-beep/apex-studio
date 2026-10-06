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
