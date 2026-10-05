import crypto from "node:crypto";
import { enqueueWorkerTask, claimWorkerTask, completeWorkerTask, failWorkerTask } from "../mesh/durable-worker-store.mjs";
import { claimReadyExecutionNodes, updateExecutionNode, setPlanStatus, appendAgentEvent } from "./durable-control-plane.mjs";

const uuid=()=>crypto.randomUUID();

export class DurablePlanScheduler {
  constructor({ runtime, executor, batchSize=20 }={}) {
    if(!runtime) throw new TypeError("runtime is required");
    if(typeof executor!=="function") throw new TypeError("executor is required");
    this.runtime=runtime; this.executor=executor; this.batchSize=Math.max(1,Math.min(100,Number(batchSize)||20));
  }

  async tick({signal}={}) {
    const nodes=await claimReadyExecutionNodes(this.batchSize);
    let queued=0, completed=0, failed=0;
    for(const node of nodes) {
      if(signal?.aborted) break;
      let agent;
      try {
        agent=this.runtime.listAgents().find(a=>a.status==="ready" && a.capabilities.includes(node.capability));
        if(!agent) {
          await updateExecutionNode(node.id,{status:"pending",last_error:"No eligible agent"});
          continue;
        }
        const taskId=uuid();
        await enqueueWorkerTask({
          id:taskId, workerId:agent.id, role:agent.role,
          task:"execute-intelligence-node",
          payload:{planId:node.plan_id,nodeId:node.id,capability:node.capability},
          maxAttempts:node.max_attempts,
          dedupeKey:`apex:node:${node.id}`
        });
        await updateExecutionNode(node.id,{status:"queued",worker_task_id:taskId});
        await appendAgentEvent({agentId:agent.id,planId:node.plan_id,nodeId:node.id,eventType:"node_queued"});
        queued++;
      } catch(error) {
        await updateExecutionNode(node.id,{status:"failed",last_error:String(error?.message||error)});
        await appendAgentEvent({planId:node.plan_id,nodeId:node.id,eventType:"node_queue_failed",payload:{error:String(error?.message||error)}});
        failed++;
      }
    }
    return {discovered:nodes.length,queued,completed,failed};
  }

  async executeTask(task,{signal}={}) {
    const {planId,nodeId}=task.payload||{};
    if(!planId||!nodeId) throw new Error("Intelligence task requires planId and nodeId");
    await updateExecutionNode(nodeId,{status:"running"});
    await setPlanStatus(planId,"running");
    await appendAgentEvent({agentId:task.worker_id,planId,nodeId,eventType:"node_started"});
    try {
      const result=await this.executor(task,{signal, runtime:this.runtime});
      await updateExecutionNode(nodeId,{status:"completed",result});
      await appendAgentEvent({agentId:task.worker_id,planId,nodeId,eventType:"node_completed"});
      return result;
    } catch(error) {
      await updateExecutionNode(nodeId,{status:"failed",last_error:String(error?.message||error)});
      await appendAgentEvent({agentId:task.worker_id,planId,nodeId,eventType:"node_failed",payload:{error:String(error?.message||error)}});
      throw error;
    }
  }
}
