import {
  claimNextWorkerTasks,
  completeWorkerTask,
  failWorkerTask,
  requeueExpiredWorkerTasks,
} from "../core/mesh/durable-worker-store.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class WarpWorkerSwarm {
  constructor({
    maxConcurrency = Number(process.env.APEX_WARP_CONCURRENCY || 16),
    pollMs = 250,
    leaseMs = 45000,
  } = {}) {
    this.maxConcurrency = Math.max(1, Math.min(64, Number(maxConcurrency) || 16));
    this.pollMs = Math.max(25, Number(pollMs) || 250);
    this.leaseMs = Math.max(5000, Number(leaseMs) || 45000);
    this.running = false;
    this.inFlight = new Map();
  }

  async ignite() {
    if (this.running) return this.status();
    this.running = true;

    while (this.running) {
      await requeueExpiredWorkerTasks(Math.max(this.maxConcurrency * 2, 50));

      const capacity = this.maxConcurrency - this.inFlight.size;
      if (capacity <= 0) {
        await sleep(this.pollMs);
        continue;
      }

      const tasks = await claimNextWorkerTasks(
        Math.min(capacity, this.maxConcurrency),
        this.leaseMs
      );

      if (!tasks.length) {
        await sleep(this.pollMs);
        continue;
      }

      for (const task of tasks) {
        const promise = this.execute(task)
          .catch(async (error) => {
            await failWorkerTask(task.id, error, task.lease_token);
          })
          .finally(() => this.inFlight.delete(task.id));

        this.inFlight.set(task.id, promise);
      }
    }

    await Promise.allSettled(this.inFlight.values());
    return this.status();
  }

  async execute(task) {
    // This swarm is deliberately a queue driver, not a second implementation
    // of Apex task semantics. Production handlers belong in the canonical
    // worker dispatcher.
    if (task.task === "synthetic-warp") {
      await sleep(50 + Math.floor(Math.random() * 150));
      const fenced = await completeWorkerTask(task.id, {
        benchmark: task.payload?.benchmark || null,
        worker: process.pid,
      }, task.lease_token);
      if (!fenced) throw new Error("WARP_FENCING_LOST");
      return;
    }

    throw new Error(`WARP_UNHANDLED_TASK:${task.task}`);
  }

  async stop() {
    this.running = false;
    await Promise.allSettled(this.inFlight.values());
    return this.status();
  }

  status() {
    return {
      running: this.running,
      maxConcurrency: this.maxConcurrency,
      inFlight: this.inFlight.size,
    };
  }
}
