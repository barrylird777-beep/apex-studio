import express from 'express';
import cors from 'cors';
import path from 'path';
import dns from 'node:dns/promises';
import net from 'node:net';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

app.disable('x-powered-by');

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
        model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct:free',
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

const inferenceProviders = [
  { id: 'groq', call: callGroq, enabled: () => Boolean(process.env.GROQ_API_KEY) },
  { id: 'openrouter', call: callOpenRouter, enabled: () => Boolean(process.env.OPENROUTER_API_KEY) },
  { id: 'pollinations', call: callPollinationsText, enabled: () => true },
];

async function executeInference(prompt, system = DEFAULT_SYSTEM) {
  const input = String(prompt || '').trim();
  if (!input) throw new Error('Prompt cannot be empty');

  const failures = [];

  for (const provider of inferenceProviders) {
    if (!provider.enabled()) {
      failures.push(`${provider.id}: not configured`);
      continue;
    }

    try {
      const output = await provider.call(input, system);
      return { text: output, provider: provider.id, failures };
    } catch (err) {
      failures.push(`${provider.id}: ${err.message}`);
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
// 4. AUTONOMOUS CRAWLER
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
      const html = await response.text();

      pages.push({
        url: current.url,
        depth: current.depth,
        status: response.status,
        text: stripHtml(html).slice(0, 100000)
      });
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
// 5. STATUS & HEALTH
// ============================================================

app.get('/api/mesh/status', (_req, res) => {
  res.json({
    success: true,
    providers: inferenceProviders.map((p) => ({ id: p.id, configured: p.enabled() }))
  });
});

app.get(['/health', '/api/health'], (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/health') return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Apex Studio active on http://${HOST}:${PORT}`);
});
