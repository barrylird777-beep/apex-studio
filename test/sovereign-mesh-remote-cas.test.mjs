import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import SovereignMeshEngine from "../src/core/sovereign-mesh-engine.mjs";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
class MemoryCAS {
  constructor() { this.refs = new Map(); }
  async init() { return this; }
  async readRef(ns, key) {
    const row = this.refs.get(ns + "/" + key);
    return row ? { namespace: ns, key, hash: row.hash, value: structuredClone(row.value) } : null;
  }
  async writeRef(ns, key, value, { expectedHash } = {}) {
    const id = ns + "/" + key, current = this.refs.get(id), actual = current?.hash ?? null;
    if (expectedHash !== undefined && actual !== expectedHash) throw Object.assign(new Error("CAS conflict"), { code: "CAS_CONFLICT" });
    const digest = hash(value);
    this.refs.set(id, { hash: digest, value: structuredClone(value) });
    return { namespace: ns, key, hash: digest };
  }
  async listRefs(ns) {
    const prefix = ns + "/";
    return [...this.refs.entries()].filter(([id]) => id.startsWith(prefix)).map(([id, row]) => ({
      namespace: ns, key: id.slice(prefix.length), hash: row.hash, value: structuredClone(row.value)
    }));
  }
  async deleteRef(ns, key, { expectedHash } = {}) {
    const id = ns + "/" + key, row = this.refs.get(id);
    if (!row) return false;
    if (expectedHash !== undefined && expectedHash !== row.hash) throw Object.assign(new Error("CAS conflict"), { code: "CAS_CONFLICT" });
    this.refs.delete(id); return true;
  }
}

test("remote sovereign mesh persists dispatches without creating local storage", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "apex-mesh-remote-"));
  const root = path.join(parent, "must-not-exist");
  try {
    const cas = new MemoryCAS();
    const engine = new SovereignMeshEngine(root, { cas });
    await engine.ready();
    const record = await engine.dispatchAutonomousPayload({
      waveId: "remote-wave-1", peerId: "peer-test", action: "test.remote", payload: { durable: true }
    });
    assert.equal(record.status, "DISPATCHED");
    assert.equal((await cas.readRef("waves", engine.key("remote-wave-1"))).value.checksum, record.checksum);
    await assert.rejects(access(root), { code: "ENOENT" });
  } finally { await rm(parent, { recursive: true, force: true }); }
});
