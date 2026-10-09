import { ApexIntelligence } from "./apex-intelligence.mjs";
import { generateUnifiedAi, unifiedAiStatus } from "../providers/unified-ai-router.mjs";

function parseModelEnvelope(text) {
  const raw = String(text ?? "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1]?.trim() ?? raw;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" ? parsed : { output: raw };
  } catch {
    return { output: raw };
  }
}

async function ask(prompt, context = {}) {
  const result = await generateUnifiedAi({
    provider: context.provider ?? process.env.APEX_INTELLIGENCE_PROVIDER ?? "openrouter",
    model: context.model,
    system: context.system,
    prompt
  });
  return { ...result, parsed: parseModelEnvelope(result.text) };
}

export function createApexIntelligenceRuntime(options = {}) {
  const events = options.events ?? null;
  const memory = options.memory ?? null;

  const executor = async input => {
    const prompt = [
      "You are Apex Intelligence, the orchestration and reasoning layer inside ApexStudio.",
      "Work evidence-first. Never claim an action happened unless the supplied execution evidence establishes it.",
      "The application may route, decompose, parallelize, retry, recover, or verify work.",
      "Return compact JSON with keys: status, output, blockers, tasks, evidence, next.",
      "",
      "Phase: " + input.phase,
      "Goal: " + input.goal,
      "Specialists: " + JSON.stringify(input.specialists?.map(s => s.name ?? s)),
      "Previous state: " + JSON.stringify(input.previous ?? null),
      "Context: " + JSON.stringify(input.context ?? {}),
      "Memory: " + JSON.stringify(input.memories ?? []),
      "",
      "Choose the next useful action. For parallel work, return tasks as an array. For a completed candidate, route to verify."
    ].join("
");

    const result = await ask(prompt, options);
    const parsed = result.parsed;
    const allowed = new Set(["diagnose", "work-around", "decompose", "parallelize", "execute", "verify", "retry", "blocked"]);
    const requested = String(parsed.status ?? parsed.next ?? "").toLowerCase();
    const status = allowed.has(requested) ? requested : (input.phase === "diagnose" ? "execute" : "verify");

    return {
      status,
      output: parsed.output ?? result.text,
      blockers: Array.isArray(parsed.blockers) ? parsed.blockers : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
      provider: result.provider,
      model: result.model
    };
  };

  const verifier = async input => {
    const prompt = [
      "Act as an independent Apex verification reviewer.",
      "Do not assume the executor is correct. Inspect only the supplied candidate and evidence.",
      "Return JSON: { verified: boolean, confidence: number, evidence: array, reason: string }.",
      "",
      "Goal: " + input.goal,
      "Candidate: " + JSON.stringify(input.output),
      "Evidence: " + JSON.stringify(input.evidence ?? []),
      "Plan: " + JSON.stringify(input.plan ?? {})
    ].join("
");

    const result = await ask(prompt, {
      ...options,
      system: "You are a skeptical verification reviewer. Reject unsupported completion."
    });

    return {
      status: result.parsed.verified === true ? "verified" : "retry",
      verified: result.parsed.verified === true,
      confidence: Number(result.parsed.confidence ?? 0),
      evidence: Array.isArray(result.parsed.evidence) ? result.parsed.evidence : [],
      reason: String(result.parsed.reason ?? ""),
      provider: result.provider,
      model: result.model
    };
  };

  return new ApexIntelligence({
    specialists: options.specialists,
    memory,
    providers: unifiedAiStatus(),
    events,
    executor,
    verifier,
    verifiers: options.verifiers,
    recoverer: options.recoverer,
    parallelExecutor: options.parallelExecutor,
    persistence: options.persistence,
    durableQueue: options.durableQueue
  });
}
