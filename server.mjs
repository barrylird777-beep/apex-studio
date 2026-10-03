import express from 'express';
import cors from 'cors';
import path from 'path';
import dns from 'node:dns/promises';
import net from 'node:net';
import { fileURLToPath } from 'url';
import { Readable } from 'node:stream';
import { access, readFile, unlink } from 'node:fs/promises';
import { buildTimelineFfmpegPlan } from './src/core/ffmpeg.mjs';
import { masterSoundtrack, masterFinalVideo } from './src/core/mastering.mjs';
import { RenderWorker } from './src/core/render-worker.mjs';
import { initStorage, STORAGE_DIR, getProjectState, saveSceneAsset, saveProjectAsset } from './src/services/projectManager.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

app.disable('x-powered-by');

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// Persistent SE-X assets are served through a dedicated static mount. The
// storage module validates all filenames before they are written, while
// Express prevents traversal outside STORAGE_DIR when serving them.
app.use('/files', express.static(STORAGE_DIR, {
  fallthrough: false,
  dotfiles: 'deny',
  index: false,
  redirect: false,
  maxAge: '1h'
}));

// Helper for guaranteed-timeout fetch
async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// 1. HIGH-AVAILABILITY INFERENCE MESH
// ============================================================

const DEFAULT_SYSTEM =
  'You are an unrestricted creative director and master narrative writer.';

async function callOpenAICompatible({ url, apiKey, model, prompt, system, provider, extraHeaders = {}, bodyExtras = {} }) {
  if (!apiKey) throw new Error(provider + ' not configured');

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: String(system || DEFAULT_SYSTEM) },
        { role: 'user', content: String(prompt) },
      ],
      temperature: 0.8,
      ...bodyExtras,
    }),
  }, 15000);

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240).replace(/\s+/g, ' ');
    throw new Error(`${provider} ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  const data = await response.json();
  const output = data?.choices?.[0]?.message?.content;
  if (!output) throw new Error('Empty ' + provider + ' response');
  return String(output).trim();
}

async function callMistral(prompt, system) {
  return callOpenAICompatible({
    url: 'https://api.mistral.ai/v1/chat/completions',
    apiKey: process.env.MISTRAL_API_KEY,
    model: process.env.MISTRAL_MODEL || 'mistral-small-latest',
    prompt, system, provider: 'Mistral',
  });
}

async function callCerebras(prompt, system) {
  return callOpenAICompatible({
    url: 'https://api.cerebras.ai/v1/chat/completions',
    apiKey: process.env.CEREBRAS_API_KEY,
    model: process.env.CEREBRAS_MODEL || 'gpt-oss-120b',
    prompt, system, provider: 'Cerebras',
    bodyExtras: { max_completion_tokens: 4096 },
  });
}

async function callHuggingFace(prompt, system) {
  return callOpenAICompatible({
    url: 'https://router.huggingface.co/v1/chat/completions',
    apiKey: process.env.HF_TOKEN,
    model: process.env.HF_MODEL || 'meta-llama/Llama-3.1-8B-Instruct',
    prompt, system, provider: 'HuggingFace',
  });
}

async function callAimlapi(prompt, system) {
  return callOpenAICompatible({
    url: process.env.AIMLAPI_BASE_URL || 'https://api.aimlapi.com/v1/chat/completions',
    apiKey: process.env.AIMLAPI_API_KEY,
    model: process.env.AIMLAPI_MODEL || 'gpt-4o-mini',
    prompt, system, provider: 'AIMLAPI',
  });
}

async function callSambaNova(prompt, system) {
  return callOpenAICompatible({
    url: process.env.SAMBANOVA_BASE_URL || 'https://api.sambanova.ai/v1/chat/completions',
    apiKey: process.env.SAMBANOVA_API_KEY,
    model: process.env.SAMBANOVA_MODEL || 'Meta-Llama-3.1-8B-Instruct',
    prompt, system, provider: 'SambaNova',
  });
}

async function callCloudflare(prompt, system) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) throw new Error('Cloudflare Workers AI not configured');

  const model = process.env.CLOUDFLARE_AI_MODEL || '@cf/zai-org/glm-4.7-flash';
  const response = await fetchWithTimeout(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${encodeURIComponent(model)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: String(system || DEFAULT_SYSTEM) },
          { role: 'user', content: String(prompt) },
        ],
      }),
    },
    15000
  );

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240).replace(/\s+/g, ' ');
    throw new Error(`Cloudflare ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  const data = await response.json();
  const output = data?.result?.response ?? data?.result?.content ?? data?.result?.text ?? data?.result?.output_text;
  if (!output) throw new Error('Empty Cloudflare response');
  return String(output).trim();
}

async function callGroq(prompt, system) {
  if (!process.env.GROQ_API_KEY) throw new Error('Groq not configured');

  const response = await fetchWithTimeout(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        temperature: 0.8,
      }),
    },
    15000
  );

  if (!response.ok) throw new Error(`Groq ${response.status}`);
  const data = await response.json();
  const output = data?.choices?.[0]?.message?.content;
  if (!output) throw new Error('Empty Groq response');
  return output;
}

async function callOpenRouter(prompt, system) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OpenRouter not configured');

  const response = await fetchWithTimeout(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://railway.app',
        'X-Title': 'Apex Studio',
      },
      body: JSON.stringify({
        // Explicit free router: never silently upgrade this provider to a paid model.
        model: process.env.OPENROUTER_MODEL || 'openrouter/free',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }),
    },
    15000
  );

  if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
  const data = await response.json();
  const output = data?.choices?.[0]?.message?.content;
  if (!output) throw new Error('Empty OpenRouter response');
  return output;
}

async function callGemini(prompt, system) {
  if (!process.env.GEMINI_API_KEY) throw new Error('Gemini not configured');

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': process.env.GEMINI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: String(system || DEFAULT_SYSTEM) }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: String(prompt) }],
          },
        ],
        generationConfig: {
          temperature: 0.8,
        },
      }),
    },
    15000
  );

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Gemini ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  const data = await response.json();
  const output = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part?.text || '')
    .join('')
    .trim();

  if (!output) throw new Error('Empty Gemini response');
  return output;
}

async function callPollinationsText(prompt, system) {
  const fullPrompt = encodeURIComponent(`${system}\n\nTask: ${prompt}`);
  const model = encodeURIComponent(process.env.POLLINATIONS_TEXT_MODEL || 'mistral');
  
  // Dual-endpoint attempt for Pollinations text
  const urls = [
    `https://text.pollinations.ai/${fullPrompt}?model=${model}`,
    `https://gen.pollinations.ai/text/${fullPrompt}?model=${model}`
  ];

  for (const url of urls) {
    try {
      const response = await fetchWithTimeout(url, {}, 10000);
      if (response.ok) {
        const text = await response.text();
        if (text && text.trim()) return text;
      }
    } catch (_) {}
  }

  throw new Error('All text fallbacks exhausted');
}

// Provider order is deterministic and cost-aware. Free-path providers are always
// eligible when configured. Metered providers are opt-in so adding an API key can
// never silently turn the zero-cost mesh into a paid workload.
const ALLOW_METERED_PROVIDERS =
  String(process.env.APEX_ALLOW_METERED_PROVIDERS || 'false').toLowerCase() === 'true';

const PROVIDER_COOLDOWN_MS = Number(process.env.APEX_PROVIDER_COOLDOWN_MS || 60_000);
const providerCooldowns = new Map();

const allInferenceProviders = [
  { id: 'groq-free', cost: 'free', call: callGroq, enabled: () => Boolean(process.env.GROQ_API_KEY) },
  { id: 'mistral-free', cost: 'free', call: callMistral, enabled: () => Boolean(process.env.MISTRAL_API_KEY) },
  { id: 'cerebras-free', cost: 'free', call: callCerebras, enabled: () => Boolean(process.env.CEREBRAS_API_KEY) },
  { id: 'openrouter-free', cost: 'free', call: callOpenRouter, enabled: () => Boolean(process.env.OPENROUTER_API_KEY) },
  { id: 'gemini-free', cost: 'free', call: callGemini, enabled: () => Boolean(process.env.GEMINI_API_KEY) },
  { id: 'cloudflare-free', cost: 'free', call: callCloudflare, enabled: () => Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) },
  { id: 'pollinations', cost: 'free', call: callPollinationsText, enabled: () => true },
  { id: 'huggingface-metered', cost: 'metered', call: callHuggingFace, enabled: () => Boolean(process.env.HF_TOKEN) },
  { id: 'aimlapi-metered', cost: 'metered', call: callAimlapi, enabled: () => Boolean(process.env.AIMLAPI_API_KEY) },
  { id: 'sambanova-metered', cost: 'metered', call: callSambaNova, enabled: () => Boolean(process.env.SAMBANOVA_API_KEY) },
];

const requestedOrder = String(process.env.APEX_INFERENCE_ORDER || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const inferenceProviders = requestedOrder.length
  ? requestedOrder.map((id) => allInferenceProviders.find((provider) => provider.id === id)).filter(Boolean)
  : allInferenceProviders;

function isProviderCoolingDown(id) {
  const until = providerCooldowns.get(id) || 0;
  if (until <= Date.now()) {
    providerCooldowns.delete(id);
    return false;
  }
  return true;
}

function markProviderFailure(id, message) {
  if (/\b(401|402|403|408|429|500|502|503|504)\b/.test(message)) {
    providerCooldowns.set(id, Date.now() + PROVIDER_COOLDOWN_MS);
  }
}

async function executeInference(prompt, system = DEFAULT_SYSTEM) {
  const input = String(prompt || '').trim();
  if (!input) throw new Error('Prompt cannot be empty');

  const failures = [];

  for (const provider of inferenceProviders) {
    if (provider.cost === 'metered' && !ALLOW_METERED_PROVIDERS) {
      failures.push(`${provider.id}: metered provider disabled by APEX_ALLOW_METERED_PROVIDERS`);
      continue;
    }

    if (!provider.enabled()) {
      failures.push(`${provider.id}: not configured`);
      continue;
    }

    if (isProviderCoolingDown(provider.id)) {
      failures.push(`${provider.id}: temporary cooldown`);
      continue;
    }

    try {
      const output = await provider.call(input, system);
      return { text: output, provider: provider.id, failures };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      markProviderFailure(provider.id, message);
      console.warn(`[mesh] ${provider.id} failed: ${message}. Escalating...`);
      failures.push(`${provider.id}: ${message}`);
    }
  }

  // Guaranteed Last-Resort Echo so the pipeline never throws an uncaught 500
  return {
    text: input,
    provider: 'fallback-passthrough',
    failures
  };
}

// ============================================================
// 2. ORACLE ROUTE
// ============================================================

app.post('/api/oracle', async (req, res) => {
  const { prompt, systemPrompt } = req.body || {};
  if (!prompt) return res.status(400).json({ success: false, error: 'prompt is required' });

  try {
    const result = await executeInference(prompt, systemPrompt || DEFAULT_SYSTEM);
    res.json({
      success: true,
      text: result.text,
      provider: result.provider,
      failures: result.failures
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 3. HARDENED FORGE ROUTE
// ============================================================

app.post('/api/forge', async (req, res) => {
  try {
    // 1. Defend against malformed payloads/types
    const rawPrompt = String(req.body?.prompt || req.body?.text || '').trim();
    if (!rawPrompt) {
      return res.status(400).json({ success: false, error: 'prompt is required' });
    }

    let finalPrompt = rawPrompt;
    let activeProvider = 'direct';
    let meshFailures = [];

    // 2. Safe LLM prompt enhancement with guaranteed catch
    try {
      const systemInstruction =
        'Rewrite this into an elite 16:9 cinematic dark fantasy anime illustration prompt. Preserve the subject, action, setting, and composition. STRICTLY ENFORCE: 1990s dark fantasy anime aesthetic, hand-painted cel shading, deep cinematic shadows, dramatic rim lighting, dense atmospheric perspective, detailed ink linework, textured backgrounds, expressive faces, dynamic film composition, Studio Madhouse-inspired theatrical anime production design. Describe lighting, camera angle, lens/framing, textures, environment, and character detail. Return ONLY the final prompt.';
      const inference = await executeInference(rawPrompt, systemInstruction);
      if (inference?.text) {
        finalPrompt = inference.text;
        activeProvider = inference.provider;
        meshFailures = inference.failures || [];
      }
    } catch (err) {
      meshFailures.push(`mesh-exhausted: ${err.message}`);
      // Silently fall through to rawPrompt
    }

    // 3. Clean string & clamp length to prevent HTTP 414 (URI Too Long)
    const FORGE_STYLE_LOCK = [
      '1990s dark fantasy anime aesthetic',
      'hand-painted cel shading',
      'deep cinematic shadows',
      'dramatic rim lighting',
      'dense atmospheric perspective',
      'detailed ink linework',
      'textured hand-painted backgrounds',
      'expressive character faces',
      'dynamic theatrical film composition',
      'Studio Madhouse-inspired anime production design',
      'dark mythic atmosphere',
      'high-detail cinematic anime frame'
    ].join(', ');

    const FORGE_QUALITY_LOCK = [
      '8k detail',
      'cinematic lighting',
      'masterpiece',
      'ultra-detailed',
      'high dynamic range',
      'sharp focal subject',
      'rich texture',
      'professional anime keyframe quality'
    ].join(', ');

    // Final style override is appended AFTER the mesh output so no provider can
    // dilute the visual direction before the prompt reaches the image model.
    const strictStyle =
      '1990s dark fantasy anime masterpiece, Studio Madhouse style, deep cinematic shadows, high contrast, cel-shaded, ultra-detailed line art, moody atmosphere, --no 3d, realistic, CGI';

    // The LLM may enhance the prompt, but it can never remove the Forge style/quality contract.
    // Keep the model-generated portion bounded, then append the locks last so
    // every Pollinations request always contains every mandatory marker.
    const modelPrompt = String(finalPrompt || '')
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 900)
      .trim();

    const sanitizedPrompt = [modelPrompt, FORGE_STYLE_LOCK, FORGE_QUALITY_LOCK, strictStyle]
      .filter(Boolean)
      .join(', ')
      .trim();

    const seed = Math.floor(Math.random() * 9999999);
    const model = encodeURIComponent(process.env.POLLINATIONS_IMAGE_MODEL || 'flux');
    const encoded = encodeURIComponent(sanitizedPrompt);

    // Primary + Secondary Image Gateways
    const primaryUrl = `https://image.pollinations.ai/prompt/${encoded}?width=1280&height=720&model=${model}&seed=${seed}&nologo=true`;
    const mirrorUrl = `https://gen.pollinations.ai/image/${encoded}?width=1280&height=720&model=${model}&seed=${seed}&nologo=true`;

    return res.json({
      success: true,
      rawPrompt,
      cinematicPrompt: sanitizedPrompt,
      // Forge remains the visual prompt authority. The deterministic narration
      // fallback keeps the full-scene pipeline executable even when no separate
      // script-generation provider is available.
      voiceoverScript: rawPrompt,
      imageUrl: primaryUrl,
      fallbackImageUrl: mirrorUrl,
      provider: activeProvider,
      seed,
      meshFailures
    });

  } catch (criticalError) {
    // Last line of defense against process-level crashes
    console.error('[forge-fatal]', criticalError);
    return res.status(500).json({
      success: false,
      error: 'Image pipeline failed',
      details: criticalError instanceof Error ? criticalError.message : String(criticalError)
    });
  }
});

// ============================================================
// 4. BARD AUDIO ENGINE (SERVER-SIDE TTS)
// ============================================================

app.post('/api/audio', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    const sceneId = String(req.body?.sceneId || '').trim();
    if (!text) {
      return res.status(400).json({ success: false, error: 'Text script required' });
    }
    if (sceneId && (!/^[A-Za-z0-9._-]+$/.test(sceneId) || sceneId === '.' || sceneId === '..')) {
      return res.status(400).json({ success: false, error: 'Invalid sceneId' });
    }
    if (!process.env.HF_TOKEN) {
      return res.status(503).json({ success: false, error: 'HF_TOKEN is not configured' });
    }

    const model = process.env.HF_TTS_MODEL || 'espnet/kan-bayashi_ljspeech_vits';
    const response = await fetchWithTimeout(
      `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.HF_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ inputs: text })
      },
      60000
    );

    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.toLowerCase().includes('audio')) {
      let detail = '';
      try {
        const body = await response.text();
        try {
          const parsed = JSON.parse(body);
          detail = parsed?.error || parsed?.message || body.slice(0, 300);
          if (parsed?.estimated_time) detail += ` (estimated wait: ${parsed.estimated_time}s)`;
        } catch {
          detail = body.slice(0, 300);
        }
      } catch {}
      throw new Error(`Hugging Face TTS ${response.status}${detail ? `: ${detail}` : ''}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error('TTS provider returned an empty audio file');
    if (sceneId) {
      const savedScene = await saveSceneAsset(sceneId, 'audio', buffer, 'wav');
      return res.json({
        success: true,
        sceneId,
        url: savedScene.audio,
        audioUrl: savedScene.audio,
        contentType: contentType || 'audio/wav',
        bytes: buffer.length
      });
    }

    res.set({
      'Content-Type': contentType || 'audio/wav',
      'Content-Length': buffer.length,
      'Cache-Control': 'no-store'
    });
    return res.send(buffer);
  } catch (error) {
    console.error('[audio-fatal]', error);
    return res.status(502).json({ success: false, error: error.message });
  }
});

app.get('/api/audio/status', (_req, res) => {
  res.json({
    success: true,
    provider: 'huggingface',
    configured: Boolean(process.env.HF_TOKEN),
    model: process.env.HF_TTS_MODEL || 'espnet/kan-bayashi_ljspeech_vits',
    note: 'Availability, model loading, quotas, and authentication are controlled by Hugging Face.'
  });
});

// ============================================================
// 5. FREE MEDIA GENERATION
// ============================================================

function pollinationsMediaKey() {
  return process.env.POLLINATIONS_API_KEY || '';
}

function buildPollinationsMediaRequest(kind, prompt, params = {}) {
  const key = pollinationsMediaKey();
  if (!key) throw new Error('POLLINATIONS_API_KEY is not configured');
  const encoded = encodeURIComponent(String(prompt || '').trim());
  const base = kind === 'video'
    ? 'https://gen.pollinations.ai/video/'
    : 'https://gen.pollinations.ai/image/';
  const query = new URLSearchParams(params);
  return {
    url: base + encoded + (query.toString() ? '?' + query.toString() : ''),
    headers: { Authorization: ['Bearer', key].join(' ') }
  };
}

async function proxyPollinationsMedia(kind, prompt, params, res) {
  const request = buildPollinationsMediaRequest(kind, prompt, params);
  const response = await fetchWithTimeout(request.url, { headers: request.headers }, kind === 'video' ? 120000 : 60000);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300).replace(/\s+/g, ' ');
    throw new Error(`Pollinations ${kind} ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  const contentType = response.headers.get('content-type') || (kind === 'video' ? 'video/mp4' : 'image/png');
  const contentLength = response.headers.get('content-length');
  res.set({
    'Content-Type': contentType,
    ...(contentLength ? { 'Content-Length': contentLength } : {}),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  if (!response.body) throw new Error(`Pollinations returned an empty ${kind} response`);
  return Readable.fromWeb(response.body).pipe(res);
}

app.post('/api/media/image', async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ success: false, error: 'prompt is required' });
    const width = Math.min(Math.max(Number(req.body?.width || 1280), 256), 2048);
    const height = Math.min(Math.max(Number(req.body?.height || 720), 256), 2048);
    const model = String(req.body?.model || process.env.POLLINATIONS_IMAGE_MODEL || 'flux').slice(0, 120);
    const seed = Number.isFinite(Number(req.body?.seed)) ? Number(req.body.seed) : Math.floor(Math.random() * 9999999);
    return await proxyPollinationsMedia('image', prompt, { model, width, height, seed, nologo: 'true' }, res);
  } catch (error) {
    console.error('[media-image-fatal]', error);
    return res.status(502).json({ success: false, error: error.message });
  }
});

app.post('/api/media/video', async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ success: false, error: 'prompt is required' });
    const duration = Math.min(Math.max(Number(req.body?.duration || 4), 1), 10);
    const aspectRatio = String(req.body?.aspectRatio || '16:9').slice(0, 20);
    const model = String(req.body?.model || process.env.POLLINATIONS_VIDEO_MODEL || 'alibaba/wan-2.2-fast').slice(0, 120);
    const sceneId = String(req.body?.sceneId || '').trim();

    if (!sceneId) {
      return await proxyPollinationsMedia('video', prompt, { model, duration, aspectRatio }, res);
    }
    if (!/^[A-Za-z0-9._-]+$/.test(sceneId) || sceneId === '.' || sceneId === '..') {
      return res.status(400).json({ success: false, error: 'Invalid sceneId' });
    }

    const request = buildPollinationsMediaRequest('video', prompt, { model, duration, aspectRatio });
    const response = await fetchWithTimeout(request.url, { headers: request.headers }, 120000);
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300).replace(/\s+/g, ' ');
      throw new Error(`Pollinations video ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    const contentType = response.headers.get('content-type') || 'video/mp4';
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error('Pollinations returned an empty video response');

    const savedScene = await saveSceneAsset(sceneId, 'video', buffer, 'mp4');
    return res.json({
      success: true,
      sceneId,
      url: savedScene.video,
      videoUrl: savedScene.video,
      contentType,
      bytes: buffer.length
    });
  } catch (error) {
    console.error('[media-video-fatal]', error);
    return res.status(502).json({ success: false, error: error.message });
  }
});
app.get('/api/media/status', (_req, res) => {
  res.json({
    success: true,
    image: {
      provider: 'pollinations',
      configured: true,
      serverSideKeyConfigured: Boolean(process.env.POLLINATIONS_API_KEY),
      model: process.env.POLLINATIONS_IMAGE_MODEL || 'flux'
    },
    video: {
      provider: 'pollinations',
      configured: true,
      apiKeyConfigured: Boolean(process.env.POLLINATIONS_API_KEY),
      model: process.env.POLLINATIONS_VIDEO_MODEL || 'alibaba/wan-2.2-fast'
    },
    note: 'Availability and free usage are controlled by the upstream service. Apex does not bypass provider authentication, quotas, or billing.'
  });
});

// ============================================================
// 6. AUTONOMOUS CRAWLER
// ============================================================

const CRAWLER_DEFAULTS = Object.freeze({
  maxPages: 10,
  maxDepth: 2,
  maxBytes: 2_000_000,
  timeoutMs: 12_000,
});

function normalizeUrl(value, base) {
  try {
    const url = base ? new URL(value, base) : new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function isPrivateIPv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIPv6(address) {
  const val = address.toLowerCase();
  return val === '::1' || val === '::' || val.startsWith('fc') || val.startsWith('fd') || val.startsWith('fe80:');
}

async function assertPublicHostname(hostname) {
  const norm = hostname.toLowerCase();
  if (norm === 'localhost' || norm.endsWith('.local')) {
    throw new Error('Local addresses prohibited');
  }
  if (net.isIP(norm) === 4 && isPrivateIPv4(norm)) throw new Error('Private IPv4 prohibited');
  if (net.isIP(norm) === 6 && isPrivateIPv6(norm)) throw new Error('Private IPv6 prohibited');

  const records = await dns.lookup(norm, { all: true, verbatim: true }).catch(() => []);
  if (!records.length) throw new Error('Hostname did not resolve');

  for (const record of records) {
    if ((record.family === 4 && isPrivateIPv4(record.address)) || (record.family === 6 && isPrivateIPv6(record.address))) {
      throw new Error('Host resolved to private IP');
    }
  }
}

function stripHtml(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function crawlSite(startUrl, options = {}) {
  const config = { ...CRAWLER_DEFAULTS, ...options };
  const root = normalizeUrl(startUrl);
  if (!root) throw new Error('Valid HTTP/HTTPS URL required');

  await assertPublicHostname(root.hostname);

  const queue = [{ url: root.toString(), depth: 0 }];
  const visited = new Set();
  const pages = [];

  while (queue.length && pages.length < config.maxPages) {
    const current = queue.shift();
    if (!current || visited.has(current.url)) continue;
    visited.add(current.url);

    try {
      const response = await fetchWithTimeout(current.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      }, config.timeoutMs);

      if (!response.ok) continue;
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > config.maxBytes) continue;

      const html = await response.text();
      if (Buffer.byteLength(html, 'utf8') > config.maxBytes) continue;

      pages.push({
        url: current.url,
        depth: current.depth,
        status: response.status,
        text: stripHtml(html).slice(0, 100000)
      });

      if (current.depth < config.maxDepth) {
        const links = [...html.matchAll(/href\\s*=\\s*["']([^"']+)["']/gi)]
          .map((match) => normalizeUrl(match[1], current.url))
          .filter(Boolean);

        for (const link of links) {
          if (link.origin !== root.origin) continue;
          if (visited.has(link.toString())) continue;
          if (queue.some((item) => item.url === link.toString())) continue;
          queue.push({ url: link.toString(), depth: current.depth + 1 });
          if (queue.length + pages.length >= config.maxPages * 3) break;
        }
      }
    } catch (_) {}
  }

  return { startUrl: root.toString(), pages, crawled: pages.length };
}

app.post(['/api/crawler', '/api/crawl'], async (req, res) => {
  const { url, maxPages, maxDepth } = req.body || {};
  if (!url) return res.status(400).json({ success: false, error: 'url is required' });

  try {
    const result = await crawlSite(url, { maxPages, maxDepth });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ============================================================
// 7. STATUS & HEALTH
// ============================================================

app.get('/api/project', async (_req, res) => {
  try {
    const state = await getProjectState();
    return res.json({ success: true, ...state });
  } catch (error) {
    console.error('[project-state-fatal]', error);
    return res.status(500).json({ success: false, error: 'Project state unavailable' });
  }
});

function storagePathFromFileUrl(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('/files/')) throw new Error('Asset is not a persistent /files/ resource');
  const name = decodeURIComponent(raw.slice('/files/'.length));
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') throw new Error('Invalid persisted asset path');
  return path.join(STORAGE_DIR, name);
}

app.get('/api/render/status', async (_req, res) => {
  try {
    const worker = new RenderWorker();
    return res.json({ success: true, ffmpegAvailable: await worker.available() });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/render/export', async (req, res) => {
  let stitchedVideoPath = null;
  let masteredAudioPath = null;
  let finalExportPath = null;

  try {
    const format = String(req.body?.format || 'master');
    const requestedIds = Array.isArray(req.body?.sceneIds) ? req.body.sceneIds.map(String) : [];
    const state = await getProjectState();
    const scenes = Array.isArray(state.scenes) ? state.scenes : [];
    const selected = scenes.filter(scene =>
      scene?.video &&
      (!requestedIds.length || requestedIds.includes(String(scene.id)))
    );

    if (!selected.length) {
      return res.status(409).json({ success: false, error: 'No persisted video scenes are ready for export' });
    }

    const clips = selected.map(scene => ({
      sceneId: scene.id,
      videoUri: storagePathFromFileUrl(scene.video),
      audioUri: scene.audio ? storagePathFromFileUrl(scene.audio) : null
    }));

    if (clips.some(clip => !clip.audioUri)) {
      return res.status(409).json({ success: false, error: 'Every exported scene must have a persistent audio asset' });
    }

    const bgmPath = path.join(STORAGE_DIR, 'bgm.wav');
    try {
      await access(bgmPath);
    } catch {
      return res.status(409).json({ success: false, error: 'Missing bgm.wav in storage directory for mastering' });
    }

    const stamp = Date.now();
    const suffix = Math.random().toString(36).slice(2, 8);
    const stitchedFilename = 'render_stitched_' + stamp + '_' + suffix + '.mp4';
    const masteredAudioFilename = 'render_mastered_audio_' + stamp + '_' + suffix + '.m4a';
    const finalFilename = 'project_master_' + stamp + '_' + suffix + '.mp4';

    stitchedVideoPath = path.join(STORAGE_DIR, stitchedFilename);
    masteredAudioPath = path.join(STORAGE_DIR, masteredAudioFilename);
    finalExportPath = path.join(STORAGE_DIR, finalFilename);

    const worker = new RenderWorker({ outputDir: STORAGE_DIR });
    if (!(await worker.available())) {
      return res.status(503).json({ success: false, error: 'FFmpeg is not available on the server' });
    }

    const stitchOutputName = path.basename(stitchedVideoPath);
    const plan = buildTimelineFfmpegPlan({
      clips,
      format,
      output: stitchOutputName
    });
    if (!plan.ready) {
      return res.status(409).json({ success: false, error: plan.reason });
    }

    const stitchJob = {
      id: 'stitch_' + stamp,
      settings: { output: stitchOutputName }
    };

    await worker.render(stitchJob, plan);

    let currentDelayMs = 0;
    const timelineAudioItems = selected.map((scene) => {
      const item = {
        filePath: storagePathFromFileUrl(scene.audio),
        startTimeMs: currentDelayMs
      };
      currentDelayMs += Math.max(1, Number(scene.durationMs) || 4000);
      return item;
    });

    await masterSoundtrack(timelineAudioItems, bgmPath, masteredAudioPath);
    await masterFinalVideo(stitchedVideoPath, masteredAudioPath, finalExportPath);

    const buffer = await readFile(finalExportPath);
    const saved = await saveProjectAsset('master', buffer, 'mp4');

    return res.json({
      success: true,
      url: saved.url,
      format,
      sceneCount: selected.length,
      bytes: saved.bytes,
      generatedAt: saved.updatedAt,
      mastering: {
        audio: '320k AAC / 48kHz / stereo / loudnorm',
        video: 'H.264 CRF 17 / veryslow / 24fps / cinematic grade'
      }
    });
  } catch (error) {
    console.error('[render-export-fatal]', error);
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    for (const file of [stitchedVideoPath, masteredAudioPath, finalExportPath]) {
      if (file) await unlink(file).catch(() => {});
    }
  }
});

app.get('/api/mesh/status', (_req, res) => {
  res.json({
    success: true,
    zeroCostMode: !ALLOW_METERED_PROVIDERS,
    meteredProvidersEnabled: ALLOW_METERED_PROVIDERS,
    providers: inferenceProviders.map((p) => ({
      id: p.id,
      costClass: p.cost,
      configured: p.enabled(),
      coolingDown: isProviderCoolingDown(p.id)
    })),
    notes: {
      groq: 'Uses the configured Groq model and the account limits.',
      mistral: 'Free mode provides included monthly usage with limits; pay-as-you-go is controlled by the Mistral account.',
      cerebras: 'Developer API access is available with a free API key; limits are account/service dependent.',
      openrouter: 'Uses openrouter/free by default; free-model availability and limits are provider controlled.',
      gemini: 'Uses gemini-2.5-flash-lite by default; Google documents a free tier with model/account limits.',
      cloudflare: 'Uses Workers AI free allocation when available; requests fail after the free allocation rather than silently switching to paid inference.',
      huggingface: 'Credit/PAYG provider; disabled unless APEX_ALLOW_METERED_PROVIDERS=true.',
      aimlapi: 'Pay-as-you-go provider; disabled unless APEX_ALLOW_METERED_PROVIDERS=true.',
      sambanova: 'Credit/PAYG provider; disabled unless APEX_ALLOW_METERED_PROVIDERS=true.',
      pollinations: 'Keyless final fallback.'
    }
  });
});

app.get(['/health', '/api/health'], (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/health') return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

await initStorage();

app.listen(PORT, HOST, () => {
  console.log(`Apex Studio active on http://${HOST}:${PORT}`);
  console.log(`SE-X persistent asset storage: ${STORAGE_DIR}`);
});
