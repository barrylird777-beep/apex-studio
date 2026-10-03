import crypto from "node:crypto";

export class WorkerPool {
  constructor({ concurrency = 4, handler } = {}) {
    this.concurrency = Math.max(1, Math.floor(Number(concurrency) || 1));
    this.handler = handler;
    this.queue = [];
    this.active = 0;
    this.completed = 0;
    this.failed = 0;
  }

  enqueue(payload) {
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
      failed: this.failed
    };
  }

  #drain() {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      this.active++;
      Promise.resolve()
        .then(() => this.handler(job.payload, job.id))
        .then(result => { this.completed++; job.resolve(result); })
        .catch(error => { this.failed++; job.reject(error); })
        .finally(() => { this.active--; this.#drain(); });
    }
  }
}

export default WorkerPool;
