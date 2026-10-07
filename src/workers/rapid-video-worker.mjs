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
  const font = fontPath();
  const lines = [
    ["GIVE US ANYTHING.", brief],
    ["MAKE IT WATCHABLE.", "Apex turns the raw idea into a scroll-stopping proof."],
    ["THE HOOK.", "Strong opening. Clear story. Cinematic treatment."],
    ["READY FOR MORE?", platform + " — Apex Studio"]
  ];
  const filters = lines.map((scene, i) => {
    const start = i * 2.5, end = start + 2.5;
    return [
      `drawtext=fontfile='${font}':text='${cleanText(scene[0])}':fontcolor=white:fontsize=76:x=(w-text_w)/2:y=760:enable='between(t,${start},${end})'`,
      `drawtext=fontfile='${font}':text='${cleanText(scene[1])}':fontcolor=white:fontsize=40:x=(w-text_w)/2:y=900:enable='between(t,${start},${end})'`
    ].join(",");
  }).join(",");
  const vf = `scale=1080:1920,format=yuv420p,${filters}`;
  await execFileAsync("ffmpeg", ["-y","-f","lavfi","-i","color=c=black:s=1080x1920:r=30:d=10","-f","lavfi","-i","sine=frequency=110:sample_rate=48000:duration=10","-vf",vf,"-af","volume=0.035,afade=t=in:st=0:d=0.4,afade=t=out:st=8.8:d=1.2","-c:v","libx264","-preset","veryfast","-crf","22","-c:a","aac","-b:a","128k","-movflags","+faststart",output], { maxBuffer: 1024 * 1024 * 4 });
  return { ok:true, type:"rapid-video-preview", orderId, customer:name, videoType:type, brief, platform, stage:"rendered", durationSeconds:10, format:"mp4", url:"/files/previews/"+encodeURIComponent(filename), generatedAt:new Date().toISOString() };
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);

function cleanText(value, fallback = "") {
  return String(value ?? fallback)
    .replace(/[\\:'"]/g, " ")
    .replace(/%/g, " percent ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function fontPath() {
  return process.env.APEX_VIDEO_FONT
    || "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
}

export async function executeRapidVideoOrder(payload = {}) {
  const name = cleanText(payload.name, "Apex GPT");
  const type = cleanText(payload.type, "Short-form video");
  const brief = cleanText(payload.brief, "Cashflow");
  const platform = cleanText(payload.platform, "Other");
  const orderId = cleanText(payload.orderId, crypto.randomUUID());

  const outputDir = process.env.STORAGE_DIR || "/srv/apex/se-x/projects";
  await mkdir(outputDir, { recursive: true, mode: 0o700 });

  const filename = "rapid_order_" + orderId.replace(/[^A-Za-z0-9_-]/g, "") + ".mp4";
  const output = path.join(outputDir, filename);
  const font = fontPath();

  const scenes = [
    ["GPT GOES HARD", brief],
    ["TURN IDEAS INTO CASHFLOW", "Build the offer. Build the content. Ship it."],
    ["HOOK", "Stop the scroll in the first seconds."],
    ["BUILD", "Use AI to move from idea to production faster."],
    ["SHIP", platform + " ready — Apex Rapid Video"]
  ];

  const filters = scenes.map((scene, i) => {
    const start = i * 6;
    const end = start + 6;
    const title = cleanText(scene[0]);
    const subtitle = cleanText(scene[1]);
    return [
      `drawtext=fontfile='${font}':text='${title}':fontcolor=white:fontsize=78:x=(w-text_w)/2:y=760:enable='between(t,${start},${end})'`,
      `drawtext=fontfile='${font}':text='${subtitle}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=900:enable='between(t,${start},${end})'`
    ].join(",");
  }).join(",");

  const vf = `scale=1080:1920,format=yuv420p,${filters}`;
  const args = [
    "-y",
    "-f", "lavfi",
    "-i", "color=c=black:s=1080x1920:r=30:d=30",
    "-f", "lavfi",
    "-i", "sine=frequency=110:sample_rate=48000:duration=30",
    "-vf", vf,
    "-af", "volume=0.035,afade=t=in:st=0:d=0.5,afade=t=out:st=28.5:d=1.5",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "22",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    output
  ];

  await execFileAsync("ffmpeg", args, { maxBuffer: 1024 * 1024 * 4 });

  return {
    ok: true,
    type: "rapid-video-order",
    orderId,
    customer: name,
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
