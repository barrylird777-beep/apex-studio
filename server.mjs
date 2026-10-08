import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';

import { access, readFile, unlink } from 'node:fs/promises';
import { buildTimelineFfmpegPlan } from './src/core/ffmpeg.mjs';
import { masterSoundtrack, masterFinalVideo } from './src/core/mastering.mjs';
import { RenderWorker } from './src/core/render-worker.mjs';
import { CAPACITY, capacitySnapshot } from './src/core/capacity.mjs';
import { initStorage, STORAGE_DIR, getProjectState, saveProjectAsset } from './src/services/projectManager.mjs';
import { GeminiMeshProvider } from './src/core/mesh/gemini-mesh-provider.mjs';
import { ClaudeMeshProvider } from './src/core/mesh/claude-mesh-provider.mjs';
import { MultiAiCoordinator } from './src/core/mesh/multi-ai-coordinator.mjs';
import { durableWorkerEnabled, enqueueWorkerTask, getWorkerTask, queueStats, requeueExpiredWorkerTasks, claimNextWorkerTasks, heartbeatWorkerTask, completeWorkerTask, failWorkerTask } from './src/core/mesh/durable-worker-store.mjs';
import { WorkerSupervisor } from './src/core/mesh/worker-supervisor.mjs';
import { DistributedTileRenderer } from './src/core/vision/distributed-tile-renderer.mjs';
import { createPermanentWorkerFleet, startPermanentWorker, heartbeatPermanentWorker, completePermanentWorkerTask, failPermanentWorkerTask, fleetStatus } from './src/core/mesh/permanent-worker-fleet.mjs';
import { createOverseer, overseerCycle, overseerStatus, overseerTaskFor } from './src/core/mesh/overseer.mjs';
import { createAiCircuitBreakerRegistry } from './src/providers/ai-circuit-breaker.mjs';
import { generateMax, openAiMaxStatus } from './src/providers/openai-max-router.mjs';
import { generateGrok, grokStatus } from './src/providers/grok-router.mjs';
import { generateUnifiedAi, unifiedAiStatus, AI_PROVIDER_CATALOG } from './src/providers/unified-ai-router.mjs';
import { createAiCrewEngine } from './src/core/mesh/ai-crew-engine.mjs';
import { createMassiveAiWorkforce } from './src/core/mesh/massive-ai-workforce.mjs';
import { continuousAiStatus } from './src/core/autonomy/locked-continuous-loop.mjs';
import { createMobileControlPlane } from './src/api/mobile-control-plane.mjs';
import { createPhoneControlPlane } from './src/api/phone-control-plane.mjs';
import { createMusicRadarBridge } from './src/api/music-radar-bridge.mjs';
import { createAudioStationRouter } from './src/api/audio-station.mjs';
import { initializeStudioAdBlock, handleStudioAdBlockDoH, studioAdBlockStatus } from './src/network/studio-adblock-doh.mjs';
import { studioAdBlockMobileConfig } from './src/network/studio-adblock-profile.mjs';
import { classifyNetworkRequest, contentFilterStatus, buildSafariContentBlockerRules } from './src/network/apex-content-filter.mjs';
import { createRogueApDetector } from './src/network/rogue-ap-detector.mjs';
import { createInfiniteBroadcast } from './src/core/infinite-broadcast.mjs';
import { createRealZeroStopProxy, RtmpSessionMultiplexer } from './src/core/real-zero-stop-proxy.mjs';
import { createRelayRouter } from './src/api/relay-routes.mjs';
import { createResearchRouter } from './src/api/research-routes.mjs';
import { FrictionlessResearchEngine } from './src/core/research/frictionless-research-engine.mjs';
import { createRapidCheckout, verifyRapidStripeSignature, decodeRapidCheckoutMetadata } from './src/payments/stripe-rapid.mjs';
import { executeRapidVideoOrder, executeRapidVideoPreview } from './src/workers/rapid-video-worker.mjs';
import { APEX_SURFACES, APEX_UNIVERSAL_CAPABILITIES, APEX_EXECUTION_POLICY } from './src/core/apex-universe.mjs';
import { createTeeVeeProductionRouter } from './src/api/teevee-production-api.mjs';
import { createShieldApex } from './src/core/shield-apex.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const app = express();

app.disable('x-powered-by');
const corsOrigins = String(process.env.APEX_ALLOWED_ORIGINS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const allowAllCors = String(process.env.APEX_ALLOW_ALL_CORS || '').toLowerCase() === 'true'
  || process.env.NODE_ENV !== 'production';
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowAllCors || corsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS origin not allowed'));
  },
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Apex-Control-Token', 'X-Apex-Shortcut-Token', 'X-Apex-Client-Id'],
  maxAge: 600
}));

const shieldApex = createShieldApex({
  allowedOrigins: String(process.env.APEX_ALLOWED_ORIGINS || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean),
  apiKeys: String(process.env.APEX_SHIELD_API_KEYS || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)
});

app.use(express.json({
  limit: CAPACITY.jsonBody,
  type: (req) => !req.path.startsWith('/api/rapid/stripe/webhook')
}));

function timingSafeSecret(expected, supplied) {
  if (!expected || !supplied) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(supplied));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireControlPlaneAuth(req, res, next) {
  const expected = process.env.APEX_SHORTCUT_TOKEN || process.env.APEX_CONTROL_TOKEN;
  if (!expected) return res.status(503).json({ success: false, error: 'Control plane authorization is not configured' });
  const supplied = req.get('x-apex-shortcut-token') || req.get('x-apex-control-token') ||
    req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!timingSafeSecret(expected, supplied)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  return next();
}


const relayDestination = process.env.APEX_RELAY_DEST_ENDPOINT || 'rtmp://127.0.0.1:1935/live/apex-studio';
const relayFallbackFile = process.env.APEX_RELAY_FALLBACK_FILE || path.join(STORAGE_DIR, 'broadcast', 'standby.flv');
const relayAutoStart = String(process.env.APEX_RELAY_AUTOSTART || 'false').toLowerCase() === 'true';

const streamRelay = new RtmpSessionMultiplexer({
  ingestSource: process.env.APEX_RELAY_INGEST_SOURCE || '',
  destination: relayDestination,
  fallbackFile: relayFallbackFile,
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  reconnectMs: Math.max(250, Number(process.env.APEX_RELAY_RECONNECT_MS || 1000)),
  frameIntervalMs: Math.max(10, Number(process.env.APEX_RELAY_FRAME_INTERVAL_MS || 40)),
  autoStart: relayAutoStart
});

app.use('/api/relay', createRelayRouter(streamRelay));

const researchEngine = new FrictionlessResearchEngine();
app.use('/api/research', createResearchRouter(researchEngine));

app.get('/api/workforce/status', (_req, res) => {
  res.status(200).json({
    success: true,
    workforce: massiveAiWorkforce.status(),
    crew: aiCrew.status(),
    fleet: fleetStatus(permanentWorkerFleet)
  });
});

app.post('/api/workforce/burst', requireControlPlaneAuth, async (req, res) => {
  try {
    const requested = Number(req.body?.count ?? permanentWorkerFleet.workers.length);
    const limit = Math.max(1, Math.min(permanentWorkerFleet.workers.length, Number.isFinite(requested) ? Math.floor(requested) : permanentWorkerFleet.workers.length));
    const jobs = await massiveAiWorkforce.dispatchWorkers({
      context: {
        scope: String(req.body?.scope || 'current repository state').slice(0, 2000),
        requirement: String(req.body?.requirement || 'Produce evidence and a verification path; do not claim unperformed work.').slice(0, 2000)
      },
      limit
    });
    return res.status(202).json({
      success: true,
      dispatched: jobs.length,
      workforce: massiveAiWorkforce.status()
    });
  } catch (error) {
    return res.status(503).json({ success: false, error: String(error?.message || error) });
  }
});

app.get('/api/relay/health', (_req, res) => {
  const relay = streamRelay.status();
  const healthy = relay.downstreamConnected && !relay.lastError;
  res.status(healthy ? 200 : 503).json({
    ok: healthy,
    relay
  });
});

const infiniteBroadcast = createInfiniteBroadcast({
  inputDir: process.env.APEX_BROADCAST_INPUT_DIR || path.join(STORAGE_DIR, 'broadcast'),
  rtmpUrl: process.env.APEX_BROADCAST_RTMP_URL || '',
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg'
});

app.use('/api/teevee/production', createTeeVeeProductionRouter({ enqueue: enqueueWorkerTask, requireAuth: requireControlPlaneAuth }));

app.get('/api/shield-apex/status', (_req, res) => {
  res.status(200).json({
    success: true,
    system: 'apex-studio',
    capability: 'ShieldApex',
    role: 'network_security',
    ...shieldApex.status()
  });
});

app.get('/api/apex/readiness', async (_req, res) => {
  try {
    const { listApexApps, assertSixAppInvariant } = await import('./src/apps/apex-six-apps.mjs');
    assertSixAppInvariant();
    const canonical = listApexApps().map(app => ({ id: app.id, name: app.name, role: app.role, entry: app.entry, state: 'runtime-surface' }));
    return res.status(200).json({
      success: true,
      releaseTrain: 'Apex canonical six-app layer',
      canonicalAppCount: canonical.length,
      canonicalApps: canonical,
      supportingSurfaces: [
        { id: 'apex-studio', name: 'Apex Studio', state: 'supporting-system' },
        { id: 'garden-of-apex', name: 'Garden of Apex', state: 'supporting-system' },
        { id: 'kornknob', name: 'KORNKNOB', state: 'supporting-system' }
      ],
      commercial: { state: 'payment-ready-not-live', stripeActivation: 'deferred until business-side readiness' },
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('[apex-readiness]', error);
    return res.status(503).json({ success: false, error: 'Apex readiness unavailable' });
  }
});

app.get('/api/broadcast/status', (_req, res) => res.status(200).json({ success: true, ...infiniteBroadcast.status() }));
app.post('/api/broadcast/start', requireControlPlaneAuth, async (_req, res) => {
  try { return res.status(200).json({ success: true, ...await infiniteBroadcast.start() }); }
  catch (error) { return res.status(503).json({ success: false, error: String(error?.message || error) }); }
});
app.post('/api/broadcast/stop', requireControlPlaneAuth, async (_req, res) => {
  try { return res.status(200).json({ success: true, ...await infiniteBroadcast.stop() }); }
  catch (error) { return res.status(503).json({ success: false, error: String(error?.message || error) }); }
});

const rogueApDetector = createRogueApDetector({
  trusted: String(process.env.APEX_TRUSTED_BSSIDS || '').split(',').map(value => value.trim()).filter(Boolean)
});

let runtimeFault = null;

process.on('uncaughtException', (error) => {
  runtimeFault = {
    type: 'uncaughtException',
    message: String(error?.message || error),
    at: new Date().toISOString()
  };
  console.error('[apex][uncaughtException]', error);
});

process.on('unhandledRejection', (reason) => {
  runtimeFault = {
    type: 'unhandledRejection',
    message: String(reason?.message || reason),
    at: new Date().toISOString()
  };
  console.error('[apex][unhandledRejection]', reason);
});

app.get('/health', (_req, res) => {
  const memory = process.memoryUsage();
  res.status(200).json({
    ok: true,
    status: runtimeFault ? 'degraded' : 'ok',
    uptime: process.uptime(),
    pid: process.pid,
    memory: {
      rss: memory.rss,
      heapTotal: memory.heapTotal,
      heapUsed: memory.heapUsed,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers
    },
    runtimeFault
  });
});

app.get('/api/health', (_req, res) => {
  const memory = process.memoryUsage();
  res.status(200).json({
    ok: true,
    status: runtimeFault ? 'degraded' : 'ok',
    uptime: process.uptime(),
    pid: process.pid,
    memory: {
      rss: memory.rss,
      heapTotal: memory.heapTotal,
      heapUsed: memory.heapUsed,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers
    },
    runtimeFault
  });
});


// Canonical six-app surface registry. These are application surfaces, not additional Apex systems.
app.post('/api/paypex/brief', express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const { createPayPexBrief } = await import('./src/apps/paypex.mjs');
    const brief = createPayPexBrief(req.body || {});
    return res.status(201).json({ success: true, brief });
  } catch (error) {
    return res.status(400).json({ success: false, error: String(error?.message || error) });
  }
});

app.get('/api/apex/apps', async (_req, res) => {
  try {
    const { listApexApps, assertSixAppInvariant } = await import('./src/apps/apex-six-apps.mjs');
    assertSixAppInvariant();
    const apps = listApexApps();
    return res.json({ success: true, count: apps.length, apps, checkedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[apex-apps]', error);
    return res.status(503).json({ success: false, error: 'Apex app registry unavailable' });
  }
});

app.get('/api/apex/apps/:appId/status', async (req, res) => {
  const id = String(req.params.appId || '').trim();
  try {
    const { getApexApp } = await import('./src/apps/apex-six-apps.mjs');
    if (getApexApp(id)) {
      const { canonicalAppStatus } = await import('./src/apps/canonical-six.mjs');
      return res.json(await canonicalAppStatus(id));
    }
    if (id === 'korn-knob') {
      const { kornKnobStatus } = await import('./src/apps/korn-knob.mjs');
      return res.json({ success: true, ...kornKnobStatus() });
    }
    if (id === 'teevee') {
      const { teeveeStatus } = await import('./src/apps/teevee.mjs');
      return res.json({ success: true, ...teeveeStatus() });
    }
    if (id === 'paypex') {
      const { payPexSnapshot, payPexStatus } = await import('./src/apps/paypex.mjs');
      const snapshot = await payPexSnapshot();
      return res.json({ success: true, ...payPexStatus(snapshot), snapshot });
    }
    if (id === 'apex-studio') {
      const { studioStatus } = await import('./src/apps/apex-studio.mjs');
      return res.json({ success: true, ...studioStatus() });
    }
    if (id === 'garden-of-apex') {
      const { gardenStatus } = await import('./src/apps/garden-of-apex.mjs');
      return res.json({ success: true, ...gardenStatus() });
    }
    if (id === 'xshield') {
      const { xshieldStatus } = await import('./src/apps/xshield.mjs');
      return res.json({ success: true, ...xshieldStatus() });
    }
    return res.status(404).json({ success: false, error: 'Unknown Apex app' });
  } catch (error) {
    console.error('[apex-app-status]', id, error);
    return res.status(503).json({ success: false, appId: id, error: 'Apex app status unavailable' });
  }
});

app.get('/api/koin-kob/status', async (_req, res) => {
  try {
    const { koinKobStatus } = await import('./src/apps/koin-kob.mjs');
    return res.json({ success: true, ...koinKobStatus() });
  } catch (error) {
    return res.status(503).json({ success: false, error: String(error?.message || error) });
  }
});

app.post('/api/koin-kob/simulation', requireControlPlaneAuth, async (req, res) => {
  try {
    const { runWorkerEconomySimulation, createSystemicEvent } = await import('./src/apps/koin-kob.mjs');
    const events = Array.isArray(req.body?.events)
      ? req.body.events.map(event => createSystemicEvent(event))
      : [];
    const result = runWorkerEconomySimulation({
      workerCount: req.body?.workerCount ?? 2000,
      factions: req.body?.factions,
      governanceModels: req.body?.governanceModels,
      events
    });
    return res.status(202).json({ success: true, simulation: result });
  } catch (error) {
    return res.status(400).json({ success: false, error: String(error?.message || error) });
  }
});

app.get('/api/canon/apps', async (_req, res) => {
  try {
    const { canonicalAppsStatus } = await import('./src/apps/canonical-six.mjs');
    return res.json({ success: true, apps: await canonicalAppsStatus(), checkedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[canonical-apps]', error);
    return res.status(503).json({ success: false, error: 'Canonical app registry unavailable' });
  }
});

app.get('/api/canon/apps/:appId/status', async (req, res) => {
  try {
    const { canonicalAppStatus } = await import('./src/apps/canonical-six.mjs');
    return res.json(await canonicalAppStatus(req.params.appId));
  } catch (error) {
    const message=String(error?.message||error);
    if(message.startsWith('Unknown Apex app:')) return res.status(404).json({success:false,error:message});
    console.error('[canonical-app-status]',error);
    return res.status(503).json({success:false,error:'Canonical app status unavailable'});
  }
});

const server = app.listen(PORT, HOST, () => {
  console.log(`[apex] server listening on ${HOST}:${PORT}`);
});
server.on('error', (error) => {
  runtimeFault = {
    type: 'listenError',
    message: String(error?.message || error),
    at: new Date().toISOString()
  };
  console.error('[apex][listen-error]', error);
});



app.post('/api/rapid/stripe/webhook', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
  try {
    const event = verifyRapidStripeSignature(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
    if (!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)) return res.json({ received: true, ignored: true });

    const session = event.data?.object || {};
    const metadata = decodeRapidCheckoutMetadata(session.metadata || {});
    const amount = Number(session.amount_total);
    const paid = session.payment_status === 'paid';
    if (!metadata.orderId || String(session.client_reference_id || '') !== metadata.orderId || !paid || amount !== 2500 || String(session.currency || '').toLowerCase() !== 'usd') {
      return res.status(400).json({ received: false, error: 'Invalid Rapid Video payment' });
    }
    if (!durableWorkerEnabled()) return res.status(503).json({ received: false, error: 'Order queue unavailable' });

    const existing = await getWorkerTask(metadata.orderId);
    if (existing) return res.json({ received: true, duplicate: true, orderId: metadata.orderId });

    await enqueueWorkerTask({
      id: metadata.orderId,
      workerId: 'rapid-video-intake',
      role: 'rapid-video',
      task: 'rapid-video-order',
      payload: {
        orderId: metadata.orderId,
        name: metadata.name,
        type: metadata.type,
        brief: metadata.brief,
        platform: metadata.platform,
        email: metadata.email || String(session.customer_details?.email || session.customer_email || ''),
        price: 25,
        paid: true,
        stripeSessionId: String(session.id || ''),
        paidAt: new Date().toISOString()
      },
      maxAttempts: 3,
      dedupeKey: 'rapid-paid:' + metadata.orderId,
      traceId: metadata.orderId
    });
    return res.json({ received: true, queued: true, orderId: metadata.orderId });
  } catch (error) {
    console.error('[rapid-stripe-webhook]', error);
    return res.status(400).json({ received: false, error: error.message || 'Webhook verification failed' });
  }
});


if (durableWorkerEnabled()) {
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
  workers: Math.max(1, Number(process.env.APEX_MESH_WORKERS || 128)),
  handler: async (payload) => {
    const type = String(payload?.type || 'inference');
    if (type === 'inference') {
      const prompt = String(payload?.prompt || '').trim();
      if (!prompt) throw new Error('Worker inference requires prompt');

      // AI crew jobs with an explicit provider/model must execute that exact
      // selection. They never silently fall through to another provider.
      if (payload?.provider) {
        return generateUnifiedAi({
          provider: String(payload.provider),
          model: payload.model ? String(payload.model) : undefined,
          prompt,
          system: String(payload?.system || DEFAULT_SYSTEM)
        });
      }

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
  workers: Math.max(1, Number(process.env.APEX_PERMANENT_WORKER_CONCURRENCY || 128)),
  handler: permanentHealthHandler
});

meshWorkerSupervisor.start();
permanentWorkerSupervisor.start();

const crewRoles = [
  ["network-defense", "Audit network paths, DNS, SSE, failover, rogue-AP telemetry, and client/runtime separation. Produce one concrete fix with evidence criteria."],
  ["adblock", "Audit DNS/content filtering coverage, state reporting, data-path overhead, and iOS behavior. Produce one concrete fix and test."],
  ["sse-reliability", "Audit SSE connection lifecycle, origin policy, heartbeats, capacity, cleanup, and backpressure. Produce one concrete fix and test."],
  ["security", "Attack auth, input validation, secrets, CORS, prototype pollution, upload boundaries, and exposed control planes. Produce one reproducible finding."],
  ["release-gate", "Find the highest-risk blocker preventing a truthful buyer-ready release and define the smallest executable acceptance test."],
  ["runtime", "Audit server startup, imports, route registration, shutdown, uncaught faults, and dependency availability. Produce one concrete runtime fix."],
  ["ui-runtime", "Audit every public UI surface for reachable APIs, error states, mobile behavior, and functional controls. Produce one concrete fix."],
  ["e2e", "Trace one user journey from UI request through backend, worker, media, artifact, and delivery. Identify the first broken boundary."],
  ["storage", "Audit project persistence, atomicity, recovery, corruption resistance, and current Ring-WAL/pure-store direction. Produce one concrete fix."],
  ["workers", "Audit worker supervision, queue fallback, leases, retries, duplicate execution, and shutdown behavior. Produce one concrete fix."],
  ["media", "Audit ingest, probing, asset assembly, FFmpeg, mastering, QC, and artifact delivery. Produce one concrete fix."],
  ["provenance", "Audit source/asset provenance and evidence lineage through production. Identify one gap and acceptance test."],
  ["scripture", "Audit Bible research/source handling, provenance, textual accuracy boundaries, and evidence-backed production handoffs."],
  ["story", "Audit opening hooks, retention, pacing, narrative architecture, and episode structure for one concrete improvement."],
  ["visuals", "Audit cinematic visual generation, continuity, shot planning, style consistency, and 16:9 production readiness."],
  ["audio", "Audit narration, music, SFX, mixing, mastering, synchronization, and KornKnob handoffs."],
  ["rapid", "Audit TeeVee against current final conclusions, customer fulfillment, preview flow, payment/order integrity, and delivery."],
  ["studio", "Audit ApexStudio as the complete production system, Bible-first then Korn, from planning through mastering and delivery."],
  ["garden", "Audit GardenOfApex as the research/knowledge/world-development surface, preserving its separation from ApexStudio."],
  ["kornknob", "Audit KORNKNOB as the audio/music intelligence surface and its capability contracts to other systems."],
  ["architecture", "Audit the three-system boundary, universal capabilities, dependency direction, and forbidden cross-domain coupling."],
  ["performance", "Find the largest CPU, memory, latency, queue, render, or network bottleneck and define a measurable fix."],
  ["observability", "Audit health, metrics, logs, worker state, runtime faults, and evidence needed for release confidence."],
  ["accessibility", "Audit mobile/iPhone controls, keyboard/accessibility semantics, contrast, captions, and failure messaging."],
  ["payments", "Audit Rapid checkout/webhook idempotency, signature verification, price/currency enforcement, and order state."],
  ["provider-routing", "Audit AI provider selection, free-first policy, explicit provider contracts, retries, and no silent paid fallback."],
  ["qa-hostile", "Act as hostile final QA. Find one reproducible defect, missing test, or false-positive readiness signal."],
  ["integration", "Audit boundaries among Garden of Apex, Apex Studio, KORNKNOB, TeeVee, and Special Search."],
  ["documentation", "Audit runtime/config/deployment documentation against actual code and remove misleading operational claims."],
  ["cleanup", "Find dead, duplicated, stale, or contradictory code/config that can damage runtime correctness and define the safest cleanup."],
]

const safeAi = continuousAiStatus();
const crewProvider = safeAi.provider || null;

const crewAssignments = crewRoles.map(([role, task]) => ({
  role,
  task,
  provider: crewProvider || 'openrouter',
  model: crewProvider === 'google'
    ? (process.env.GEMINI_FREE_MODEL || 'gemini-3.8-flash')
    : crewProvider === 'openrouter'
      ? 'openrouter/free'
      : undefined
}));

const aiCrew = createAiCrewEngine({
  concurrency: Math.max(1, Math.min(128, Number(process.env.APEX_AI_CREW_CONCURRENCY || 128))),
  assignments: crewAssignments,
  dispatch: payload => meshWorkerSupervisor.dispatch(payload)
});

const massiveAiWorkforce = createMassiveAiWorkforce({
  fleet: permanentWorkerFleet,
  crew: aiCrew,
  mission: 'Finish Apex through concrete, evidence-backed implementation, testing, and release validation.',
  maxActive: Math.max(1, Number(process.env.APEX_MASSIVE_AI_ACTIVE || 64)),
  batchSize: Math.max(1, Number(process.env.APEX_MASSIVE_AI_BATCH || 128))
});

// Dispatch the whole logical fleet in bounded waves. The fleet may be large,
// but actual provider execution remains bounded by the AI crew and provider
// concurrency controls. This avoids pretending that 1000 OS threads exist.
const massiveAiAutoRun = String(process.env.APEX_MASSIVE_AI_AUTORUN ?? (safeAi.enabled ? 'true' : 'false')).toLowerCase() === 'true';
if (massiveAiAutoRun && safeAi.enabled) {
  void massiveAiWorkforce.dispatchWorkers({
    context: {
      scope: 'current repository state',
      requirement: 'Find a concrete issue or improvement and provide evidence plus a verification path.'
    },
    limit: permanentWorkerFleet.workers.length
  });
}

// The durable worker loop owns continuous AI work. Keep this in-memory burst
// opt-in only so an unavailable provider cannot create a permanent failure storm.
const aiCrewAutoRun = String(process.env.APEX_AI_CREW_AUTORUN ?? (safeAi.enabled ? 'true' : 'false')).toLowerCase() === 'true';
if (aiCrewAutoRun && safeAi.enabled) {
  const crewContext = {
    mission: 'Continuously improve Apex Studio as a Bible intelligence and video-production system.',
    rules: [
      'Find root defects before proposing cosmetic work.',
      'Prefer concrete implementation and tests.',
      'Preserve provenance and distinguish verified facts from inference.',
      'Do not claim files, tests, APIs, or capabilities that are not evidenced.',
      'Surface blockers with a workaround path rather than stopping.'
    ]
  };
  aiCrew.burst(Math.max(1, Math.min(32, Number(process.env.APEX_AI_CREW_INITIAL_BURST || 32))), crewContext);
  const aiCrewPulse = setInterval(() => {
    aiCrew.burst(Math.max(1, Math.min(16, Number(process.env.APEX_AI_CREW_PULSE_SIZE || 8))), crewContext);
  }, Math.max(60000, Number(process.env.APEX_AI_CREW_PULSE_MS || 60000)));
  aiCrewPulse.unref?.();
}


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

    const taskPayload = { type: 'permanent-health', workerId: worker.id, role: worker.role, task };
    void enqueueWorkerTask({
      id: durableTaskId,
      workerId: worker.id,
      role: worker.role,
      task,
      payload: taskPayload
    }).catch(async () => {
      // Keep the swarm alive when durable persistence is unavailable.
      // The durable queue resumes distribution automatically when it returns.
      await permanentWorkerSupervisor.dispatch(taskPayload);
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


// Serve the standalone public app pages before API routes.
app.get('/api/teevee/buyer', (_req, res) => {
  res.status(200).json({
    success: true,
    product: 'TeeVee',
    category: '24/7 original animated entertainment network',
    productionTarget: { episodes: 2785, firstEpisode: 'APX-0001', lastEpisode: 'APX-2785' },
    payment: { state: 'payment-ready-not-live', processor: 'Stripe', activation: 'requires business-side Stripe setup and operating policy' }
  });
});
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/api/network/adblock/content/status', (_req, res) => {
  return res.json(contentFilterStatus(studioAdBlockStatus().blockedDomains));
});

app.get('/api/network/adblock/content/rules', (_req, res) => {
  res.type('application/json').set('Cache-Control', 'no-store');
  return res.send(JSON.stringify(buildSafariContentBlockerRules(), null, 2));
});

app.get('/api/network/adblock/content/classify', (req, res) => {
  const target = String(req.query?.url || '');
  const firstPartyHost = String(req.query?.firstPartyHost || '');
  const resourceType = String(req.query?.resourceType || 'other');
  if (!target) return res.status(400).json({ ok:false, error:'url is required' });
  return res.json({ ok:true, ...classifyNetworkRequest(target, { firstPartyHost, resourceType }) });
});

app.get('/api/network/adblock/profile', (_req, res) => {
  res.type('application/x-apple-aspen-config').set('Content-Disposition', 'attachment; filename="Apex-AdBlock.mobileconfig"');
  return res.send(studioAdBlockMobileConfig());
});

const throughputWindows = new Map();
const throughputWindowMs = 60_000;
const throughputMaxRequestsPerWindow = Math.max(1, Number(process.env.APEX_NETWORK_BENCHMARK_REQUESTS || 4));

function pruneThroughputWindows(now) {
  for (const [ip, state] of throughputWindows) {
    if (now - state.startedAt >= throughputWindowMs) throughputWindows.delete(ip);
  }
  if (throughputWindows.size > 10_000) {
    for (const ip of throughputWindows.keys()) {
      throughputWindows.delete(ip);
      if (throughputWindows.size <= 8_000) break;
    }
  }
}

function allowThroughputProbe(ip) {
  const now = Date.now();
  pruneThroughputWindows(now);
  const current = throughputWindows.get(ip);
  if (!current || now - current.startedAt >= throughputWindowMs) {
    throughputWindows.set(ip, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= throughputMaxRequestsPerWindow) return false;
  current.count += 1;
  return true;
}

app.get('/api/network/throughput', async (req, res) => {
  if (!allowThroughputProbe(req.ip)) {
    return res.status(429).json({ ok: false, error: 'Network benchmark rate limit exceeded' });
  }
  const requestedMiB = Number(req.query?.mib ?? 32);
  const mib = Math.min(64, Math.max(1, Number.isFinite(requestedMiB) ? Math.floor(requestedMiB) : 32));
  const totalBytes = mib * 1024 * 1024;
  const chunk = Buffer.alloc(1024 * 1024);
  let sent = 0;
  res.status(200).set({
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(totalBytes),
    'Cache-Control': 'no-store',
    'X-Apex-Network-Benchmark': 'ingress-throughput',
    'X-Apex-Benchmark-Bytes': String(totalBytes)
  });
  while (sent < totalBytes) {
    const remaining = totalBytes - sent;
    const part = remaining >= chunk.length ? chunk : chunk.subarray(0, remaining);
    if (!res.write(part)) await new Promise(resolve => res.once('drain', resolve));
    sent += part.length;
  }
  res.end();
});

const clientNetworkTelemetry = new Map();
const clientTelemetryMaxEntries = 5000;
const clientTelemetryTtlMs = Math.max(60_000, Number(process.env.APEX_CLIENT_NETWORK_TELEMETRY_TTL_MS || 15 * 60_000));

function normalizeClientId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9._:-]{8,128}$/.test(id) ? id : null;
}

function pruneClientNetworkTelemetry(now = Date.now()) {
  for (const [id, entry] of clientNetworkTelemetry) {
    if (now - entry.receivedAtMs > clientTelemetryTtlMs) clientNetworkTelemetry.delete(id);
  }
  while (clientNetworkTelemetry.size > clientTelemetryMaxEntries) {
    clientNetworkTelemetry.delete(clientNetworkTelemetry.keys().next().value);
  }
}

app.post('/api/network/client-telemetry', (req, res) => {
  const clientId = normalizeClientId(req.get('x-apex-client-id'));
  if (!clientId) return res.status(400).json({ ok: false, error: 'X-Apex-Client-Id is required' });
  const body = req.body || {};
  const telemetry = {
    online:Boolean(body.online),
    type:String(body.type||'unknown').slice(0,32),
    effectiveType:String(body.effectiveType||'unknown').slice(0,32),
    downlinkMbps:Number.isFinite(Number(body.downlinkMbps))?Number(body.downlinkMbps):null,
    rttMs:Number.isFinite(Number(body.rttMs))?Number(body.rttMs):null,
    saveData:Boolean(body.saveData),
    reportedAt:new Date().toISOString(),
    receivedAtMs:Date.now()
  };
  pruneClientNetworkTelemetry(telemetry.receivedAtMs);
  clientNetworkTelemetry.set(clientId, telemetry);
  res.set('Cache-Control','no-store').json({ok:true,receivedAt:telemetry.reportedAt});
});

let networkStatusCache = { expiresAt: 0, value: null };
let networkStatusInFlight = null;
const networkStatusCacheMs = Math.max(1000, Number(process.env.APEX_NETWORK_STATUS_CACHE_MS || 5000));

async function getNetworkFabric() {
  const now = Date.now();
  if (networkStatusCache.value && now < networkStatusCache.expiresAt) return networkStatusCache.value;
  if (networkStatusInFlight) return networkStatusInFlight;
  networkStatusInFlight = (async () => {
    const { selectNetworkPath } = await import('./src/network/path-selector.mjs');
    const value = await selectNetworkPath();
    networkStatusCache = { value, expiresAt: Date.now() + networkStatusCacheMs };
    return value;
  })();
  try {
    return await networkStatusInFlight;
  } finally {
    networkStatusInFlight = null;
  }
}

app.get('/api/network/status', async (req,res)=>{
  try {
    const { buildConnectionPolicy, buildNetworkSpeedPolicy } = await import('./src/network/path-selector.mjs');
    const fabric = await getNetworkFabric();
    const clientId = normalizeClientId(req.get('x-apex-client-id'));
    const clientTelemetry = clientId ? clientNetworkTelemetry.get(clientId) || null : null;
    const healthy = fabric.candidates.filter(p => p.healthy);
    const runtimeObserved = fabric.candidates.length > 0;
    res.set('Cache-Control', 'no-store').json({success:true,status:fabric.selected?'connected':'offline',observedAt:fabric.observedAt,source:fabric.source,selected:fabric.selected,failover:fabric.failover,candidates:fabric.candidates,speed:buildNetworkSpeedPolicy(healthy),policy:buildConnectionPolicy(),planes:{apexRuntime:{status:fabric.selected?'connected':'offline',source:fabric.source},clientDevice:{status:clientTelemetry?(clientTelemetry.online?'online':'offline'):'telemetry-pending',source:'browser-or-mobile-client',telemetry:clientTelemetry},providers:{status:healthy.length?'reachable-from-apex-runtime':'unverified'}},verified:{runtimeInterfacesObserved:runtimeObserved,clientWifiObserved:clientTelemetry?.type==='wifi',clientCellularObserved:['cellular','4g','5g'].includes(String(clientTelemetry?.type)),starlinkObserved:Boolean(fabric.verification?.starlinkVerified),sixGObserved:Boolean(fabric.verification?.sixGVerified)},limitations:['Server-side interface telemetry does not represent the physical network interfaces of the user device.','Browser telemetry cannot reliably expose iPhone Wi-Fi/cellular radio state on all iOS versions.','This service does not bond the iPhone Wi-Fi and cellular modems.'],checkedAt:new Date().toISOString()});
  } catch (error) { res.status(200).json({success:false,status:'degraded',selected:null,candidates:[],failover:[],verified:{runtimeInterfacesObserved:false,clientWifiObserved:false,clientCellularObserved:false},error:error?.message||String(error),checkedAt:new Date().toISOString()}); }
});
app.use('/api/studio/audio', createAudioStationRouter());

app.get('/api/studio/omni/events', async (req, res) => {
  const { omniEventsHandler } = await import('./src/api/omni-events.mjs');
  return omniEventsHandler(req, res);
});
app.use('/api/phone', createPhoneControlPlane({
  getHealth: async () => ({ ok: true, uptime: process.uptime() }),
  getNetwork: async () => {
    const { buildConnectionPolicy, buildNetworkSpeedPolicy } = await import('./src/network/path-selector.mjs');
    const fabric = await getNetworkFabric();
    const healthy = fabric.candidates.filter(path => path.healthy);
    return {
      status: fabric.selected ? 'connected' : 'offline',
      selected: fabric.selected,
      failover: fabric.failover,
      candidates: fabric.candidates,
      speed: buildNetworkSpeedPolicy(healthy),
      policy: buildConnectionPolicy(),
      verified: {
        runtimeInterfacesObserved: Boolean(fabric.selected || fabric.candidates.length),
        clientWifiObserved: false,
        clientCellularObserved: false,
        starlinkObserved: Boolean(fabric.verification?.starlinkVerified),
        sixGObserved: Boolean(fabric.verification?.sixGVerified)
      },
      checkedAt: new Date().toISOString()
    };
  }
}));

const musicRadarBridge = createMusicRadarBridge({
  enqueueWorkerTask,
  getGardenPackage: async () => {
    const { graph } = await gardenSnapshot();
    return {
      graphVersion: "garden-lore-v1",
      packageHash: crypto.createHash("sha256").update(JSON.stringify(graph)).digest("hex"),
      references: ["garden:Apex", "garden:JesusFreaks"]
    };
  }
});

app.get("/api/music-radar/status", async (_req, res) => {
  res.json(await musicRadarBridge.status());
});

app.post("/api/music-radar/handoff", async (req, res) => {
  const expected = String(process.env.APEX_SHORTCUT_TOKEN || "");
  const supplied = String(req.get("x-apex-shortcut-token") || "");
  if (!expected || !supplied || supplied !== expected) {
    return res.status(401).json({ ok: false, error: "Music Radar integration authentication failed" });
  }
  try {
    res.json(await musicRadarBridge.handoff(req.body || {}));
  } catch (error) {
    res.status(400).json({ ok: false, error: error?.message || String(error) });
  }
});

app.use('/api/mobile', createMobileControlPlane({
  getHealth: async () => ({ ok: true, uptime: process.uptime() }),
  getAiStatus: async () => ({ ...unifiedAiStatus(), openai: openAiMaxStatus(), grok: grokStatus() }),
  getCapacity: async () => capacitySnapshot(),
  getWorkers: async () => ({permanent:fleetStatus(permanentWorkerFleet),supervisor:permanentWorkerSupervisor.status(),durable:await queueStats(),aiCrew:aiCrew.status()}),
  getOverseer: async () => overseerStatus(apexOverseer, permanentWorkerFleet),
  getNetwork: async () => {
    const { buildConnectionPolicy, buildNetworkSpeedPolicy } = await import('./src/network/path-selector.mjs');
    const fabric = await getNetworkFabric(); const healthy = fabric.candidates.filter(path => path.healthy);
    return {status:fabric.selected?'connected':'offline',observedAt:fabric.observedAt,source:fabric.source,selected:fabric.selected,failover:fabric.failover,candidates:fabric.candidates,speed:buildNetworkSpeedPolicy(healthy),policy:buildConnectionPolicy(),verified:{
      runtimeInterfacesObserved:Boolean(fabric.selected || fabric.candidates.length),
      clientWifiObserved:false,
      clientCellularObserved:false,
      starlinkObserved:Boolean(fabric.verification?.starlinkVerified),
      sixGObserved:Boolean(fabric.verification?.sixGVerified)
    },checkedAt:new Date().toISOString()};
  },
  generateAi: payload => generateUnifiedAi(payload),
  produceEpisode: async (book, chapter, verses, requestId, contentDomain = "bible") => {
    if (!durableWorkerEnabled()) throw new Error('Durable PostgreSQL worker fabric is unavailable');
    const id = crypto.randomUUID();
    const result = await enqueueWorkerTask({
      id,
      workerId: 'mobile-production-control',
      role: 'production',
      task: 'episode-production',
      payload: { book, chapter, verses, requestId, contentDomain, requestedAt: new Date().toISOString() },
      maxAttempts: 5,
      dedupeKey: `mobile-episode:${book}:${chapter}:${verses}`,
      traceId: requestId
    });
    return {
      requestId,
      jobId: result.id,
      status: 'queued',
      durable: true,
      controlPlane: 'postgresql-worker-fabric'
    };
  }
}));

app.post('/api/rapid/preview', async (req, res) => {
  try {
    const name = String(req.body?.name || 'Preview visitor').trim().slice(0, 120);
    const type = String(req.body?.type || 'Creative proof').trim().slice(0, 160);
    const brief = String(req.body?.brief || '').trim().slice(0, 4000);
    const platform = String(req.body?.platform || 'Short-form social').trim().slice(0, 80);
    if (!brief) return res.status(400).json({ success: false, error: 'brief is required' });
    if (!durableWorkerEnabled()) return res.status(503).json({ success: false, error: 'Preview queue is temporarily unavailable' });
    const orderId = crypto.randomUUID();
    const result = await enqueueWorkerTask({
      id: orderId, workerId: 'rapid-preview-intake', role: 'rapid-preview',
      task: 'rapid-video-preview',
      payload: { orderId, name, type, brief, platform, submittedAt: new Date().toISOString() },
      maxAttempts: 1,
      dedupeKey: `rapid-preview:${crypto.createHash('sha256').update(JSON.stringify({ name, type, brief, platform })).digest('hex')}`,
      traceId: orderId
    });
    return res.status(202).json({ success: true, orderId: result.id, status: 'queued', statusUrl: `/api/rapid/orders/${encodeURIComponent(result.id)}` });
  } catch (error) {
    console.error('[rapid-preview]', error);
    return res.status(500).json({ success: false, error: 'Unable to queue preview' });
  }
});

app.post('/api/rapid/orders', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 120);
    const type = String(req.body?.type || '').trim().slice(0, 160);
    const brief = String(req.body?.brief || '').trim().slice(0, 4000);
    const platform = String(req.body?.platform || 'Other').trim().slice(0, 80);
    const email = String(req.body?.email || '').trim().slice(0, 320).toLowerCase();
    if (!name || !type || !brief || !email) {
      return res.status(400).json({ success: false, error: 'name, type and email are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Enter a valid email address' });
    }
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({ success: false, error: 'Rapid Video checkout is not configured' });
    }
    const orderId = crypto.randomUUID();
    const origin = `${req.headers['x-forwarded-proto'] || req.protocol || 'https'}://${req.get('host')}`;
    const checkout = await createRapidCheckout({
      orderId, name, type, brief, platform, email,
      successUrl: origin + '/rapid-video.html?paid=1&orderId=' + encodeURIComponent(orderId),
      cancelUrl: origin + '/rapid-video.html?canceled=1#order'
    });
    return res.status(201).json({
      success: true,
      orderId,
      status: 'payment_required',
      price: 25,
      checkoutUrl: checkout.url,
      statusUrl: `/api/rapid/orders/${encodeURIComponent(orderId)}`
    });
  } catch (error) {
    console.error('[rapid-order]', error);
    return res.status(502).json({ success: false, error: error.message || 'Unable to create checkout' });
  }
});

app.get('/api/rapid/orders/:id', async (req, res) => {
  try {
    const task = await getWorkerTask(req.params.id);
    if (!task || !['rapid-video-order','rapid-video-preview'].includes(task.task)) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    return res.json({
      success: true,
      orderId: task.id,
      status: task.status,
      attempts: task.attempts,
      maxAttempts: task.max_attempts,
      result: task.result || null,
      error: task.last_error || null,
      createdAt: task.created_at,
      updatedAt: task.updated_at
    });
  } catch (error) {
    console.error('[rapid-order-status]', error);
    return res.status(500).json({ success: false, error: 'Order status unavailable' });
  }
});

app.get('/api/capacity', (_req,res)=>res.json(capacitySnapshot()));
app.get('/api/workers/permanent', (_req,res)=>res.json({
  success:true,
  ...fleetStatus(permanentWorkerFleet),
  supervisor: permanentWorkerSupervisor.status()
}));
app.get('/api/workers/overseer', (_req,res)=>res.json({success:true,overseer:overseerStatus(apexOverseer,permanentWorkerFleet)}));
app.get('/api/workers/durable', async (_req,res)=>{ try { res.json({success:true, queue:await queueStats()}); } catch (error) { res.status(503).json({success:false,error:error?.message||String(error)}); } });

app.get('/api/network/rogue-ap/status', (_req, res) => {
  return res.json({ success: true, detector: rogueApDetector.status() });
});

app.post('/api/network/rogue-ap/trust', (req, res) => {
  try {
    return res.status(200).json({ success: true, ...rogueApDetector.trustBssid(req.body?.bssid) });
  } catch (error) {
    return res.status(400).json({ success: false, error: String(error?.message || error) });
  }
});

app.post('/api/network/rogue-ap/revoke', (req, res) => {
  try {
    return res.status(200).json({ success: true, ...rogueApDetector.revokeBssid(req.body?.bssid) });
  } catch (error) {
    return res.status(400).json({ success: false, error: String(error?.message || error) });
  }
});

app.post('/api/network/rogue-ap/observations', (req, res) => {
  try {
    return res.status(200).json({ success: true, observation: rogueApDetector.observe(req.body || {}) });
  } catch (error) {
    return res.status(400).json({ success: false, error: String(error?.message || error) });
  }
});

app.post('/api/episodes/produce', (_req, res) => {
  return res.status(503).json({ success: false, error: 'Episode pipeline is unavailable in this deployment' });
});

// Titan-protected mutation surfaces are mounted explicitly at the route boundary.
app.use('/api/bible-production', async (req, res, next) => {
  try {
    const { default: router } = await import('./src/api/bible-production.mjs');
    return router(req, res, next);
  } catch (error) {
    console.error('[bible-production] unavailable:', error?.message || error);
    return res.status(503).json({
      success: false,
      error: 'Bible production service unavailable',
      detail: process.env.NODE_ENV === 'production' ? undefined : String(error?.message || error)
    });
  }
});
app.use(express.urlencoded({ extended: true, limit: CAPACITY.urlencodedBody }));
app.get('/korn-knob', async (_req, res) => {
  try {
    return res.sendFile(path.join(__dirname, 'public', 'korn-knob.html'));
  } catch (error) {
    return res.status(500).send('KORN-KNOB UI unavailable');
  }
});
app.get('/rapid-video.html', (_req, res) => res.redirect(308, '/teevee-buyer.html'));
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

const aiCircuitBreakers = createAiCircuitBreakerRegistry({
  failureThreshold: Number(process.env.APEX_AI_FAILURE_THRESHOLD || 5),
  resetTimeoutMs: Number(process.env.APEX_AI_RESET_TIMEOUT_MS || 10000),
  maxResetTimeoutMs: Number(process.env.APEX_AI_MAX_RESET_TIMEOUT_MS || 120000),
  jitterMs: Number(process.env.APEX_AI_JITTER_MS || 2000),
});

function providerHttpError(provider, response, detail) {
  const error = new Error(`${provider} ${response.status}${detail ? `: ${detail}` : ''}`);
  error.status = response.status;
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) error.retryAfterMs = Math.max(0, seconds * 1000);
    else {
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) error.retryAfterMs = Math.max(0, date - Date.now());
    }
  }
  return error;
}

const DEFAULT_SYSTEM =
  'You are Apex Studio production intelligence: research, analytics, scripting utility, audio, video, automation, publishing, experimentation, reliability, security, and operations. Do not invent sources or hidden capabilities.';

async function callOpenAICompatible({ url, apiKey, model, prompt, system, provider, extraHeaders = {}, bodyExtras = {} }) {
  if (!apiKey) throw new Error(provider + ' not configured');

  return aiCircuitBreakers.get(provider).execute(async () => {
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
      throw providerHttpError(provider, response, detail);
    }

    const data = await response.json();
    const output = data?.choices?.[0]?.message?.content;
    if (!output) throw new Error('Empty ' + provider + ' response');
    return String(output).trim();
  });
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
  return aiCircuitBreakers.get('Cohere').execute(async () => {
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
      throw providerHttpError('Cohere', response, detail);
    }
    const data = await response.json();
    const output = data?.message?.content?.map?.((part) => part?.text || '').join('').trim();
    if (!output) throw new Error('Empty Cohere response');
    return output;
  });
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
  if (String(process.env.APEX_FREE_MODE ?? 'true').toLowerCase() !== 'false') throw new Error('Free mode blocks metered media generation; no charge path is permitted');
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

app.post('/api/ai/generate-max', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await generateMax({
      prompt: body.prompt,
      messages: body.messages,
      system: body.system,
      model: body.model,
      previousResponseId: body.previous_response_id || body.previousResponseId,
      schema: body.schema,
      schemaName: body.schema_name || body.schemaName,
      schemaDescription: body.schema_description || body.schemaDescription,
      verbosity: body.verbosity
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    const message = String(error?.message || error);
    const status = /not configured|required|too many|invalid|exceeds|schema/i.test(message) ? 400 : 502;
    console.error('[ai-generate-max]', message);
    return res.status(status).json({ success: false, error: status === 502 ? 'OpenAI generation failed' : message });
  }
});

app.get('/api/ai/generate-max/status', (_req, res) => {
  res.json({ success: true, ...openAiMaxStatus() });
});

app.post('/api/ai/generate-grok', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await generateGrok({
      prompt: body.prompt, messages: body.messages, system: body.system,
      model: body.model, previousResponseId: body.previous_response_id || body.previousResponseId,
      schema: body.schema, schemaName: body.schema_name || body.schemaName,
      schemaDescription: body.schema_description || body.schemaDescription,
      reasoningEffort: body.reasoning_effort || body.reasoningEffort,
      webSearch: body.web_search ?? body.webSearch, xSearch: body.x_search ?? body.xSearch
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    const message = String(error?.message || error);
    const status = /not configured|required|too many|invalid|exceeds|schema/i.test(message) ? 400 : 502;
    console.error('[ai-generate-grok]', message);
    return res.status(status).json({ success: false, error: status === 502 ? 'Grok generation failed' : message });
  }
});

app.get('/api/ai/generate-grok/status', (_req, res) => {
  res.json({ success: true, ...grokStatus() });
});

app.get('/api/apex/universe', (_req, res) => res.json({
  success: true,
  surfaces: APEX_SURFACES,
  capabilities: APEX_UNIVERSAL_CAPABILITIES,
  executionPolicy: APEX_EXECUTION_POLICY,
  localMobile: {
    runtime: "llama.cpp",
    acceleration: "Metal",
    appIntents: true,
    offlineInference: true,
    unrestrictedBackgroundDaemon: false
  }
}));

app.get('/api/ai/catalog', (_req, res) => {
  res.json({ success: true, generatedAt: new Date().toISOString(), providers: getAiCatalog(), categories: getAiCategories() });
});

app.get('/api/ai/providers', (_req, res) => {
  res.json({ success: true, providers: AI_PROVIDER_CATALOG, ...unifiedAiStatus() });
});

app.post('/api/ai/generate/:provider', async (req, res) => {
  try {
    const result = await generateUnifiedAi({ provider: req.params.provider, ...(req.body || {}) });
    return res.json({ success: true, ...result });
  } catch (error) {
    const message = String(error?.message || error);
    const status = /not configured|required|invalid|unknown provider|too many|exceeds|schema/i.test(message) ? 400 : 502;
    console.error('[ai-unified]', req.params.provider, message);
    return res.status(status).json({ success: false, error: status === 502 ? 'AI generation failed' : message });
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

app.get('/api/crew/status', (_req, res) => {
  res.json({ success: true, crew: aiCrew.status(), fleet: fleetStatus(permanentWorkerFleet), overseer: overseerStatus(apexOverseer, permanentWorkerFleet) });
});

app.post('/api/crew/jobs', (req, res) => {
  try {
    const job = aiCrew.enqueue({
      role: req.body?.role,
      task: req.body?.task,
      context: req.body?.context
    });
    res.status(202).json({ success: true, job });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/crew/burst', (req, res) => {
  try {
    const jobs = aiCrew.burst(req.body?.count ?? 32, req.body?.context ?? {});
    res.status(202).json({ success: true, queued: jobs.length, jobs });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
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
      gemini: 'Uses gemini-2.5-flash by default; Google documents a free tier with model/account limits.',
      cloudflare: 'Uses Workers AI free allocation when available; requests fail after the free allocation rather than silently switching to paid inference.',
      huggingface: 'Credit/PAYG provider; disabled unless APEX_ALLOW_METERED_PROVIDERS=true.',
      aimlapi: 'Pay-as-you-go provider; disabled unless APEX_ALLOW_METERED_PROVIDERS=true.',
      sambanova: 'Credit/PAYG provider; disabled unless APEX_ALLOW_METERED_PROVIDERS=true.',
      pollinations: 'Keyless final fallback.'
    }
  });
});

app.get('/api/voiceover/voices', async (_req,res) => {
  try {
    const { listVoiceCatalog } = await import('./src/workers/voiceover-worker.mjs');
    res.json({success:true,voices:await listVoiceCatalog()});
  } catch(error) {
    res.status(503).json({success:false,error:error.message});
  }
});
app.get('/api/voiceover/status', async (_req,res) => {
  try {
    const { voiceoverWorkerStatus } = await import('./src/workers/voiceover-worker.mjs');
    res.json({success:true,...await voiceoverWorkerStatus()});
  } catch(error) {
    res.status(503).json({success:false,error:error.message});
  }
});
app.post('/api/voiceover/jobs', async (req,res) => {
  try {
    const text=String(req.body?.text||'').trim();
    if(!text) return res.status(400).json({success:false,error:'text is required'});
    const { enqueueVoiceoverJob } = await import('./src/workers/voiceover-worker.mjs');
    const id=await enqueueVoiceoverJob(req.body||{}, {priority:Number(req.body?.priority||0)});
    res.status(202).json({success:true,id,status:'queued'});
  } catch(error){ res.status(500).json({success:false,error:error.message}); }
});

app.get('/api/network/adblock/profile', (_req, res) => {
  try {
    const body = studioAdBlockMobileConfig();
    res.writeHead(200, {
      'content-type': 'application/x-apple-aspen-config',
      'content-disposition': 'attachment; filename="Apex-Studio-Ad-Blocker.mobileconfig"',
      'cache-control': 'no-store'
    });
    res.end(body);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'profile generation failed' });
  }
});
app.get('/api/network/adblock/status', (_req, res) => res.status(200).json(studioAdBlockStatus()));
app.all('/api/network/adblock/doh', (req, res) => handleStudioAdBlockDoH(req, res, new URL(req.originalUrl || req.url || '/', 'http://localhost')));

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

void initializeStudioAdBlock().catch(error => console.error('[adblock] initialization failed', error));
if (String(process.env.APEX_BROADCAST_AUTOSTART || 'false').toLowerCase() === 'true') {
  void infiniteBroadcast.start().catch(error => console.error('[broadcast] autostart failed:', error?.message || error));
}


async function runInlineRapidTask(task) {
  const leaseMs = Math.max(15000, Number(process.env.APEX_RAPID_INLINE_LEASE_MS || 45000));
  const heartbeat = setInterval(() => {
    void heartbeatWorkerTask(task.id, leaseMs, task.lease_token).catch(error => {
      console.error('[rapid-inline-worker] heartbeat failed:', error?.message || error);
    });
  }, Math.max(5000, Math.floor(leaseMs / 3)));
  heartbeat.unref?.();
  try {
    const result = task.task === 'rapid-video-preview'
      ? await executeRapidVideoPreview(task.payload || {})
      : await executeRapidVideoOrder(task.payload || {});
    const completed = await completeWorkerTask(task.id, result, task.lease_token);
    if (!completed) console.warn('[rapid-inline-worker] completion fenced out', task.id);
  } catch (error) {
    await failWorkerTask(task.id, error, task.lease_token).catch(failure => {
      console.error('[rapid-inline-worker] failure update failed:', failure?.message || failure);
    });
    console.error('[rapid-inline-worker] task failed:', task.id, error?.message || error);
  } finally {
    clearInterval(heartbeat);
  }
}

if (durableWorkerEnabled()) {
  const rapidInlineLoop = async () => {
    const roles = ['rapid-preview', 'rapid-video'];
    while (true) {
      try {
        let claimedAny = false;
        for (const role of roles) {
          const tasks = await claimNextWorkerTasks(1, 45000, role);
          if (!tasks.length) continue;
          claimedAny = true;
          await runInlineRapidTask(tasks[0]);
        }
        if (!claimedAny) await new Promise(resolve => setTimeout(resolve, 1500));
      } catch (error) {
        console.error('[rapid-inline-worker] poll failed:', error?.message || error);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  };
  void rapidInlineLoop();
}



// Railway autodeploy trigger: keep production deployment tied to main.

// Railway rollout heartbeat: Rapid buyer release.
// buyer-release-trigger-2026-10-07


// EngineApex decision layer: opportunity intelligence stays separate from production.
app.get('/api/korn-knob/status', async (_req, res) => {
  try {
    const { kornKnobStatus } = await import('./src/apps/korn-knob.mjs');
    return res.json({ success: true, ...kornKnobStatus() });
  } catch (error) {
    return res.status(503).json({ success: false, error: error.message });
  }
});

app.post('/api/korn-knob/ideas', async (req, res) => {
  try {
    const { createKornKnobIdea } = await import('./src/apps/korn-knob.mjs');
    const idea = createKornKnobIdea(req.body || {});
    return res.status(201).json({ success: true, idea });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/korn-knob/ideas/evaluate', async (req, res) => {
  try {
    const { createKornKnobIdea } = await import('./src/apps/korn-knob.mjs');
    const idea = createKornKnobIdea(req.body || {});
    return res.status(200).json({
      success: true,
      idea,
      rating: {
        system: "KornKnob",
        type: "movie-potential",
        percent: idea.moviePotentialPercent
      }
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/korn-knob/worker-job', async (req, res) => {
  try {
    const { enqueueWorkerTask } = await import('./src/core/mesh/durable-worker-store.mjs');
    const payload = req.body || {};
    const task = await enqueueWorkerTask({
      task: "kornknob.idea.evaluate",
      role: "kornknob",
      payload
    });
    return res.status(202).json({ success: true, task });
  } catch (error) {
    return res.status(503).json({ success: false, error: error.message });
  }
});

app.get('/api/engine-apex/chat-runtime/state', async (req, res) => {
  try {
    const { getChatRuntimeState } = await import('./src/core/engine-apex-chat-runtime.mjs');
    return res.json({ success: true, ...(await getChatRuntimeState(req.query?.scope || 'default')) });
  } catch (error) {
    console.error('[engine-apex-chat-runtime-state]', error);
    return res.status(503).json({ success: false, error: 'Chat runtime state unavailable' });
  }
});

app.patch('/api/engine-apex/chat-runtime/state', async (req, res) => {
  try {
    const { updateChatRuntimeState } = await import('./src/core/engine-apex-chat-runtime.mjs');
    const result = await updateChatRuntimeState({
      scope: req.body?.scope || 'default',
      patch: req.body?.patch || {},
      expectedVersion: req.body?.expectedVersion ?? null,
      actor: req.body?.actor || 'engine-apex'
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    const status = error?.code === 'RUNTIME_VERSION_CONFLICT' ? 409 : 503;
    return res.status(status).json({
      success: false,
      error: error?.message || 'Chat runtime state update failed',
      ...(error?.currentVersion != null ? { currentVersion: error.currentVersion } : {})
    });
  }
});

app.get('/api/engine-apex/chat-runtime/events', async (req, res) => {
  try {
    const { listChatRuntimeEvents } = await import('./src/core/engine-apex-chat-runtime.mjs');
    return res.json({ success: true, ...(await listChatRuntimeEvents(req.query?.scope || 'default', req.query?.limit)) });
  } catch (error) {
    console.error('[engine-apex-chat-runtime-events]', error);
    return res.status(503).json({ success: false, error: 'Chat runtime events unavailable' });
  }
});

app.post('/api/engine-apex/chat-runtime/events', async (req, res) => {
  try {
    const { recordChatRuntimeEvent } = await import('./src/core/engine-apex-chat-runtime.mjs');
    return res.status(201).json({
      success: true,
      ...(await recordChatRuntimeEvent({
        scope: req.body?.scope || 'default',
        eventType: req.body?.eventType || 'runtime.event',
        payload: req.body?.payload || {},
        actor: req.body?.actor || 'engine-apex'
      }))
    });
  } catch (error) {
    console.error('[engine-apex-chat-runtime-event]', error);
    return res.status(503).json({ success: false, error: 'Chat runtime event unavailable' });
  }
});

app.get('/api/engine-apex/chat-runtime/status', async (_req, res) => {
  try {
    const { getChatRuntimeState } = await import('./src/core/engine-apex-chat-runtime.mjs');
    const snapshot = await getChatRuntimeState('default');
    return res.json({
      success: true,
      engine: 'EngineApex',
      runtime: 'chat',
      durable: snapshot.durable,
      stateVersion: snapshot.version ?? 0,
      stateUpdatedAt: snapshot.updatedAt ?? null,
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    return res.status(503).json({ success: false, engine: 'EngineApex', runtime: 'chat', durable: false, error: 'Chat runtime unavailable', checkedAt: new Date().toISOString() });
  }
});

app.get('/api/engine-apex/snapshot', async (_req, res) => {
  try {
    const { getEngineSnapshot } = await import('./src/core/engine-apex.mjs');
    return res.json({ success: true, ...(await getEngineSnapshot()) });
  } catch (error) {
    console.error('[engine-apex-snapshot]', error);
    return res.status(503).json({ success: false, error: 'EngineApex evidence is unavailable' });
  }
});

app.post('/api/engine-apex/brief', async (req, res) => {
  try {
    const { buildEngineBrief } = await import('./src/core/engine-apex.mjs');
    return res.status(201).json({ success: true, brief: buildEngineBrief(req.body || {}) });
  } catch (error) {
    const message = String(error?.message || error);
    return res.status(400).json({ success: false, error: message });
  }
});

app.get('/api/engine-apex/status', async (_req, res) => {
  try {
    const { getEngineSnapshot } = await import('./src/core/engine-apex.mjs');
    const snapshot = await getEngineSnapshot();
    return res.json({
      success: true,
      engine: 'EngineApex',
      state: snapshot.state,
      opportunityCount: snapshot.opportunities.length,
      handoffs: ['TeeVee', 'Apex Studio'],
      productionSeparated: true,
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    return res.status(503).json({ success: false, engine: 'EngineApex', state: 'unavailable', error: 'EngineApex evidence is unavailable', checkedAt: new Date().toISOString() });
  }
});
