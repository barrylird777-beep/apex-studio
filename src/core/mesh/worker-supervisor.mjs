import WorkerPool from "./worker-pool.mjs";

export class WorkerSupervisor {
  constructor({ workers = 4, handler } = {}) {
    this.pool = new WorkerPool({ concurrency: workers, handler });
    this.started = false;
    this.stopping = false;
  }

  start() {
    if (this.started) return this.status();
    if (this.stopping) throw new Error("Worker supervisor is stopping.");
    this.started = true;
    return this.status();
  }

  async stop() {
    if (!this.started && !this.stopping) return this.status();
    this.started = false;
    this.stopping = true;
    await this.pool.stop({ rejectQueued: true });
    this.stopping = false;
    return this.status();
  }

  dispatch(payload) {
    if (!this.started || this.stopping) throw new Error("Worker supervisor is not running.");
    return this.pool.enqueue(payload);
  }

  status() {
    return { started: this.started, stopping: this.stopping, pool: this.pool.status() };
  }
}

export default WorkerSupervisor;
