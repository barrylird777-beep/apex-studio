import crypto from "node:crypto";
import { DecentralizedMeshOrchestrator } from "./src/core/mesh/decentralized-mesh-orchestrator.mjs";

async function startMasterIgnite() {
  console.log("[MASTER-IGNITE] Booting Apex Studio decentralized production mesh...");
  const orchestrator = new DecentralizedMeshOrchestrator();
  const boot = await orchestrator.bootMesh();
  const workers = await orchestrator.startWorkerLoop();

  const batchResult = await orchestrator.dispatchSwarmPipeline({
    jobId: crypto.randomUUID(),
    width: Number(process.env.APEX_RENDER_WIDTH ?? 3840),
    height: Number(process.env.APEX_RENDER_HEIGHT ?? 2160),
    tileSize: Number(process.env.APEX_RENDER_TILE_SIZE ?? 1080),
    model: process.env.APEX_SWARM_MODEL ?? "qwen3:8b"
  });

  console.log("[MASTER-IGNITE] Mesh online.", { boot, workers, batchResult });
  return batchResult;
}

startMasterIgnite().catch(err => {
  console.error("[FATAL] Master Ignite initialization failure:", err);
  process.exitCode = 1;
});
