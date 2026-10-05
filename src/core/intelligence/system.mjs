import { ApexIntelligencePlatform } from "./platform.mjs";
import { AgentRuntime } from "./agent-runtime.mjs";
import { AgentSupervisor } from "./agent-supervisor.mjs";
import { DurablePlanScheduler } from "./durable-plan-scheduler.mjs";
import { IntelligenceWorker } from "./intelligence-worker.mjs";
import { IntelligenceControlPlane } from "./control-plane.mjs";
import { IndependentVerifier } from "./independent-verifier.mjs";
import { TitanOrchestrator } from "./titan-orchestrator.mjs";

export function createApexIntelligenceSystem({
  capabilities=[],
  providers=[],
  agents=[],
  verifierChecks=[],
  executor,
  concurrency=32,
  workerConcurrency=4
}={}) {
  const platform=new ApexIntelligencePlatform({capabilities,providers});
  const runtime=new AgentRuntime({
    registry:platform.capabilities,
    providers:platform.providers,
    evidence:platform.evidence,
    maxConcurrency:concurrency
  });
  const supervisor=new AgentSupervisor(runtime);
  const verifier=new IndependentVerifier({checks:verifierChecks});

  const nodeExecutor=executor ?? (async (task,{signal}) => {
    const capability=platform.capabilities.get(task.payload.capability);
    if(!capability) throw new Error("Capability unavailable: "+task.payload.capability);
    const output=await capability.execute(task.payload.input,{signal,metadata:task.payload.metadata,platform,runtime});
    const verification=await verifier.verify({input:task.payload.input,output,task},{signal,platform,runtime});
    return {output,verification};
  });

  const scheduler=new DurablePlanScheduler({runtime,executor:nodeExecutor});
  const controlPlane=new IntelligenceControlPlane({platform,runtime,scheduler});
  const worker=new IntelligenceWorker({runtime,scheduler,concurrency:workerConcurrency});
  const titan=new TitanOrchestrator({runtime,controlPlane,verifier:async result=>verifier.verify(result)});

  return Object.freeze({
    platform,runtime,supervisor,verifier,scheduler,controlPlane,worker,titan,
    async bootstrap() {
      await titan.bootstrap();
      for(const agent of agents) await runtime.registerAgent(agent);
      return this.inspect();
    },
    inspect() {
      return {
        ...platform.inspect(),
        agents:runtime.listAgents(),
        verifierChecks:verifier.checks.size
      };
    }
  });
}
