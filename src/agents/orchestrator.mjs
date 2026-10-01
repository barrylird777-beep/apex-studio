export class AgentOrchestrator {
  constructor(){this.agents=new Map();this.jobs=new Map();}
  register(agent){this.agents.set(agent.id,agent);return agent;}
  dispatch(job){const agent=this.agents.get(job.agentId);if(!agent)throw new Error("Agent not registered");const id=crypto.randomUUID();const record={id,status:"queued",...job,createdAt:new Date().toISOString()};this.jobs.set(id,record);return record;}
  async run(id,context={}){const job=this.jobs.get(id);if(!job)throw new Error("Job not found");const agent=this.agents.get(job.agentId);job.status="running";job.result=await agent.run(job.input,context);job.status="complete";job.completedAt=new Date().toISOString();return job;}
}
