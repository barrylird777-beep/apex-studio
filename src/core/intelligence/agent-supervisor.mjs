export class AgentSupervisor {
  constructor(runtime,{failureThreshold=3,cooldownMs=30000}={}) {
    if(!runtime) throw new TypeError("runtime is required");
    this.runtime=runtime; this.failureThreshold=Math.max(1,Number(failureThreshold)||3); this.cooldownMs=Math.max(1000,Number(cooldownMs)||30000);
    this.failures=new Map(); this.cooldowns=new Map();
  }
  health(agentId) {
    const a=this.runtime.getAgent(agentId); const failures=a?.failureCount??this.failures.get(agentId)??0;
    const cooldownUntil=this.cooldowns.get(agentId)??0;
    return {agentId,healthy:Boolean(a)&&a.status==="ready"&&cooldownUntil<=Date.now(),failures,cooldownUntil};
  }
  async recordFailure(agentId) {
    const result=await this.runtime.quarantine(agentId, this.failureThreshold);
    const failures=Number(result?.failure_count ?? ((this.failures.get(agentId)??0)+1));
    this.failures.set(agentId,failures);
    if(failures>=this.failureThreshold) this.cooldowns.set(agentId,Date.now()+this.cooldownMs);
    return {durable:result,...this.health(agentId)};
  }
  async recordSuccess(agentId) {
    this.failures.set(agentId,Math.max(0,(this.failures.get(agentId)??0)-1));
    return this.health(agentId);
  }
  eligibleAgents(capability) {
    return this.runtime.listAgents().filter(agent=>agent.status==="ready"&&agent.capabilities.includes(capability)&&this.health(agent.id).healthy);
  }
  selectAgent(capability) {
    const agents=this.eligibleAgents(capability);
    if(!agents.length) throw new Error("No healthy agent for capability: "+capability);
    return agents.sort((a,b)=>a.maxConcurrency-b.maxConcurrency)[0];
  }
}
