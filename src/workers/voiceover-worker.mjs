import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { apexPureStore } from "../core/apex-pure-store.mjs";
import { synthesizeSpeech, listVoiceOptions } from "../core/audio-station.mjs";

const CONCURRENCY = Math.max(1, Number(process.env.APEX_VOICEOVER_CONCURRENCY || process.env.APEX_JOB_CONCURRENCY || 4));
const POLL_MS = Math.max(250, Number(process.env.APEX_VOICEOVER_POLL_MS || 1000));
const LEASE_MS = Math.max(15000, Number(process.env.APEX_WORKER_LEASE_MS || 45000));
const OUT_DIR = process.env.APEX_VOICEOVER_DIR || path.join(process.env.STORAGE_DIR || "/srv/apex/se-x", "voiceover");
const MAX_ATTEMPTS = Math.max(1, Number(process.env.APEX_VOICEOVER_MAX_ATTEMPTS || 3));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let stopping = false;

function voiceoverPayload(input = {}) {
  const text = String(input.text || "").trim().slice(0, 100000);
  if (!text) throw new TypeError("Voiceover text is required");
  return {
    text,
    provider: String(input.provider || "local").slice(0, 40),
    voice: input.voice ? String(input.voice).slice(0, 200) : null,
    language: String(input.language || "en-US").slice(0, 32),
    speed: Math.max(0.5, Math.min(2, Number(input.speed) || 1)),
    pitch: Math.max(-20, Math.min(20, Number(input.pitch) || 0)),
    format: String(input.format || "wav").toLowerCase().slice(0, 8)
  };
}

export async function enqueueVoiceoverJob(input = {}, options = {}) {
  const store = options.store || apexPureStore;
  const id = String(options.id || input.id || crypto.randomUUID());
  const payload = voiceoverPayload(input);
  const result = await store.enqueue({
    id,
    type: "voiceover.synthesize",
    payload: { ...payload, _apex_worker: { role: "voiceover" } },
    maxAttempts: Math.max(1, Math.min(10, Number(options.maxAttempts || MAX_ATTEMPTS))),
    priority: Number(options.priority || input.priority || 0),
    dedupeKey: options.dedupeKey || input.dedupeKey || null
  });
  return result.id;
}

async function synth(job) {
  const p = voiceoverPayload(job.payload || {});
  if (!p.voice) {
    const voices = await listVoiceOptions();
    p.voice = voices.find(item => item.engine === "espeak-ng" || item.engine === "espeak")?.id || "";
  }
  if (!p.voice) throw new Error("No installed local TTS engine found; install Piper/eSpeak-ng or configure a supported provider");
  await fs.mkdir(OUT_DIR, { recursive: true, mode: 0o700 });
  const result = await synthesizeSpeech({ ...p, outputDir: OUT_DIR });
  const info = await fs.stat(result.path);
  return {
    provider: "local",
    file: result.path,
    bytes: info.size,
    contentType: p.format === "mp3" ? "audio/mpeg" : p.format === "ogg" ? "audio/ogg" : "audio/wav",
    completedAt: new Date().toISOString()
  };
}

async function loop(store = apexPureStore) {
  const workerId = "voiceover-" + crypto.randomUUID();
  while (!stopping) {
    let job = null;
    try {
      const tasks = await store.claim({ workerId, limit: 1, leaseMs: LEASE_MS, role: "voiceover" });
      job = tasks[0] || null;
      if (!job) { await sleep(POLL_MS); continue; }
      const result = await synth(job);
      await store.transition(job.id, "complete", {
        leaseToken: job.leaseToken,
        leaseFence: job.leaseFence,
        result
      });
    } catch (error) {
      if (job) {
        await store.transition(job.id, "fail", {
          leaseToken: job.leaseToken,
          leaseFence: job.leaseFence,
          error,
          reason: String(error?.message || error)
        }).catch(() => {});
      }
      await sleep(POLL_MS);
    }
  }
}

export async function startVoiceoverWorker({ store = apexPureStore } = {}) {
  if (String(process.env.APEX_WORKER_API_URL || "").trim()) {
    throw new Error("Voiceover tasks must run through the authoritative remote Pure-WAL worker; start index.mjs instead.");
  }
  stopping = false;
  await store.init();
  await Promise.all(Array.from({ length: CONCURRENCY }, () => loop(store)));
}

export async function listVoiceCatalog() {
  return (await listVoiceOptions()).map(v => ({ ...v, provider: "local" }));
}

export async function voiceoverWorkerStatus({ store = apexPureStore } = {}) {
  const remoteUrl = String(process.env.APEX_WORKER_API_URL || "").trim().replace(/\\/+$/, "");
  const token = String(process.env.APEX_WORKER_TOKEN || "");
  if (remoteUrl && token) {
    const response = await fetch(new URL("/api/internal/worker/stats", remoteUrl), {
      headers: { "x-apex-worker-token": token },
      signal: AbortSignal.timeout(10000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("Remote Pure-WAL queue status returned " + response.status);
    return {
      durable: true,
      queueOwner: "remote-pure-wal",
      remoteQueueConfigured: true,
      concurrency: CONCURRENCY,
      queued: Number(body.stats?.queued || 0),
      running: Number(body.stats?.running || 0),
      providers: { local: true, elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY), google: Boolean(process.env.GOOGLE_TTS_API_KEY) }
    };
  }
  await store.refresh();
  const jobs = store.jobs().filter(job => job.type === "voiceover.synthesize");
  return {
    durable: true,
    queueOwner: "local-pure-wal",
    remoteQueueConfigured: false,
    concurrency: CONCURRENCY,
    queued: jobs.filter(job => job.status === "queued").length,
    running: jobs.filter(job => job.status === "running").length,
    providers: { local: true, elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY), google: Boolean(process.env.GOOGLE_TTS_API_KEY) }
  };
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { stopping = true; });

if (process.argv[1] && new URL(import.meta.url).pathname === new URL(process.argv[1], "file:").pathname) {
  await startVoiceoverWorker();
}
