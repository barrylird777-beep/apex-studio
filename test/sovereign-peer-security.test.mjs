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
        assert.match(address, /\/p2p\/allowed-peer$/);
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
