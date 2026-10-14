import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { privateKeyToProtobuf } from "@libp2p/crypto/keys";
import { loadOrCreatePeerPrivateKey, getSovereignBootstrapPeers } from "../src/network/sovereign-peer.mjs";

test("sovereign peer identity can load from a secret without touching local storage", async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),"apex-peer-env-"));
  const keyFile=path.join(dir,"identity","peer.key");
  const previous=process.env.APEX_PEER_PRIVATE_KEY_BASE64;
  try {
    delete process.env.APEX_PEER_PRIVATE_KEY_BASE64;
    const generated=await loadOrCreatePeerPrivateKey(keyFile);
    const encoded=Buffer.from(privateKeyToProtobuf(generated)).toString("base64");
    await rm(keyFile,{force:true});
    process.env.APEX_PEER_PRIVATE_KEY_BASE64=encoded;
    const restored=await loadOrCreatePeerPrivateKey(keyFile);
    assert.deepEqual(Buffer.from(privateKeyToProtobuf(restored)),Buffer.from(encoded,"base64"));
    await assert.rejects(stat(keyFile),{code:"ENOENT"});
  } finally {
    if(previous===undefined) delete process.env.APEX_PEER_PRIVATE_KEY_BASE64;
    else process.env.APEX_PEER_PRIVATE_KEY_BASE64=previous;
    await rm(dir,{recursive:true,force:true});
  }
});

test("invalid encoded sovereign identity fails closed", async () => {
  const previous=process.env.APEX_PEER_PRIVATE_KEY_BASE64;
  try {
    process.env.APEX_PEER_PRIVATE_KEY_BASE64="not valid base64!";
    await assert.rejects(loadOrCreatePeerPrivateKey("/tmp/apex-identity-must-not-be-created/peer.key"),/valid base64/);
  } finally {
    if(previous===undefined) delete process.env.APEX_PEER_PRIVATE_KEY_BASE64;
    else process.env.APEX_PEER_PRIVATE_KEY_BASE64=previous;
  }
});

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


test("sovereign bootstrap accepts literal IP multiaddrs and rejects DNS names", () => {
  assert.deepEqual(getSovereignBootstrapPeers("/ip4/192.0.2.10/tcp/9000"), [
    "/ip4/192.0.2.10/tcp/9000/p2p/12D3KooWExample"
  ]);
  assert.throws(() => getSovereignBootstrapPeers("/dns4/bootstrap.example/tcp/9000"), /literal/);
  assert.throws(() => getSovereignBootstrapPeers("bootstrap.example:9000"), /literal/);
  assert.throws(() => getSovereignBootstrapPeers("/ip4/192.0.2.10/tcp/nope"), /Invalid literal-IP/);
});
