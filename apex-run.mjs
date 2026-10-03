import "dotenv/config";
import crypto from "node:crypto";
import { DecentralizedMeshOrchestrator } from "./src/core/mesh/decentralized-mesh-orchestrator.mjs";

async function executeStudioPipeline() {
  console.log("[APEX-RUN] Initializing Apex Studio production execution daemon...");

  const orchestrator = new DecentralizedMeshOrchestrator();
  const boot = await orchestrator.bootMesh();
  const workers = await orchestrator.startWorkerLoop();

  const batchId = crypto.randomUUID();
  const pipelineSummary = await orchestrator.dispatchSwarmPipeline({
    jobId: batchId,
    width: Number(process.env.APEX_RENDER_WIDTH ?? 3840),
    height: Number(process.env.APEX_RENDER_HEIGHT ?? 2160),
    tileSize: Number(process.env.APEX_RENDER_TILE_SIZE ?? 1080),
    model: process.env.APEX_SWARM_MODEL ?? "qwen3:8b"
  });

  console.log("[APEX-RUN] Pipeline execution active.");
  console.log(JSON.stringify({ batchId, boot, workers, pipelineSummary }, null, 2));
  return pipelineSummary;
}

executeStudioPipeline().catch((error) => {
  console.error("[FATAL] Studio execution pipeline crashed:", error);
  process.exitCode = 1;
});
