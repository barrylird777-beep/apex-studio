const timeoutMs = Number(process.env.AI_SMOKE_TIMEOUT_MS || 20000);
const prompt = process.env.AI_SMOKE_PROMPT || 'Reply with exactly: APEX_AI_OK';

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function smokeOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { provider: 'OpenAI', configured: false, ok: false, error: 'missing API key' };
  const model = process.env.OPENAI_MAX_MODEL || 'gpt-6';
  try {
    const response = await request('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, max_tokens: 32, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await response.json().catch(() => ({}));
    const text = data.choices?.[0]?.message?.content?.trim() || '';
    return { provider: 'OpenAI', configured: true, model, ok: response.ok && Boolean(text), status: response.status, error: response.ok && text ? undefined : 'request failed or empty response' };
  } catch (error) {
    return { provider: 'OpenAI', configured: true, model, ok: false, error: error.message };
  }
}

async function smokeClaude() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { provider: 'Claude', configured: false, ok: false, error: 'missing API key' };
  const model = process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
  try {
    const response = await request('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 32, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await response.json().catch(() => ({}));
    const text = data.content?.filter(p => p?.type === 'text').map(p => p.text).join('').trim() || '';
    return { provider: 'Claude', configured: true, model, ok: response.ok && Boolean(text), status: response.status, error: response.ok && text ? undefined : (data.error?.message || 'empty response') };
  } catch (error) {
    return { provider: 'Claude', configured: true, model, ok: false, error: error.message };
  }
}

const results = [await smokeOpenAI(), await smokeClaude()];
console.log(JSON.stringify({ results }, null, 2));
if (process.env.AI_SMOKE_REQUIRE_LIVE === 'true' && results.some(r => r.configured && !r.ok)) process.exitCode = 1;
