export class GeminiMeshProvider {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    this.endpoint = (process.env.GEMINI_ENDPOINT || 'https://generativelanguage.googleapis.com/v1beta/models').replace(/\/$/, '');
    this.model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  }

  async generate(prompt, options = {}) {
    if (!this.apiKey) throw new Error('Gemini not configured');
    const model = options.model || this.model;
    const response = await fetch(`${this.endpoint}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: String(prompt) }] }] })
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300).replace(/\s+/g, ' ');
      throw new Error(`Gemini API Error: ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.map(p => p?.text || '').join('') || '';
  }

  async getStatus() {
    return { provider: 'Gemini', configured: Boolean(this.apiKey), model: this.model, authHeader: 'x-goog-api-key' };
  }
}

export default GeminiMeshProvider;
