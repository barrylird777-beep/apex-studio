import crypto from "node:crypto";
import { enqueueWorkerTask } from "../src/core/mesh/durable-worker-store.mjs";

const taskId = crypto.randomUUID();
const result = await enqueueWorkerTask({
  id: taskId,
  workerId: "swarm-orchestrator",
  role: "distributed-swarm",
  task: "distributed-swarm-sync",
  payload: {
    targetNode: "edge-swarm-01",
    upscaleTo: "1440p",
    canonCheck: true
  },
  maxAttempts: 5,
  dedupeKey: `distributed-swarm-sync:edge-swarm-01:1440p`
});

console.log("Dispatched Distributed Swarm Task ID:", result.id);
