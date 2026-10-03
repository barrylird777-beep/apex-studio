export class ClaudeMeshProvider {
  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY || '';
    this.endpoint = process.env.ANTHROPIC_ENDPOINT || 'https://api.anthropic.com/v1/messages';
    this.model = process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
  }

  async generate(prompt, options = {}) {
    if (!this.apiKey) throw new Error('Claude not configured');
    const model = options.model || this.model;
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: Number(options.maxTokens || 4096),
        messages: [{ role: 'user', content: String(prompt) }]
      })
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300).replace(/\s+/g, ' ');
      throw new Error(`Claude API Error: ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    const data = await response.json();
    return data.content?.filter(p => p?.type === 'text').map(p => p.text).join('') || '';
  }

  async getStatus() {
    return { provider: 'Claude', configured: Boolean(this.apiKey), model: this.model };
  }
}

export default ClaudeMeshProvider;
