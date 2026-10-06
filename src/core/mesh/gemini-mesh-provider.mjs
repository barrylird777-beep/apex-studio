import { acquireAiRateLimit } from "./durable-worker-store.mjs";

export class GeminiMeshProvider {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    this.endpoint = (process.env.GEMINI_ENDPOINT || 'https://generativelanguage.googleapis.com/v1beta/models').replace(/\/$/, '');
    this.model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  }

  async generate(prompt, options = {}) {
    if (!this.apiKey) throw new Error('Gemini not configured');
    const model = options.model || this.model;
    const rateLimit = await acquireAiRateLimit({
      capacity: Number(process.env.GEMINI_RATE_LIMIT_CAPACITY || 10),
      refillPerSecond: Number(process.env.GEMINI_RATE_LIMIT_PER_SECOND || (10 / 60))
    });
    if (!rateLimit) throw new Error('Gemini shared rate limit reached; retry later');
    const body = {
      generationConfig: { thinkingConfig: { thinkingLevel: options.thinkingLevel || process.env.GEMINI_THINKING_LEVEL || 'high' }, maxOutputTokens: Number(options.maxOutputTokens || process.env.GEMINI_MAX_OUTPUT_TOKENS || 65536) },
      contents: [{ role: 'user', parts: [{ text: String(prompt) }] }]
    };
    if (options.system) body.systemInstruction = { parts: [{ text: String(options.system) }] };
    const response = await fetch(`${this.endpoint}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300).replace(/\s+/g, ' ');
      throw new Error(`Gemini API Error: ${response.status}${detail ? `: ${detail}` : ''}`);
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
