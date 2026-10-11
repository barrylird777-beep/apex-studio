import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ApexRingWAL } from "../src/core/apex-ring-wal.mjs";
import { ApexPureStore } from "../src/core/apex-pure-store.mjs";
import { createApexWorkerDispatcher } from "../src/workers/apex-worker-dispatch.mjs";

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
      context: { scope: "recovery-test", source: "fixed-manifest" }
    });

    assert.equal(queued.durable, true);
    assert.equal(queued.duplicate, false);
    assert.equal(queued.worker.role, "scripture");
    assert.equal(queued.worker.task, "scripture.worker.001");

    const [claimed] = await store.claim({ workerId: "apex-worker-0001", role: "scripture" });
    assert.ok(claimed);
    assert.equal(claimed.id, queued.jobId);
    assert.equal(claimed.payload._apex_worker.id, "apex-worker-0001");
    assert.equal(claimed.payload._apex_worker.assignedTask, "scripture.worker.001");
    assert.equal(claimed.payload.context.scope, "recovery-test");

    assert.equal(await store.transition(claimed.id, "complete", {
      leaseToken: claimed.leaseToken,
      leaseFence: claimed.leaseFence,
      result: { verified: true }
    }), true);

    const reopened = makeStore();
    await reopened.init();
    const recovered = reopened.jobs().find(job => job.id === queued.jobId);
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.result.verified, true);

    const duplicate = await createApexWorkerDispatcher({ store: reopened })
      .enqueueWorker("apex-worker-0001");
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.status, "completed");
    assert.equal(reopened.jobs().length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
