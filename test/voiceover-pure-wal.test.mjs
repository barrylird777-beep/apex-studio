import test from "node:test";
import assert from "node:assert/strict";

delete process.env.DATABASE_URL;

const { enqueueVoiceoverJob, getVoiceoverJob, voiceoverWorkerStatus } =
  await import("../src/workers/voiceover-worker.mjs");

test("voiceover jobs use the durable Pure-WAL queue without PostgreSQL", async () => {
  const id = await enqueueVoiceoverJob(
    { text: "A durable voiceover queue test.", format: "wav" },
    { id: "voiceover-pure-wal-test-1" }
  );

  assert.equal(id, "voiceover-pure-wal-test-1");

  const job = await getVoiceoverJob(id);
  assert.equal(job?.id, id);
  assert.equal(job?.status, "queued");
  assert.equal(job?.result, null);

  const status = await voiceoverWorkerStatus();
  assert.equal(status.storage, "local-pure-wal");
  assert.ok(status.queued >= 1);
});
