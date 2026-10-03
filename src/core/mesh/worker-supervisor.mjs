import WorkerPool from "./worker-pool.mjs";

export class WorkerSupervisor {
  constructor({ workers = 4, handler } = {}) {
    this.pool = new WorkerPool({ concurrency: workers, handler });
    this.started = false;
  }

  start() {
    this.started = true;
    return this.status();
  }

  stop() {
    this.started = false;
    return this.status();
  }

  dispatch(payload) {
    if (!this.started) throw new Error("Worker supervisor is not running.");
    return this.pool.enqueue(payload);
  }

  status() {
    return { started: this.started, pool: this.pool.status() };
  }
}

export default WorkerSupervisor;
