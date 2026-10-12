import { randomUUID } from "node:crypto";
import { generateUnifiedAi } from "../providers/unified-ai-router.mjs";
import { executeRapidTrendRender } from "../workers/rapid-video-worker.mjs";
import { buildUniversalExecutionEnvelope } from "../core/apex-universal-capabilities.mjs";
import { createKornKnobIdea } from "../core/korn-knob.mjs";
import { apexPureStore } from "../core/apex-pure-store.mjs";

const store = { enqueue: options => apexPureStore.enqueue(options) };
const clean = (value, max = 2000) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

function parseJson(text) {
  const raw = String(text || "").trim().replace(/^\`\`\`(?:json)?/i, "").replace(/\`\`\`$/i, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI response did not contain JSON");
  return JSON.parse(raw.slice(start, end + 1));
}

async function analyzeTrend(job) {
  const trend = clean(job.payload?.trend);
  const source = clean(job.payload?.source);
  const fingerprint = clean(job.payload?.fingerprint, 128);
  if (!trend) throw new Error("trend.analyze requires trend");

  const prompt = JSON.stringify({
    trend,
    source,
    goal: "Create an original Apex Rapid Video concept inspired by the trend without copying protected expression.",
    style: "dark cinematic anime, sharp cel shading, high contrast lighting",
    retention: "begin with a compelling opening hook and build escalating visual tension",
    output: "hook,title,concept,visualDirection"
  });

  let plan;
  try {
    const result = await generateUnifiedAi({
      provider: process.env.APEX_TREND_AI_PROVIDER || process.env.APEX_RAPID_AI_PROVIDER || "openrouter",
      model: process.env.APEX_TREND_AI_MODEL || process.env.APEX_RAPID_AI_MODEL || undefined,
      system: "Return JSON only. Create original expression. Never reproduce source media, lyrics, dialogue, captions, or protected expression verbatim.",
      prompt,
      temperature: 0.8,
      max_tokens: 900
    });
    plan = parseJson(result?.text ?? result?.content ?? result);
  } catch (error) {
    plan = {
      hook: "TREND SIGNAL DETECTED.",
      title: trend,
      concept: `Original creative interpretation of: ${trend}`,
      visualDirection: "Original dark cinematic anime"
    };
  }

  const child = await store.enqueue({
    id: randomUUID(),
    type: "rapid.trend.render",
    payload: { trend, source, fingerprint, plan, execution: buildUniversalExecutionEnvelope({ capability: "video", request: trend, source }) },
    maxAttempts: 5,
    dedupeKey: "rapid-trend-render:" + (fingerprint || trend.toLowerCase())
  });

  return { analyzed: true, plan, childJobId: child?.id || null };
}

async function renderTrend(job) {
  return executeRapidTrendRender(job.payload || {});
}

async function evaluateKornKnobIdea(job) {
  const payload = job.payload || {};
  const idea = createKornKnobIdea(payload);
  return {
    ...idea,
    ownerApp: "Kernelodies",
    productionOwner: "KernelVision",
    durableEvaluation: true
  };
}

export const handlers = {
  "trend.analyze": analyzeTrend,
  "rapid.trend.render": renderTrend,
  "kornknob.idea.evaluate": evaluateKornKnobIdea
};

export async function closeProductionHandlers() {}

export default handlers;
