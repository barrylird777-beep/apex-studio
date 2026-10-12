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

async function smokeGemini() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return { provider: 'Gemini', configured: false, ok: false, error: 'missing API key' };
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  try {
    const response = await request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] })
    });
    const data = await response.json().catch(() => ({}));
    const text = data.candidates?.[0]?.content?.parts?.map(p => p?.text || '').join('').trim() || '';
    return { provider: 'Gemini', configured: true, model, ok: response.ok && Boolean(text), status: response.status, error: response.ok && text ? undefined : (data.error?.message || 'empty response') };
  } catch (error) {
    return { provider: 'Gemini', configured: true, model, ok: false, error: error.message };
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

const results = [await smokeGemini(), await smokeClaude()];
console.log(JSON.stringify({ results }, null, 2));
if (process.env.AI_SMOKE_REQUIRE_LIVE === 'true' && results.some(r => r.configured && !r.ok)) process.exitCode = 1;
