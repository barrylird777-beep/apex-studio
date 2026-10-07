import { spawn } from "node:child_process";
import crypto from "node:crypto";

let processRef = null;
let stopping = false;
let restartTimer = null;
let startedAt = null;
let lastExit = null;
let restartCount = 0;

function enabled() {
  return String(process.env.APEX_SHOWRUNNER_ENABLED || "").toLowerCase() === "true"
    && Boolean(String(process.env.BROADCAST_RTMP_URL || "").trim());
}

function clean(value, fallback) {
  const v = String(value ?? "").trim();
  return v || fallback;
}

function buildArgs() {
  const rtmp = String(process.env.BROADCAST_RTMP_URL || "").trim();
  const title = clean(process.env.BROADCAST_TITLE, "APEX RAPID VIDEO — LIVE");
  const platform = clean(process.env.BROADCAST_PLATFORM, "free-to-air");
  const accent = clean(process.env.BROADCAST_ACCENT, "ff482f").replace(/[^0-9a-f]/gi, "").slice(0, 6) || "ff482f";
  const safeTitle = title.replace(/[':\\]/g, " ").slice(0, 80);
  const safePlatform = platform.replace(/[':\\]/g, " ").slice(0, 40);
  const filter = [
    "drawbox=x=0:y=0:w=iw:h=ih:color=0x070708:t=fill",
    "drawbox=x=80:y=160:w=iw-160:h=5:color=0x" + accent + ":t=fill",
    "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='APEX RAPID VIDEO':fontcolor=white:fontsize=58:x=80:y=245",
    "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='" + safeTitle + "':fontcolor=0xe5bb77:fontsize=42:x=80:y=330",
    "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='LIVE • " + safePlatform + " • FREE-TIER BROADCAST FABRIC':fontcolor=0xb7b4bb:fontsize=28:x=80:y=405",
    "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='MAKE THE IDEA IMPOSSIBLE TO IGNORE.':fontcolor=white:fontsize=62:x='(w-text_w)/2':y='h/2+sin(t/2)*80'",
    "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='Apex Rapid Video • Hook-first creative • 24/7 loop':fontcolor=0x9a979f:fontsize=26:x='(w-text_w)/2':y='h-160'",
    "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='%{localtime\\:%Y-%m-%d %H\\\\:%M\\\\:%S}':fontcolor=0x77747c:fontsize=22:x=80:y='h-90'",
    "vignette=PI/5"
  ].join(",");
  return [
    "-hide_banner","-loglevel","warning",
    "-f","lavfi","-re",
    "-i","color=c=070708:s=1920x1080:r=30",
    "-f","lavfi","-re",
    "-i","sine=frequency=110:sample_rate=48000",
    "-vf",filter,
    "-map","0:v:0","-map","1:a:0",
    "-c:v","libx264","-preset",process.env.BROADCAST_PRESET || "veryfast",
    "-tune","zerolatency","-pix_fmt","yuv420p","-r","30","-g","60",
    "-b:v",process.env.BROADCAST_VIDEO_BITRATE || "2500k",
    "-maxrate",process.env.BROADCAST_MAXRATE || "2800k",
    "-bufsize",process.env.BROADCAST_BUFSIZE || "5000k",
    "-c:a","aac","-b:a",process.env.BROADCAST_AUDIO_BITRATE || "128k",
    "-ar","48000","-f","flv",rtmp
  ];
}

function spawnBroadcast() {
  if (stopping || !enabled() || processRef) return;
  const token = crypto.randomUUID();
  startedAt = new Date().toISOString();
  const child = spawn("ffmpeg", buildArgs(), { stdio: ["ignore","ignore","pipe"] });
  processRef = child;
  console.log("[apex-showrunner] broadcast started", token);
  child.stderr.on("data", data => console.error("[apex-showrunner][ffmpeg]", String(data).trim()));
  child.on("error", error => {
    lastExit = { at: new Date().toISOString(), code: null, signal: null, error: String(error?.message || error) };
  });
  child.on("exit", (code, signal) => {
    processRef = null;
    lastExit = { at: new Date().toISOString(), code, signal };
    restartCount += 1;
    if (!stopping && enabled()) {
      const delay = Math.min(30000, 1000 * (2 ** Math.min(restartCount, 5)));
      restartTimer = setTimeout(() => { restartTimer = null; spawnBroadcast(); }, delay);
      restartTimer.unref?.();
      console.error("[apex-showrunner] broadcast exited; restart scheduled", { code, signal, delay });
    }
  });
}

export function showrunnerStatus() {
  return {
    enabled: enabled(),
    running: Boolean(processRef),
    startedAt,
    restartCount,
    lastExit,
    platform: clean(process.env.BROADCAST_PLATFORM, "unconfigured"),
    transport: String(process.env.BROADCAST_RTMP_URL || "").trim() ? "rtmp" : "unconfigured"
  };
}

export function startFreeBroadcast() {
  if (!enabled()) {
    console.log("[apex-showrunner] idle: set APEX_SHOWRUNNER_ENABLED=true and BROADCAST_RTMP_URL to enable");
    return { enabled: false };
  }
  stopping = false;
  spawnBroadcast();
  return showrunnerStatus();
}

export async function stopFreeBroadcast() {
  stopping = true;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;
  if (!processRef) return;
  const child = processRef;
  await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.kill("SIGTERM");
  });
  processRef = null;
}

export function broadcastEnabledByConfig() {
  return enabled();
}
