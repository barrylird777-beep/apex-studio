import crypto from "node:crypto";

export class AgentOrchestrator {
  constructor(){this.agents=new Map();this.jobs=new Map();}

  register(agent){
    if(!agent || typeof agent.id!=="string" || typeof agent.run!=="function"){
      throw new TypeError("Agent must provide an id and run function");
    }
    this.agents.set(agent.id,agent);
    return agent;
  }

  dispatch(job={}){
    if(!job || typeof job.agentId!=="string" || !this.agents.has(job.agentId)){
      throw new Error("Agent not registered");
    }
    const id=crypto.randomUUID();
    const record={
      id,
      status:"queued",
      agentId:job.agentId,
      input:job.input,
      createdAt:new Date().toISOString()
    };
    this.jobs.set(id,record);
    return {...record};
  }

  async run(id,context={}){
    const job=this.jobs.get(id);
    if(!job) throw new Error("Job not found");
    if(job.status==="complete" || job.status==="failed") return {...job};
    const agent=this.agents.get(job.agentId);
    if(!agent) {
      job.status="failed";
      job.error="Agent not registered";
      job.completedAt=new Date().toISOString();
      return {...job};
    }
    job.status="running";
    job.startedAt=new Date().toISOString();
    try {
      job.result=await agent.run(job.input,context);
      job.status="complete";
    } catch(error) {
      job.status="failed";
      job.error=String(error?.message??error);
    }
    job.completedAt=new Date().toISOString();
    return {...job};
  }

  list(){return [...this.jobs.values()].map(job=>({...job}));}
}
