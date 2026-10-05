import { createDurablePlan, materializePlanNodes, appendAgentEvent, updateExecutionNode, setPlanStatus } from "./durable-control-plane.mjs";
import crypto from "node:crypto";

const uuid=()=>crypto.randomUUID();

export class IntelligenceControlPlane {
  constructor({ platform, runtime, scheduler }={}) {
    if(!platform||!runtime||!scheduler) throw new TypeError("platform, runtime, and scheduler are required");
    this.platform=platform; this.runtime=runtime; this.scheduler=scheduler;
  }

  async createPlan(work,{context={}}={}) {
    const graph=this.platform.plan(work);
    const planId=uuid();
    const graphSnapshot=graph.snapshot();
    const nodes=graphSnapshot.nodes.map(n=>({
      id:uuid(), name:n.name, capability:n.capability, dependsOn:[],
      maxAttempts:n.maxAttempts??3, input:n.input, metadata:n.metadata
    }));
    const byName=new Map(nodes.map(n=>[n.name,n]));
    for(const original of(work.tasks??[])) {
      const target=byName.get(original.name);
      if(!target) continue;
      target.dependsOn=(original.dependsOn??[]).map(name=>byName.get(name)?.id).filter(Boolean);
    }
    await createDurablePlan({id:planId,goal:String(work.goal??"Unnamed Apex goal"),graph:graphSnapshot,context});
    await materializePlanNodes(planId,nodes);
    await appendAgentEvent({planId,eventType:"plan_created",payload:{nodeCount:nodes.length}});
    return {id:planId,graph:graphSnapshot,nodes};
  }

  async run({signal,maxTicks=100}={}) {
    let ticks=0,totalQueued=0;
    while(!signal?.aborted&&ticks<maxTicks) {
      const result=await this.scheduler.tick({signal});
      totalQueued+=result.queued; ticks++;
      if(result.discovered===0) break;
      if(result.queued===0) await new Promise(r=>setTimeout(r,100));
    }
    return {ticks,totalQueued,aborted:Boolean(signal?.aborted)};
  }

  async markVerified(nodeId,verification) {
    if(!verification||typeof verification!=="object") throw new TypeError("verification evidence is required");
    const ok=verification.passed===true;
    if(!ok) {
      await updateExecutionNode(nodeId,{status:"failed",verification,last_error:String(verification.reason??"Verification failed")});
      return false;
    }
    await updateExecutionNode(nodeId,{verification});
    return true;
  }
}
