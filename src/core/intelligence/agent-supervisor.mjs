export class AgentSupervisor {
  constructor(runtime, { failureThreshold = 3, cooldownMs = 30000 } = {}) {
    this.runtime = runtime; this.failureThreshold = failureThreshold; this.cooldownMs = cooldownMs;
    this.failures = new Map(); this.cooldowns = new Map();
  }

  health(agentId) {
    const failures = this.failures.get(agentId) ?? 0;
    const cooldownUntil = this.cooldowns.get(agentId) ?? 0;
    return { agentId, healthy: cooldownUntil <= Date.now(), failures, cooldownUntil };
  }

  recordFailure(agentId) {
    const failures = (this.failures.get(agentId) ?? 0) + 1;
    this.failures.set(agentId, failures);
    if (failures >= this.failureThreshold) this.cooldowns.set(agentId, Date.now() + this.cooldownMs);
    return this.health(agentId);
  }

  recordSuccess(agentId) {
    this.failures.set(agentId, Math.max(0, (this.failures.get(agentId) ?? 0) - 1));
    if ((this.failures.get(agentId) ?? 0) === 0) this.cooldowns.delete(agentId);
    return this.health(agentId);
  }

  eligibleAgents(capability) {
    return this.runtime.listAgents().filter(agent =>
      agent.status === "ready" &&
      agent.capabilities.includes(capability) &&
      this.health(agent.id).healthy
    );
  }

  selectAgent(capability) {
    const agents = this.eligibleAgents(capability);
    if (!agents.length) throw new Error("No healthy agent for capability: " + capability);
    return agents.sort((a,b) => a.maxConcurrency - b.maxConcurrency)[0];
  }
}
