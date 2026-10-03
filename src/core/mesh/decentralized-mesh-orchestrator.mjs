import crypto from "node:crypto";
import { DecentralizedInferenceSwarm } from "./decentralized-inference-swarm.mjs";
import { DistributedTileRenderer } from "../vision/distributed-tile-renderer.mjs";

export class DecentralizedMeshOrchestrator {
  constructor(options = {}) {
    this.swarm = options.swarm ?? new DecentralizedInferenceSwarm(options);
    this.workerCount = Math.max(1, Number(options.workerCount ?? process.env.APEX_MESH_WORKERS ?? 2));
    this.booted = false;
    this.running = false;
  }

  async bootMesh() {
    this.booted = true;
    return {
      status: "online",
      workers: this.workerCount,
      inference: this.swarm.status(),
      tileRenderer: "ready"
    };
  }

  async startWorkerLoop() {
    if (!this.booted) await this.bootMesh();
    this.running = true;
    return { status: "running", workers: this.workerCount };
  }

  dispatchSwarmPipeline(input = {}) {
    if (!this.running) throw new Error("Mesh worker loop is not running.");
    const width = Number(input.width ?? 3840);
    const height = Number(input.height ?? 2160);
    const tileSize = Number(input.tileSize ?? 1080);
    return Promise.resolve({
      jobId: input.jobId ?? crypto.randomUUID(),
      status: "planned",
      tiles: DistributedTileRenderer.plan(width, height, tileSize, this.workerCount),
      inferenceModel: input.model ?? process.env.APEX_SWARM_MODEL ?? "qwen3:8b"
    });
  }

  async stop() {
    this.running = false;
    return { status: "stopped" };
  }
}
