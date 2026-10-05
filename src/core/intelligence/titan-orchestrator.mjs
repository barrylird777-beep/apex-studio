import { TITAN_PROFILE, createTitanCrew } from "./titan-profile.mjs";
import { registerDurableAgent, appendAgentEvent } from "./durable-control-plane.mjs";

export class TitanOrchestrator {
  constructor({ runtime, controlPlane, verifier }={}) {
    if(!runtime||!controlPlane) throw new TypeError("runtime and controlPlane are required");
    this.runtime=runtime; this.controlPlane=controlPlane; this.verifier=verifier;
  }

  async bootstrap() {
    await this.runtime.registerAgent(TITAN_PROFILE);
    for(const specialist of createTitanCrew()) await this.runtime.registerSpecialist(specialist);
    return { id:TITAN_PROFILE.id, specialists:createTitanCrew().map(x=>x.id) };
  }

  async buildRepairPlan({ goal, tasks, context={} }) {
    if(!goal||!Array.isArray(tasks)||!tasks.length) throw new TypeError("TITAN requires a goal and task graph");
    const plan=await this.controlPlane.createPlan({goal,tasks},{context:{
      ...context, orchestrator:"titan", profile:TITAN_PROFILE.id,
      specialistCount:createTitanCrew().length, humanAuthority:true
    }});
    await appendAgentEvent({agentId:"titan",planId:plan.id,eventType:"titan_plan_created",payload:{goal,taskCount:tasks.length}});
    return plan;
  }

  async inspectPlan(planId) {
    await appendAgentEvent({agentId:"titan",planId,eventType:"titan_inspection_requested"});
    return { planId, independentVerificationRequired:true, humanReleaseRequired:true };
  }

  async verify(result) {
    if(typeof this.verifier!=="function") throw new Error("TITAN requires an independent verifier");
    const verification=await this.verifier(result);
    if(!verification||verification.passed!==true) throw new Error("Independent TITAN verification failed");
    return verification;
  }

  authority() {
    return {
      canImplement:true,
      canTest:true,
      canInspect:true,
      canMerge:false,
      canRelease:false,
      canPerformDestructiveAction:false
    };
  }
}
