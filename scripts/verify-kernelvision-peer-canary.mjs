import { randomUUID } from 'node:crypto';

const baseUrl = String(process.env.APEX_BASE_URL || '').replace(/\/+$/, '');
const token = String(process.env.APEX_CONTROL_TOKEN || '');
const key = String(process.env.APEX_PEER_CANARY_KEY || `durability-${randomUUID()}`);
const minimumReplicas = Number(process.env.APEX_PEER_CAS_REPLICAS || 2);
const minimumDomains = Number(process.env.APEX_PEER_CAS_FAILURE_DOMAINS || 2);

if (!/^https?:\/\//i.test(baseUrl)) throw new Error('APEX_BASE_URL must be the reachable APEX API base URL');
if (token.length < 16) throw new Error('APEX_CONTROL_TOKEN is required; do not print or commit it');
if (!/^[A-Za-z0-9._-]{1,120}$/.test(key)) throw new Error('APEX_PEER_CANARY_KEY must be 1-120 safe characters');
if (!Number.isSafeInteger(minimumReplicas) || minimumReplicas < 1 ||
    !Number.isSafeInteger(minimumDomains) || minimumDomains < 1 || minimumDomains > minimumReplicas) {
  throw new Error('invalid replica/failure-domain policy');
}

const endpoint = baseUrl + '/api/kernelvision/peer-canary/' + encodeURIComponent(key);
const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
const marker = { schema: 'apex.kernelvision.durability-probe.v1', nonce: randomUUID(), createdAt: new Date().toISOString() };

async function request(method, body) {
  const response = await fetch(endpoint, {
    method, headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000)
  });
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = { error: 'non-JSON response' }; }
  if (!response.ok) throw new Error(`${method} canary failed with HTTP ${response.status}: ${String(payload.error || 'unknown error').slice(0, 160)}`);
  return payload;
}

const written = await request('PUT', { value: marker });
if (typeof written.hash !== 'string' || !/^[a-f0-9]{64}$/.test(written.hash)) {
  throw new Error('write did not return a valid content hash');
}
const receipts = Array.isArray(written.receipts) ? written.receipts : [];
const peers = new Set(receipts.map(receipt => receipt?.peerId).filter(Boolean));
const receiptIds = new Set(receipts.map(receipt => receipt?.receiptId).filter(Boolean));
const domains = new Set(receipts.map(receipt => receipt?.failureDomain).filter(domain => typeof domain === 'string' && domain && domain !== 'unspecified'));
if (peers.size < minimumReplicas || receiptIds.size < minimumReplicas || domains.size < minimumDomains) {
  throw new Error(`write lacks verified placement evidence: peers=${peers.size}, receiptIds=${receiptIds.size}, independentDomains=${domains.size}; required replicas=${minimumReplicas}, domains=${minimumDomains}`);
}
const readback = await request('GET');
if (readback.hash !== written.hash || JSON.stringify(readback.value) !== JSON.stringify(marker)) {
  throw new Error('canary readback hash/value does not match the write');
}

console.log(JSON.stringify({
  status: 'WRITE_READBACK_VERIFIED',
  key,
  hash: written.hash,
  replicaPeerIds: [...peers],
  receiptIds: [...receiptIds],
  trustedFailureDomains: [...domains],
  valueReadbackVerified: true,
  timestamp: new Date().toISOString(),
  independentHostRestartRecovery: 'NOT_PROVEN',
  nextRequiredStep: 'Stop one physical peer, read the same hash from a surviving peer, restart it on the same persistent volume, then verify the same hash and a fresh backend durability receipt.'
}, null, 2));
