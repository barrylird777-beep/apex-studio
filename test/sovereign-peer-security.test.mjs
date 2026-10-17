import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { signSovereignVote, verifySovereignQuorum } from "../src/testing/sovereign-bft-quorum.mjs";
import { createPeerSecurityGuard, sealPeerEnvelope, verifyPeerEnvelope } from "../src/network/sovereign-peer-security.mjs";
import {
  readSovereignEnvelope,
  sendToPeer
} from "../src/network/sovereign-peer.mjs";

const streamFor = value => ({
  source: (async function* () { yield new TextEncoder().encode(value); })()
});

test("sealed peer envelopes bind payload digest, authenticated sender, and freshness", () => {
  const now = 1_000_000;
  const sealed = sealPeerEnvelope({ type: "cas.write", namespace: "PlanetApeX", key: "asset-1" }, "peer-a", now);
  assert.equal(verifyPeerEnvelope(sealed, "peer-a", now).allowed, true);
  assert.equal(verifyPeerEnvelope(sealed, "peer-b", now).allowed, false);
  assert.equal(verifyPeerEnvelope(sealed, "peer-a", now + 300_001).allowed, false);
  assert.equal(verifyPeerEnvelope({ ...sealed, key: "tampered" }, "peer-a", now).allowed, false);
});

test("peer security guard rejects a replayed message identifier", () => {
  const guard = createPeerSecurityGuard({ now: () => 1000, replayTtlMs: 60000 });
  const envelope = { type: "test.payload", messageId: "12345678-1234-4234-9234-123456789abc" };
  assert.equal(guard.admit("peer-a", envelope).allowed, true);
  const replay = guard.admit("peer-a", envelope);
  assert.equal(replay.allowed, false);
  assert.match(replay.reason, /replayed message/);
});

test("peer replay guard returns a cached response without re-admitting the request", () => {
  const guard = createPeerSecurityGuard({ now: () => 1000, replayTtlMs: 60000 });
  const envelope = { type: "cas.write", messageId: "12345678-1234-4234-9234-123456789abc" };
  assert.equal(guard.admit("peer-a", envelope).allowed, true);
  const response = { accepted: true, peerId: "peer-b", receipt: { hash: "a".repeat(64) } };
  assert.equal(guard.rememberResponse("peer-a", envelope, response), true);
  const replay = guard.admit("peer-a", envelope);
  assert.equal(replay.allowed, false);
  assert.deepEqual(guard.getReplayResponse("peer-a", envelope), response);
  const copy = guard.getReplayResponse("peer-a", envelope);
  copy.receipt.hash = "b".repeat(64);
  assert.deepEqual(guard.getReplayResponse("peer-a", envelope), response, "cached responses must be isolated copies");
});

test("sovereign envelope parser rejects oversized peer messages", async () => {
  const oversized = "x".repeat(65537) + "\n";
  await assert.rejects(readSovereignEnvelope(streamFor(oversized)), /exceeds size limit/);
});

test("sovereign envelope reader preserves a second envelope from the same stream chunk", async () => {
  const { readSovereignEnvelope } = await import("../src/network/sovereign-peer.mjs");
  const stream = {
    source: (async function* () {
      yield new TextEncoder().encode('{"type":"request"}\n{"accepted":true}\n');
    })()
  };
  assert.deepEqual(await readSovereignEnvelope(stream), { type: "request" });
  assert.deepEqual(await readSovereignEnvelope(stream), { accepted: true });
});

test("sovereign envelope reader supports the libp2p v3 async-iterator stream", async () => {
  const stream = {
    async *[Symbol.asyncIterator]() {
      yield new TextEncoder().encode('{"accepted":true}\n');
    }
  };
  assert.deepEqual(await readSovereignEnvelope(stream), { accepted: true });
});

test("sovereign envelope reader resumes event-based streams", async () => {
  const listeners = new Map();
  const stream = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    resume() {
      queueMicrotask(() => listeners.get("message")?.({
        data: new TextEncoder().encode('{"accepted":true}\n')
      }));
    }
  };
  assert.deepEqual(await readSovereignEnvelope(stream), { accepted: true });
});

test("outgoing sovereign transport refuses a peer outside the allowlist", async () => {
  const previous = process.env.APEX_ALLOWED_PEER_IDS;
  delete process.env.APEX_ALLOWED_PEER_IDS;
  let dialed = false;
  try {
    await assert.rejects(sendToPeer({
      async dialProtocol() { dialed = true; throw new Error("should not dial"); }
    }, "/ip4/127.0.0.1/tcp/1234/p2p/not-allowed", { type: "test" }), /not allowlisted/);
    assert.equal(dialed, false);
  } finally {
    if (previous === undefined) delete process.env.APEX_ALLOWED_PEER_IDS;
    else process.env.APEX_ALLOWED_PEER_IDS = previous;
  }
});

test("outgoing sovereign transport refuses to dial its own peer identity", async () => {
  const previous = process.env.APEX_ALLOWED_PEER_IDS;
  process.env.APEX_ALLOWED_PEER_IDS = "self-peer";
  let dialed = false;
  try {
    await assert.rejects(sendToPeer({
      peerId: { toString: () => "self-peer" },
      async dialProtocol() { dialed = true; throw new Error("should not dial itself"); }
    }, "/ip4/127.0.0.1/tcp/1234/p2p/self-peer", { type: "test" }), /cannot dial itself/);
    assert.equal(dialed, false);
  } finally {
    if (previous === undefined) delete process.env.APEX_ALLOWED_PEER_IDS;
    else process.env.APEX_ALLOWED_PEER_IDS = previous;
  }
});

test("outgoing sovereign transport accepts an explicitly allowlisted peer", async () => {
  const previous = process.env.APEX_ALLOWED_PEER_IDS;
  process.env.APEX_ALLOWED_PEER_IDS = "allowed-peer";
  const fakeStream = {
    async sink() {},
    source: (async function* () { yield new TextEncoder().encode('{"accepted":true,"peerId":"allowed-peer"}\n'); })(),
    async close() {}
  };
  let dialed = false;
  try {
    const response = await sendToPeer({
      async dialProtocol(address) {
        dialed = true;
        assert.match(String(address), /\/p2p\/allowed-peer$/);
        return fakeStream;
      }
    }, "/ip4/127.0.0.1/tcp/1234/p2p/allowed-peer", { type: "test" });
    assert.equal(dialed, true);
    assert.equal(response.accepted, true);
  } finally {
    if (previous === undefined) delete process.env.APEX_ALLOWED_PEER_IDS;
    else process.env.APEX_ALLOWED_PEER_IDS = previous;
  }
});

test("two sovereign peers exchange an envelope only when both identities are allowlisted", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { createSovereignPeer } = await import("../src/network/sovereign-peer.mjs");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "apex-peer-roundtrip-"));
  const priorIds = process.env.APEX_ALLOWED_PEER_IDS;
  const priorPort = process.env.APEX_P2P_PORT;
  const priorPrivateKey = process.env.APEX_PEER_PRIVATE_KEY_BASE64;
  // Production deployments inject one stable peer identity. The round-trip test
  // must generate two distinct temporary identities instead of reusing that key.
  delete process.env.APEX_PEER_PRIVATE_KEY_BASE64;
  process.env.APEX_P2P_PORT = "0";
  let a, b;
  const received = [];
  try {
    a = await createSovereignPeer({
      keyFile: path.join(dir, "peer-a.key"),
      onEnvelope: async (envelope, context) => {
        received.push({ envelope, context });
        return { accepted: true, replica: { waveId: envelope.waveId, checksum: 'roundtrip-checksum' } };
      }
    });
    b = await createSovereignPeer({
      keyFile: path.join(dir, "peer-b.key"),
      onEnvelope: async () => true
    });
    process.env.APEX_ALLOWED_PEER_IDS = [a.peerId.toString(), b.peerId.toString()].join(",");
    await a.start();
    await b.start();
    const address = a.getMultiaddrs().map(String).map(value => value.replace("/ip4/0.0.0.0/", "/ip4/127.0.0.1/")).find(value => value.includes("/ip4/127.0.0.1/") && value.endsWith("/p2p/" + a.peerId.toString()));
    assert.ok(address, "peer A must expose a local test dial address");
    const envelope = { type: "test.payload", waveId: "roundtrip-1", payload: { appId: "kernelodies" } };
    const response = await sendToPeer(b, address, envelope);
    assert.equal(response.accepted, true);
    assert.deepEqual(response.replica, { waveId: 'roundtrip-1', checksum: 'roundtrip-checksum' });
    assert.equal(received.length, 1);
    assert.equal(received[0].envelope.waveId, "roundtrip-1");
    assert.match(received[0].envelope.messageId, /^[0-9a-f-]{36}$/i);
    assert.equal(received[0].context.remotePeerId, b.peerId.toString());
  } finally {
    await b?.stop().catch(() => {});
    await a?.stop().catch(() => {});
    if (priorIds === undefined) delete process.env.APEX_ALLOWED_PEER_IDS;
    else process.env.APEX_ALLOWED_PEER_IDS = priorIds;
    if (priorPort === undefined) delete process.env.APEX_P2P_PORT;
    else process.env.APEX_P2P_PORT = priorPort;
    if (priorPrivateKey === undefined) delete process.env.APEX_PEER_PRIVATE_KEY_BASE64;
    else process.env.APEX_PEER_PRIVATE_KEY_BASE64 = priorPrivateKey;
    await fs.rm(dir, { recursive: true, force: true });
  }
});


test("outgoing peer ACK reader tolerates a stream closing during resume", async () => {
  const previous = process.env.APEX_ALLOWED_PEER_IDS;
  process.env.APEX_ALLOWED_PEER_IDS = "allowed-peer";
  const listeners = new Map();
  let resumeCalls = 0;
  const fakeStream = {
    status: "open",
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    resume() {
      resumeCalls++;
      throw new Error("Cannot resume a stream that is closing/closed");
    },
    send() {
      listeners.get("message")?.({
        data: new TextEncoder().encode(JSON.stringify({ accepted: true, peerId: "allowed-peer" }) + String.fromCharCode(10))
      });
      return true;
    },
    async close() {}
  };
  try {
    const response = await sendToPeer({
      async dialProtocol() { return fakeStream; }
    }, "/ip4/127.0.0.1/tcp/1234/p2p/allowed-peer", { type: "test.payload" });
    assert.equal(response.accepted, true);
    assert.equal(resumeCalls, 1, "open stream is resumed; a close race must be contained");
  } finally {
    if (previous === undefined) delete process.env.APEX_ALLOWED_PEER_IDS;
    else process.env.APEX_ALLOWED_PEER_IDS = previous;
  }
});


test("ACK timeout during a backpressured write is handled and closes the peer stream", async () => {
  const priorIds = process.env.APEX_ALLOWED_PEER_IDS;
  const priorTimeout = process.env.APEX_PEER_DIAL_TIMEOUT_MS;
  process.env.APEX_ALLOWED_PEER_IDS = "allowed-peer";
  process.env.APEX_PEER_DIAL_TIMEOUT_MS = "25";
  const listeners = new Map();
  let closed = false;
  const fakeStream = {
    status: "open",
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    send() { return false; },
    onDrain({ signal }) {
      return new Promise((resolve, reject) => {
        if (signal.aborted) reject(new Error("write timed out"));
        else signal.addEventListener("abort", () => reject(new Error("write timed out")), { once: true });
      });
    },
    async close() { closed = true; }
  };
  try {
    await assert.rejects(
      sendToPeer(
        { async dialProtocol() { return fakeStream; } },
        "/ip4/127.0.0.1/tcp/1234/p2p/allowed-peer",
        { type: "test" }
      ),
      /timed out/
    );
    assert.equal(closed, true);
  } finally {
    if (priorIds === undefined) delete process.env.APEX_ALLOWED_PEER_IDS;
    else process.env.APEX_ALLOWED_PEER_IDS = priorIds;
    if (priorTimeout === undefined) delete process.env.APEX_PEER_DIAL_TIMEOUT_MS;
    else process.env.APEX_PEER_DIAL_TIMEOUT_MS = priorTimeout;
  }
});


test("outgoing sovereign envelopes wait for accepted bytes to drain before reporting ACK", async () => {
  const previous = process.env.APEX_ALLOWED_PEER_IDS;
  process.env.APEX_ALLOWED_PEER_IDS = "allowed-peer";
  let drained = false;
  const listeners = new Map();
  const fakeStream = {
    status: "open",
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    resume() {},
    send() {
      listeners.get("message")?.({
        data: new TextEncoder().encode(JSON.stringify({ accepted: true, peerId: "allowed-peer" }) + "\n")
      });
      return true;
    },
    async onDrain() {
      await new Promise(resolve => setTimeout(resolve, 15));
      drained = true;
    },
    async close() {}
  };
  try {
    const response = await sendToPeer(
      { async dialProtocol() { return fakeStream; } },
      "/ip4/127.0.0.1/tcp/1234/p2p/allowed-peer",
      { type: "test.flush" }
    );
    assert.equal(response.accepted, true);
    assert.equal(drained, true, "ACK must not be reported until the outbound buffer drains");
  } finally {
    if (previous === undefined) delete process.env.APEX_ALLOWED_PEER_IDS;
    else process.env.APEX_ALLOWED_PEER_IDS = previous;
  }
});


test("BFT quorum accepts three of four authenticated validator signatures", () => {
  const validators = new Map();
  const keys = new Map();
  for (const peerId of ["peer-a","peer-b","peer-c","peer-d"]) {
    const pair = generateKeyPairSync("ed25519");
    validators.set(peerId,pair.publicKey);
    keys.set(peerId,pair.privateKey);
  }
  const body = {height:7,round:1,proposalHash:"hash-proposal-7",prevHash:"hash-proposal-6"};
  const votes = ["peer-a","peer-b","peer-c"].map(peerId=>signSovereignVote({...body,peerId,privateKey:keys.get(peerId)}));
  const certificate = verifySovereignQuorum({...body,votes,validators});
  assert.equal(certificate.valid,true);
  assert.equal(certificate.maxFaults,1);
  assert.equal(certificate.quorum,3);
  assert.equal(certificate.acceptedSigners.length,3);
});

test("BFT quorum rejects two votes and never counts duplicate signers twice", () => {
  const validators = new Map();
  const keys = new Map();
  for (const peerId of ["peer-a","peer-b","peer-c","peer-d"]) {
    const pair = generateKeyPairSync("ed25519");
    validators.set(peerId,pair.publicKey);
    keys.set(peerId,pair.privateKey);
  }
  const body = {height:8,round:0,proposalHash:"hash-proposal-8",prevHash:"hash-proposal-7"};
  const a = signSovereignVote({...body,peerId:"peer-a",privateKey:keys.get("peer-a")});
  const b = signSovereignVote({...body,peerId:"peer-b",privateKey:keys.get("peer-b")});
  const short = verifySovereignQuorum({...body,votes:[a,b],validators});
  assert.equal(short.valid,false);
  const duplicate = verifySovereignQuorum({...body,votes:[a,a,b],validators});
  assert.equal(duplicate.valid,false);
  assert.equal(duplicate.acceptedSigners.length,2);
  assert.ok(duplicate.rejected.some(item=>item.reason==="duplicate-vote"));
});

test("BFT quorum rejects forged votes and quarantines authenticated equivocation", () => {
  const validators = new Map();
  const keys = new Map();
  for (const peerId of ["peer-a","peer-b","peer-c","peer-d"]) {
    const pair = generateKeyPairSync("ed25519");
    validators.set(peerId,pair.publicKey);
    keys.set(peerId,pair.privateKey);
  }
  const body = {height:9,round:0,proposalHash:"hash-proposal-9",prevHash:"hash-proposal-8"};
  const a = signSovereignVote({...body,peerId:"peer-a",privateKey:keys.get("peer-a")});
  const b = signSovereignVote({...body,peerId:"peer-b",privateKey:keys.get("peer-b")});
  const c = signSovereignVote({...body,peerId:"peer-c",privateKey:keys.get("peer-c")});
  const forged = {...c,proposalHash:"tampered-proposal"};
  const forgedOnly = verifySovereignQuorum({...body,votes:[a,b,forged],validators});
  assert.equal(forgedOnly.valid,false);
  assert.deepEqual(forgedOnly.quarantine,[],"an invalid signature alone must not let an attacker frame a validator");

  const conflicting = signSovereignVote({...body,proposalHash:"other-proposal",peerId:"peer-c",privateKey:keys.get("peer-c")});
  const equivocation = verifySovereignQuorum({...body,votes:[a,b,c,conflicting],validators});
  assert.equal(equivocation.valid,false,"an equivocating validator is removed from the accepted quorum");
  assert.ok(equivocation.quarantine.includes("peer-c"));
  assert.ok(equivocation.rejected.some(item=>item.reason==="equivocation"));
});


test("peer security guard rejects replayed message IDs and throttles noisy peers", () => {
  let now = 1000;
  const guard = createPeerSecurityGuard({ now: () => now, windowMs: 60_000, limit: 3, replayTtlMs: 10_000 });
  const first = { type: "replica.write", messageId: "message-0001" };
  assert.equal(guard.admit("peer-a", first).allowed, true);
  assert.equal(guard.admit("peer-a", first).reason, "replayed message rejected");
  assert.equal(guard.admit("peer-a", { type: "heartbeat" }).allowed, true);
  assert.equal(guard.admit("peer-a", { type: "heartbeat-2" }).reason, "peer rate limit exceeded");
  assert.equal(guard.admit("peer-b", { type: "heartbeat" }).allowed, true);
  now += 60_001;
  assert.equal(guard.admit("peer-a", first).allowed, true);
});

test("peer security guard rejects malformed message identifiers", () => {
  const guard = createPeerSecurityGuard();
  assert.equal(guard.admit("peer-a", { type: "task", nonce: "short" }).reason, "invalid message identifier");
  assert.equal(guard.admit("", { type: "task" }).reason, "invalid peer identity");
});


test("outgoing sovereign transport rejects a mismatched peer identity in an ACK", async () => {
  const previous = process.env.APEX_ALLOWED_PEER_IDS;
  process.env.APEX_ALLOWED_PEER_IDS = "allowed-peer";
  const fakeStream = {
    async sink() {},
    source: (async function* () { yield new TextEncoder().encode('{"accepted":true,"peerId":"attacker-peer"}\n'); })(),
    async close() {}
  };
  try {
    await assert.rejects(
      sendToPeer({ async dialProtocol() { return fakeStream; } },
        "/ip4/127.0.0.1/tcp/1234/p2p/allowed-peer", { type: "test.identity" }),
      /response identity mismatch/
    );
  } finally {
    if (previous === undefined) delete process.env.APEX_ALLOWED_PEER_IDS;
    else process.env.APEX_ALLOWED_PEER_IDS = previous;
  }
});
