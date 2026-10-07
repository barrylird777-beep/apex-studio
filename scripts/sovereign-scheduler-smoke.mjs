import { SovereignDeterministicScheduler, nowNs } from '../src/scheduler/sovereign-deterministic-scheduler.mjs';
const scheduler = new SovereignDeterministicScheduler({ concurrency: 2 });
const order = [];
await Promise.all([
  scheduler.enqueue(async () => { order.push('a'); }, { deadlineNs: nowNs() }),
  scheduler.enqueue(async () => { order.push('b'); }, { deadlineNs: nowNs() })
]);
scheduler.stop();
if (order.length !== 2) throw new Error('scheduler failed to dispatch all tasks');
console.log(JSON.stringify({ ok: true, order }));
