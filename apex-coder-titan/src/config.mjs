import process from "node:process";
import os from "node:os";
import path from "node:path";

const int = (name, fallback) => {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const config = Object.freeze({
  port: int("TITAN_PORT", 8787),
  maxDepth: int("TITAN_MAX_DEPTH", 2),
  implementationRounds: int("TITAN_IMPLEMENTATION_ROUNDS", 12),
  repairPasses: int("TITAN_REPAIR_PASSES", 2),
  repairTurns: int("TITAN_REPAIR_TURNS", 6),
  auditConcurrency: int("TITAN_AUDIT_CONCURRENCY", 3),
  model: process.env.TITAN_MODEL || process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  geminiModel: process.env.TITAN_GEMINI_MODEL || "gemini-3.8-flash",
  reasoningEffort: process.env.TITAN_REASONING_EFFORT || "high",
  maxOutputTokens: int("TITAN_MAX_OUTPUT_TOKENS", 12000),
  auditOutputTokens: int("TITAN_AUDIT_OUTPUT_TOKENS", 6000),
  groqApiKey: process.env.GROQ_API_KEY || "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  openAiModel: process.env.OPENAI_MODEL || "",
  evidenceDir: path.resolve(process.env.TITAN_EVIDENCE_DIR || path.join(os.homedir(), ".apex-coder-titan", "runs"))
});

export function validateConfig() {
  if (!config.groqApiKey && !config.geminiApiKey && !config.openAiApiKey) {
    return { ok: false, error: "Configure GROQ_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY." };
  }
  return { ok: true };
}
