import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ApexPureStore } from "../src/core/apex-pure-store.mjs";
import { ApexRingWAL } from "../src/core/apex-ring-wal.mjs";
import { enqueueVoiceoverJob, voiceoverWorkerStatus } from "../src/workers/voiceover-worker.mjs";

test("voiceover queue is durable Pure-WAL and does not require DATABASE_URL", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apex-voiceover-pure-wal-"));
  const store = new ApexPureStore({
    root: path.join(dir, "projects"),
    wal: new ApexRingWAL({ file: path.join(dir, "wal", "ring.wal.jsonl") })
  });
  const priorDb = process.env.DATABASE_URL;
  const priorUrl = process.env.APEX_WORKER_API_URL;
  const priorToken = process.env.APEX_WORKER_TOKEN;
  delete process.env.DATABASE_URL;
  delete process.env.APEX_WORKER_API_URL;
  delete process.env.APEX_WORKER_TOKEN;
  try {
    await store.init();
    const id = await enqueueVoiceoverJob({ text: "A sovereign audio test.", format: "wav" }, { store, id: "voiceover-test-1" });
    assert.equal(id, "voiceover-test-1");
    const job = store.jobs().find(item => item.id === id);
    assert.equal(job.type, "voiceover.synthesize");
    assert.equal(job.payload._apex_worker.role, "voiceover");
    const status = await voiceoverWorkerStatus({ store });
    assert.equal(status.durable, true);
    assert.equal(status.queueOwner, "local-pure-wal");
    assert.equal(status.queued, 1);
    await assert.rejects(enqueueVoiceoverJob({ text: "   " }, { store }), /Voiceover text is required/);
  } finally {
    if (priorDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorDb;
    if (priorUrl === undefined) delete process.env.APEX_WORKER_API_URL; else process.env.APEX_WORKER_API_URL = priorUrl;
    if (priorToken === undefined) delete process.env.APEX_WORKER_TOKEN; else process.env.APEX_WORKER_TOKEN = priorToken;
    await rm(dir, { recursive: true, force: true });
  }
});
