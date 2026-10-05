import crypto from "node:crypto";
import { registerDurableAgent, heartbeatDurableAgent, setDurableAgentFailure, reviveDurableAgent, appendAgentEvent } from "./durable-control-plane.mjs";

const id = () => crypto.randomUUID();

export class AgentRuntime {
  constructor({ registry, providers, evidence, maxConcurrency = 32, leaseMs = 45000 } = {}) {
    this.registry=registry; this.providers=providers; this.evidence=evidence;
    this.maxConcurrency=Math.max(1,Number(maxConcurrency)); this.leaseMs=Math.max(5000,Number(leaseMs));
    this.agents=new Map(); this.active=new Map();
  }
  async registerAgent(input={}) {
    if(!input.id || !input.capabilities?.length) throw new TypeError("Agent requires id and capabilities");
    const agent={id:String(input.id),role:String(input.role??"general"),capabilities:[...new Set(input.capabilities.map(String))],
      tools:[...new Set((input.tools??[]).map(String))],permissions:[...new Set((input.permissions??[]).map(String))],
      status:"ready",maxConcurrency:Math.max(1,Number(input.maxConcurrency??1)),metadata:input.metadata??{},createdAt:new Date().toISOString()};
    this.agents.set(agent.id,agent); await registerDurableAgent(agent); await appendAgentEvent({agentId:agent.id,eventType:"registered",payload:{role:agent.role}});
    return structuredClone(agent);
  }
  async registerSpecialist(input={}) { return this.registerAgent({...input,metadata:{...(input.metadata??{}),specialist:true}}); }
  getAgent(id){return structuredClone(this.agents.get(id)??null)}
  listAgents(){return [...this.agents.values()].map(structuredClone)}
  async heartbeat(agentId,status="ready"){const a=this.agents.get(agentId);if(!a)throw new Error("Agent not registered: "+agentId);a.status=status;return heartbeatDurableAgent(agentId,status)}
  async quarantine(agentId){const result=await setDurableAgentFailure(agentId);const a=this.agents.get(agentId);if(a&&result)a.status=result.status;return result}
  async revive(agentId){const result=await reviveDurableAgent(agentId);if(result){const a=this.agents.get(agentId);if(a)a.status="ready"}return result}
  async enqueue({agentId,role,task,payload={},maxAttempts=5,dedupeKey}={}) {
    const agent=this.agents.get(agentId); if(!agent) throw new Error("Agent not registered: "+agentId);
    const taskId=id();
    const {enqueueWorkerTask}=await import("../mesh/durable-worker-store.mjs");
    return enqueueWorkerTask({id:taskId,workerId:agent.id,role:role??agent.role,task,payload,maxAttempts,dedupeKey});
  }
}
