import { sanitizeOutboundPayload, createGuardedFetch } from "../security/sovereign-outbound-gateway.mjs";

const boundedNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};
const MAX_MESSAGES = boundedNumber(process.env.APEX_AI_MAX_MESSAGES, 20, 1, 50);
const MAX_CHARS = boundedNumber(process.env.APEX_AI_MAX_PROMPT_CHARS, 30000, 1000, 50000);
const MAX_TOTAL_MESSAGE_CHARS = MAX_CHARS;
const MAX_SYSTEM_CHARS = 10000;
const FREE_MODE = String(process.env.APEX_FREE_MODE ?? 'true').toLowerCase() !== 'false';
const FREE_AI_PROVIDERS = new Set(['openrouter', 'pollinations', 'groq', 'google', 'mistral', 'cloudflare']);
const FREE_AI_MAX_CONCURRENCY = boundedNumber(process.env.APEX_FREE_AI_MAX_CONCURRENCY, 8, 1, 16);
let freeAiInFlight = 0;
const freeAiWaiters = [];
async function acquireFreeAiSlot() {
  if (freeAiInFlight < FREE_AI_MAX_CONCURRENCY) { freeAiInFlight += 1; return; }
  await new Promise(resolve => freeAiWaiters.push(resolve));
  freeAiInFlight += 1;
}
function releaseFreeAiSlot() { freeAiInFlight = Math.max(0, freeAiInFlight - 1); freeAiWaiters.shift()?.(); }

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
  { id: 'groq', category: 'ultra-fast-inference', env: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', defaultModel: 'llama-3.3-70b-versatile', protocol: 'openai-compatible', freeTierRequiresOptIn: true },
  { id: 'openrouter', category: 'multi-provider-routing', env: 'OPENROUTER_API_KEY', modelEnv: 'OPENROUTER_MODEL', defaultModel: 'openrouter/free', protocol: 'openai-compatible' },
  { id: 'cloudflare', category: 'edge-inference', env: 'CLOUDFLARE_API_TOKEN', modelEnv: 'CLOUDFLARE_AI_MODEL', defaultModel: '@cf/meta/llama-3.1-8b-instruct', protocol: 'cloudflare', freeTierRequiresOptIn: true },
  { id: 'pollinations', category: 'free-fallback', env: null, modelEnv: 'POLLINATIONS_MODEL', defaultModel: 'openai', protocol: 'pollinations' }
];

const ALIASES = new Map(AI_PROVIDER_CATALOG.flatMap(p => [p.id, ...(p.aliases || [])].map(a => [a, p])));

function providerOf(id) {
  const p = ALIASES.get(String(id || '').toLowerCase());
  if (!p) throw new Error('unknown provider');
  return p;
}

export function messagesOf({ prompt, messages, system }) {
  if (Array.isArray(messages) && messages.length) {
    if (messages.length > MAX_MESSAGES) throw new Error(`Too many messages; maximum is ${MAX_MESSAGES}`);
    let totalChars = 0;
    const normalized = messages.map(m => {
      const role = String(m?.role || '');
      const content = typeof m?.content === 'string' ? m.content.trim() : '';
      // Callers may provide conversation turns, but cannot impersonate trusted instructions or tool output.
      if (!['user', 'assistant'].includes(role) || !content || content.length > MAX_CHARS) {
        throw new Error('invalid message role or content');
      }
      totalChars += content.length;
      if (totalChars > MAX_TOTAL_MESSAGE_CHARS) throw new Error('conversation exceeds configured total character limit');
      return { role, content };
    });
    const callerContext = String(system || '').trim();
    if (callerContext.length > MAX_SYSTEM_CHARS) throw new Error('additional context exceeds configured maximum');
    if (callerContext) {
      totalChars += callerContext.length;
      if (totalChars > MAX_TOTAL_MESSAGE_CHARS) throw new Error('conversation exceeds configured total character limit');
      normalized.unshift({ role: 'user', content: callerContext });
    }
    return normalized;
  }
  const text = String(prompt || '').trim();
  if (!text) throw new Error('prompt is required');
  if (text.length > MAX_CHARS) throw new Error('prompt exceeds configured maximum');
  const callerContext = String(system || '').trim();
  if (callerContext.length > MAX_SYSTEM_CHARS) throw new Error('additional context exceeds configured maximum');
  if (text.length + callerContext.length > MAX_TOTAL_MESSAGE_CHARS) throw new Error('conversation exceeds configured total character limit');
  return [...(callerContext ? [{ role: 'user', content: callerContext }] : []), { role: 'user', content: text }];
}

function enforceFreeAiBudget(provider) {
  if (!FREE_MODE) return;
  if (!FREE_AI_PROVIDERS.has(provider)) throw new Error(`Free mode blocks paid/non-free AI provider: ${provider}`);
}

const pollinationsFetch = createGuardedFetch(['text.pollinations.ai']);
const providerFetch = createGuardedFetch([
  'api.anthropic.com', 'generativelanguage.googleapis.com', 'api.cohere.com', 'api.cloudflare.com',
  'api.deepseek.com', 'api.mistral.ai', 'dashscope-intl.aliyuncs.com',
  'api.perplexity.ai', 'api.together.xyz', 'api.fireworks.ai',
  'api.cerebras.ai', 'api.sambanova.ai', 'api.groq.com', 'openrouter.ai'
]);

async function pollinations({ model, messages }) {
  const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n');
  const r = await pollinationsFetch('https://text.pollinations.ai/', {
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
    const r = await providerFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal });
    const raw = await r.text();
    let data; try { data = JSON.parse(raw); } catch { data = null; }
    // Provider error bodies are untrusted and may echo prompts, credentials, or private input.
    // Preserve only the HTTP status for diagnostics; never propagate provider response text.
    if (!r.ok) throw new Error(`AI provider request failed (HTTP ${r.status})`);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('AI provider returned an invalid response');
    }
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

async function cloudflare({ model, messages, temperature, maxTokens }) {
  const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is not configured');
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('CLOUDFLARE_ACCOUNT_ID must be a 32-character account ID');
  if (String(process.env.APEX_CLOUDFLARE_FREE_TIER_CONFIRMED || '').toLowerCase() !== 'true') {
    throw new Error('Cloudflare free-tier use requires explicit APEX_CLOUDFLARE_FREE_TIER_CONFIRMED=true');
  }
  const modelPath = String(model || '@cf/meta/llama-3.1-8b-instruct');
  if (!/^[@A-Za-z0-9._/-]{1,160}$/.test(modelPath) || modelPath.includes('..')) throw new Error('invalid Cloudflare model identifier');
  const data = await post('https://api.cloudflare.com/client/v4/accounts/' + accountId + '/ai/run/' + modelPath.split('/').map(encodeURIComponent).join('/'), {
    Authorization: 'Bearer ' + token
  }, {
    messages,
    ...(temperature == null ? {} : { temperature }),
    ...(maxTokens ? { max_tokens: Number(maxTokens) } : {})
  });
  if (data.success === false) throw new Error('Cloudflare AI request failed');
  return { id: null, model: modelPath, text: String(data.result?.response || ''), usage: data.result?.usage || null };
}

async function gemini({ model, messages, temperature, maxTokens }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured');
  const system = messages.filter(m => m.role === 'system' || m.role === 'developer').map(m => m.content).join('\n');
  const contents = messages.filter(m => m.role !== 'system' && m.role !== 'developer').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const data = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { "x-goog-api-key": key }, {
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

let freeAiRotationCursor = 0;
const FREE_AI_ROTATION_ORDER = Object.freeze(['groq', 'google', 'openrouter', 'mistral', 'cloudflare', 'pollinations']);

function freeProviderIsConfigured(id) {
  if (id === 'pollinations') return true;
  if (id === 'google') return String(process.env.APEX_GEMINI_FREE_TIER_CONFIRMED || '').toLowerCase() === 'true' && Boolean(process.env.GEMINI_API_KEY);
  if (id === 'groq') return String(process.env.APEX_GROQ_FREE_TIER_CONFIRMED || '').toLowerCase() === 'true' && Boolean(process.env.GROQ_API_KEY);
  if (id === 'openrouter') return Boolean(process.env.OPENROUTER_API_KEY);
  if (id === 'mistral') return String(process.env.APEX_MISTRAL_FREE_TIER_CONFIRMED || '').toLowerCase() === 'true' && Boolean(process.env.MISTRAL_API_KEY);
  if (id === 'cloudflare') return String(process.env.APEX_CLOUDFLARE_FREE_TIER_CONFIRMED || '').toLowerCase() === 'true' && Boolean(process.env.CLOUDFLARE_API_TOKEN) && /^[a-f0-9]{32}$/i.test(String(process.env.CLOUDFLARE_ACCOUNT_ID || ''));
  return false;
}

export function getFreeAiRotationPlan() {
  const configured = FREE_AI_ROTATION_ORDER.filter(id => FREE_AI_PROVIDERS.has(id) && freeProviderIsConfigured(id));
  if (!configured.length) throw new Error('No configured free AI providers; paid fallback is disabled');
  const offset = freeAiRotationCursor++ % configured.length;
  return [...configured.slice(offset), ...configured.slice(0, offset)];
}

async function executeProvider({ effectiveProvider, normalized, model, temperature, maxTokens }) {
  const p = providerOf(effectiveProvider);
  if (p.env && !process.env[p.env]) throw new Error(`${p.env} is not configured`);
  let selectedModel = String(model || process.env[p.modelEnv] || p.defaultModel).trim();
  if (FREE_MODE && p.id === 'openrouter' && selectedModel !== 'openrouter/free' && !selectedModel.endsWith(':free')) {
    selectedModel = 'openrouter/free';
  }
  let result;
  if (p.id === 'pollinations') result = await pollinations({ model: selectedModel, messages: normalized });
  else if (p.id === 'anthropic') result = await anthropic({ p, model: selectedModel, messages: normalized, temperature, maxTokens });
  else if (p.id === 'google') result = await gemini({ model: selectedModel, messages: normalized, temperature, maxTokens });
  else if (p.id === 'cloudflare') result = await cloudflare({ model: selectedModel, messages: normalized, temperature, maxTokens });
  else if (p.id === 'cohere') result = await cohere({ p, model: selectedModel, messages: normalized, temperature, maxTokens });
  else if (OPENAI_COMPATIBLE[p.id]) result = await openAiCompatible({ p, model: selectedModel, messages: normalized, temperature, maxTokens });
  else if (p.id === 'openai') {
    const { generateMax } = await import('./openai-max-router.mjs');
    result = await generateMax({ messages: normalized, model: selectedModel });
  } else if (p.id === 'xai') {
    const { generateGrok } = await import('./grok-router.mjs');
    result = await generateGrok({ messages: normalized, model: selectedModel });
  } else throw new Error('provider protocol not implemented');
  return { ...result, provider: p.id, category: p.category, freeMode: FREE_MODE, trusted: false, trustBoundary: 'untrusted-model-output' };
}

export async function generateUnifiedAi({ provider, prompt, messages, system, model, temperature, max_tokens, maxTokens } = {}) {
  const requested = String(provider || '').trim().toLowerCase();
  const normalized = sanitizeOutboundPayload({ messages: messagesOf({ prompt, messages, system }) }).messages;
  const requestedMaxTokens = maxTokens ?? max_tokens;
  const outputTokenLimit = requestedMaxTokens == null ? undefined : boundedNumber(requestedMaxTokens, 1024, 1, 8192);
  const requestedTemperature = temperature == null ? undefined : boundedNumber(temperature, 0.7, 0, 2);
  await acquireFreeAiSlot();
  try {
    if (!FREE_MODE) {
      const p = providerOf(requested);
      return await executeProvider({ effectiveProvider: requested, normalized, model, temperature: requestedTemperature, maxTokens: outputTokenLimit });
    }
    const order = getFreeAiRotationPlan();
    const failures = [];
    for (const id of order) {
      try {
        return await executeProvider({ effectiveProvider: id, normalized, model: id === requested ? model : undefined, temperature: requestedTemperature, maxTokens: outputTokenLimit });
      } catch (error) {
        // Do not expose provider response bodies or prompts; retain only a bounded provider label and generic error.
        failures.push(id);
      }
    }
    const error = new Error('All configured free AI providers failed; no paid endpoint was attempted.');
    error.code = 'FREE_AI_PROVIDERS_EXHAUSTED';
    error.providersAttempted = failures;
    throw error;
  } finally { releaseFreeAiSlot(); }
}

export function unifiedAiStatus() {
  return Object.fromEntries(AI_PROVIDER_CATALOG.map(p => [p.id, {
    category: p.category,
    configured: p.env ? Boolean(process.env[p.env]) : p.id === 'pollinations',
    model: process.env[p.modelEnv] || p.defaultModel,
    protocol: p.protocol,
    freeEligible: FREE_AI_PROVIDERS.has(p.id) && freeProviderIsConfigured(p.id)
  }]));
}
