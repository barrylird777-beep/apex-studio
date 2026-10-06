const MAX_MESSAGES = Math.max(1, Math.min(100, Number(process.env.APEX_AI_MAX_MESSAGES || 50)));
const MAX_CHARS = Math.max(1000, Number(process.env.APEX_AI_MAX_PROMPT_CHARS || 50000));
const FREE_MODE = String(process.env.APEX_FREE_MODE ?? 'true').toLowerCase() !== 'false';
const FREE_AI_DAILY_REQUESTS = Math.max(1, Number(process.env.APEX_FREE_AI_DAILY_REQUESTS || 5000));
const FREE_AI_PROVIDERS = new Set(['openrouter']);

export const AI_PROVIDER_CATALOG = [
  { id: 'openai', category: 'frontier-text-reasoning', env: 'OPENAI_API_KEY', modelEnv: 'OPENAI_MAX_MODEL', defaultModel: 'gpt-6-astra', protocol: 'responses' },
  { id: 'anthropic', category: 'frontier-text-reasoning-coding', env: 'ANTHROPIC_API_KEY', modelEnv: 'ANTHROPIC_MODEL', defaultModel: 'claude-opus-5', protocol: 'anthropic-messages' },
  { id: 'google', aliases: ['gemini'], category: 'frontier-multimodal-reasoning', env: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL', defaultModel: 'gemini-3.8-flash', protocol: 'gemini' },
  { id: 'xai', aliases: ['grok'], category: 'frontier-reasoning-search', env: 'XAI_API_KEY', modelEnv: 'GROK_MODEL', defaultModel: 'grok-4.7', protocol: 'responses' },
  { id: 'deepseek', category: 'reasoning-coding', env: 'DEEPSEEK_API_KEY', modelEnv: 'DEEPSEEK_MODEL', defaultModel: 'deepseek-v4-pro', protocol: 'openai-compatible' },
  { id: 'mistral', category: 'multilingual-reasoning-coding', env: 'MISTRAL_API_KEY', modelEnv: 'MISTRAL_MODEL', defaultModel: 'mistral-large-latest', protocol: 'openai-compatible' },
  { id: 'cohere', category: 'enterprise-rag-search', env: 'COHERE_API_KEY', modelEnv: 'COHERE_MODEL', defaultModel: 'command-a-plus-05-2026', protocol: 'cohere' },
  { id: 'qwen', category: 'multilingual-reasoning-coding', env: 'QWEN_API_KEY', modelEnv: 'QWEN_MODEL', defaultModel: 'qwen-plus', protocol: 'openai-compatible' },
  { id: 'perplexity', category: 'search-research', env: 'PERPLEXITY_API_KEY', modelEnv: 'PERPLEXITY_MODEL', defaultModel: 'sonar-pro', protocol: 'openai-compatible' },
  { id: 'together', category: 'open-model-inference', env: 'TOGETHER_API_KEY', modelEnv: 'TOGETHER_MODEL', defaultModel: 'moonshotai/Kimi-K2.5', protocol: 'openai-compatible' },
  { id: 'fireworks', category: 'open-model-inference', env: 'FIREWORKS_API_KEY', modelEnv: 'FIREWORKS_MODEL', defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct', protocol: 'openai-compatible' },
  { id: 'cerebras', category: 'ultra-fast-inference', env: 'CEREBRAS_API_KEY', modelEnv: 'CEREBRAS_MODEL', defaultModel: 'llama-3.3-70b', protocol: 'openai-compatible' },
  { id: 'sambanova', category: 'ultra-fast-inference', env: 'SAMBANOVA_API_KEY', modelEnv: 'SAMBANOVA_MODEL', defaultModel: 'Meta-Llama-3.3-70B-Instruct', protocol: 'openai-compatible' },
  { id: 'groq', category: 'ultra-fast-inference', env: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', defaultModel: 'llama-3.3-70b-versatile', protocol: 'openai-compatible' },
  { id: 'openrouter', category: 'multi-provider-routing', env: 'OPENROUTER_API_KEY', modelEnv: 'OPENROUTER_MODEL', defaultModel: 'openrouter/free', protocol: 'openai-compatible' },
  { id: 'pollinations', category: 'free-fallback', env: null, modelEnv: 'POLLINATIONS_MODEL', defaultModel: 'openai', protocol: 'pollinations' }
];

const ALIASES = new Map(AI_PROVIDER_CATALOG.flatMap(p => [p.id, ...(p.aliases || [])].map(a => [a, p])));

function providerOf(id) {
  const p = ALIASES.get(String(id || '').toLowerCase());
  if (!p) throw new Error('unknown provider');
  return p;
}

function messagesOf({ prompt, messages, system }) {
  if (Array.isArray(messages) && messages.length) {
    if (messages.length > MAX_MESSAGES) throw new Error(`Too many messages; maximum is ${MAX_MESSAGES}`);
    return messages.map(m => {
      const role = String(m?.role || '');
      const content = String(m?.content || '').trim();
      if (!['system','developer','user','assistant','tool'].includes(role) || !content || content.length > MAX_CHARS) throw new Error('invalid message');
      return { role, content };
    });
  }
  const text = String(prompt || '').trim();
  if (!text) throw new Error('prompt is required');
  if (text.length > MAX_CHARS) throw new Error('prompt exceeds configured maximum');
  return [{ role: 'system', content: String(system || '').trim() }, { role: 'user', content: text }].filter(x => x.content);
}

const freeUsage = { day: '', requests: 0 };
function enforceFreeAiBudget(provider) {
  if (!FREE_MODE) return;
  if (!FREE_AI_PROVIDERS.has(provider)) throw new Error(`Free mode blocks paid/non-free AI provider: ${provider}`);
  const day = new Date().toISOString().slice(0, 10);
  if (freeUsage.day !== day) { freeUsage.day = day; freeUsage.requests = 0; }
  if (freeUsage.requests >= FREE_AI_DAILY_REQUESTS) throw new Error('Free AI daily safety budget reached');
  freeUsage.requests += 1;
}

async function pollinations({ model, messages }) {
  const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n');
  const r = await fetch('https://text.pollinations.ai/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, model: model || 'openai' })
  });
  if (!r.ok) throw new Error(`Pollinations HTTP ${r.status}`);
  return { id: null, model: model || 'openai', text: await r.text(), usage: null };
}

async function post(url, headers, body, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal });
    const raw = await r.text();
    let data; try { data = JSON.parse(raw); } catch { data = { raw }; }
    if (!r.ok) throw new Error(`provider HTTP ${r.status}: ${String(data?.error?.message || data?.message || data?.error || raw).slice(0, 1000)}`);
    return data;
  } finally { clearTimeout(timer); }
}

async function anthropic({ p, model, messages, maxTokens = 4096, temperature }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not configured');
  const system = messages.filter(m => m.role === 'system' || m.role === 'developer').map(m => m.content).join('\n');
  const input = messages.filter(m => m.role !== 'system' && m.role !== 'developer');
  const data = await post('https://api.anthropic.com/v1/messages', {
    'x-api-key': key, 'anthropic-version': '2023-06-01'
  }, { model, max_tokens: Math.max(1, Number(maxTokens) || 4096), ...(system ? { system } : {}), messages: input, ...(temperature == null ? {} : { temperature }) });
  return { id: data.id, model: data.model || model, text: data.content?.filter(x => x.type === 'text').map(x => x.text).join('') || '', usage: data.usage || null };
}

async function gemini({ model, messages, temperature, maxTokens }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured');
  const system = messages.filter(m => m.role === 'system' || m.role === 'developer').map(m => m.content).join('\n');
  const contents = messages.filter(m => m.role !== 'system' && m.role !== 'developer').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const data = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {}, {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    generationConfig: { ...(temperature == null ? {} : { temperature }), ...(maxTokens ? { maxOutputTokens: Number(maxTokens) } : {}) }
  });
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  return { id: data.responseId || null, model, text, usage: data.usageMetadata || null };
}

async function cohere({ model, messages, temperature, maxTokens }) {
  const key = process.env.COHERE_API_KEY;
  if (!key) throw new Error('COHERE_API_KEY is not configured');
  const data = await post('https://api.cohere.com/v2/chat', { Authorization: `Bearer ${key}` }, { model, messages, ...(temperature == null ? {} : { temperature }), ...(maxTokens ? { max_tokens: Number(maxTokens) } : {}) });
  return { id: data.id, model, text: data.message?.content?.filter(x => x.type === 'text').map(x => x.text).join('') || '', usage: data.usage || null };
}

const OPENAI_COMPATIBLE = {
  deepseek: ['https://api.deepseek.com/chat/completions', 'DEEPSEEK_API_KEY'],
  mistral: ['https://api.mistral.ai/v1/chat/completions', 'MISTRAL_API_KEY'],
  qwen: ['https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', 'QWEN_API_KEY'],
  perplexity: ['https://api.perplexity.ai/chat/completions', 'PERPLEXITY_API_KEY'],
  together: ['https://api.together.xyz/v1/chat/completions', 'TOGETHER_API_KEY'],
  fireworks: ['https://api.fireworks.ai/inference/v1/chat/completions', 'FIREWORKS_API_KEY'],
  cerebras: ['https://api.cerebras.ai/v1/chat/completions', 'CEREBRAS_API_KEY'],
  sambanova: ['https://api.sambanova.ai/v1/chat/completions', 'SAMBANOVA_API_KEY'],
  groq: ['https://api.groq.com/openai/v1/chat/completions', 'GROQ_API_KEY'],
  openrouter: ['https://openrouter.ai/api/v1/chat/completions', 'OPENROUTER_API_KEY']
};

async function openAiCompatible({ p, model, messages, temperature, maxTokens }) {
  const [url, env] = OPENAI_COMPATIBLE[p.id];
  const key = process.env[env];
  if (!key) throw new Error(`${env} is not configured`);
  const data = await post(url, { Authorization: `Bearer ${key}` }, { model, messages, ...(temperature == null ? {} : { temperature }), ...(maxTokens ? { max_tokens: Number(maxTokens) } : {}) });
  return { id: data.id, model: data.model || model, text: data.choices?.[0]?.message?.content || '', usage: data.usage || null };
}

export async function generateUnifiedAi({ provider, prompt, messages, system, model, temperature, max_tokens, maxTokens } = {}) {
  const requested = String(provider || '').trim().toLowerCase();
  const effectiveProvider = FREE_MODE ? (FREE_AI_PROVIDERS.has(requested) ? requested : 'openrouter') : requested;
  enforceFreeAiBudget(effectiveProvider);
  const p = providerOf(effectiveProvider);
  if (p.env && !process.env[p.env]) throw new Error(`${p.env} is not configured`);
  const normalized = messagesOf({ prompt, messages, system });
  const selectedModel = String(model || process.env[p.modelEnv] || p.defaultModel).trim();
  let result;
  if (p.id === 'pollinations') result = await pollinations({ model: selectedModel, messages: normalized });
  else if (p.id === 'anthropic') result = await anthropic({ p, model: selectedModel, messages: normalized, temperature, maxTokens: maxTokens ?? max_tokens });
  else if (p.id === 'google') result = await gemini({ model: selectedModel, messages: normalized, temperature, maxTokens: maxTokens ?? max_tokens });
  else if (p.id === 'cohere') result = await cohere({ model: selectedModel, messages: normalized, temperature, maxTokens: maxTokens ?? max_tokens });
  else if (OPENAI_COMPATIBLE[p.id]) result = await openAiCompatible({ p, model: selectedModel, messages: normalized, temperature, maxTokens: maxTokens ?? max_tokens });
  else if (p.id === 'openai') {
    const { generateMax } = await import('./openai-max-router.mjs');
    result = await generateMax({ prompt, messages, system, model: selectedModel });
  } else if (p.id === 'xai') {
    const { generateGrok } = await import('./grok-router.mjs');
    result = await generateGrok({ prompt, messages, system, model: selectedModel });
  } else throw new Error('provider protocol not implemented');
  return { provider: p.id, category: p.category, ...result };
}

export function unifiedAiStatus() {
  return Object.fromEntries(AI_PROVIDER_CATALOG.map(p => [p.id, {
    category: p.category,
    configured: Boolean(process.env[p.env]),
    model: process.env[p.modelEnv] || p.defaultModel,
    protocol: p.protocol
  }]));
}
