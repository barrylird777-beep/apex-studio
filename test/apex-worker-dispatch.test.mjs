import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ApexRingWAL } from "../src/core/apex-ring-wal.mjs";
import { ApexPureStore } from "../src/core/apex-pure-store.mjs";
import { createApexWorkerDispatcher } from "../src/workers/apex-worker-dispatch.mjs";
import { resolveHandler } from "../src/workers/apex-2000-worker-pure-wal-daemon.mjs";

test("fixed worker assignment reaches Pure-WAL queue and survives restart", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "apex-worker-dispatch-"));
  const root = path.join(dir, "projects");
  const walFile = path.join(dir, "wal", "ring.wal.jsonl");
  const makeStore = () => new ApexPureStore({
    root,
    wal: new ApexRingWAL({ file: walFile })
  });

  try {
    const store = makeStore();
    await store.init();
    const dispatcher = createApexWorkerDispatcher({ store });
    const queued = await dispatcher.enqueueWorker("apex-worker-0001", {
      workId: "recovery-test-1",
      context: { scope: "recovery-test", source: "fixed-manifest" }
    });

    assert.equal(queued.durable, true);
    assert.equal(queued.duplicate, false);
    assert.equal(queued.worker.role, "scripture");
    assert.equal(queued.worker.task, "scripture.worker.001");

    const executed = await dispatcher.runQueued({
      workerId: "runner-test",
      role: "scripture",
      limit: 1,
      executeTask: async assignment => ({
        verified: true,
        workerId: assignment.workerId,
        assignedTask: assignment.assignedTask,
        scope: assignment.context.scope
      })
    });
    assert.equal(executed.claimed, 1);
    assert.equal(executed.completed, 1);
    assert.equal(executed.results[0].status, "completed");
    assert.equal(executed.results[0].result.workerId, "apex-worker-0001");
    assert.equal(executed.results[0].result.assignedTask, "scripture.worker.001");

    const reopened = makeStore();
    await reopened.init();
    const recovered = reopened.jobs().find(job => job.id === queued.jobId);
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.result.verified, true);

    const duplicate = await createApexWorkerDispatcher({ store: reopened })
      .enqueueWorker("apex-worker-0001", { workId: "recovery-test-1" });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.status, "completed");
    assert.equal(reopened.jobs().length, 1);

    const nextRun = await createApexWorkerDispatcher({ store: reopened })
      .enqueueWorker("apex-worker-0001", { workId: "recovery-test-2" });
    assert.equal(nextRun.duplicate, false);
    assert.notEqual(nextRun.jobId, queued.jobId);
    assert.equal(reopened.jobs().length, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("Pure-WAL worker daemon requires an explicit assigned-task or generic handler", () => {
  const handler = async () => ({ ok: true });
  assert.equal(resolveHandler({ handlers: { "apex.worker.assigned-task": handler } }), handler);
  assert.equal(resolveHandler({ handleJob: handler }), handler);
  assert.equal(resolveHandler({ default: handler }), handler);
  assert.throws(() => resolveHandler({ handlers: {} }), /must export a handler/);
});
