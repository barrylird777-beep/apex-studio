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
    APEX_PROJECTS_DIR: path.join(smokeRoot, 'projects'),
    APEX_WAL_DIR: path.join(smokeRoot, 'wal'),
    APEX_WAL_FILE: path.join(smokeRoot, 'wal', 'ring.wal.jsonl'),
    APEX_OPPORTUNITY_ENGINE_TOKEN: 'test-opportunity-engine-token'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
child.stdout.on('data', chunk => { output += chunk.toString(); });
child.stderr.on('data', chunk => { output += chunk.toString(); });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const getJson = path => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, method: 'GET', timeout: 1000 }, res => {
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


  const unauthenticatedStoreWrite = await fetch(`http://127.0.0.1:${port}/api/internal/opportunity-engine/store/put`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ collection: 'koin_kob_opportunities', id: 'smoke-opportunity', record: { kind: 'arbitrage' } })
  });
  if (unauthenticatedStoreWrite.status !== 401) {
    throw new Error(`Opportunity store accepted an unauthenticated write: HTTP ${unauthenticatedStoreWrite.status}`);
  }

  const opportunityWrite = await fetch(`http://127.0.0.1:${port}/api/internal/opportunity-engine/store/put`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-apex-opportunity-token': 'test-opportunity-engine-token' },
    body: JSON.stringify({
      collection: 'koin_kob_opportunities',
      id: 'smoke-opportunity',
      record: { fingerprint: 'smoke-fingerprint', kind: 'arbitrage', estimated_net_profit_usd: 42.25, observed_at: '2026-10-12T00:00:00.000Z', payload: { internal_secret: 'must-not-leak' } }
    })
  });
  const writtenOpportunity = await opportunityWrite.json();
  if (opportunityWrite.status !== 200 || writtenOpportunity.success !== true || writtenOpportunity.record?.id !== 'smoke-opportunity') {
    throw new Error(`KoinKob sovereign opportunity write failed: ${JSON.stringify(writtenOpportunity)}`);
  }

  const opportunityQuery = await fetch(`http://127.0.0.1:${port}/api/internal/opportunity-engine/store/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-apex-opportunity-token': 'test-opportunity-engine-token' },
    body: JSON.stringify({ collection: 'koin_kob_opportunities', filters: { kind: 'arbitrage' }, sortField: 'estimated_net_profit_usd', descending: true, limit: 5 })
  });
  const queriedOpportunities = await opportunityQuery.json();
  if (opportunityQuery.status !== 200 || queriedOpportunities.success !== true || queriedOpportunities.records?.[0]?.id !== 'smoke-opportunity') {
    throw new Error(`KoinKob sovereign opportunity query failed: ${JSON.stringify(queriedOpportunities)}`);
  }

  const opportunityGet = await fetch(`http://127.0.0.1:${port}/api/internal/opportunity-engine/store/get`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-apex-opportunity-token': 'test-opportunity-engine-token' },
    body: JSON.stringify({ collection: 'koin_kob_opportunities', id: 'smoke-opportunity' })
  });
  const fetchedOpportunity = await opportunityGet.json();
  if (opportunityGet.status !== 200 || fetchedOpportunity.success !== true || fetchedOpportunity.record?.fingerprint !== 'smoke-fingerprint') {
    throw new Error(`KoinKob sovereign opportunity get failed: ${JSON.stringify(fetchedOpportunity)}`);
  }

  const opportunityBulk = await fetch(`http://127.0.0.1:${port}/api/internal/opportunity-engine/store/bulk`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-apex-opportunity-token': 'test-opportunity-engine-token' },
    body: JSON.stringify({ items: [
      { collection: 'koin_kob_opportunities', id: 'smoke-opportunity', record: { fingerprint: 'must-not-overwrite', kind: 'arbitrage' } },
      { collection: 'koin_kob_opportunities', id: 'smoke-opportunity-2', record: { fingerprint: 'smoke-fingerprint-2', kind: 'arbitrage', estimated_net_profit_usd: 10 } }
    ] })
  });
  const bulkResult = await opportunityBulk.json();
  if (opportunityBulk.status !== 200 || bulkResult.written !== 1 || bulkResult.existing !== 1) {
    throw new Error(`KoinKob Pure-WAL bulk idempotency failed: ${JSON.stringify(bulkResult)}`);
  }
  const originalAfterBulk = await fetch(`http://127.0.0.1:${port}/api/internal/opportunity-engine/store/get`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-apex-opportunity-token': 'test-opportunity-engine-token' },
    body: JSON.stringify({ collection: 'koin_kob_opportunities', id: 'smoke-opportunity' })
  });
  const originalAfterBulkBody = await originalAfterBulk.json();
  if (originalAfterBulkBody.record?.fingerprint !== 'smoke-fingerprint') {
    throw new Error('KoinKob Pure-WAL bulk write overwrote an existing record');
  }


  const publicOpportunityFeed = await fetch(`http://127.0.0.1:${port}/api/koin-kob/opportunities?limit=10`);
  const publicOpportunityBody = await publicOpportunityFeed.json();
  const publicSmokeOpportunity = publicOpportunityBody.items?.find(item => item.id === 'smoke-opportunity');
  if (publicOpportunityFeed.status !== 200 || publicOpportunityBody.success !== true ||
      publicOpportunityBody.storage !== 'pure-wal' || !publicSmokeOpportunity ||
      Object.prototype.hasOwnProperty.call(publicSmokeOpportunity, 'payload')) {
    throw new Error(`KoinKob public Pure-WAL opportunity feed failed or exposed internal payload: ${JSON.stringify(publicOpportunityBody)}`);
  }


  const koinKobPageResponse = await fetch(`http://127.0.0.1:${port}/koin-kob.html`);
  const koinKobPage = await koinKobPageResponse.text();
  if (koinKobPageResponse.status !== 200 || !koinKobPage.includes('Opportunity Feed') ||
      !koinKobPage.includes('/api/koin-kob/opportunities')) {
    throw new Error('KoinKob page is missing the Pure-WAL opportunity feed UI');
  }

  const invalidOpportunityCollection = await fetch(`http://127.0.0.1:${port}/api/internal/opportunity-engine/store/put`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-apex-opportunity-token': 'test-opportunity-engine-token' },
    body: JSON.stringify({ collection: 'teevee_episodes', id: 'must-not-write', record: { kind: 'arbitrage' } })
  });
  if (invalidOpportunityCollection.status !== 400) {
    throw new Error(`Opportunity store accepted a non-KoinKob collection: HTTP ${invalidOpportunityCollection.status}`);
  }

  console.log('production server smoke: PASS (health, six canonical apps, KoBlocks graph validation, authenticated KoinKob Pure-WAL store verified)');
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    sleep(3000)
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
  await rm(smokeRoot, { recursive: true, force: true });
}
