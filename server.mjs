import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'node:stream';
import { access, readFile, unlink } from 'node:fs/promises';
import { buildTimelineFfmpegPlan } from './src/core/ffmpeg.mjs';
import { masterSoundtrack, masterFinalVideo } from './src/core/mastering.mjs';
import { RenderWorker } from './src/core/render-worker.mjs';
import { CAPACITY, capacitySnapshot } from './src/core/capacity.mjs';
import { initStorage, STORAGE_DIR, getProjectState, saveProjectAsset } from './src/services/projectManager.mjs';
import { GeminiMeshProvider } from './src/core/mesh/gemini-mesh-provider.mjs';
import { ClaudeMeshProvider } from './src/core/mesh/claude-mesh-provider.mjs';
import { MultiAiCoordinator } from './src/core/mesh/multi-ai-coordinator.mjs';
import { durableWorkerEnabled, ensureWorkerTaskSchema, enqueueWorkerTask, queueStats, requeueExpiredWorkerTasks } from './src/core/mesh/durable-worker-store.mjs';
import { WorkerSupervisor } from './src/core/mesh/worker-supervisor.mjs';
import { DistributedTileRenderer } from './src/core/vision/distributed-tile-renderer.mjs';
import { startProductionDaemon } from './src/workers/av1-production-daemon.mjs';
import { enqueueVoiceoverJob, startVoiceoverWorker, voiceoverWorkerStatus, listVoiceCatalog } from './src/workers/voiceover-worker.mjs';
import bibleProductionRouter from './src/api/bible-production-pg.mjs';
import biblePopcornRouter from './src/api/bible-popcorns.mjs';
import { startPopcornWorker } from './src/workers/popcorn-worker.mjs';
import { createPermanentWorkerFleet, startPermanentWorker, heartbeatPermanentWorker, completePermanentWorkerTask, failPermanentWorkerTask, fleetStatus } from './src/core/mesh/permanent-worker-fleet.mjs';
import { createOverseer, overseerCycle, overseerStatus, overseerTaskFor } from './src/core/mesh/overseer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

if (durableWorkerEnabled()) {
  void ensureWorkerTaskSchema().catch(error => console.error("[worker-store] schema initialization failed", error));
  const reclaimTimer = setInterval(() => { void requeueExpiredWorkerTasks().catch(error => console.error("[worker-store] reclaim failed", error)); }, 15000);
  reclaimTimer.unref?.();
}
const geminiMeshProvider = new GeminiMeshProvider();
const claudeMeshProvider = new ClaudeMeshProvider();
const multiAiCoordinator = new MultiAiCoordinator({ providers: { gemini: geminiMeshProvider, claude: claudeMeshProvider } });
const permanentWorkerFleet = createPermanentWorkerFleet();
const apexOverseer = createOverseer({ intervalMs: Math.max(5000, Number(process.env.APEX_WORKER_HEARTBEAT_MS || 15000)) });
for (const worker of permanentWorkerFleet.workers) {
  Object.assign(worker, startPermanentWorker(worker), {
    nextRunAt: new Date(Date.now() + (Number(worker.id.replace(/\D/g, '').slice(-3) || 0) % 30) * 1000).toISOString(),
    taskStartedAt: null,
    lastCompletedAt: null
  });
}
permanentWorkerFleet.status = 'running';

const permanentHealthHandler = async (payload) => {
  const role = String(payload?.role || 'general');
  const startedAt = Date.now();
  if (['project-storage', 'media-ingest', 'publishing'].includes(role)) {
    await getProjectState();
  } else if (['video-engine', 'export', 'render-cache', 'visual-direction'].includes(role)) {
    await new RenderWorker().available();
  } else if (['voiceover', 'audio-reference'].includes(role)) {
    await voiceoverWorkerStatus();
  } else {
    capacitySnapshot();
  }
  return {
    ok: true,
    workerId: String(payload?.workerId || ''),
    role,
    task: String(payload?.task || ''),
    durationMs: Date.now() - startedAt,
    completedAt: new Date().toISOString()
  };
};

const meshWorkerSupervisor = new WorkerSupervisor({
  workers: Math.max(1, Number(process.env.APEX_MESH_WORKERS || 64)),
  handler: async (payload) => {
    const type = String(payload?.type || 'inference');
    if (type === 'inference') {
      const prompt = String(payload?.prompt || '').trim();
      if (!prompt) throw new Error('Worker inference requires prompt');
      return executeInference(prompt, String(payload?.system || DEFAULT_SYSTEM));
    }
    if (type === 'tile-plan') {
      return DistributedTileRenderer.plan(
        Number(payload?.width || 3840),
        Number(payload?.height || 2160),
        Number(payload?.tileSize || 1080),
        Math.max(1, Number(process.env.APEX_MESH_WORKERS || 4))
      );
    }
    throw new Error('Unknown mesh worker task: ' + type);
  }
});

const permanentWorkerSupervisor = new WorkerSupervisor({
  workers: Math.max(1, Number(process.env.APEX_PERMANENT_WORKER_CONCURRENCY || 64)),
  handler: permanentHealthHandler
});

meshWorkerSupervisor.start();
permanentWorkerSupervisor.start();

const permanentWorkerInFlight = new Set();
const permanentWorkerRunEveryMs = Math.max(30000, Number(process.env.APEX_PERMANENT_WORKER_RUN_MS || 60000));
const permanentWorkerMaxConcurrent = Math.max(1, Number(process.env.APEX_PERMANENT_WORKER_CONCURRENCY || 64));

const permanentWorkerHeartbeat = setInterval(() => {
  const nowMs = Date.now();
  for (const worker of permanentWorkerFleet.workers) {
    const taskStartedMs = Date.parse(worker.taskStartedAt || '');
    const taskTimedOut = permanentWorkerInFlight.has(worker.id)
      && Number.isFinite(taskStartedMs)
      && nowMs - taskStartedMs > apexOverseer.staleAfterMs;

    if (taskTimedOut) {
      const staleToken = worker.taskToken;
      permanentWorkerInFlight.delete(worker.id);
      Object.assign(worker, failPermanentWorkerTask(worker, new Error('Worker task lease expired')));
      worker.lastError = 'Worker task lease expired';
      worker.taskStartedAt = null;
      worker.taskToken = null;
      if (staleToken) worker.lastStaleTaskToken = staleToken;
    }

    if (permanentWorkerInFlight.has(worker.id) || permanentWorkerInFlight.size >= permanentWorkerMaxConcurrent) {
      Object.assign(worker, heartbeatPermanentWorker(worker, worker.currentTask));
      continue;
    }

    const nextRun = Date.parse(worker.nextRunAt || '');
    if (Number.isFinite(nextRun) && nextRun > nowMs) continue;

    const task = overseerTaskFor(worker);
    const taskToken = crypto.randomUUID();
    worker.taskToken = taskToken;
    worker.taskStartedAt = new Date(nowMs).toISOString();
    worker.nextRunAt = new Date(nowMs + permanentWorkerRunEveryMs).toISOString();
    Object.assign(worker, heartbeatPermanentWorker(worker, task));
    permanentWorkerInFlight.add(worker.id);
    const durableTaskId = crypto.randomUUID();

    void enqueueWorkerTask({
      id: durableTaskId,
      workerId: worker.id,
      role: worker.role,
      task,
      payload: { type: 'permanent-health', workerId: worker.id, role: worker.role, task }
    }).then(() => {
      worker.taskStartedAt = null;
      worker.taskToken = null;
      worker.lastQueuedAt = new Date().toISOString();
      permanentWorkerInFlight.delete(worker.id);
    }).catch(error => {
      permanentWorkerInFlight.delete(worker.id);
      if (worker.taskToken !== taskToken) return;
      Object.assign(worker, failPermanentWorkerTask(worker, error));
      worker.lastError = String(error?.message || error);
      worker.taskStartedAt = null;
      worker.taskToken = null;
    });
  }
  Object.assign(apexOverseer, overseerCycle(apexOverseer, permanentWorkerFleet));
}, apexOverseer.intervalMs);
permanentWorkerHeartbeat.unref?.();

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

app.disable('x-powered-by');
app.use(cors());
app.get('/api/capacity', (_req,res)=>res.json(capacitySnapshot()));
app.get('/api/workers/permanent', (_req,res)=>res.json({
  success:true,
  ...fleetStatus(permanentWorkerFleet),
  supervisor: permanentWorkerSupervisor.status()
}));
app.get('/api/workers/overseer', (_req,res)=>res.json({success:true,overseer:overseerStatus(apexOverseer,permanentWorkerFleet)}));
app.get('/api/workers/durable', async (_req,res)=>{ try { res.json({success:true, queue:await queueStats()}); } catch (error) { res.status(503).json({success:false,error:error?.message||String(error)}); } });

app.use(express.json({ limit: CAPACITY.jsonBody }));
app.use('/api/bible-production', bibleProductionRouter);
app.use('/api/bible-popcorns', biblePopcornRouter);
const popcornWorker = process.env.DATABASE_URL ? startPopcornWorker() : null;
app.use(express.urlencoded({ extended: true, limit: CAPACITY.urlencodedBody }));
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
  'You are Apex Studio production intelligence: research, analytics, scripting utility, audio, video, automation, publishing, experimentation, reliability, security, and operations. Do not invent sources or hidden capabilities.';

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
async function callNvidia(prompt, system) {
  return callOpenAICompatible({
    url: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1/chat/completions',
    apiKey: process.env.NVIDIA_API_KEY,
    model: process.env.NVIDIA_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b',
    prompt, system, provider: 'NVIDIA',
    bodyExtras: { max_tokens: 4096 },
  });
}

async function callCohere(prompt, system) {
  if (!process.env.COHERE_API_KEY) throw new Error('Cohere not configured');
  const response = await fetchWithTimeout('https://api.cohere.com/v2/chat', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.COHERE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.COHERE_MODEL || 'command-a-03-2025',
      messages: [
        { role: 'system', content: String(system || DEFAULT_SYSTEM) },
        { role: 'user', content: String(prompt) },
      ],
      temperature: 0.8,
    }),
  }, 15000);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240).replace(/\s+/g, ' ');
    throw new Error(`Cohere ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  const data = await response.json();
  const output = data?.message?.content?.map?.((part) => part?.text || '').join('').trim();
  if (!output) throw new Error('Empty Cohere response');
  return output;
}

async function callOllama(prompt, system) {
  const base = String(process.env.OLLAMA_BASE_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('Ollama not configured');
  const response = await fetchWithTimeout(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || 'qwen3:8b',
      stream: false,
      messages: [
        { role: 'system', content: String(system || DEFAULT_SYSTEM) },
        { role: 'user', content: String(prompt) },
      ],
    }),
  }, 30000);
  if (!response.ok) throw new Error(`Ollama ${response.status}`);
  const data = await response.json();
  const output = data?.message?.content;
  if (!output) throw new Error('Empty Ollama response');
  return String(output).trim();
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

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
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

async function callClaude(prompt, system) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Claude not configured');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: String(system || DEFAULT_SYSTEM),
      messages: [{ role: 'user', content: String(prompt) }],
    }),
  }, 30000);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300).replace(/\\s+/g, ' ');
    throw new Error(`Claude ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  const data = await response.json();
  const output = data?.content?.filter(part => part?.type === 'text').map(part => part.text).join('').trim();
  if (!output) throw new Error('Empty Claude response');
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
  { id: 'nvidia-free', cost: 'free', call: callNvidia, enabled: () => Boolean(process.env.NVIDIA_API_KEY) },
  { id: 'cohere-free', cost: 'free', call: callCohere, enabled: () => Boolean(process.env.COHERE_API_KEY) },
  { id: 'ollama-local', cost: 'free', call: callOllama, enabled: () => Boolean(process.env.OLLAMA_BASE_URL) },
  { id: 'groq-free', cost: 'free', call: callGroq, enabled: () => Boolean(process.env.GROQ_API_KEY) },
  { id: 'mistral-free', cost: 'free', call: callMistral, enabled: () => Boolean(process.env.MISTRAL_API_KEY) },
  { id: 'cerebras-free', cost: 'free', call: callCerebras, enabled: () => Boolean(process.env.CEREBRAS_API_KEY) },
  { id: 'openrouter-free', cost: 'free', call: callOpenRouter, enabled: () => Boolean(process.env.OPENROUTER_API_KEY) },
  { id: 'gemini-free', cost: 'free', call: callGemini, enabled: () => Boolean(process.env.GEMINI_API_KEY) },
  { id: 'cloudflare-free', cost: 'free', call: callCloudflare, enabled: () => Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) },
  { id: 'pollinations', cost: 'free', call: callPollinationsText, enabled: () => true },
  { id: 'claude', cost: 'metered', call: callClaude, enabled: () => Boolean(process.env.ANTHROPIC_API_KEY) },
  { id: 'huggingface-metered', cost: 'metered', call: callHuggingFace, enabled: () => Boolean(process.env.HF_TOKEN) },
  { id: 'aimlapi-metered', cost: 'metered', call: callAimlapi, enabled: () => Boolean(process.env.AIMLAPI_API_KEY) },
  { id: 'sambanova-metered', cost: 'metered', call: callSambaNova, enabled: () => Boolean(process.env.SAMBANOVA_API_KEY) },
];

const requestedOrder = String(process.env.APEX_INFERENCE_ORDER || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const defaultInferenceOrder = [
  'gemini-free',
  'claude',
  'nvidia-free',
  'cohere-free',
  'ollama-local',
  'groq-free',
  'mistral-free',
  'cerebras-free',
  'openrouter-free',
  'cloudflare-free',
  'pollinations',
  'huggingface-metered',
  'aimlapi-metered',
  'sambanova-metered'
];

const inferenceProviders = (requestedOrder.length ? requestedOrder : defaultInferenceOrder)
  .map((id) => allInferenceProviders.find((provider) => provider.id === id))
  .filter(Boolean);

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

async function checkInferenceSwarmHealth() {
  const configuredProviders = inferenceProviders.filter((provider) => provider.enabled());
  const availableProviders = configuredProviders.filter((provider) => !isProviderCoolingDown(provider.id));

  if (availableProviders.length === 0) throw new Error('Inference swarm has no available providers');
  if (!meshWorkerSupervisor.started) throw new Error('Inference mesh supervisor is not running');

  return { ok: true, configuredProviders: configuredProviders.length, availableProviders: availableProviders.length };
}

function triggerSwarmFallback(error) {
  console.error('[supervisor] inference swarm unhealthy:', error?.message || String(error));
  if (!meshWorkerSupervisor.started) meshWorkerSupervisor.start();
  for (const provider of inferenceProviders) {
    if (provider.enabled()) providerCooldowns.delete(provider.id);
  }
}

global.checkInferenceSwarmHealth = checkInferenceSwarmHealth;
global.triggerSwarmFallback = triggerSwarmFallback;

const SUPERVISOR_INTERVAL = 1000;
const SUPERVISOR_TIMEOUT = 2500;
global.isSupervisorBusy = false;

const supervisorHeartbeat = setInterval(async () => {
  if (global.isSupervisorBusy) return;
  global.isSupervisorBusy = true;
  let timeoutId;
  try {
    await Promise.race([
      Promise.resolve(global.checkInferenceSwarmHealth?.()),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Supervisor health-check timeout')), SUPERVISOR_TIMEOUT);
      })
    ]);
  } catch (error) {
    try {
      await Promise.resolve(global.triggerSwarmFallback?.(error));
    } catch (fallbackError) {
      console.error('[supervisor] fallback failed:', fallbackError);
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    global.isSupervisorBusy = false;
  }
}, SUPERVISOR_INTERVAL);
supervisorHeartbeat.unref?.();

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
// 6. STATUS & HEALTH
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

app.post('/api/ai/generate', async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ success: false, error: 'prompt is required' });
  const requested = String(req.body?.provider || '').trim();
  const system = String(req.body?.system || DEFAULT_SYSTEM);
  try {
    if (requested === 'gemini') {
      const text = await geminiMeshProvider.generate(prompt, { system });
      return res.json({ success: true, provider: 'gemini', model: geminiMeshProvider.model, text });
    }
    if (requested === 'claude') {
      const model = String(req.body?.model || claudeMeshProvider.model);
      const text = await claudeMeshProvider.generate(prompt, { system, model });
      return res.json({ success: true, provider: 'claude', model, text });
    }
    const result = await executeInference(prompt, system);
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(502).json({ success: false, error: error.message, provider: requested || 'mesh' });
  }
});

app.post('/api/ai/collaborate', async (req, res) => {
  const task = String(req.body?.task || req.body?.prompt || '').trim();
  if (!task) return res.status(400).json({ success: false, error: 'task is required' });

  const requestedProviders = Array.isArray(req.body?.providers) && req.body.providers.length
    ? req.body.providers
    : ['gemini', 'claude'];

  try {
    const result = await multiAiCoordinator.run({
      task,
      providers: requestedProviders,
      system: String(req.body?.system || DEFAULT_SYSTEM),
      context: req.body?.context && typeof req.body.context === 'object' ? req.body.context : {}
    });

    return res.status(result.ok ? 200 : 503).json({ success: result.ok, ...result });
  } catch (error) {
    return res.status(502).json({ success: false, error: error.message });
  }
});

app.get('/api/ai/status', (_req, res) => res.json({
  success: true,
  gemini: {
    configured: Boolean(process.env.GEMINI_API_KEY),
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  },
  claude: {
    configured: Boolean(process.env.ANTHROPIC_API_KEY),
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5'
  },
  mesh: {
    configuredProviders: inferenceProviders.filter(p => p.enabled()).map(p => p.id)
  }
}));

app.post('/api/mesh/jobs', async (req, res) => {
  try {
    if (!meshWorkerSupervisor.started) meshWorkerSupervisor.start();
    const result = await meshWorkerSupervisor.dispatch(req.body || {});
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return res.status(502).json({ success: false, error: error.message });
  }
});

app.get('/api/mesh/workers', (_req, res) => {
  res.json({ success: true, ...meshWorkerSupervisor.status() });
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
      gemini: 'Uses gemini-2.5-flash by default; Google documents a free tier with model/account limits.',
      cloudflare: 'Uses Workers AI free allocation when available; requests fail after the free allocation rather than silently switching to paid inference.',
      huggingface: 'Credit/PAYG provider; disabled unless APEX_ALLOW_METERED_PROVIDERS=true.',
      aimlapi: 'Pay-as-you-go provider; disabled unless APEX_ALLOW_METERED_PROVIDERS=true.',
      sambanova: 'Credit/PAYG provider; disabled unless APEX_ALLOW_METERED_PROVIDERS=true.',
      pollinations: 'Keyless final fallback.'
    }
  });
});

app.get('/api/voiceover/voices', async (_req,res) => { try { res.json({success:true,voices:await listVoiceCatalog()}); } catch(error){ res.status(500).json({success:false,error:error.message}); } });
app.get('/api/voiceover/status', async (_req,res) => {
  try { res.json({success:true,...await voiceoverWorkerStatus()}); }
  catch(error){ res.status(500).json({success:false,error:error.message}); }
});
app.post('/api/voiceover/jobs', async (req,res) => {
  try {
    const text=String(req.body?.text||'').trim();
    if(!text) return res.status(400).json({success:false,error:'text is required'});
    const id=await enqueueVoiceoverJob(req.body||{}, {priority:Number(req.body?.priority||0)});
    res.status(202).json({success:true,id,status:'queued'});
  } catch(error){ res.status(500).json({success:false,error:error.message}); }
});

app.get(['/health', '/api/health'], (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Decentralized swarm routing fallback & retry wrapper
async function routeWithSwarm(payload, retries = 2) {
  const providers = ['groq', 'openrouter', 'pollinations', 'gemini'];
  for (const provider of providers) {
    try {
      return await executeInference(provider, payload);
    } catch (e) {
      if (retries === 0) continue;
    }
  }
  throw new Error('All swarm nodes failed');
}

app.listen(PORT, HOST, () => console.log(`[apex] server listening on ${HOST}:${PORT}`));
