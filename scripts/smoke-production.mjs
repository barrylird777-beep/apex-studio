import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';

const port = 18080;
const smokeRoot = path.join(tmpdir(), `apex-smoke-${process.pid}`);
const child = spawn(process.execPath, ['server.mjs'], {
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    APEX_SE_X_ROOT: smokeRoot,
    APEX_SHORTCUT_TOKEN: 'apex-smoke-token',
    APEX_PROJECTS_DIR: path.join(smokeRoot, 'projects'),
    APEX_WAL_DIR: path.join(smokeRoot, 'wal'),
    APEX_WAL_FILE: path.join(smokeRoot, 'wal', 'ring.wal.jsonl')
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
child.stdout.on('data', chunk => { output += chunk.toString(); });
child.stderr.on('data', chunk => { output += chunk.toString(); });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const getJson = (path, headers = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, method: 'GET', timeout: 1000, headers }, res => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      let json;
      try {
        json = JSON.parse(body);
      } catch {
        return resolve({ status: res.statusCode, body, json: null });
      }
      return resolve({ status: res.statusCode, body, json });
    });
  });
  req.on('error', reject);
  req.on('timeout', () => req.destroy(new Error(`${path} request timeout`)));
  req.end();
});

try {
  let health = null;
  for (let i = 0; i < 30; i += 1) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}\n${output}`);
    try {
      health = await getJson('/health');
      if (health.status === 200 && health.json?.status === 'alive') break;
    } catch {}
    await sleep(250);
  }

  if (health?.status !== 200 || health.json?.status !== 'alive') {
    throw new Error(`liveness endpoint did not report status=alive; last response: ${health?.body || 'no response'}\n${output}`);
  }

  const detailedHealth = await getJson('/api/health');
  if (detailedHealth.status !== 200 || detailedHealth.json?.status !== 'ok') {
    throw new Error(`detailed health endpoint did not report status=ok; last response: ${detailedHealth.body}`);
  }

  const emptySearch = await getJson('/api/search');
  if (emptySearch.status !== 400 || emptySearch.json?.success !== false || !/required/i.test(String(emptySearch.json?.error || ''))) {
    throw new Error(`Special Search validation smoke failed: ${emptySearch.body}`);
  }

  const readiness = await getJson('/api/apex/readiness');
  const expectedApps = ['PlanetApeX', 'KoBlocks', 'KernelVision', 'KoinKob', 'KashKorner', 'Kernelodies'];
  const actualApps = readiness.json?.canonicalApps?.map(app => app.name);
  if (
    readiness.status !== 200 ||
    readiness.json?.success !== true ||
    readiness.json?.canonicalAppCount !== expectedApps.length ||
    JSON.stringify(actualApps) !== JSON.stringify(expectedApps)
  ) {
    throw new Error(`canonical app readiness check failed; response: ${readiness.body}`);
  }

  const canonicalAppIds = [
    ['planet-apex', 'PlanetApeX'],
    ['ko-blocks', 'KoBlocks'],
    ['kernel-vision', 'KernelVision'],
    ['koin-kob', 'KoinKob'],
    ['kash-korner', 'KashKorner'],
    ['kernelodies', 'Kernelodies']
  ];

  for (const [appId, expectedName] of canonicalAppIds) {
    const status = await getJson(`/api/canon/apps/${appId}/status`);
    if (status.status !== 200 || status.json?.success !== true ||
        status.json?.app?.name !== expectedName || status.json?.canonical !== true) {
      throw new Error(`${expectedName} status smoke failed: ${status.body}`);
    }
  }

  const sovereignStatus = await getJson('/api/mobile/sovereign/status', {
    'x-apex-shortcut-token': 'apex-smoke-token'
  });
  if (sovereignStatus.status !== 200 || sovereignStatus.json?.success !== true ||
      sovereignStatus.json?.storage !== 'local-pure-wal' ||
      sovereignStatus.json?.canonicalAppCount !== canonicalAppIds.length ||
      sovereignStatus.json?.durableStoreReady !== true) {
    throw new Error(`six-app sovereign storage smoke failed: ${sovereignStatus.body}`);
  }

  for (const [appId, expectedName] of canonicalAppIds) {
    const payload = { source: 'smoke-production', appId, marker: `verified-${appId}` };
    const savedResponse = await fetch(`http://127.0.0.1:${port}/api/mobile/apps/${appId}/records/smoke-record`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-apex-shortcut-token': 'apex-smoke-token' },
      body: JSON.stringify(payload)
    });
    const saved = await savedResponse.json();
    if (savedResponse.status !== 200 || saved.success !== true ||
        saved.durable !== true || saved.storage !== 'local-pure-wal' ||
        saved.record?.marker !== payload.marker) {
      throw new Error(`${expectedName} durable save smoke failed: ${JSON.stringify(saved)}`);
    }

    const loadedResponse = await fetch(`http://127.0.0.1:${port}/api/mobile/apps/${appId}/records/smoke-record`, {
      headers: { 'x-apex-shortcut-token': 'apex-smoke-token' }
    });
    const loaded = await loadedResponse.json();
    if (loadedResponse.status !== 200 || loaded.success !== true ||
        loaded.record?.marker !== payload.marker || loaded.record?.appId !== appId) {
      throw new Error(`${expectedName} durable load smoke failed: ${JSON.stringify(loaded)}`);
    }
  }

  const validGraphResponse = await fetch(`http://127.0.0.1:${port}/api/canon/apps/ko-blocks/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      version: 'koblx.v1',
      blocks: [{ id: 'source', outputs: ['out'] }, { id: 'target', inputs: ['in'] }],
      edges: [{ from: 'source', to: 'target', port: 'out' }]
    })
  });
  const validGraph = await validGraphResponse.json();
  if (validGraphResponse.status !== 200 || validGraph.success !== true || validGraph.appId !== 'ko-blocks') {
    throw new Error(`KoBlocks valid graph smoke failed: ${JSON.stringify(validGraph)}`);
  }

  const cyclicGraphResponse = await fetch(`http://127.0.0.1:${port}/api/canon/apps/ko-blocks/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      version: 'koblx.v1',
      blocks: [{ id: 'a', outputs: ['out'] }, { id: 'b', outputs: ['out'] }],
      edges: [{ from: 'a', to: 'b', port: 'out' }, { from: 'b', to: 'a', port: 'out' }]
    })
  });
  const cyclicGraph = await cyclicGraphResponse.json();
  if (cyclicGraphResponse.status !== 422 || cyclicGraph.success !== false || cyclicGraph.reason !== 'cycle') {
    throw new Error(`KoBlocks cycle rejection smoke failed: ${JSON.stringify(cyclicGraph)}`);
  }

  console.log('production server smoke: PASS (health, six canonical apps, KoBlocks graph validation, Special Search input validation verified)');
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    sleep(3000)
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
  await rm(smokeRoot, { recursive: true, force: true });
}
