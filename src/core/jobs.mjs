import { uid, now } from "./id.mjs";
export class JobQueue {
 constructor(events){this.events=events;this.jobs=new Map();this.handlers=new Map();}
 register(type,handler){this.handlers.set(type,handler);return this;}
 enqueue(type,payload={},opts={}){const job={id:uid("job"),type,payload,status:"queued",priority:opts.priority??0,createdAt:now(),updatedAt:now()};this.jobs.set(job.id,job);this.events?.emit("job.queued",job);return job;}
 async run(id){const job=this.jobs.get(id);if(!job)throw new Error("Job not found");const fn=this.handlers.get(job.type);if(!fn)throw new Error("No handler for "+job.type);job.status="running";job.startedAt=now();try{job.result=await fn(job.payload,job);job.status="completed";}catch(error){job.status="failed";job.error=String(error?.message??error);}job.finishedAt=now();job.updatedAt=now();this.events?.emit("job."+job.status,job);return job;}
 async drain(){for(const job of [...this.jobs.values()].filter(j=>j.status==="queued").sort((a,b)=>b.priority-a.priority))await this.run(job.id);return this.list();}
 get(id){return this.jobs.get(id)??null;} list(){return [...this.jobs.values()];}
}
