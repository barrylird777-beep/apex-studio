import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateKeyPair, privateKeyToProtobuf } from "@libp2p/crypto/keys";
import { createSovereignPeer, loadOrCreatePeerPrivateKey } from "../src/network/sovereign-peer.mjs";

test("sovereign peer identity is persisted with private permissions and survives restart", async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),"apex-peer-identity-"));
  const file=path.join(dir,"identity","peer.key");
  try {
    const first=await loadOrCreatePeerPrivateKey(file);
    const firstBytes=Buffer.from(privateKeyToProtobuf(first));
    const info=await stat(file);
    assert.equal(info.isFile(),true);
    assert.equal(info.mode & 0o777,0o600);
    const persisted=await readFile(file);
    assert.deepEqual(persisted,firstBytes);

    const second=await loadOrCreatePeerPrivateKey(file);
    assert.deepEqual(Buffer.from(privateKeyToProtobuf(second)),firstBytes);
  } finally {
    await rm(dir,{recursive:true,force:true});
  }
});


test("production identity fails closed instead of creating a local key", async () => {
  const previousMode = process.env.NODE_ENV;
  const previousKey = process.env.APEX_PEER_PRIVATE_KEY_BASE64;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.APEX_PEER_PRIVATE_KEY_BASE64;
    await assert.rejects(loadOrCreatePeerPrivateKey(path.join(os.tmpdir(), "must-not-create", "peer.key")), /refusing local key-file fallback/);
  } finally {
    if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode;
    if (previousKey === undefined) delete process.env.APEX_PEER_PRIVATE_KEY_BASE64; else process.env.APEX_PEER_PRIVATE_KEY_BASE64 = previousKey;
  }
});

test("injected stable identity is used without touching local storage", async () => {
  const previousMode = process.env.NODE_ENV;
  const previousKey = process.env.APEX_PEER_PRIVATE_KEY_BASE64;
  const previousRequired = process.env.APEX_PEER_IDENTITY_REQUIRED;
  const dir = await mkdtemp(path.join(os.tmpdir(), "apex-peer-injected-"));
  const file = path.join(dir, "must-not-exist", "peer.key");
  try {
    const generated = await generateKeyPair("Ed25519");
    const bytes = Buffer.from(privateKeyToProtobuf(generated));
    process.env.NODE_ENV = "production";
    process.env.APEX_PEER_PRIVATE_KEY_BASE64 = bytes.toString("base64");
    delete process.env.APEX_PEER_IDENTITY_REQUIRED;
    const loaded = await loadOrCreatePeerPrivateKey(file);
    assert.deepEqual(Buffer.from(privateKeyToProtobuf(loaded)), bytes);
    await assert.rejects(stat(file), error => error.code === "ENOENT");
  } finally {
    if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode;
    if (previousKey === undefined) delete process.env.APEX_PEER_PRIVATE_KEY_BASE64; else process.env.APEX_PEER_PRIVATE_KEY_BASE64 = previousKey;
    if (previousRequired === undefined) delete process.env.APEX_PEER_IDENTITY_REQUIRED; else process.env.APEX_PEER_IDENTITY_REQUIRED = previousRequired;
    await rm(dir, { recursive: true, force: true });
  }
});

test("production peer startup requires an expected identity pin", async () => {
  const previousMode = process.env.NODE_ENV;
  const previousExpected = process.env.APEX_EXPECTED_PEER_ID;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.APEX_EXPECTED_PEER_ID;
    await assert.rejects(createSovereignPeer(), /APEX_EXPECTED_PEER_ID is required in production/);
  } finally {
    if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode;
    if (previousExpected === undefined) delete process.env.APEX_EXPECTED_PEER_ID; else process.env.APEX_EXPECTED_PEER_ID = previousExpected;
  }
});
