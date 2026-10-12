import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { RemoteApexRingWAL } from "../src/core/remote-apex-ring-wal.mjs";

const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
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
    const hash = digest(value);
    this.refs.set(id, { hash, value: structuredClone(value) });
    return { namespace: ns, key, hash };
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

test("remote WAL persists and verifies its hash chain across reinitialization without local files", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "apex-remote-wal-"));
  const forbiddenRoot = path.join(parent, "must-not-be-created");
  try {
    const cas = new MemoryCAS();
    const first = new RemoteApexRingWAL({ cas, scope: "remote-wal-test", ringSize: 8 });
    assert.match(first.file, /^remote:\/\//);
    await first.append("state.put", { id: "one", value: 1 });
    await first.append("state.put", { id: "two", value: 2 });
    await assert.rejects(access(forbiddenRoot), { code: "ENOENT" });

    const restarted = new RemoteApexRingWAL({ cas, scope: "remote-wal-test", ringSize: 8 });
    const replayed = [];
    assert.equal(await restarted.replay({ onRecord: record => replayed.push(record) }), 2);
    assert.deepEqual(replayed.map(record => record.payload.id), ["one", "two"]);
    assert.equal(restarted.seq, 2);
    assert.equal(restarted.lastHash, replayed[1].hash);
    assert.equal(replayed[1].prevHash, replayed[0].hash);
    await assert.rejects(access(forbiddenRoot), { code: "ENOENT" });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
