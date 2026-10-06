import { spawn } from "node:child_process";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore","pipe","pipe"] });
    let out = "", err = "";
    child.stdout.on("data", c => { out += c.toString(); });
    child.stderr.on("data", c => { err += c.toString(); });
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve(out) : reject(new Error(err || `${command} exited ${code}`)));
  });
}

export async function inspectMedia(path) {
  const raw = await run(process.env.FFPROBE_PATH || "ffprobe", [
    "-v","error","-show_streams","-show_format","-of","json",path
  ]);
  return JSON.parse(raw);
}

export async function runRenderQC({ mediaPath, expectedWidth=1920, expectedHeight=1080, expectedAspect=16/9, expectedDurationSeconds=null, toleranceSeconds=0.25 }) {
  const probe = await inspectMedia(mediaPath);
  const video = probe.streams?.find(s => s.codec_type === "video");
  const audio = probe.streams?.find(s => s.codec_type === "audio");
  const duration = Number(probe.format?.duration || video?.duration || 0);
  const checks = {
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    dimensions: Boolean(video && Number(video.width) === expectedWidth && Number(video.height) === expectedHeight),
    aspectRatio: Boolean(video && Math.abs((Number(video.width)/Number(video.height)) - expectedAspect) < 0.01),
    duration: expectedDurationSeconds == null || Math.abs(duration - Number(expectedDurationSeconds)) <= toleranceSeconds,
    playable: Boolean(probe.format?.format_name)
  };
  const failures = Object.entries(checks).filter(([,ok]) => !ok).map(([name]) => name);
  return { ok: failures.length === 0, checks, failures, duration, streams: probe.streams || [] };
}

export function requireRenderQC(result) {
  if (!result?.ok) throw new Error(`Render QC failed: ${(result?.failures || []).join(", ")}`);
  return result;
}
