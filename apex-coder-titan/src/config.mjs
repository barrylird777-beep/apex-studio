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
  implementationRounds: int("TITAN_IMPLEMENTATION_ROUNDS", 72),
  repairPasses: int("TITAN_REPAIR_PASSES", 7),
  repairTurns: int("TITAN_REPAIR_TURNS", 20),
  model: process.env.OPENAI_MODEL || "gpt-5.6-sol",
  reasoningEffort: process.env.TITAN_REASONING_EFFORT || "xhigh",
  maxOutputTokens: int("TITAN_MAX_OUTPUT_TOKENS", 12000),
  apiKey: process.env.OPENAI_API_KEY || "",
  evidenceDir: path.resolve(process.env.TITAN_EVIDENCE_DIR || path.join(os.homedir(), ".apex-coder-titan", "runs"))
});

export function validateConfig() {
  if (!config.apiKey) return { ok: false, error: "OPENAI_API_KEY is not configured." };
  if (!config.model) return { ok: false, error: "OPENAI_MODEL is not configured." };
  return { ok: true };
}
