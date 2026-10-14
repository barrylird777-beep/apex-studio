import test from 'node:test';
import assert from 'node:assert/strict';
import { createPeerCasTransport } from '../src/network/peer-cas-transport.mjs';

const localId = 'local-peer';
const remoteId = 'remote-peer';
const address = `/ip4/127.0.0.1/tcp/9000/p2p/${remoteId}`;
const node = { peerId: { toString: () => localId }, dialProtocol() {} };

test('peer CAS transport requires an explicit libp2p node', () => {
  assert.throws(() => createPeerCasTransport(), /started libp2p node/);
});

test('peer CAS transport rejects addresses whose embedded peer ID mismatches the map key', () => {
  assert.throws(
    () => createPeerCasTransport({ node, peerAddresses: { [remoteId]: '/ip4/127.0.0.1/tcp/9000/p2p/other-peer' } }),
    /matching \/p2p\/<peerId>/
  );
});

test('peer CAS transport rejects self as a replica', () => {
  assert.throws(
    () => createPeerCasTransport({ node, peerAddresses: { [localId]: `/ip4/127.0.0.1/tcp/9000/p2p/${localId}` } }),
    /local peer cannot be configured/
  );
});

test('peer CAS transport exposes only configured peers', async () => {
  const transport = createPeerCasTransport({ node, peerAddresses: { [remoteId]: address } });
  await assert.rejects(
    transport.request('unconfigured-peer', { protocol: 'apex.cas.v1', namespace: 'KernelVision' }),
    error => error.code === 'CAS_PEER_NOT_CONFIGURED'
  );
});

test('peer CAS transport rejects malformed or unnamespaced requests', async () => {
  const transport = createPeerCasTransport({ node, peerAddresses: { [remoteId]: address } });
  await assert.rejects(
    transport.request(remoteId, { protocol: 'apex.cas.v1' }),
    /protocol and app namespace/
  );
});
