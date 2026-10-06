import { RenderWorker } from "./src/core/render-worker.mjs";
import { capacitySnapshot } from "./src/core/capacity.mjs";
import { getProjectState } from "./src/services/projectManager.mjs";
import {
  durableWorkerEnabled,
  claimNextWorkerTasks,
  heartbeatWorkerTask,
  completeWorkerTask,
  failWorkerTask,
  requeueExpiredWorkerTasks,
  releaseWorkerTasks
} from "./src/core/mesh/durable-worker-store.mjs";
import { generateUnifiedAi } from "./src/providers/unified-ai-router.mjs";
import { startLockedContinuousAiLoop } from "./src/core/autonomy/locked-continuous-loop.mjs";
import crypto from "node:crypto";
import { gardenSnapshot, verifiedGardenIds } from "./src/garden/lore-graph.mjs";
import { assertProductionHandoff, validateScriptGardenReferences } from "./src/core/validation/production-contracts.mjs";
import { createMusicRadarHandoff } from "./src/core/music/music-radar-contract.mjs";
import { buildMusicProductionPlan, verifyMusicGardenPackage } from "./src/core/music/music-studio.mjs";
import { normalizeContentDomain } from "./src/core/content/content-domains.mjs";

async function executeEpisodeProductionTask(payload = {}) {
  const contentDomain = normalizeContentDomain(payload?.contentDomain || "bible");
  const book = String(payload?.book || "").trim();
  const chapter = Number(payload?.chapter);
  const verses = String(payload?.verses || "full").trim();
  if (!book || !Number.isInteger(chapter)) throw new Error("Episode production requires book and integer chapter");
  let graphVersion = "none";
  let packageHash = "none";
  const references = [];
  if (contentDomain === "korn") {
    const { graph } = await gardenSnapshot();
    graphVersion = "garden-lore-v1";
    packageHash = crypto.createHash("sha256").update(JSON.stringify(graph)).digest("hex");
    references.push(
      { id: "garden:Apex", type: "garden:Universe", graphVersion },
      { id: "garden:JesusFreaks", type: "garden:Collective", graphVersion }
    );
    const verifiedIds = await verifiedGardenIds();
    validateScriptGardenReferences(references, verifiedIds);
  }
  const handoff = assertProductionHandoff({
    contractVersion: "apex-production-handoff.v1",
    projectId: `${contentDomain}:${book}`,
    contentDomain,
    episodeId: `${book}:${chapter}:${verses}`,
    gardenPackage: { graphVersion, packageHash, references },
    artifact: {
      kind: "research",
      version: "1",
      contentHash: crypto.createHash("sha256").update(`${book}:${chapter}:${verses}`).digest("hex")
    },
    provenance: { source: "Apex Studio episode-production control plane", verified: true, verifiedAt: new Date().toISOString() }
  });
  const render = new RenderWorker();
  const ffmpegAvailable = await render.available();
  return {
    ok: true,
    type: "episode-production",
    contentDomain,
    book,
    chapter,
    verses,
    stage: "production-handoff-validated",
    handoff,
    render: { ffmpegAvailable },
    queuedAt: new Date().toISOString()
  };
}

async function executeMusicAudioHandoffTask(payload = {}) {
  const handoff = payload?.handoff;
  if (!handoff || handoff.contractVersion !== "music-radar-studio-handoff.v1") {
    throw new Error("Invalid Music Radar audio handoff");
  }
  return {
    ok: true,
    type: "music-audio-handoff",
    projectId: handoff.projectId,
    contentDomain: handoff.contentDomain,
    assetCount: Array.isArray(handoff.assets) ? handoff.assets.length : 0,
    audioRoles: [...new Set((handoff.assets || []).map(asset => asset.kind))],
    worldPackage: handoff.worldPackage,
    provenance: handoff.provenance,
    stage: "audio-handoff-validated",
    validatedAt: new Date().toISOString()
  };
}

async function executeAiInferenceTask(payload = {}) {
  const provider = String(payload?.provider || "").trim();
  const model = String(payload?.model || "").trim();
  const prompt = String(payload?.prompt || "").trim();
  if (!provider || !prompt) throw new Error("AI inference requires explicit provider and prompt");

  return generateUnifiedAi({
    provider,
    model: model || undefined,
    prompt,
    system: String(payload?.system || "Apex Studio autonomous worker. Return one concrete, evidence-based result.")
  });
}

async function executeMusicAudioHandoffTask(payload = {}) {
  const handoff = createMusicRadarHandoff(payload?.handoff || {});
  let gardenVerification = { verified: true, references: [] };
  if (handoff.contentDomain === "korn") {
    const { graph } = await gardenSnapshot();
    const packageHash = crypto.createHash("sha256").update(JSON.stringify(graph)).digest("hex");
    const currentPackage = {
      system: "garden-of-apex",
      graphVersion: "garden-lore-v1",
      packageHash,
      references: handoff.worldPackage?.references || []
    };
    const verifiedIds = await verifiedGardenIds();
    gardenVerification = verifyMusicGardenPackage(
      { contentDomain: "korn", gardenPackage: currentPackage },
      verifiedIds
    );
    if (handoff.worldPackage?.packageHash && handoff.worldPackage.packageHash !== packageHash) {
      throw new Error("Music handoff Garden package hash is stale");
    }
  }
  const plan = buildMusicProductionPlan({
    projectId: handoff.projectId,
    contentDomain: handoff.contentDomain,
    gardenPackage: handoff.worldPackage?.system === "garden-of-apex" ? handoff.worldPackage : undefined,
    genre: handoff.musicalIntent.genre,
    fusion: handoff.musicalIntent.fusion,
    mood: handoff.musicalIntent.mood,
    purpose: handoff.musicalIntent.purpose,
    tracks: handoff.assets.map(asset => ({
      trackId: asset.assetId,
      projectId: handoff.projectId,
      title: asset.title,
      role: asset.kind,
      contentDomain: handoff.contentDomain,
      durationSeconds: asset.durationSeconds,
      gardenPackage: handoff.worldPackage?.system === "garden-of-apex" ? handoff.worldPackage : undefined,
      sourceAsset: {
        assetId: asset.assetId,
        checksum: asset.checksum,
        url: asset.mediaUrl,
        path: asset.localPath
      },
      provenance: asset.provenance
    }))
  });
  return {
    ok: true,
    type: "music-audio-handoff",
    stage: "audio-handoff-validated",
    handoff,
    gardenVerification,
    plan
  };
}

async function executePermanentHealthTask(payload = {}) {
  const role = String(payload?.role || "general");
  const startedAt = Date.now();
  if (["project-storage", "media-ingest", "publishing"].includes(role)) {
    await getProjectState();
  } else if (["video-engine", "export", "render-cache", "visual-direction"].includes(role)) {
    await new RenderWorker().available();
  } else if (["voiceover", "audio-reference"].includes(role)) {
    const { voiceoverWorkerStatus } = await import("./src/workers/voiceover-worker.mjs");
    await voiceoverWorkerStatus();
  } else {
    capacitySnapshot();
  }
  return {
    ok: true,
    workerId: String(payload?.workerId || ""),
    role,
    task: String(payload?.task || ""),
    durationMs: Date.now() - startedAt,
    completedAt: new Date().toISOString()
  };
}

const workerOnly = String(process.env.APEX_WORKER_ONLY || "").toLowerCase() === "true";

if (!workerOnly) {
  const { startProductionDaemon } = await import("./src/workers/av1-production-daemon.mjs");
  process.title = "apex-av1-production";
  await startProductionDaemon();
} else {
  process.title = "apex-autonomous-worker";
  if (!durableWorkerEnabled()) throw new Error("APEX_WORKER_ONLY requires DATABASE_URL");

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const leaseMs = Math.max(15000, Number(process.env.APEX_WORKER_LEASE_MS || 45000));
  const pollMs = Math.max(250, Number(process.env.APEX_WORKER_POLL_MS || 1000));
  const concurrency = Math.max(1, Math.min(100, Number(process.env.APEX_WORKER_CONCURRENCY || 32)));
  const batchSize = Math.max(1, Math.min(concurrency, Number(process.env.APEX_WORKER_BATCH_SIZE || 20)));
  const shutdownDeadlineMs = Math.max(5000, Number(process.env.APEX_WORKER_SHUTDOWN_MS || 30000));
  let stopping = false;
  let emptyPolls = 0;

  console.log("[apex-worker] durable worker online");

  // Locked continuous path: seed only zero-cost AI work. If no provider is
  // provably zero-cost, the feeder stays idle rather than risking a charge.
  const autonomousAiLoop = await startLockedContinuousAiLoop();
  const inFlight = new Map();
  const claimed = new Map();

  const executeTask = async (task) => {
    const heartbeat = setInterval(() => {
      void heartbeatWorkerTask(task.id, leaseMs, task.lease_token).catch(error => {
        console.error("[apex-worker] heartbeat failed:", error?.message || error);
      });
    }, Math.max(5000, Math.floor(leaseMs / 3)));
    heartbeat.unref?.();
    try {
      const taskType = String(task.task || "");
      const result = taskType === "episode-production"
        ? await executeEpisodeProductionTask(task.payload || {})
        : taskType === "music-audio-handoff"
          ? await executeMusicAudioHandoffTask(task.payload || {})
          : taskType === "ai-inference"
          ? await executeAiInferenceTask(task.payload || {})
          : await executePermanentHealthTask(task.payload || {});
      const completed = await completeWorkerTask(task.id, result, task.lease_token);
      if (!completed) {
        console.warn("[apex-worker] completion fenced out", task.id, task.role);
        return;
      }
      console.log("[apex-worker] completed", task.id, task.role);
    } catch (error) {
      await failWorkerTask(task.id, error, task.lease_token).then(ok => {
        if (!ok) console.warn("[apex-worker] failure update fenced out", task.id);
      }).catch(failure => {
        console.error("[apex-worker] durable failure update failed:", failure?.message || failure);
      });
      console.error("[apex-worker] task failed:", task.id, error?.message || error);
    } finally {
      clearInterval(heartbeat);
    }
  };

  const runTask = async (task) => {
    claimed.set(task.id, task);
    inFlight.set(task.id, task);
    try { await executeTask(task); }
    finally {
      inFlight.delete(task.id);
      claimed.delete(task.id);
    }
  };

  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`[apex-worker] ${signal} received; draining`);
    const deadline = Date.now() + shutdownDeadlineMs;
    while (inFlight.size && Date.now() < deadline) await sleep(250);

    const unstartedTasks = [...claimed.values()].filter(task => !inFlight.has(task.id));
    if (unstartedTasks.length) {
      await releaseWorkerTasks(
        unstartedTasks.map(task => task.id),
        unstartedTasks.map(task => task.lease_token)
      ).catch(error => {
        console.error("[apex-worker] release failed:", error?.message || error);
      });
    }
    autonomousAiLoop.stop();
    process.exit(0);
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  while (!stopping) {
    await requeueExpiredWorkerTasks().catch(error => {
      console.error("[apex-worker] reclaim failed:", error?.message || error);
    });

    try {
      const available = Math.max(0, concurrency - inFlight.size);
      if (!available) {
        await sleep(100);
        continue;
      }

      const tasks = await claimNextWorkerTasks(Math.min(batchSize, available), leaseMs);
      if (!tasks.length) {
        emptyPolls = Math.min(emptyPolls + 1, 6);
        const base = Math.min(5000, pollMs * 2 ** emptyPolls);
        const jitter = Math.floor(Math.random() * Math.max(100, base * 0.25));
        await sleep(base + jitter);
        continue;
      }

      emptyPolls = 0;
      await Promise.all(tasks.map(runTask));
    } catch (error) {
      console.error("[apex-worker] queue poll failed:", error?.message || error);
      const base = Math.min(5000, pollMs * 2 ** Math.min(emptyPolls, 6));
      const jitter = Math.floor(Math.random() * Math.max(100, base * 0.25));
      await sleep(base + jitter);
      emptyPolls = Math.min(emptyPolls + 1, 6);
    }
  }
}
