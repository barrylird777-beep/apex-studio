import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);

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

function commonVideoArgs(output, duration, vf) {
  return [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=0x080809:s=1080x1920:r=30:d=${duration}`,
    "-f", "lavfi",
    "-i", `sine=frequency=110:sample_rate=48000:duration=${duration}`,
    "-vf", vf,
    "-af", `volume=0.04,afade=t=in:st=0:d=0.5,afade=t=out:st=${Math.max(0, duration - 1.5)}:d=1.5`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    output
  ];
}

export async function executeRapidVideoPreview(payload = {}) {
  const name = cleanText(payload.name, "Preview visitor");
  const type = cleanText(payload.type, "Creative proof");
  const brief = cleanText(payload.brief, "Turn this idea into something people want to watch.");
  const platform = cleanText(payload.platform, "Short-form social");
  const orderId = cleanText(payload.orderId, crypto.randomUUID());
  const outputDir = path.join(process.env.STORAGE_DIR || "/srv/apex/se-x/projects", "previews");
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const filename = "rapid_preview_" + orderId.replace(/[^A-Za-z0-9_-]/g, "") + ".mp4";
  const output = path.join(outputDir, filename);
  const [bg, accent, warm] = paletteFor(brief + platform);
  const scenes = [
    ["STOP THE SCROLL.", brief],
    ["MAKE IT WATCHABLE.", "Apex turns the raw idea into a sharp visual direction."],
    ["THE HOOK.", "Clear story. Fast pacing. A reason to keep watching."],
    ["READY FOR MORE?", platform + " — full production is one click away."]
  ];
  const base = `scale=1080:1920,format=yuv420p,drawbox=x=0:y=0:w=1080:h=1920:color=0x${bg}:t=fill,`;
  const progress = `drawbox=x=70:y=120:w='940*t/10':h=5:color=0x${accent}:t=fill`;
  const vf = base + buildSceneFilters(scenes, 10, [bg, accent, warm]) + "," + progress + ",vignette=PI/5";
  await execFileAsync("ffmpeg", commonVideoArgs(output, 10, vf), { maxBuffer: 1024 * 1024 * 4 });
  return {
    ok: true,
    type: "rapid-video-preview",
    orderId,
    customer: name,
    videoType: type,
    brief,
    platform,
    stage: "rendered",
    durationSeconds: 10,
    format: "mp4",
    url: "/files/previews/" + encodeURIComponent(filename),
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

  const outputDir = process.env.STORAGE_DIR || "/srv/apex/se-x/projects";
  await mkdir(outputDir, { recursive: true, mode: 0o700 });

  const filename = "rapid_order_" + orderId.replace(/[^A-Za-z0-9_-]/g, "") + ".mp4";
  const output = path.join(outputDir, filename);
  const scenes = [
    ["YOUR IDEA.", brief],
    ["BUILD THE HOOK.", "Open hard. Give the viewer a reason to stay."],
    ["BUILD THE STORY.", "Turn the core idea into a fast, clear visual sequence."],
    ["MAKE IT FEEL BIG.", "Cinematic motion, strong typography, music and pacing."],
    ["READY TO POST.", platform + " — Apex Rapid Video"]
  ];
  const [bg, accent, warm] = paletteFor(brief + name);
  const base = `scale=1080:1920,format=yuv420p,drawbox=x=0:y=0:w=1080:h=1920:color=0x${bg}:t=fill,`;
  const progress = `drawbox=x=70:y=120:w='940*t/30':h=5:color=0x${accent}:t=fill`;
  const vf = base + buildSceneFilters(scenes, 30, [bg, accent, warm]) + "," + progress + ",vignette=PI/5";
  await execFileAsync("ffmpeg", commonVideoArgs(output, 30, vf), { maxBuffer: 1024 * 1024 * 4 });

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
    durationSeconds: 30,
    format: "mp4",
    url: "/files/" + encodeURIComponent(filename),
    generatedAt: new Date().toISOString()
  };
}
