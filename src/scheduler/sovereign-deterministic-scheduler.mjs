import os from 'node:os';

const nowNs = () => process.hrtime.bigint();

export class SovereignDeterministicScheduler {
  constructor({ concurrency = os.availableParallelism?.() || os.cpus().length || 1 } = {}) {
    this.concurrency = Math.max(1, Number(concurrency));
    this.pending = [];
    this.active = 0;
    this.sequence = 0;
    this.timer = null;
    this.stopped = false;
  }

  enqueue(task, { deadlineNs = nowNs(), priority = 0, metadata = {} } = {}) {
    if (this.stopped) throw new Error('scheduler stopped');
    return new Promise((resolve, reject) => {
      this.pending.push({ sequence: ++this.sequence, deadlineNs: BigInt(deadlineNs), priority, task, metadata, resolve, reject });
      this.pending.sort((a, b) => a.deadlineNs < b.deadlineNs ? -1 : a.deadlineNs > b.deadlineNs ? 1 : b.priority - a.priority || a.sequence - b.sequence);
      this.arm();
    });
  }

  arm() {
    if (this.stopped || this.timer || !this.pending.length) return;
    const delta = this.pending[0].deadlineNs - nowNs();
    const ms = Number(delta <= 0n ? 0n : delta / 1000000n);
    this.timer = setTimeout(() => { this.timer = null; void this.dispatch(); }, Math.min(ms, 2147483647));
  }

  async dispatch() {
    if (this.stopped) return;
    while (this.active < this.concurrency && this.pending.length) {
      if (this.pending[0].deadlineNs > nowNs()) break;
      const item = this.pending.shift();
      this.active++;
      Promise.resolve().then(item.task).then(item.resolve, item.reject).finally(() => {
        this.active--;
        void this.dispatch();
        this.arm();
      });
    }
    this.arm();
  }

  async drain() {
    while (this.active || this.pending.length) await new Promise(r => setTimeout(r, 0));
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const item of this.pending.splice(0)) item.reject(new Error('scheduler stopped'));
  }
}

export { nowNs };
