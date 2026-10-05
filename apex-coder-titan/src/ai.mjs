const GROQ_RESPONSES_API = "https://api.groq.com/openai/v1/responses";
const GEMINI_CHAT_API = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

async function requestJson(url, { headers, body, provider }) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json?.error?.message || json?.error || provider + " request failed: " + response.status);
    error.status = response.status; error.retryAfter = response.headers.get("retry-after"); throw error;
  }
  return json;
}

export class TitanAI {
  constructor({ groqApiKey = "", openAiApiKey = "", groqModel = "openai/gpt-oss-120b", openAiModel = "", reasoningEffort = "high", maxOutputTokens = 12000 }) {
    this.groqApiKey = groqApiKey; this.openAiApiKey = openAiApiKey; this.groqModel = groqModel; this.openAiModel = openAiModel;
    this.reasoningEffort = reasoningEffort; this.maxOutputTokens = maxOutputTokens;
  }
  get provider() { if (this.groqApiKey) return "groq"; if (this.openAiApiKey) return "openai"; throw new Error("No coding-model API key is configured."); }
  async turn({ input, previousResponseId, tools = [] }) {
    if (this.groqApiKey) {
      const body = { model: this.groqModel, input, reasoning: { effort: this.reasoningEffort }, max_output_tokens: this.maxOutputTokens, store: true, ...(tools.length ? { tools, parallel_tool_calls: true } : {}) };
      if (previousResponseId) body.previous_response_id = previousResponseId;
      return requestJson(GROQ_RESPONSES_API, { headers: { authorization: "Bearer " + this.groqApiKey }, body, provider: "Groq" });
    }
    if (!this.openAiApiKey) throw new Error("No coding-model API key is configured.");
    const body = { model: this.openAiModel, input, reasoning: { effort: this.reasoningEffort }, max_output_tokens: this.maxOutputTokens, store: true, ...(tools.length ? { tools } : {}) };
    if (previousResponseId) body.previous_response_id = previousResponseId;
    return requestJson("https://api.openai.com/v1/responses", { headers: { authorization: "Bearer " + this.openAiApiKey }, body, provider: "OpenAI" });
  }
}

export class GeminiAuditAI {
  constructor({ apiKey, model = "gemini-3.8-flash", maxOutputTokens = 6000 }) { this.apiKey = apiKey; this.model = model; this.maxOutputTokens = maxOutputTokens; }
  async audit(input) {
    if (!this.apiKey) throw new Error("GEMINI_API_KEY is not configured.");
    return requestJson(GEMINI_CHAT_API, { headers: { authorization: "Bearer " + this.apiKey, "x-goog-api-client": "apex-coder-titan/1.0" }, body: { model: this.model, messages: [{ role: "system", content: "You are a Titan specialist reviewer. Produce concrete, testable findings. Never self-certify production-ready." }, { role: "user", content: input }], max_tokens: this.maxOutputTokens }, provider: "Gemini" });
  }
}

export function extractText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  return (response?.output || []).filter(item => item.type === "message").flatMap(item => item.content || []).filter(part => part.type === "output_text").map(part => part.text).join("\n");
}
export function extractChatText(response) { return response?.choices?.[0]?.message?.content || ""; }