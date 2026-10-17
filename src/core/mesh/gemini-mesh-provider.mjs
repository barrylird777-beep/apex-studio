export class GeminiMeshProvider {
  constructor() { this.apiKey = ''; this.model = 'disabled'; }
  async generate() { throw new Error('Gemini provider disabled by APEX security policy'); }
  async getStatus() { return { provider: 'Gemini', configured: false, disabled: true }; }
}
export default GeminiMeshProvider;
