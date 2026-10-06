import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const STARLINK_HINT = process.env.APEX_STARLINK_INTERFACE || 'starlink';
const SIX_G_HINT = process.env.APEX_6G_INTERFACE || '6g';
const WIFI_HINT = process.env.APEX_WIFI_INTERFACE || 'wlan';
const CELLULAR_HINT = process.env.APEX_CELLULAR_INTERFACE || 'wwan';
const APPLY_ROUTES = process.env.APEX_NETWORK_APPLY_ROUTES === 'true';

async function interfaces() {
  const { stdout } = await exec('ip', ['-o', 'link', 'show']);
  return stdout.trim().split('\n').filter(Boolean)
    .map(line => line.split(': ')[1]?.split('@')[0])
    .filter(x => x && x !== 'lo');
}

function classify(dev) {
  const name = dev.toLowerCase();
  if (name.includes(SIX_G_HINT.toLowerCase())) return '6g';
  if (name.includes(STARLINK_HINT.toLowerCase())) return 'starlink';
  if (name.includes(CELLULAR_HINT.toLowerCase())) return 'cellular';
  if (name.includes(WIFI_HINT.toLowerCase())) return 'wifi';
  return 'other';
}

async function probe(dev) {
  const started = performance.now();
  try {
    const { stdout } = await exec('curl', [
      '-4', '-L', '--silent', '--show-error', '--fail',
      '--interface', dev, '--connect-timeout', '2',
      '--max-time', process.env.APEX_PATH_PROBE_TIMEOUT || '2',
      '-o', '/dev/null', '-w', '%{http_code}',
      process.env.APEX_PATH_PROBE_URL || 'https://www.starlink.com/'
    ]);
    return { healthy: true, rttMs: performance.now() - started, httpCode: Number(stdout) || 0 };
  } catch {
    return { healthy: false, rttMs: Infinity, httpCode: 0 };
  }
}

function score(dev, result) {
  if (!result.healthy) return 0;
  const kind = classify(dev);
  const preference = kind === '6g' ? 35 : kind === 'starlink' ? 25 : kind === 'wifi' ? 10 : 5;
  return Math.max(0, 100 - Math.min(100, result.rttMs * 2)) + preference;
}

async function applyPriority(dev) {
  if (!APPLY_ROUTES) return { applied: false, reason: 'route mutation disabled' };
  try {
    await exec('ip', ['route', 'replace', 'default', 'dev', dev, 'metric', '50']);
    return { applied: true, device: dev };
  } catch (error) {
    return { applied: false, device: dev, error: error.message };
  }
}

export async function selectNetworkPath() {
  const devices = await interfaces();
  const results = await Promise.all(devices.map(async device => {
    const result = await probe(device);
    return { device, network: classify(device), ...result, score: score(device, result) };
  }));
  const candidates = results;
  candidates.sort((a, b) => b.score - a.score);
  const selected = candidates[0] || null;
  const failover = candidates.slice(1, 4).map(({ device, network, score: pathScore, healthy }) => ({ device, network, score: pathScore, healthy }));
  return {
    selected,
    failover,
    candidates,
    route: selected ? await applyPriority(selected.device) : { applied: false },
    policy: {
      sixGHint: SIX_G_HINT,
      starlinkHint: STARLINK_HINT,
      wifiHint: WIFI_HINT,
      cellularHint: CELLULAR_HINT,
      applyRoutes: APPLY_ROUTES,
      policy: 'health-first; 6G preferred when an actual 6G interface is present; Starlink next; Wi-Fi/cellular fallback'
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  selectNetworkPath().then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error('[NETWORK SELECTOR]', e); process.exitCode = 1; });
}


export function buildNetworkSpeedPolicy(paths = []) {
  const healthy = paths.filter(p => p?.healthy).sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  if (!healthy.length) return Object.freeze({ mode: 'offline', lanes: 0, paths: [] });
  const top = healthy.slice(0, 4);
  const totalScore = top.reduce((sum, p) => sum + Math.max(1, Number(p.score || 1)), 0);
  return Object.freeze({
    mode: top.length > 1 ? 'multipath' : 'single-path',
    lanes: top.length,
    paths: top.map(p => Object.freeze({
      device: p.device,
      network: p.network,
      weight: Math.max(1, Number(p.score || 1)) / totalScore,
      rttMs: p.rttMs
    })),
    failover: healthy.slice(4, 8).map(p => p.device)
  });
}

export function adaptiveLaneCount({ bandwidthMbps = 0, lossPct = 0, rttMs = 0, maxLanes = 16 } = {}) {
  const bandwidth = Math.max(0, Number(bandwidthMbps) || 0);
  const loss = Math.max(0, Number(lossPct) || 0);
  const rtt = Math.max(0, Number(rttMs) || 0);
  const ceiling = Math.max(1, Math.min(16, Math.floor(Number(maxLanes) || 16)));
  if (loss > 3 || rtt > 180) return 1;
  if (loss > 1.5 || rtt > 100) return Math.min(2, ceiling);
  if (bandwidth >= 1000 && rtt <= 50 && loss < 0.5) return Math.min(ceiling, 16);
  if (bandwidth >= 500 && rtt <= 75 && loss < 1) return Math.min(ceiling, 8);
  if (bandwidth >= 250 && rtt <= 100 && loss < 1.5) return Math.min(ceiling, 4);
  return Math.min(ceiling, 2);
}
