import { spawn } from "node:child_process";
import { once } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const OUTPUT_BUCKET = process.env.APEX_OBJECT_STORE_BUCKET || process.env.S3_BUCKET || "";
const OUTPUT_PREFIX = (process.env.APEX_AV1_OUTPUT_PREFIX || "av1/").replace(/^\/+|\/+$/g, "");
const REGION = process.env.AWS_REGION || process.env.S3_REGION || "auto";
const ENDPOINT = process.env.APEX_OBJECT_STORE_ENDPOINT || process.env.S3_ENDPOINT || "";
const FORCE_PATH_STYLE = /^(1|true|yes)$/i.test(process.env.APEX_S3_FORCE_PATH_STYLE || "true");

function objectClient() {
  if (!OUTPUT_BUCKET) throw new Error("APEX_OBJECT_STORE_BUCKET or S3_BUCKET is required");
  return new S3Client({ region: REGION, endpoint: ENDPOINT || undefined, forcePathStyle: FORCE_PATH_STYLE });
}

function splitS3Url(value) {
  const u = new URL(value);
  if (u.protocol !== "s3:") return null;
  return { bucket: u.hostname, key: decodeURIComponent(u.pathname.replace(/^\//, "")) };
}

function bodyToNodeStream(body) {
  if (!body) throw new Error("Input has no body");
  if (typeof body.pipe === "function") return body;
  if (typeof body.transformToWebStream === "function") return Readable.fromWeb(body.transformToWebStream());
  throw new Error("Unsupported object-store body stream");
}

async function openInput(input) {
  const s3 = splitS3Url(input);
  if (!s3) {
    const response = await fetch(input);
    if (!response.ok) throw new Error(`Input fetch failed: HTTP ${response.status}`);
    return bodyToNodeStream(response.body);
  }
  const result = await objectClient().send(new GetObjectCommand({ Bucket: s3.bucket, Key: s3.key }));
  return bodyToNodeStream(result.Body);
}

function ffmpegArgs(job) {
  const p = job.payload || {};
  const input = p.input_url || p.inputUrl;
  if (!input) throw new Error("Job requires input_url");
  const fps = Math.max(1, Math.min(120, Number(p.fps || 24)));
  const crf = Math.max(0, Math.min(63, Number(p.crf ?? 30)));
  const cpu = Math.max(0, Math.min(13, Number(p.cpuUsed ?? 4)));
  const width = p.width ? Math.max(16, Number(p.width)) : null;
  const height = p.height ? Math.max(16, Number(p.height)) : null;
  const scale = width && height ? ["-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`] : [];
  const format = String(p.format || "mp4").toLowerCase() === "webm" ? "webm" : "mp4";
  const common = ["-hide_banner","-loglevel","error","-i","pipe:0","-map","0:v:0","-an","-c:v","libsvtav1","-crf",String(crf),"-preset",String(cpu),"-r",String(fps),...scale];
  return format === "webm"
    ? { input, format, args: [...common,"-f","webm","pipe:1"] }
    : { input, format, args: [...common,"-pix_fmt","yuv420p","-movflags","frag_keyframe+empty_moov+default_base_moof","-f","mp4","pipe:1"] };
}

async function streamToObjectStore(readable, key, contentType) {
  const body = new PassThrough();
  const upload = new Upload({
    client: objectClient(),
    params: { Bucket: OUTPUT_BUCKET, Key: key, Body: body, ContentType: contentType },
    queueSize: 1,
    partSize: 8 * 1024 * 1024,
    leavePartsOnError: false
  });
  const resultPromise = upload.done();
  readable.on("error", error => body.destroy(error));
  readable.pipe(body);
  return resultPromise;
}

export async function encodeAv1Job(job) {
  const spec = ffmpegArgs(job);
  const input = await openInput(spec.input);
  const ffmpeg = spawn(FFMPEG, spec.args, { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  let bytes = 0;
  ffmpeg.stderr.on("data", chunk => {
    stderr += chunk.toString();
    if (stderr.length > 12000) stderr = stderr.slice(-12000);
  });
  ffmpeg.stdout.on("data", chunk => { bytes += chunk.length; });

  const inputDone = new Promise((resolve, reject) => {
    input.once("error", reject);
    ffmpeg.stdin.once("error", reject);
    ffmpeg.stdin.once("finish", resolve);
    input.pipe(ffmpeg.stdin);
  });

  const key = `${OUTPUT_PREFIX ? OUTPUT_PREFIX + "/" : ""}${job.id}.${spec.format}`;
  const outputPromise = streamToObjectStore(
    ffmpeg.stdout,
    key,
    spec.format === "webm" ? "video/webm" : "video/mp4"
  );

  await inputDone;
  ffmpeg.stdin.end();
  const [exit] = await once(ffmpeg, "close");
  const upload = await outputPromise;
  if (exit !== 0) throw new Error(`ffmpeg exited ${exit}: ${stderr.trim()}`);
  return { key, bucket: OUTPUT_BUCKET, bytes, etag: upload?.ETag || null };
}

export async function handleAv1Job(job) {
  return encodeAv1Job(job);
}
