import test from "node:test";
import assert from "node:assert/strict";
import {
  readSovereignEnvelope,
  sendToPeer
} from "../src/network/sovereign-peer.mjs";

const streamFor = value => ({
  source: (async function* () { yield new TextEncoder().encode(value); })()
});

test("sovereign envelope parser rejects oversized peer messages", async () => {
  const oversized = "x".repeat(65537) + "\n";
  await assert.rejects(readSovereignEnvelope(streamFor(oversized)), /exceeds size limit/);
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

test("outgoing sovereign transport accepts an explicitly allowlisted peer", async () => {
  const previous = process.env.APEX_ALLOWED_PEER_IDS;
  process.env.APEX_ALLOWED_PEER_IDS = "allowed-peer";
  const fakeStream = {
    async sink() {},
    source: (async function* () { yield new TextEncoder().encode('{"accepted":true}\n'); })(),
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
  process.env.APEX_P2P_PORT = "0";
  let a, b;
  const received = [];
  try {
    a = await createSovereignPeer({
      keyFile: path.join(dir, "peer-a.key"),
      onEnvelope: async (envelope, context) => { received.push({ envelope, context }); return true; }
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
    assert.equal(received.length, 1);
    assert.equal(received[0].envelope.waveId, "roundtrip-1");
    assert.equal(received[0].context.remotePeerId, b.peerId.toString());
  } finally {
    await b?.stop().catch(() => {});
    await a?.stop().catch(() => {});
    if (priorIds === undefined) delete process.env.APEX_ALLOWED_PEER_IDS;
    else process.env.APEX_ALLOWED_PEER_IDS = priorIds;
    if (priorPort === undefined) delete process.env.APEX_P2P_PORT;
    else process.env.APEX_P2P_PORT = priorPort;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// Verification snapshot marker: exercise the sovereign peer transport on a stable branch.
