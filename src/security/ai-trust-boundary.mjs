const ALLOWED_AUTONOMOUS_PROVIDERS = new Set(["openrouter", "google"]);
const MAX_PROMPT_CHARS = 12000;
const MAX_CONTEXT_CHARS = 3000;
const MAX_MODEL_CHARS = 160;

/**
 * Convert remote-worker AI input into the only fields the inference layer may receive.
 * Every value is untrusted text. No tool, shell, filesystem, token, or infrastructure
 * capability is carried through this payload.
 */
export function normalizeAutonomousAiPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("AI inference payload must be an object");
  }

  const prompt = String(payload.prompt || "").trim();
  if (!prompt) throw new Error("AI inference prompt is required");
  const provider = String(payload.provider || "").trim().toLowerCase();
  if (!ALLOWED_AUTONOMOUS_PROVIDERS.has(provider)) {
    throw new Error("AI provider is not allowlisted for autonomous work");
  }

  const normalized = {
    prompt: prompt.slice(0, MAX_PROMPT_CHARS),
    system: String(payload.system || "Apex Studio autonomous worker.").slice(0, MAX_CONTEXT_CHARS),
    provider
  };
  const model = String(payload.model || "").trim().slice(0, MAX_MODEL_CHARS);
  if (model) normalized.model = model;
  return Object.freeze(normalized);
}
