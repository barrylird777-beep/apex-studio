import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { generateUnifiedAi } from "../providers/unified-ai-router.mjs";
import { RemoteContentAddressedStore } from "../core/remote-content-addressed-store.mjs";
import { createGuardedFetch, sanitizeOutboundPayload } from "../security/sovereign-outbound-gateway.mjs";

const execFileAsync = promisify(execFile);
const forgeFetch = createGuardedFetch(["gen.pollinations.ai", "api-inference.huggingface.co"]);

const remoteAssetsEnabled = () => String(process.env.APEX_CAS_REMOTE_ENABLED || "").toLowerCase() === "true";
let remoteAssetStore;
function assetStore() {
  if (!remoteAssetStore) remoteAssetStore = new RemoteContentAddressedStore();
  return remoteAssetStore;
}
function renderOutputDir(kind) {
  if (process.env.NODE_ENV === "production" && !remoteAssetsEnabled()) throw new Error("Sovereign video rendering requires remote CAS; local durable output is disabled.");
  return remoteAssetsEnabled()
    ? path.join(tmpdir(), "apex-rapid-video")
    : path.join(process.env.STORAGE_DIR || "/srv/apex/se-x/projects", kind === "preview" ? "previews" : "");
}
async function generateForgeBackground(storyboard, brief, orderId) {
  const provider = String(process.env.APEX_RAPID_IMAGE_PROVIDER || "").trim().toLowerCase();
  if (!provider) return null;
  const sceneText = (storyboard || []).map((scene, index) => "Scene " + (index + 1) + ": " + scene.visualPrompt).join("\n");
  const prompt = sanitizeOutboundPayload({ prompt: [
    "Create one cinematic vertical 9:16 storyboard background for a short-form video.",
    "Dark fantasy anime, sharp cel shading, high-contrast cinematic lighting, detailed environments, strong readable silhouettes.",
    "No words, captions, logos, watermark, or typography.",
    "Core idea: " + brief,
    sceneText
  ].join("\n").slice(0, 7000) }).prompt;
  let response;
  if (provider === "pollinations") {
    const token = String(process.env.POLLINATIONS_API_KEY || "").trim();
    if (!token) throw new Error("POLLINATIONS_API_KEY is required for Pollinations Forge image generation.");
    const model = process.env.POLLINATIONS_IMAGE_MODEL || "flux";
    const url = "https://gen.pollinations.ai/image/" + encodeURIComponent(prompt) + "?" + new URLSearchParams({ model, width: "1080", height: "1920", nologo: "true" });
    response = await forgeFetch(url, { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(90000) });
  } else if (provider === "huggingface") {
    const token = String(process.env.HF_TOKEN || process.env.HUGGINGFACEHUB_API_TOKEN || "").trim();
    if (!token) throw new Error("HF_TOKEN is required for Hugging Face Forge image generation.");
    const configured = String(process.env.APEX_RAPID_HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-dev").trim();
    const model = /realvisxl/i.test(configured) ? "SG161222/RealVisXL_V4.0" : configured;
    response = await forgeFetch("https://api-inference.huggingface.co/models/" + encodeURIComponent(model), {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "image/*" },
      body: JSON.stringify({ inputs: prompt, options: { wait_for_model: true } }),
      signal: AbortSignal.timeout(90000)
    });
  } else {
    throw new Error("APEX_RAPID_IMAGE_PROVIDER must be pollinations or huggingface.");
  }
  if (!response.ok) throw new Error("Forge image provider returned HTTP " + response.status);
  const contentType = String(response.headers.get("content-type") || "");
  if (!contentType.startsWith("image/")) throw new Error("Forge image provider did not return an image.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error("Forge image size is empty or exceeds 15 MiB.");
  const directory = renderOutputDir("preview");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = "rapid_bg_" + String(orderId).replace(/[^A-Za-z0-9_-]/g, "") + (contentType.includes("png") ? ".png" : ".jpg");
  const output = path.join(directory, filename);
  await writeFile(output, bytes, { mode: 0o600, flag: "wx" });
  return output;
}

async function publishVideoAsset(output, orderId, fallbackUrl) {
  if (!remoteAssetsEnabled()) return { url: fallbackUrl, storage: "filesystem-dev", sha256: null };
  try {
    const bytes = await readFile(output);
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    await assetStore().writeRef("rapid_video_assets", orderId, {
      version: 1,
      sha256,
      contentType: "video/mp4",
      sizeBytes: bytes.length,
      base64: bytes.toString("base64"),
      generatedAt: new Date().toISOString()
    });
    return { url: "/api/rapid/assets/" + encodeURIComponent(orderId), storage: "remote-cas", sha256 };
  } finally {
    await unlink(output).catch(() => {});
  }
}

function cleanText(value, fallback = "") {
  return String(value ?? fallback)
    .replace(/[\\:'",;\[\]%=]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function ffmpegText(value, fallback = "") {
  return cleanText(value, fallback).replace(/=/g, " ").slice(0, 180);
}

function wrapText(value, max = 42, lines = 2) {
  const words = ffmpegText(value).split(/\s+/).filter(Boolean);
  const out = [];
  let current = "";
  for (const word of words) {
    const next = current ? current + " " + word : word;
    if (next.length > max && current) {
      out.push(current);
      current = word;
      if (out.length === lines - 1) break;
    } else {
      current = next;
    }
  }
  if (out.length < lines && current) out.push(current);
  return out.length ? out : ["Apex Rapid Video"];
}

function fontPath() {
  return process.env.APEX_VIDEO_FONT
    || "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
}

function paletteFor(seed) {
  const palettes = [
    ["080809", "ff3b22", "e7bd78"],
    ["080a10", "5c7cff", "c7d2ff"],
    ["090b0a", "4fd1a5", "d9f99d"],
    ["0b080d", "b56cff", "f2c4ff"]
  ];
  let hash = 0;
  for (const ch of String(seed || "")) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return palettes[hash % palettes.length];
}

function buildSceneFilters(scenes, duration, palette, brand = "APEX RAPID VIDEO") {
  const [bg, accent, warm] = palette;
  return scenes.map((scene, i) => {
    const start = i * (duration / scenes.length);
    const end = start + (duration / scenes.length);
    const title = ffmpegText(scene[0]);
    const subtitleLines = wrapText(scene[1], 44, 2);
    const n = String(i + 1).padStart(2, "0");
    const angle = i * 1.7;
    return [
      `drawbox=x='-300+500*sin(t/2+${angle})':y='280+100*cos(t/3+${angle})':w=760:h=760:color=0x${accent}@0.12:t=fill:enable='between(t,${start},${end})'`,
      `drawbox=x='650+160*cos(t/2.5+${angle})':y='1000+120*sin(t/2+${angle})':w=620:h=620:color=0x${warm}@0.10:t=fill:enable='between(t,${start},${end})'`,
      `drawtext=fontfile='${fontPath()}':text='${brand}':fontcolor=0x${warm}:fontsize=28:x=70:y=125:enable='between(t,${start},${end})'`,
      `drawtext=fontfile='${fontPath()}':text='${n}':fontcolor=0x${accent}:fontsize=22:x=70:y=165:enable='between(t,${start},${end})'`,
      `drawtext=fontfile='${fontPath()}':text='${title}':fontcolor=white:fontsize=72:x='(w-text_w)/2+20*sin(t*1.7)':y=760:enable='between(t,${start},${end})'`,
      `drawtext=fontfile='${fontPath()}':text='${subtitleLines[0] || ""}':fontcolor=0xd0d0d4:fontsize=38:x='(w-text_w)/2':y=900:enable='between(t,${start},${end})'`,
      `drawtext=fontfile='${fontPath()}':text='${subtitleLines[1] || ""}':fontcolor=0xd0d0d4:fontsize=38:x='(w-text_w)/2':y=950:enable='between(t,${start},${end})'`
    ].join(",");
  }).join(",");
}

function hookScore(value) {
  const text = String(value || "").trim();
  const words = text.split(/\s+/).filter(Boolean);
  const hasQuestion = /\?/.test(text) ? 2 : 0;
  const hasContrast = /\b(but|until|secret|never|truth|why|what if|instead)\b/i.test(text) ? 3 : 0;
  const concise = words.length >= 4 && words.length <= 14 ? 4 : Math.max(0, 4 - Math.abs(words.length - 9) * 0.4);
  const concrete = /\b(you|your|one|first|hidden|lost|last|impossible|real|truth)\b/i.test(text) ? 2 : 0;
  return concise + hasQuestion + hasContrast + concrete;
}

async function generateHook(brief, platform, provider, model) {
  const primaryProvider = provider || process.env.APEX_RAPID_AI_PROVIDER || "openrouter";
  const primaryModel = model || process.env.APEX_ORACLE_MODEL || process.env.APEX_RAPID_AI_MODEL || undefined;
  const requests = [
    { provider: primaryProvider, model: primaryModel, angle: "curiosity gap" },
    ...(process.env.APEX_RAPID_ENABLE_POLLINATIONS === "true" ? [{ provider: "pollinations", model: process.env.POLLINATIONS_MODEL || "openai", angle: "bold contrast" }] : []),
    ...(process.env.APEX_RAPID_ENABLE_GROQ === "true" && process.env.GROQ_API_KEY
      ? [{ provider: "groq", model: process.env.GROQ_MODEL || undefined, angle: "emotional stakes" }] : [])
  ];
  const settled = await Promise.allSettled(requests.map(async request => {
    const result = await generateUnifiedAi({
      provider: request.provider,
      model: request.model,
      system: "You are Oracle, the hook editor for a cinematic short-form studio. Write ONE original opening hook for the requested angle. Max 14 words. No quotes, labels, markdown, or unsupported claims.",
      prompt: "Angle: " + request.angle + "\nIdea: " + brief + "\nPlatform: " + platform,
      temperature: 0.85,
      max_tokens: 100
    });
    const text = cleanText(result.text, "");
    return text ? { text, provider: request.provider, score: hookScore(text) } : null;
  }));
  const candidates = settled.filter(item => item.status === "fulfilled").map(item => item.value).filter(Boolean);
  candidates.sort((a, b) => b.score - a.score);
  return { hook: candidates[0]?.text || "STOP THE SCROLL.", candidates: candidates.map(({text,provider,score}) => ({text,provider,score})), providersTried: requests.map(item => item.provider) };
}

async function generateOracleStoryboard(brief, platform, hook, provider, model) {
  const fallback = [
    { title: hook, dialogue: brief, visualPrompt: "Dark cinematic anime, cel shading, high-contrast rim light, dramatic close-up, vertical 9:16 composition." },
    { title: "THE HIDDEN TURN", dialogue: "Show the choice that changes everything.", visualPrompt: "A vast shadowed environment, one striking silhouette, ember particles, dramatic perspective, dark cinematic anime." },
    { title: "THE CONSEQUENCE", dialogue: "Make the stakes unmistakable.", visualPrompt: "Cinematic wide shot, powerful scale, volumetric light, textured dark-fantasy anime, cel shading." },
    { title: "THE LAST WORD", dialogue: platform + " — the story does not end here.", visualPrompt: "Heroic final frame, clean negative space for captions, strong silhouette, polished anime finish, vertical 9:16." }
  ];
  try {
    const result = await generateUnifiedAi({
      provider: provider || process.env.APEX_RAPID_AI_PROVIDER || "openrouter",
      model: model || process.env.APEX_ORACLE_MODEL || process.env.APEX_RAPID_AI_MODEL || undefined,
      system: "You are Oracle, a storyboard writer. Return valid JSON only with a scenes array of exactly 4 objects. Each object has string fields title, dialogue, visualPrompt. Keep dialogue faithful to the brief. Every visualPrompt must specify dark cinematic anime, cel shading, high-contrast cinematic lighting, and vertical 9:16 framing. No markdown.",
      prompt: "Create a production storyboard. Platform: " + platform + "\nChosen opening hook: " + hook + "\nBrief: " + brief,
      temperature: 0.65,
      max_tokens: 1000
    });
    const parsed = JSON.parse(String(result.text || "").trim());
    const scenes = Array.isArray(parsed.scenes) ? parsed.scenes.slice(0, 4) : [];
    if (scenes.length === 4 && scenes.every(scene => scene && typeof scene.title === "string" && typeof scene.dialogue === "string" && typeof scene.visualPrompt === "string")) {
      return scenes.map(scene => ({ title: cleanText(scene.title, "SCENE"), dialogue: cleanText(scene.dialogue, brief), visualPrompt: String(scene.visualPrompt).slice(0, 500) }));
    }
  } catch {}
  return fallback;
}

function commonVideoArgs(output, duration, vf, backgroundImage = null) {
  return [
    "-y",
    ...(backgroundImage ? ["-loop", "1", "-framerate", "30", "-i", backgroundImage] : ["-f", "lavfi", "-i", `color=c=0x080809:s=1080x1920:r=30:d=${duration}`]),
    "-f", "lavfi",
    "-i", `sine=frequency=110:sample_rate=48000:duration=${duration}`,
    "-vf", vf,
    "-af", `volume=0.04,afade=t=in:st=0:d=0.5,afade=t=out:st=${Math.max(0, duration - 1.5)}:d=1.5`,
    "-c:v", "libx264",
    "-preset", process.env.APEX_VIDEO_PRESET || "veryfast",
    "-crf", process.env.APEX_VIDEO_CRF || "17",
    "-r", process.env.APEX_VIDEO_FPS || "24",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "-t", String(duration),
    output
  ];
}

export async function executeRapidVideoPreview(payload = {}) {
  const name = cleanText(payload.name, "Preview visitor");
  const type = cleanText(payload.type, "Creative proof");
  const brief = cleanText(payload.brief, "Turn this idea into something people want to watch.");
  const platform = cleanText(payload.platform, "Short-form social");
  const orderId = cleanText(payload.orderId, crypto.randomUUID());
  const outputDir = renderOutputDir("preview");
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const filename = "rapid_preview_" + orderId.replace(/[^A-Za-z0-9_-]/g, "") + ".mp4";
  const output = path.join(outputDir, filename);
  const [bg, accent, warm] = paletteFor(brief + platform);
  const hookResult = await generateHook(brief, platform, payload.provider, payload.model);
  const hook = hookResult.hook;
  const storyboard = await generateOracleStoryboard(brief, platform, hook, payload.provider, payload.model);
  const scenes = storyboard.map(scene => [scene.title, scene.dialogue]);
  const base = `scale=1080:1920,format=yuv420p,drawbox=x=0:y=0:w=1080:h=1920:color=0x${bg}:t=fill,`;
  const progress = `drawbox=x=70:y=120:w='940*t/10':h=5:color=0x${accent}:t=fill`;
  const vf = base + buildSceneFilters(scenes, 10, [bg, accent, warm]) + "," + progress + ",vignette=PI/5";
  const backgroundImage = await generateForgeBackground(storyboard, brief, orderId);
  try { await execFileAsync("ffmpeg", commonVideoArgs(output, 10, vf, backgroundImage), { maxBuffer: 1024 * 1024 * 4 }); }
  catch (error) { if (remoteAssetsEnabled()) await unlink(output).catch(() => {}); if (backgroundImage) await unlink(backgroundImage).catch(() => {}); throw error; }
  if (backgroundImage) await unlink(backgroundImage).catch(() => {});
  const asset = await publishVideoAsset(output, orderId, "/files/previews/" + encodeURIComponent(filename));
  return {
    ok: true,
    type: "rapid-video-preview",
    orderId,
    customer: name,
    videoType: type,
    brief,
    platform,
    stage: "rendered",
    pipeline: "oracle-to-forge",
    chosenHook: hook,
    hookCandidates: hookResult.candidates,
    providersTried: hookResult.providersTried,
    storyboard,
    durationSeconds: 10,
    format: "mp4",
    url: asset.url,
    assetStorage: asset.storage,
    assetSha256: asset.sha256,
    generatedAt: new Date().toISOString()
  };
}

export async function executeRapidVideoOrder(payload = {}) {
  const name = cleanText(payload.name, "Apex customer");
  const email = cleanText(payload.email, "");
  const type = cleanText(payload.type, "Short-form video");
  const brief = cleanText(payload.brief, "Turn this idea into something people want to watch.");
  const platform = cleanText(payload.platform, "Other");
  const orderId = cleanText(payload.orderId, crypto.randomUUID());

  const outputDir = renderOutputDir("order");
  await mkdir(outputDir, { recursive: true, mode: 0o700 });

  const filename = "rapid_order_" + orderId.replace(/[^A-Za-z0-9_-]/g, "") + ".mp4";
  const output = path.join(outputDir, filename);
  const hookResult = await generateHook(brief, platform, payload.provider, payload.model);
  const hook = hookResult.hook;
  const storyboard = await generateOracleStoryboard(brief, platform, hook, payload.provider, payload.model);
  const scenes = storyboard.concat([{ title: "READY TO POST.", dialogue: platform + " — Apex Rapid Video", visualPrompt: "Polished dark anime end card, clean negative space." }]).map(scene => [scene.title, scene.dialogue]);
  const [bg, accent, warm] = paletteFor(brief + name);
  const base = `scale=1080:1920,format=yuv420p,drawbox=x=0:y=0:w=1080:h=1920:color=0x${bg}:t=fill,`;
  const progress = `drawbox=x=70:y=120:w='940*t/30':h=5:color=0x${accent}:t=fill`;
  const vf = base + buildSceneFilters(scenes, 30, [bg, accent, warm]) + "," + progress + ",vignette=PI/5";
  const backgroundImage = await generateForgeBackground(storyboard, brief, orderId);
  try { await execFileAsync("ffmpeg", commonVideoArgs(output, 30, vf, backgroundImage), { maxBuffer: 1024 * 1024 * 4 }); }
  catch (error) { if (remoteAssetsEnabled()) await unlink(output).catch(() => {}); if (backgroundImage) await unlink(backgroundImage).catch(() => {}); throw error; }
  if (backgroundImage) await unlink(backgroundImage).catch(() => {});
  const asset = await publishVideoAsset(output, orderId, "/files/" + encodeURIComponent(filename));

  return {
    ok: true,
    type: "rapid-video-order",
    orderId,
    customer: name,
    email,
    videoType: type,
    brief,
    platform,
    stage: "rendered",
    pipeline: "oracle-to-forge",
    chosenHook: hook,
    hookCandidates: hookResult.candidates,
    providersTried: hookResult.providersTried,
    storyboard,
    durationSeconds: 30,
    format: "mp4",
    url: asset.url,
    assetStorage: asset.storage,
    assetSha256: asset.sha256,
    generatedAt: new Date().toISOString()
  };
}

// Rapid buyer smoke gate: validated render path on pull requests.


export async function executeRapidTrendRender(payload = {}) {
  const plan = payload.plan || {};
  const brief = cleanText(plan.concept || payload.trend || "Create an original trend-inspired short video.");
  return executeRapidVideoPreview({
    name: "Apex Trend Swarm",
    type: "Trend-derived creative proof",
    brief: (plan.hook ? String(plan.hook) + " — " : "") + brief,
    platform: "Short-form social",
    orderId: payload.fingerprint || crypto.randomUUID()
  });
}
