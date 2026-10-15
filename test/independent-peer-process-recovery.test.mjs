import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
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

function startPeer(t, { peerId, root, signingPrivateKey }) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', worker], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APEX_PEER_OWNED_STORAGE_ROOT: root,
      APEX_PEER_STORAGE_RECEIPT_PRIVATE_KEY_PKCS8_BASE64: signingPrivateKey,
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
  const keyPairs = Object.fromEntries(['peer-a', 'peer-b'].map(peerId => [peerId, generateKeyPairSync('ed25519')]));
  const publicKeys = Object.fromEntries(Object.entries(keyPairs).map(([peerId, pair]) => [peerId, pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')]));
  const signingKeys = Object.fromEntries(Object.entries(keyPairs).map(([peerId, pair]) => [peerId, pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')]));
  t.after(() => rm(root, { recursive: true, force: true }));
  const roots = { 'peer-a': path.join(root, 'peer-a'), 'peer-b': path.join(root, 'peer-b') };
  let peerA = startPeer(t, { peerId: 'peer-a', root: roots['peer-a'], signingPrivateKey: signingKeys['peer-a'] });
  let peerB = startPeer(t, { peerId: 'peer-b', root: roots['peer-b'], signingPrivateKey: signingKeys['peer-b'] });
  let a = await peerA.ready;
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
    encryptionKey: Buffer.alloc(32, 7),
    receiptPublicKeysByPeerId: publicKeys
  });

  const value = { project: 'cross-process-recovery', revision: 1, payload: 'survives process loss' };
  const written = await client.putObject(value);

  // Fault injection: terminate both peers after the immutable object is durable
  // but before publishing its mutable reference.
  await stopPeer(peerA);
  await stopPeer(peerB);
  peerA = startPeer(t, { peerId: 'peer-a', root: roots['peer-a'], signingPrivateKey: signingKeys['peer-a'] });
  peerB = startPeer(t, { peerId: 'peer-b', root: roots['peer-b'], signingPrivateKey: signingKeys['peer-b'] });
  a = await peerA.ready;
  b = await peerB.ready;
  assert.deepEqual(await client.getObject(written.hash), value);
  assert.deepEqual(await client.listRefs(), [], 'interrupted publication must not fabricate a reference');

  const ref = await client.writeRef('project-main', { objectHash: written.hash, revision: 1 }, { expectedHash: null });
  assert.deepEqual(new Set(written.replicas), new Set(['peer-a', 'peer-b']));
  assert.deepEqual(new Set(ref.replicas), new Set(['peer-a', 'peer-b']));
  assert.deepEqual(await client.listRefs(), [
    { namespace: 'PlanetApeX', key: 'project-main', hash: ref.hash, value: { objectHash: written.hash, revision: 1 } }
  ]);

  await stopPeer(peerA);
  await stopPeer(peerB);
  peerB = startPeer(t, { peerId: 'peer-b', root: roots['peer-b'], signingPrivateKey: signingKeys['peer-b'] });
  b = await peerB.ready;

  assert.deepEqual(await client.getObject(written.hash), value);
  await assert.rejects(
    client.readRef('project-main'),
    error => error.code === 'INSUFFICIENT_REPLICAS' && error.verifiedReplicas === 1
  );
  await assert.rejects(client.listRefs(), error => error.code === 'INSUFFICIENT_REPLICAS' && error.verifiedReplicas === 1);
  await assert.rejects(
    client.putObject({ mustNotBeAcknowledged: true }),
    error => error.code === 'INSUFFICIENT_REPLICAS' && error.verifiedReplicas === 1
  );

  peerA = startPeer(t, { peerId: 'peer-a', root: roots['peer-a'], signingPrivateKey: signingKeys['peer-a'] });
  a = await peerA.ready;
  assert.deepEqual(await client.listRefs(), [
    { namespace: 'PlanetApeX', key: 'project-main', hash: ref.hash, value: { objectHash: written.hash, revision: 1 } }
  ]);
  assert.deepEqual((await client.readRef('project-main')).value, { objectHash: written.hash, revision: 1 });
});


test('corrupt stored bytes are rejected on restart instead of being acknowledged as durable', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apex-peer-corruption-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const signingPrivateKey = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const peerRoot = path.join(root, 'peer-a');
  let peer = startPeer(t, { peerId: 'peer-a', root: peerRoot, signingPrivateKey });
  let address = await peer.ready;
  const transport = { async request(peerId, request, { signal } = {}) {
    const response = await fetch(`http://127.0.0.1:${address.port}/rpc`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request), signal: signal || AbortSignal.timeout(1000)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'peer request failed');
    return result;
  }};
  const client = new PeerContentAddressedStore({
    transport, peers: ['peer-a'], replicaCount: 1,
    namespace: 'PlanetApeX', encryptionKey: Buffer.alloc(32, 31),
    receiptPublicKeysByPeerId: { 'peer-a': publicKey }
  });
  const stored = await client.putObject({ integrity: 'must fail closed after corruption' });
  await stopPeer(peer);
  const objectPath = path.join(peerRoot, 'objects', stored.hash + '.bin');
  const original = await readFile(objectPath);
  await writeFile(objectPath, Buffer.concat([original, Buffer.from([0])]));
  peer = startPeer(t, { peerId: 'peer-a', root: peerRoot, signingPrivateKey });
  await assert.rejects(peer.ready, /exited before readiness|startup timed out/);
});
