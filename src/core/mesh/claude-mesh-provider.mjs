import { createGuardedFetch, sanitizeOutboundPayload } from "../../security/sovereign-outbound-gateway.mjs";

const outboundFetch = createGuardedFetch(["api.anthropic.com"]);

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
    const safeInput = sanitizeOutboundPayload({ prompt: String(prompt), system: options.system == null ? '' : String(options.system) });
    const body = {
      model,
      max_tokens: Number(options.maxTokens || process.env.CLAUDE_MAX_OUTPUT_TOKENS || 64000),
      thinking: options.thinking === false ? { type: 'disabled' } : { type: 'adaptive' },
      output_config: { effort: options.effort || process.env.CLAUDE_EFFORT || 'max' },
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
