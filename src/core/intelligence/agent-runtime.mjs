import crypto from "node:crypto";
import { enqueueWorkerTask, claimNextWorkerTasks, heartbeatWorkerTask, completeWorkerTask, failWorkerTask, requeueExpiredWorkerTasks } from "../mesh/durable-worker-store.mjs";

const id = () => crypto.randomUUID();

export class AgentRuntime {
  constructor({ registry, providers, evidence, maxConcurrency = 32, leaseMs = 45000 } = {}) {
    this.registry = registry;
    this.providers = providers;
    this.evidence = evidence;
    this.maxConcurrency = Math.max(1, Number(maxConcurrency));
    this.leaseMs = Math.max(5000, Number(leaseMs));
    this.agents = new Map();
    this.active = new Map();
  }

  registerAgent(input = {}) {
    if (!input.id || !input.capabilities?.length) throw new TypeError("Agent requires id and capabilities");
    const agent = {
      id: String(input.id), role: String(input.role ?? "general"),
      capabilities: [...new Set(input.capabilities.map(String))],
      tools: [...new Set((input.tools ?? []).map(String))],
      permissions: [...new Set((input.permissions ?? []).map(String))],
      status: "ready", maxConcurrency: Math.max(1, Number(input.maxConcurrency ?? 1)),
      metadata: input.metadata ?? {}, createdAt: new Date().toISOString()
    };
    this.agents.set(agent.id, agent);
    return structuredClone(agent);
  }

  registerSpecialist(input = {}) {
    return this.registerAgent({ ...input, metadata: { ...(input.metadata ?? {}), specialist: true } });
  }

  getAgent(id) { return structuredClone(this.agents.get(id) ?? null); }
  listAgents() { return [...this.agents.values()].map(structuredClone); }

  async enqueue({ agentId, role, task, payload = {}, maxAttempts = 5, dedupeKey } = {}) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("Agent not registered: " + agentId);
    const taskId = id();
    return enqueueWorkerTask({ id: taskId, workerId: agent.id, role: role ?? agent.role, task, payload, maxAttempts, dedupeKey });
  }

  async runBatch({ limit = 20, executor, signal } = {}) {
    if (typeof executor !== "function") throw new TypeError("executor is required");
    await requeueExpiredWorkerTasks(limit * 4);
    const capacity = Math.max(0, this.maxConcurrency - this.active.size);
    if (!capacity) return { claimed: 0, completed: 0, failed: 0, skipped: 0 };
    const claimed = await claimNextWorkerTasks(Math.min(limit, capacity), this.leaseMs);
    let completed = 0, failed = 0, skipped = 0;
    await Promise.all(claimed.map(async task => {
      if (signal?.aborted) { skipped++; return; }
      const heartbeat = setInterval(() => {
        heartbeatWorkerTask(task.id, this.leaseMs, task.lease_token).catch(() => {});
      }, Math.max(1000, Math.floor(this.leaseMs / 3)));
      this.active.set(task.id, task);
      try {
        const agent = this.agents.get(task.worker_id);
        if (!agent) throw new Error("Agent unavailable: " + task.worker_id);
        const result = await executor(task, agent, { signal, runtime: this });
        const fenced = await completeWorkerTask(task.id, result, task.lease_token);
        if (!fenced) throw new Error("Task lease lost before completion");
        completed++;
      } catch (error) {
        const fenced = await failWorkerTask(task.id, error, task.lease_token);
        if (fenced) failed++; else skipped++;
      } finally {
        clearInterval(heartbeat);
        this.active.delete(task.id);
      }
    }));
    return { claimed: claimed.length, completed, failed, skipped };
  }

  async drain({ timeoutMs = 30000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (this.active.size && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
    return { active: this.active.size, drained: this.active.size === 0 };
  }
}
