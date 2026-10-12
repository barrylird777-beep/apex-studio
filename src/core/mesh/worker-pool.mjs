import crypto from "node:crypto";

export class WorkerPool {
  constructor({ concurrency = 4, handler } = {}) {
    if (typeof handler !== "function") throw new Error("WorkerPool requires a handler.");
    this.concurrency = Math.max(1, Math.floor(Number(concurrency) || 1));
    this.handler = handler;
    this.queue = [];
    this.active = 0;
    this.completed = 0;
    this.failed = 0;
    this.stopping = false;
    this.idleWaiters = new Set();
  }

  enqueue(payload) {
    if (this.stopping) return Promise.reject(new Error("Worker pool is stopping."));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.queue.push({ id, payload, resolve, reject });
      this.#drain();
    });
  }

  status() {
    return {
      concurrency: this.concurrency,
      queued: this.queue.length,
      active: this.active,
      completed: this.completed,
      failed: this.failed,
      stopping: this.stopping
    };
  }

  stop({ rejectQueued = true } = {}) {
    this.stopping = true;
    if (rejectQueued) {
      const pending = this.queue.splice(0);
      const error = new Error("Worker pool stopped before queued work started.");
      for (const job of pending) job.reject(error);
      this.#notifyIdle();
    }
    return this.waitForIdle();
  }

  waitForIdle() {
    if (this.active === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise(resolve => this.idleWaiters.add(resolve));
  }

  #notifyIdle() {
    if (this.active !== 0 || this.queue.length !== 0) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }

  #drain() {
    while (!this.stopping && this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      this.active++;
      Promise.resolve()
        .then(() => this.handler(job.payload, job.id))
        .then(result => { this.completed++; job.resolve(result); })
        .catch(error => { this.failed++; job.reject(error); })
        .finally(() => { this.active--; this.#notifyIdle(); this.#drain(); });
    }
  }
}

export default WorkerPool;
