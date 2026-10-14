import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { PeerContentAddressedStore } from '../src/core/peer-content-addressed-store.mjs';

const worker = String.raw`
import { createServer } from 'node:http';
const { createPeerOwnedBinaryBackend } = await import(process.env.APEX_TEST_BACKEND_MODULE);
const { createPeerObjectStorageHandler } = await import(process.env.APEX_TEST_HANDLER_MODULE);
const backend = await createPeerOwnedBinaryBackend({
  peerId: process.env.APEX_TEST_PEER_ID,
  namespaceAcl: 'PlanetApeX=writer-peer'
});
const handle = createPeerObjectStorageHandler({
  store: backend,
  peerId: process.env.APEX_TEST_PEER_ID,
  authorizeNamespace: ({ remotePeerId, namespace }) =>
    remotePeerId === 'writer-peer' && namespace === 'PlanetApeX'
});
const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/rpc') {
    res.writeHead(404).end();
    return;
  }
  try {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 12 * 1024 * 1024) throw new Error('request too large');
    }
    const response = await handle(JSON.parse(body), { remotePeerId: 'writer-peer' });
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(response));
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' })
      .end(JSON.stringify({ error: error.message }));
  }
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  process.stdout.write(JSON.stringify({ ready: true, port: address.port }) + '\n');
});
`;

function startPeer(t, { peerId, root, receiptKey }) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', worker], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APEX_PEER_OWNED_STORAGE_ROOT: root,
      APEX_PEER_STORAGE_RECEIPT_KEY_BASE64: receiptKey,
      APEX_TEST_PEER_ID: peerId,
      APEX_TEST_BACKEND_MODULE: pathToFileURL(path.resolve('src/core/peer-owned-binary-backend.mjs')).href,
      APEX_TEST_HANDLER_MODULE: pathToFileURL(path.resolve('src/core/peer-content-addressed-store.mjs')).href
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const ready = new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`${peerId} startup timed out: ${stderr}`)), 10_000);
    const inspect = () => {
      const newline = stdout.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(deadline);
      try {
        const line = stdout.slice(0, newline);
        const message = JSON.parse(line);
        if (!message.ready || !Number.isInteger(message.port)) throw new Error('invalid readiness message');
        resolve({ port: message.port });
      } catch (error) { reject(error); }
    };
    child.stdout.on('data', inspect);
    child.once('error', error => { clearTimeout(deadline); reject(error); });
    child.once('exit', code => {
      clearTimeout(deadline);
      reject(new Error(`${peerId} exited before readiness (code ${code}): ${stderr}`));
    });
    inspect();
  });
  const peer = { child, ready, get stderr() { return stderr; } };
  t.after(async () => {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  });
  return peer;
}

async function stopPeer(peer) {
  if (peer.child.exitCode !== null) return;
  peer.child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => peer.child.once('exit', resolve)),
    delay(3_000).then(() => {
      if (peer.child.exitCode === null) peer.child.kill('SIGKILL');
    })
  ]);
}

test('independent peer processes recover encrypted objects and refs after outage and restart', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apex-independent-peers-'));
  const receiptKey = Buffer.alloc(32, 51).toString('base64');
  t.after(() => rm(root, { recursive: true, force: true }));
  const roots = { 'peer-a': path.join(root, 'peer-a'), 'peer-b': path.join(root, 'peer-b') };
  let peerA = startPeer(t, { peerId: 'peer-a', root: roots['peer-a'], receiptKey });
  let peerB = startPeer(t, { peerId: 'peer-b', root: roots['peer-b'], receiptKey });
  const a = await peerA.ready;
  let b = await peerB.ready;
  const transport = {
    async request(peerId, request) {
      const port = peerId === 'peer-a' ? a.port : b.port;
      const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(2_000)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `peer HTTP ${response.status}`);
      return payload;
    }
  };
  const client = new PeerContentAddressedStore({
    transport,
    peers: ['peer-a', 'peer-b'],
    replicaCount: 2,
    minFailureDomains: 2,
    failureDomainsByPeerId: { 'peer-a': 'process-a', 'peer-b': 'process-b' },
    namespace: 'PlanetApeX',
    encryptionKey: Buffer.alloc(32, 7)
  });

  const value = { project: 'cross-process-recovery', revision: 1, payload: 'survives process loss' };
  const written = await client.putObject(value);
  const ref = await client.writeRef('project-main', { objectHash: written.hash, revision: 1 }, { expectedHash: null });
  assert.deepEqual(new Set(written.replicas), new Set(['peer-a', 'peer-b']));
  assert.deepEqual(new Set(ref.replicas), new Set(['peer-a', 'peer-b']));

  await stopPeer(peerA);
  await stopPeer(peerB);
  peerB = startPeer(t, { peerId: 'peer-b', root: roots['peer-b'], receiptKey });
  b = await peerB.ready;

  assert.deepEqual(await client.getObject(written.hash), value);
  assert.deepEqual((await client.readRef('project-main')).value, { objectHash: written.hash, revision: 1 });
  await assert.rejects(
    client.putObject({ mustNotBeAcknowledged: true }),
    error => error.code === 'INSUFFICIENT_REPLICAS' && error.verifiedReplicas === 1
  );
});
