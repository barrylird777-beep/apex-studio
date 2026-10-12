import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { privateKeyToProtobuf } from "@libp2p/crypto/keys";
import { loadOrCreatePeerPrivateKey } from "../src/network/sovereign-peer.mjs";

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

test("sovereign peer identity rejects unsafe permissions instead of silently rotating keys", async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),"apex-peer-identity-mode-"));
  const file=path.join(dir,"identity","peer.key");
  try {
    const key=await loadOrCreatePeerPrivateKey(file);
    const bytes=Buffer.from(privateKeyToProtobuf(key));
    await (await import("node:fs/promises")).chmod(file,0o644);
    await assert.rejects(loadOrCreatePeerPrivateKey(file),/permissions are unsafe/);
    assert.deepEqual(await readFile(file),bytes);
  } finally {
    await rm(dir,{recursive:true,force:true});
  }
});
