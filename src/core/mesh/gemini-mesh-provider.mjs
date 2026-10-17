import { acquireAiRateLimit } from "./durable-worker-store.mjs";
import { createGuardedFetch, sanitizeOutboundPayload } from "../../security/sovereign-outbound-gateway.mjs";

const outboundFetch = createGuardedFetch(["generativelanguage.googleapis.com"]);

const MAX_PROMPT_CHARS = Math.min(50000, Math.max(1000, Number(process.env.GEMINI_MAX_PROMPT_CHARS || 50000)));
const MAX_OUTPUT_TOKENS = 65536;

export function normalizeGeminiInput(prompt, system = '') {
  const normalizedPrompt = String(prompt ?? '').trim();
  const normalizedSystem = String(system ?? '').trim();
  if (!normalizedPrompt) throw new Error('prompt is required');
  if (normalizedPrompt.length > MAX_PROMPT_CHARS) throw new Error('prompt exceeds configured maximum');
  if (normalizedSystem.length > MAX_PROMPT_CHARS) throw new Error('system instructions exceed configured maximum');
  return sanitizeOutboundPayload({ prompt: normalizedPrompt, system: normalizedSystem });
}

function boundedOutputTokens(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(MAX_OUTPUT_TOKENS, Math.max(1, Math.floor(parsed)));
}

export class GeminiMeshProvider {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    this.endpoint = (process.env.GEMINI_ENDPOINT || 'https://generativelanguage.googleapis.com/v1beta/models').replace(/\/$/, '');
    this.model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  }

  async generate(prompt, options = {}) {
    if (String(process.env.APEX_FREE_MODE ?? 'true').toLowerCase() !== 'false') throw new Error('Free mode blocks paid AI provider: Gemini');
    if (!this.apiKey) throw new Error('Gemini not configured');
    const model = options.model || this.model;
    const rateLimit = await acquireAiRateLimit({
      capacity: Number(process.env.GEMINI_RATE_LIMIT_CAPACITY || 10),
      refillPerSecond: Number(process.env.GEMINI_RATE_LIMIT_PER_SECOND || (10 / 60))
    });
    if (!rateLimit) throw new Error('Gemini shared rate limit reached; retry later');
    const safeInput = normalizeGeminiInput(prompt, options.system);
    const body = {
      generationConfig: { thinkingConfig: { thinkingLevel: ['low', 'medium', 'high'].includes(options.thinkingLevel || process.env.GEMINI_THINKING_LEVEL) ? (options.thinkingLevel || process.env.GEMINI_THINKING_LEVEL) : 'high' }, maxOutputTokens: boundedOutputTokens(options.maxOutputTokens || process.env.GEMINI_MAX_OUTPUT_TOKENS, 65536) },
      contents: [{ role: 'user', parts: [{ text: safeInput.prompt }] }]
    };
    if (safeInput.system) body.systemInstruction = { parts: [{ text: safeInput.system }] };
    const target = `${this.endpoint}/${encodeURIComponent(model)}:generateContent`;
    const response = await outboundFetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`AI provider request failed (HTTP ${response.status})`);
    }
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.map(p => p?.text || '').join('').trim() || '';
    if (!text) throw new Error('Gemini returned an empty response');
    return text;
  }

  async getStatus() {
    return { provider: 'Gemini', configured: Boolean(this.apiKey), model: this.model, authHeader: 'x-goog-api-key' };
  }
}

export default GeminiMeshProvider;
