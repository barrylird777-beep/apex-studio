import { createGuardedFetch, sanitizeOutboundPayload } from "../../security/sovereign-outbound-gateway.mjs";

const outboundFetch = createGuardedFetch(["api.anthropic.com"]);

const MAX_PROMPT_CHARS = Math.min(50000, Math.max(1000, Number(process.env.CLAUDE_MAX_PROMPT_CHARS || 50000)));
const MAX_OUTPUT_TOKENS = 64000;

export function normalizeClaudeInput(prompt, system = '') {
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

export class ClaudeMeshProvider {
  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY || '';
    this.endpoint = process.env.ANTHROPIC_ENDPOINT || 'https://api.anthropic.com/v1/messages';
    this.model = process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-opus-5';
  }

  async generate(prompt, options = {}) {
    if (String(process.env.APEX_FREE_MODE ?? 'true').toLowerCase() !== 'false') throw new Error('Free mode blocks paid AI provider: Claude');
    if (!this.apiKey) throw new Error('Claude not configured');
    const model = options.model || this.model;
    const safeInput = normalizeClaudeInput(prompt, options.system);
    const body = {
      model,
      max_tokens: boundedOutputTokens(options.maxTokens || process.env.CLAUDE_MAX_OUTPUT_TOKENS, 64000),
      thinking: options.thinking === false ? { type: 'disabled' } : { type: 'adaptive' },
      output_config: { effort: ['low', 'medium', 'high', 'max'].includes(options.effort || process.env.CLAUDE_EFFORT) ? (options.effort || process.env.CLAUDE_EFFORT) : 'max' },
      messages: [{ role: 'user', content: safeInput.prompt }]
    };
    if (safeInput.system) body.system = safeInput.system;
    const response = await outboundFetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`AI provider request failed (HTTP ${response.status})`);
    }
    const data = await response.json();
    const text = data.content?.filter(p => p?.type === 'text').map(p => p.text).join('').trim() || '';
    if (!text) throw new Error('Claude returned an empty response');
    return text;
  }

  async getStatus() {
    return { provider: 'Claude', configured: Boolean(this.apiKey), model: this.model };
  }
}

export default ClaudeMeshProvider;
