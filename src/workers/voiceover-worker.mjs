import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { synthesizeSpeech, listVoiceOptions } from "../core/audio-station.mjs";
import { enqueueWorkerTask, getWorkerTask, queueStats } from "../core/mesh/durable-worker-store.mjs";

const STORAGE_PREFIX = "apex-business";
const OUT_DIR = process.env.APEX_VOICEOVER_DIR || path.join(process.env.STORAGE_DIR || "/srv/apex/se-x/projects", "voiceover");

export async function enqueueVoiceoverJob(input = {}, options = {}) {
  const text = String(input.text || "").trim();
  if (!text) throw new Error("text is required");
  const id = String(options.id || input.id || crypto.randomUUID());
  const queued = await enqueueWorkerTask({
    id, workerId: "voiceover", role: "voiceover", task: "voiceover-synthesize",
    payload: { text, provider: String(input.provider || "auto"), voice: input.voice || null,
      language: String(input.language || "en-US"), speed: Number(input.speed || 1),
      pitch: Number(input.pitch || 0), format: input.format === "mp3" ? "mp3" : "wav" },
    maxAttempts: 3, priority: Number(options.priority || input.priority || 0),
    dedupeKey: "voiceover:" + id
  });
  return queued.id;
}

export async function listVoiceCatalog() {
  return (await listVoiceOptions()).map(v => ({ ...v, provider: "local" }));
}

export async function voiceoverWorkerStatus() {
  const stats = await queueStats();
  return { storage: stats.storage || "local-pure-wal", queued: stats.queued || 0,
    running: stats.running || 0, providers: { elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
      google: Boolean(process.env.GOOGLE_TTS_API_KEY), local: true } };
}

function objectStore() {
  const endpoint = String(process.env.APEX_OBJECT_STORAGE_ENDPOINT || "").trim();
  const bucket = String(process.env.APEX_OBJECT_STORAGE_BUCKET || "").trim();
  const accessKeyId = String(process.env.APEX_OBJECT_STORAGE_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.APEX_OBJECT_STORAGE_SECRET_ACCESS_KEY || "").trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error("Voiceover object storage is not configured");
  return { bucket, client: new S3Client({ endpoint, region: String(process.env.APEX_OBJECT_STORAGE_REGION || "auto"),
    forcePathStyle: false, credentials: { accessKeyId, secretAccessKey } }) };
}

async function synth(job) {
  const order = job.provider === "auto" ? String(process.env.APEX_VOICEOVER_PROVIDER_ORDER || "local").split(",").map(v => v.trim()).filter(Boolean) : [job.provider];
  let lastError;
  for (const provider of order) {
    try {
      if (provider === "local") {
        let voice = String(job.voice || process.env.APEX_VOICEOVER_DEFAULT_VOICE || "");
        if (!voice) {
          const voices = await listVoiceOptions();
          voice = voices.find(item => item.engine === "espeak-ng" || item.engine === "espeak")?.id || "";
        }
        if (!voice) throw new Error("No installed local TTS engine found; configure Piper/eSpeak-ng or select a configured cloud provider");
        const result = await synthesizeSpeech({ text: job.text, voice, speed: job.speed,
          pitch: job.pitch, format: job.format, outputDir: OUT_DIR });
        return { provider, path: result.path, format: job.format };
      }
      let bytes;
      if (provider === "elevenlabs" && process.env.ELEVENLABS_API_KEY) {
        const voice = job.voice || process.env.ELEVENLABS_VOICE_ID;
        if (!voice) throw new Error("ElevenLabs voice_id required");
        const response = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(voice) + "?output_format=mp3_44100_192", {
          method: "POST", headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "content-type": "application/json" },
          body: JSON.stringify({ text: job.text, model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
            voice_settings: { speed: Number(job.speed || 1) } }), signal: AbortSignal.timeout(90000) });
        if (!response.ok) throw new Error("ElevenLabs " + response.status);
        bytes = Buffer.from(await response.arrayBuffer());
      } else if (provider === "google" && process.env.GOOGLE_TTS_API_KEY) {
        const response = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize?key=" + encodeURIComponent(process.env.GOOGLE_TTS_API_KEY), {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ input: { text: job.text }, voice: { languageCode: job.language || "en-US",
            name: job.voice || process.env.GOOGLE_TTS_VOICE || "en-US-Neural2-D" },
            audioConfig: { audioEncoding: "MP3", speakingRate: Number(job.speed || 1), pitch: Number(job.pitch || 0) } }),
          signal: AbortSignal.timeout(90000) });
        if (!response.ok) throw new Error("Google TTS " + response.status);
        bytes = Buffer.from((await response.json()).audioContent || "", "base64");
      } else continue;
      if (!bytes || !bytes.length) throw new Error("Voiceover provider returned empty audio");
      await fs.mkdir(OUT_DIR, { recursive: true });
      const file = path.join(OUT_DIR, crypto.randomUUID() + ".mp3");
      await fs.writeFile(file, bytes, { mode: 0o600 });
      return { provider, path: file, format: "mp3" };
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error("No voiceover provider available");
}

export async function executeVoiceoverTask(payload = {}, taskId = crypto.randomUUID()) {
  const text = String(payload.text || "").trim();
  if (!text) throw new Error("Voiceover task has no text");
  const result = await synth({ ...payload, text });
  try {
    const { client, bucket } = objectStore();
    const bytes = await fs.readFile(result.path);
    const extension = result.format === "mp3" ? "mp3" : "wav";
    const key = "voiceover/" + String(taskId).replace(/[^a-zA-Z0-9_-]/g, "") + "." + extension;
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: "mobile/" + STORAGE_PREFIX + "/" + key,
      Body: bytes, ContentLength: bytes.length, ContentType: extension === "mp3" ? "audio/mpeg" : "audio/wav",
      Metadata: { "apex-task-id": String(taskId) } }));
    return { ok: true, taskId: String(taskId), provider: result.provider, storageKey: key,
      storagePrefix: STORAGE_PREFIX, format: extension, bytes: bytes.length, completedAt: new Date().toISOString() };
  } finally { await fs.unlink(result.path).catch(() => {}); }
}

export async function getVoiceoverJob(id) {
  const task = await getWorkerTask(id);
  if (!task || task.task !== "voiceover-synthesize") return null;
  return { id: task.id, status: task.status, result: task.result || null,
    error: task.last_error || null, createdAt: task.created_at || null, updatedAt: task.updated_at || null };
}
