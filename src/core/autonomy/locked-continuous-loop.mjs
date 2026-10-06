import crypto from "node:crypto";
import { enqueueWorkerTask, queueStats } from "../mesh/durable-worker-store.mjs";

const ROLES = Object.freeze([
  ["scripture-research", "Produce one evidence-backed scripture research finding that can improve a Bible-video episode."],
  ["story-architecture", "Produce one concrete narrative, pacing, hook, or retention improvement for a Bible-video episode."],
  ["visual-direction", "Produce one concrete cinematic visual-direction improvement for Apex Studio output."],
  ["audio-direction", "Produce one concrete narration, music, sound-design, or mix improvement."],
  ["production-engineering", "Identify one production-pipeline reliability or performance improvement and explain the smallest robust implementation."],
  ["network-engineering", "Identify one concrete network/runtime reliability, failover, or observability improvement."],
  ["qa-review", "Act as hostile QA: identify one reproducible defect or missing acceptance test and state the evidence required."],
  ["architecture-review", "Identify one concrete correctness, durability, or scalability risk and distinguish evidence from inference."]
]);

const FREE_MODE = String(process.env.APEX_FREE_MODE ?? "true").toLowerCase() !== "false";

function truthy(name) {
  return String(process.env[name] ?? "").toLowerCase() === "true";
}

export function zeroCostAiProvider() {
  if (!FREE_MODE) return null;

  // OpenRouter's dedicated free router is $0 for prompt/completion tokens.
  // The API key is still required; provider rate limits remain authoritative.
  if (process.env.OPENROUTER_API_KEY) {
    return {
      provider: "openrouter",
      model: "openrouter/free",
      basis: "OpenRouter free router"
    };
  }

  // Gemini is free only when the operator has explicitly confirmed that the
  // specific project/key is on Google's Free Tier. Never infer this from the
  // mere presence of GEMINI_API_KEY because paid projects can share the same key shape.
  if (process.env.GEMINI_API_KEY && truthy("APEX_GEMINI_FREE_TIER_CONFIRMED")) {
    return {
      provider: "google",
      model: process.env.GEMINI_FREE_MODEL || "gemini-3.8-flash",
      basis: "explicitly confirmed Gemini Free Tier"
    };
  }

  return null;
}

export function buildAutonomousAiTask({ role, task, provider, model, cycle = Date.now() }) {
  const roleName = String(role || "general");
  const instruction = String(task || "Find one concrete improvement for Apex Studio.");
  const id = crypto.randomUUID();
  return {
    id,
    workerId: `ai-autonomous-${roleName}`,
    role: roleName,
    task: "ai-inference",
    maxAttempts: 5,
    dedupeKey: `locked-ai:${roleName}:${Math.floor(Number(cycle) / 60000)}`,
    payload: {
      type: "ai-inference",
      provider,
      model,
      role: roleName,
      prompt: [
        "You are an autonomous Apex Studio specialist.",
        "Work continuously toward concrete, evidence-based improvements.",
        "Do not claim that you inspected files or runtime state you were not given.",
        "Return one high-value finding, implementation direction, or testable production improvement.",
        "Mission: " + instruction
      ].join("\n"),
      system: "Apex Studio autonomous worker. Be precise, evidence-aware, implementation-oriented, and concise."
    }
  };
}

export async function seedAutonomousAiWork({ maxTasks = ROLES.length } = {}) {
  const provider = zeroCostAiProvider();
  if (!provider) return { enabled: false, reason: "no confirmed zero-cost AI provider configured", queued: 0 };

  const stats = await queueStats();
  const queued = Number(stats?.queued || 0);
  const capacity = Math.max(0, Math.min(ROLES.length, Number(maxTasks) || ROLES.length));
  if (queued >= capacity * 2) {
    return { enabled: true, provider, queued: 0, reason: "durable queue already has work" };
  }

  const created = [];
  for (const [role, task] of ROLES.slice(0, capacity)) {
    const item = buildAutonomousAiTask({
      role,
      task,
      provider: provider.provider,
      model: provider.model
    });
    const result = await enqueueWorkerTask(item);
    created.push({ id: result.id, role, provider: provider.provider, model: provider.model });
  }

  return { enabled: true, provider, queued: created.length, jobs: created };
}

export function continuousAiStatus() {
  const provider = zeroCostAiProvider();
  return {
    freeMode: FREE_MODE,
    enabled: Boolean(provider),
    provider: provider?.provider || null,
    model: provider?.model || null,
    configured: {
      openrouter: Boolean(process.env.OPENROUTER_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      geminiFreeConfirmed: truthy("APEX_GEMINI_FREE_TIER_CONFIRMED")
    }
  };
}

export async function startLockedContinuousAiLoop() {
  const intervalMs = Math.max(15000, Number(process.env.APEX_AUTONOMOUS_AI_PULSE_MS || 60000));
  let stopping = false;

  const pulse = async () => {
    if (stopping) return;
    try {
      const result = await seedAutonomousAiWork();
      if (result.queued) console.log("[apex-autonomy] seeded", result.queued, "AI jobs via", result.provider.provider);
    } catch (error) {
      console.error("[apex-autonomy] seed failed:", error?.message || error);
    }
  };

  await pulse();
  const timer = setInterval(() => void pulse(), intervalMs);
  timer.unref?.();

  return {
    stop() {
      stopping = true;
      clearInterval(timer);
    },
    status: continuousAiStatus
  };
}
