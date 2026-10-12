import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTeeVeeProductionRouter } from "../src/api/teevee-production-api.mjs";
import { ApexPureStore } from "../src/core/apex-pure-store.mjs";
import { ApexRingWAL } from "../src/core/apex-ring-wal.mjs";

test("TeeVee production API requires a durable enqueue function", () => {
  assert.throws(() => createTeeVeeProductionRouter(), /TeeVee production enqueue function is required/);
});


test("TeeVee production start is blocked until remote worker state and artifact handoff are verified", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apex-teevee-disabled-"));
  const store = new ApexPureStore({
    root: path.join(dir, "projects"),
    wal: new ApexRingWAL({ file: path.join(dir, "wal", "ring.wal.jsonl") })
  });
  await store.init();
  let enqueueCalled = false;
  const app = express();
  app.use("/api/teevee/production", createTeeVeeProductionRouter({
    store,
    enqueue: async item => { enqueueCalled = true; return item; }
  }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/teevee/production`;
    const status = await (await fetch(base + "/status")).json();
    assert.equal(status.pipelineEnabled, false);
    assert.match(status.startBlockedReason, /artifact handoff/i);

    const response = await fetch(base + "/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ episodeNumber: 1 })
    });
    const result = await response.json();
    assert.equal(response.status, 503);
    assert.equal(result.success, false);
    assert.match(result.error, /disabled/i);
    assert.equal(enqueueCalled, false);
    assert.equal((await store.list("teevee_episodes")).length, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test("TeeVee production routes use Pure-WAL inventory and idempotent durable enqueue", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apex-teevee-pure-wal-"));
  const store = new ApexPureStore({
    root: path.join(dir, "projects"),
    wal: new ApexRingWAL({ file: path.join(dir, "wal", "ring.wal.jsonl") })
  });
  await store.init();
  const app = express();
  app.use("/api/teevee/production", createTeeVeeProductionRouter({
    store,
    enabled: true,
    enqueue: async item => store.enqueue({
      id: item.id,
      type: item.task,
      payload: item.payload,
      maxAttempts: item.maxAttempts,
      dedupeKey: item.dedupeKey
    })
  }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/teevee/production`;
    const initial = await (await fetch(base + "/status")).json();
    assert.equal(initial.success, true);
    assert.equal(initial.storage, "Pure-WAL/Ring-WAL");
    assert.equal(initial.inventoryTotal, 2785);
    assert.equal(initial.seededEpisodes, 0);

    const firstResponse = await fetch(base + "/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ episodeNumber: 1 })
    });
    const first = await firstResponse.json();
    assert.equal(firstResponse.status, 202);
    assert.equal(first.success, true);
    assert.equal(first.episodeCode, "APX-0001");
    assert.ok(first.jobId);

    const duplicateResponse = await fetch(base + "/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ episodeNumber: 1 })
    });
    const duplicate = await duplicateResponse.json();
    assert.equal(duplicateResponse.status, 200);
    assert.equal(duplicate.status, "already-queued");
    assert.equal(duplicate.jobId, first.jobId);

    const after = await (await fetch(base + "/status")).json();
    assert.equal(after.seededEpisodes, 1);
    assert.equal(after.queuedJobs, 1);

    const invalidResponse = await fetch(base + "/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ episodeNumber: 9999 })
    });
    assert.equal(invalidResponse.status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
