import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { RemoteApexRingWAL } from "../src/core/remote-apex-ring-wal.mjs";
import { createRingWal } from "../src/core/apex-ring-wal.mjs";
import { DeterministicSimulator } from "../src/testing/deterministic-simulator.mjs";

const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
class MemoryCAS {
  constructor() { this.refs = new Map(); this.listCalls = 0; }
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
    this.listCalls++;
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


test("remote WAL repairs a stale head after a crash between record and head writes", async () => {
  const cas = new MemoryCAS();
  const first = new RemoteApexRingWAL({ cas, scope: "remote-wal-recovery", ringSize: 8 });
  await first.append("state.put", { id: "committed-before-crash", value: 1 });
  const head = await cas.readRef("system", first.headKey);
  await cas.deleteRef("system", first.headKey, { expectedHash: head.hash });

  const restarted = new RemoteApexRingWAL({ cas, scope: "remote-wal-recovery", ringSize: 8 });
  assert.equal(await restarted.replay(), 1, "valid immutable records survive a missing head");
  const second = await restarted.append("state.put", { id: "after-recovery", value: 2 });
  assert.equal(second.seq, 2);
  const recoveredHead = await cas.readRef("system", restarted.headKey);
  assert.equal(recoveredHead.value.seq, 2);
  assert.equal(recoveredHead.value.lastHash, second.hash);

  const verified = new RemoteApexRingWAL({ cas, scope: "remote-wal-recovery", ringSize: 8 });
  const records = [];
  assert.equal(await verified.replay({ onRecord: record => records.push(record) }), 2);
  assert.deepEqual(records.map(record => record.payload.id), ["committed-before-crash", "after-recovery"]);
});


test("createRingWal factory honors remote mode and never creates its requested local path", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "apex-remote-wal-factory-"));
  const localFile = path.join(parent, "wal", "ring.jsonl");
  const previous = process.env.APEX_CAS_REMOTE_ENABLED;
  try {
    process.env.APEX_CAS_REMOTE_ENABLED = "true";
    const cas = new MemoryCAS();
    const wal = createRingWal({ file: localFile, cas, scope: "remote-wal-factory-test" });
    assert.match(wal.file, /^remote:\/\//);
    await wal.append("factory.test", { persisted: true });
    const records = await wal.readAll();
    assert.equal(records.length, 1);
    assert.equal(records[0].payload.persisted, true);
    await assert.rejects(access(path.dirname(localFile)), { code: "ENOENT" });
  } finally {
    if (previous === undefined) delete process.env.APEX_CAS_REMOTE_ENABLED;
    else process.env.APEX_CAS_REMOTE_ENABLED = previous;
    await rm(parent, { recursive: true, force: true });
  }
});

test("normal remote WAL appends do not rescan the entire remote WAL namespace", async () => {
  const cas = new MemoryCAS();
  const wal = new RemoteApexRingWAL({ cas, scope: "remote-wal-incremental", ringSize: 8 });
  await wal.append("event.one", { value: 1 });
  const scansAfterFirstAppend = cas.listCalls;
  await wal.append("event.two", { value: 2 });
  await wal.append("event.three", { value: 3 });
  assert.equal(cas.listCalls, scansAfterFirstAppend, "appends should verify the head and adjacent refs, not list every WAL record");
  assert.equal((await wal.snapshot()).sequence, 3);
});

test("remote WAL lock waiting and record timestamps use injected deterministic clock and sleep", async () => {
  const cas = new MemoryCAS();
  await cas.writeRef("system", "wal-lock-wal-injected-clock", {
    token: "another-owner",
    leaseUntil: 20,
    owner: "another-owner"
  });
  let now = 0;
  const sleeps = [];
  const wal = new RemoteApexRingWAL({
    cas,
    scope: "wal-injected-clock",
    clock: () => now,
    random: () => 0,
    sleep: async ms => { sleeps.push(ms); now += ms; },
    scheduleInterval: () => () => {},
    tokenFactory: () => "deterministic-token"
  });

  const record = await wal.append("clock.test", { value: 1 });
  assert.deepEqual(sleeps, [35]);
  assert.equal(record.id, "deterministic-token");
  assert.equal(record.ts, new Date(35).toISOString());
  assert.equal(record.seq, 1);
  assert.equal(await cas.readRef("system", wal.lockKey), null, "lock is released after the append");
});


test("remote WAL lock contention replays under seeded virtual time without wall-clock sleeps", async () => {
  async function scenario(seed) {
    const sim = new DeterministicSimulator({ seed, startTime: 0 });
    const cas = new MemoryCAS();
    await cas.writeRef("system", "wal-lock-simulated-wal", {
      token: "live-owner",
      leaseUntil: 100,
      owner: "live-owner"
    });
    const sleeps = [];
    const wal = new RemoteApexRingWAL({
      cas,
      scope: "simulated-wal",
      clock: () => sim.now,
      random: () => sim.random(),
      sleep: ms => new Promise(resolve => {
        sleeps.push(ms);
        sim.setTimeout(resolve, ms, "remote-wal-lock-backoff");
      }),
      scheduleInterval: () => () => {},
      tokenFactory: () => "seeded-" + sim.randomInt(1, 1000000)
    });
    let settled = false;
    const pendingAppend = wal.append("simulation.claim", { opportunity: "job-1" }).finally(() => { settled = true; });
    let processed = 0;
    for (let turn = 0; turn < 100 && !settled; turn += 1) {
      await Promise.resolve();
      const result = await sim.run({ maxEvents: 100 });
      processed += result.processed;
      await Promise.resolve();
    }
    assert.equal(settled, true, "simulated append should settle without wall-clock timers");
    const record = await pendingAppend;
    return {
      now: sim.now,
      processed,
      sleeps,
      trace: sim.trace,
      record: { id: record.id, seq: record.seq, ts: record.ts, type: record.type },
      lock: await cas.readRef("system", wal.lockKey)
    };
  }

  const first = await scenario("wal-seed-2026");
  const replay = await scenario("wal-seed-2026");
  assert.deepEqual(replay, first, "same seed reproduces virtual timing and WAL result exactly");
  assert.ok(first.sleeps.length > 0, "contended lock must exercise virtual sleep");
  assert.ok(first.now > 100, "virtual clock must advance past the live lease");
  assert.equal(first.record.seq, 1);
  assert.equal(first.record.ts, new Date(first.now).toISOString());
  assert.equal(first.lock, null, "lock is released after append");
});


test("remote WAL recovers a committed record after injected ENOSPC on head update", async () => {
  class EnospcHeadCAS extends MemoryCAS {
    constructor() { super(); this.failHeadKey = null; this.failed = false; }
    async writeRef(ns, key, value, options) {
      if (!this.failed && ns === "system" && key === this.failHeadKey && value?.seq === 1) {
        this.failed = true;
        throw Object.assign(new Error("simulated remote CAS disk full"), { code: "ENOSPC" });
      }
      return super.writeRef(ns, key, value, options);
    }
  }

  const cas = new EnospcHeadCAS();
  const first = new RemoteApexRingWAL({ cas, scope: "enospc-head-recovery", ringSize: 8 });
  cas.failHeadKey = first.headKey;
  await assert.rejects(first.append("state.put", { id: "survives-head-enospc" }), { code: "ENOSPC" });
  assert.equal(cas.failed, true);
  assert.ok(await cas.listRefs("wal").then(rows => rows.some(row => row.key.includes("enospc-head-recovery"))));

  const recovered = new RemoteApexRingWAL({ cas, scope: "enospc-head-recovery", ringSize: 8 });
  assert.equal(await recovered.replay(), 1, "immutable record remains recoverable after head update failure");
  const next = await recovered.append("state.put", { id: "after-enospc" });
  assert.equal(next.seq, 2);
  assert.equal(next.payload.id, "after-enospc");
});


test("remote WAL idempotency survives cross-instance appends and rejects key reuse", async () => {
  const cas = new MemoryCAS();
  const first = new RemoteApexRingWAL({cas,scope:"wal-idempotency",ringSize:8});
  const one = await first.append("state.put",{id:"one",value:1},{idempotencyKey:"state:one:v1"});
  const second = new RemoteApexRingWAL({cas,scope:"wal-idempotency",ringSize:8});
  const two = await second.append("state.put",{id:"two",value:2},{idempotencyKey:"state:two:v1"});
  const duplicate = await first.append("state.put",{id:"two",value:2},{idempotencyKey:"state:two:v1"});
  assert.equal(duplicate.seq,two.seq,"a stale process must refresh the remote head and dedupe against another process's append");
  assert.equal(duplicate.id,two.id);
  assert.equal(one.seq,1);
  assert.equal(two.seq,2);
  await assert.rejects(
    first.append("state.put",{id:"different",value:3},{idempotencyKey:"state:two:v1"}),
    {code:"IDEMPOTENCY_CONFLICT"}
  );
  assert.equal((await cas.listRefs("wal")).filter(row=>row.key.startsWith("wal-idempotency-r")).length,2);
});
