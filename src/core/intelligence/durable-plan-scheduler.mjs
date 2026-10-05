import crypto from "node:crypto";
import { enqueueWorkerTask } from "../mesh/durable-worker-store.mjs";
import { claimReadyExecutionNodes, updateExecutionNode, updateExecutionNodeForLease, setPlanStatus, appendAgentEvent } from "./durable-control-plane.mjs";

export class DurablePlanScheduler {
  constructor({ runtime, executor, batchSize=20 }={}) {
    if(!runtime) throw new TypeError("runtime is required");
    if(typeof executor!=="function") throw new TypeError("executor is required");
    this.runtime=runtime; this.executor=executor; this.batchSize=Math.max(1,Math.min(100,Number(batchSize)||20));
  }

  async tick({signal}={}) {
    const nodes=await claimReadyExecutionNodes(this.batchSize);
    let queued=0,failed=0;
    for(const node of nodes) {
      if(signal?.aborted) break;
      let agent=null;
      try {
        agent=this.runtime.listAgents().filter(a=>a.status==="ready"&&a.capabilities.includes(node.capability)&&a.active<a.maxConcurrency).sort((a,b)=>(a.active/a.maxConcurrency)-(b.active/b.maxConcurrency))[0];
        if(!agent) {
          await updateExecutionNode(node.id,{status:"pending",last_error:"No eligible agent"});
          continue;
        }
        if (!this.runtime.reserve(agent.id)) { await updateExecutionNode(node.id,{status:"pending",last_error:"Agent capacity unavailable"}); continue; }
        const taskId=crypto.randomUUID();
        const enqueued=await enqueueWorkerTask({
          id:taskId,workerId:agent.id,role:agent.role,task:"execute-intelligence-node",
          payload:{planId:node.plan_id,nodeId:node.id,capability:node.capability,input:node.input,metadata:node.metadata},
          maxAttempts:node.max_attempts,dedupeKey:"apex:node:"+node.id
        });
        if (!enqueued.durable) throw new Error("Durable intelligence scheduling requires DATABASE_URL");
        if (enqueued.existingStatus && !["queued","running"].includes(enqueued.existingStatus)) {
          this.runtime.release(agent.id);
          await updateExecutionNode(node.id,{status:"pending",last_error:`Existing worker task is terminal: ${enqueued.existingStatus}`});
          continue;
        }
        await updateExecutionNode(node.id,{status:"queued",worker_task_id:enqueued.id});
        await appendAgentEvent({agentId:agent.id,planId:node.plan_id,nodeId:node.id,eventType:"node_queued"});
        queued++;
      } catch(error) {
        if (agent) this.runtime.release(agent.id);
        await updateExecutionNode(node.id,{status:"failed",last_error:String(error?.message||error)});
        await appendAgentEvent({planId:node.plan_id,nodeId:node.id,eventType:"node_queue_failed",payload:{error:String(error?.message||error)}});
        failed++;
      }
    }
    return {discovered:nodes.length,queued,failed};
  }

  async executeTask(task,{signal}={}) {
    const {planId,nodeId}=task.payload||{};
    if(!planId||!nodeId) throw new Error("Intelligence task requires planId and nodeId");
    const fenced = await updateExecutionNodeForLease(nodeId, task.id, task.lease_token, { status:"running" });
    if (!fenced) throw new Error("Execution node lease fence rejected task start");
    await setPlanStatus(planId,"running");
    await appendAgentEvent({agentId:task.worker_id,planId,nodeId,eventType:"node_started"});
    try {
      const result=await this.executor(task,{signal,runtime:this.runtime});
      return result;
    } catch(error) {
      await updateExecutionNodeForLease(nodeId, task.id, task.lease_token, {status:"failed",last_error:String(error?.message||error)});
      await appendAgentEvent({agentId:task.worker_id,planId,nodeId,eventType:"node_failed",payload:{error:String(error?.message||error)}});
      throw error;
    }
  }
}
