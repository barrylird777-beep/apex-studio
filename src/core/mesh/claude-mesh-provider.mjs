import { acquireAiRateLimit } from "./durable-worker-store.mjs";
import { APEX_LIMITS } from "./apex-limits.mjs";

export class ClaudeMeshProvider {
  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY || "";
    this.endpoint = process.env.ANTHROPIC_ENDPOINT || "https://api.anthropic.com/v1/messages";
    this.model = process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
  }

  async generate(prompt, options = {}) {
    if (!this.apiKey) throw new Error("Claude not configured");
    const model = options.model || this.model;
    const rateLimit = await acquireAiRateLimit({
      key: "claude",
      capacity: Number(process.env.CLAUDE_RATE_LIMIT_CAPACITY || APEX_LIMITS.GEMINI.RATE_BUCKET_CAPACITY),
      refillPerSecond: Number(process.env.CLAUDE_RATE_LIMIT_PER_SECOND || (APEX_LIMITS.GEMINI.RATE_BUCKET_CAPACITY / APEX_LIMITS.GEMINI.REFILL_WINDOW_SECONDS)),
      maxWaitMs: Number(process.env.CLAUDE_RATE_LIMIT_MAX_WAIT_MS || APEX_LIMITS.GEMINI.MAX_RATE_LIMIT_WAIT_MS)
    });
    if (!rateLimit) throw new Error("Claude shared rate limit reached; retry later");

    const body = {
      model,
      max_tokens: Number(options.maxTokens || 4096),
      messages: [{ role: "user", content: String(prompt) }]
    };
    if (options.system) body.system = String(options.system);

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(process.env.CLAUDE_TIMEOUT_MS || APEX_LIMITS.GEMINI.TIMEOUT_MS))
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300).replace(/\s+/g, " ");
      throw new Error(`Claude API Error: ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    const data = await response.json();
    const text = data.content?.filter(p => p?.type === "text").map(p => p.text).join("").trim() || "";
    if (!text) throw new Error("Claude returned an empty response");
    return text;
  }

  async getStatus() {
    return { provider: "Claude", configured: Boolean(this.apiKey), model: this.model };
  }
}

export default ClaudeMeshProvider;
