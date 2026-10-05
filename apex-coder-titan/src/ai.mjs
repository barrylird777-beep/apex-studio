const API = "https://api.openai.com/v1/responses";

export class TitanAI {
  constructor({ apiKey, model, reasoningEffort, maxOutputTokens }) {
    this.apiKey = apiKey;
    this.model = model;
    this.reasoningEffort = reasoningEffort;
    this.maxOutputTokens = maxOutputTokens;
  }

  async turn({ input, previousResponseId, tools = [] }) {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is not configured.");
    const body = {
      model: this.model,
      input,
      reasoning: { effort: this.reasoningEffort },
      max_output_tokens: this.maxOutputTokens,
      store: true
    };
    if (previousResponseId) body.previous_response_id = previousResponseId;
    if (tools.length) body.tools = tools;
    const response = await fetch(API, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${this.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json?.error?.message || `OpenAI request failed: ${response.status}`);
    return json;
  }
}

export function extractText(response) {
  return (response.output || [])
    .filter(item => item.type === "message")
    .flatMap(item => item.content || [])
    .filter(part => part.type === "output_text")
    .map(part => part.text)
    .join("\n");
}
