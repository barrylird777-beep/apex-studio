import { claimNextWorkerTasks, heartbeatWorkerTask, completeWorkerTask, failWorkerTask, releaseWorkerTasks } from "../mesh/durable-worker-store.mjs";
import { bindExecutionNodeLease, updateExecutionNodeForLease, appendAgentEvent } from "./durable-control-plane.mjs";

export class IntelligenceWorker {
  constructor({ runtime, scheduler, concurrency = 4, leaseMs = 45000 } = {}) {
    if (!runtime || !scheduler) throw new TypeError("runtime and scheduler are required");
    this.runtime = runtime;
    this.scheduler = scheduler;
    this.concurrency = Math.max(1, Math.min(32, Number(concurrency) || 4));
    this.leaseMs = Math.max(5000, Number(leaseMs) || 45000);
    this.running = new Map();
    this.claimed = new Map();
    this.stopping = false;
  }

  async processOne(signal) {
    const claimed = await claimNextWorkerTasks(1, this.leaseMs);
    const task = claimed[0];
    if (!task) return false;
    this.claimed.set(task.id, task);
    if (this.stopping || signal?.aborted) {
      this.claimed.delete(task.id);
      await releaseWorkerTasks([task.id], [task.lease_token]);
      return false;
    }
    if (task.task !== "execute-intelligence-node") {
      await failWorkerTask(task.id, new Error("Unsupported intelligence task"), task.lease_token);
      this.claimed.delete(task.id);
      this.runtime.release?.(task.worker_id);
      return true;
    }

    const bound = await bindExecutionNodeLease(task.payload?.nodeId, task.id, task.lease_token);
    if (!bound) {
      await failWorkerTask(task.id, new Error("Execution node lease binding rejected"), task.lease_token);
      this.claimed.delete(task.id);
      this.runtime.release?.(task.worker_id);
      return true;
    }

    const heartbeat = setInterval(() => {
      heartbeatWorkerTask(task.id, this.leaseMs, task.lease_token).catch(() => {});
    }, Math.max(1000, Math.floor(this.leaseMs / 3)));

    this.claimed.delete(task.id);
    this.running.set(task.id, task);
    try {
      const result = await this.scheduler.executeTask(task, { signal });
      const verified = result && typeof result === "object" && result.verification
        ? result.verification
        : null;

      if (!verified || verified.passed !== true || verified.verifier === task.worker_id) {
        throw new Error("Intelligence node executor requires independent verification evidence");
      }

      const nodeCompleted = await updateExecutionNodeForLease(task.payload.nodeId, task.id, task.lease_token, { verification: verified, status: "completed" });
      if (!nodeCompleted) throw new Error("Execution node lease fence rejected completion");
      const fenced = await completeWorkerTask(task.id, result, task.lease_token);
      if (!fenced) throw new Error("Worker lease lost before task completion");
      await appendAgentEvent({
        agentId: task.worker_id,
        planId: task.payload.planId,
        nodeId: task.payload.nodeId,
        eventType: "task_completed"
      });
      return true;
    } catch (error) {
      await updateExecutionNodeForLease(task.payload?.nodeId, task.id, task.lease_token, {
        status: "failed",
        last_error: String(error?.message || error)
      }).catch(() => {});
      const fenced = await failWorkerTask(task.id, error, task.lease_token);
      if (fenced) {
        await appendAgentEvent({
          agentId: task.worker_id,
          planId: task.payload?.planId,
          nodeId: task.payload?.nodeId,
          eventType: "task_failed",
          payload: { error: String(error?.message || error) }
        }).catch(() => {});
      }
      return true;
    } finally {
      clearInterval(heartbeat);
      this.running.delete(task.id);
      this.runtime.release?.(task.worker_id);
    }
  }

  async run({ signal } = {}) {
    let processed = 0;
    while (!this.stopping && !signal?.aborted) {
      const capacity = this.concurrency - this.running.size;
      if (capacity <= 0) {
        await new Promise(resolve => setTimeout(resolve, 25));
        continue;
      }
      const results = await Promise.all(
        Array.from({ length: capacity }, () => this.processOne(signal))
      );
      const count = results.filter(Boolean).length;
      processed += count;
      if (!count) break;
    }
    return { processed, running: this.running.size };
  }

  async stop({ timeoutMs = 30000 } = {}) {
    this.stopping = true;
    const claimed = [...this.claimed.values()];
    if (claimed.length) {
      await releaseWorkerTasks(claimed.map(task => task.id), claimed.map(task => task.lease_token));
      for (const task of claimed) this.claimed.delete(task.id);
    }
    const deadline = Date.now() + timeoutMs;
    while (this.running.size && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return { running: this.running.size, drained: this.running.size === 0 };
  }
}
