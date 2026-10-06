import OpenAI from 'openai';

const DEFAULT_MODEL = process.env.GROK_MODEL || 'grok-4.7';
const MAX_PROMPT_CHARS = Math.max(1000, Number(process.env.GROK_MAX_PROMPT_CHARS || 50000));
const MAX_MESSAGES = Math.max(1, Math.min(100, Number(process.env.GROK_MAX_MESSAGES || 50)));

function getClient() {
  if (!process.env.XAI_API_KEY) throw new Error('XAI_API_KEY is not configured');
  return new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: process.env.XAI_BASE_URL || 'https://api.x.ai/v1',
    timeout: Math.max(5000, Number(process.env.GROK_TIMEOUT_MS || 120000)),
    maxRetries: Math.max(0, Math.min(5, Number(process.env.GROK_MAX_RETRIES || 2)))
  });
}

function normalizeInput({ prompt, messages }) {
  if (Array.isArray(messages) && messages.length) {
    if (messages.length > MAX_MESSAGES) throw new Error(`Too many messages; maximum is ${MAX_MESSAGES}`);
    return messages.map((message) => {
      const role = String(message?.role || '');
      if (!['user', 'assistant', 'system', 'developer'].includes(role)) throw new Error('Invalid message role');
      const content = String(message?.content || '').trim();
      if (!content || content.length > MAX_PROMPT_CHARS) throw new Error('Message content is empty or too large');
      return { role, content };
    });
  }
  const text = String(prompt || '').trim();
  if (!text) throw new Error('prompt is required');
  if (text.length > MAX_PROMPT_CHARS) throw new Error(`prompt exceeds ${MAX_PROMPT_CHARS} characters`);
  return text;
}

function normalizeSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return null;
  if (JSON.stringify(schema).length > 20000) throw new Error('response schema is too large');
  return schema;
}

export async function generateGrok({
  prompt, messages, system, model = DEFAULT_MODEL, previousResponseId,
  schema, schemaName = 'apex_grok_response', schemaDescription,
  reasoningEffort = 'high', webSearch = false, xSearch = false
} = {}) {
  const client = getClient();
  const input = normalizeInput({ prompt, messages });
  const normalizedSchema = normalizeSchema(schema);
  const tools = [];
  if (webSearch) tools.push({ type: 'web_search' });
  if (xSearch) tools.push({ type: 'x_search' });
  const request = {
    model: String(model || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    instructions: String(system || '').trim() || undefined,
    input,
    previous_response_id: previousResponseId ? String(previousResponseId) : undefined,
    ...(tools.length ? { tools } : {}),
    ...(reasoningEffort ? { reasoning: { effort: ['low', 'medium', 'high', 'xhigh'].includes(reasoningEffort) ? reasoningEffort : 'high' } } : {}),
    ...(normalizedSchema ? {
      text: { format: {
        type: 'json_schema',
        name: String(schemaName).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'apex_grok_response',
        description: schemaDescription ? String(schemaDescription).slice(0, 1000) : undefined,
        strict: true,
        schema: normalizedSchema
      }}
    } : {})
  };
  const response = await client.responses.create(request);
  const text = response.output_text || '';
  return {
    id: response.id,
    model: response.model || request.model,
    text,
    structured: Boolean(normalizedSchema),
    data: normalizedSchema ? JSON.parse(text) : null,
    usage: response.usage || null
  };
}

export function grokStatus() {
  return {
    configured: Boolean(process.env.XAI_API_KEY),
    model: DEFAULT_MODEL,
    sdk: 'openai-compatible',
    baseURL: process.env.XAI_BASE_URL || 'https://api.x.ai/v1',
    responsesApi: true,
    structuredOutputs: true,
    webSearch: true,
    xSearch: true
  };
}
