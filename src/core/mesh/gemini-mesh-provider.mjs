import { generateMax, openAiMaxStatus } from "../../providers/openai-max-router.mjs";

// Compatibility adapter retained while callers migrate; all generation is routed through APEX's OpenAI provider.
export class GeminiMeshProvider {
  constructor() { this.model = process.env.OPENAI_MAX_MODEL || "configured default"; }
  async generate(prompt, options = {}) {
    const result = await generateMax({ prompt: String(prompt), system: options.system == null ? undefined : String(options.system), model: options.model });
    const text = result?.text ?? result?.output_text ?? result?.response ?? "";
    if (!String(text).trim()) throw new Error("OpenAI provider returned an empty response");
    return String(text);
  }
  async getStatus() {
    const status = await openAiMaxStatus();
    return { provider: "openai", configured: Boolean(status?.configured), model: this.model };
  }
}
export default GeminiMeshProvider;
