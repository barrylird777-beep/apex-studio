import sqlite3 from "sqlite3";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const DB_FILE = process.env.APEX_PRODUCTION_DB_FILE || process.env.APEX_OMNI_DB_FILE || "./apex-production.sqlite";
const CONCURRENCY = Math.max(1, Number(process.env.APEX_AV1_CONCURRENCY || process.env.APEX_JOB_CONCURRENCY || 2));
const POLL_MS = Math.max(250, Number(process.env.APEX_PRODUCTION_POLL_MS || 1000));
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const OUTPUT_BUCKET = process.env.APEX_OBJECT_STORE_BUCKET || process.env.S3_BUCKET || "";
const OUTPUT_PREFIX = (process.env.APEX_AV1_OUTPUT_PREFIX || "av1/").replace(/^\/+|\/+$/g, "");
const REGION = process.env.AWS_REGION || process.env.S3_REGION || "auto";
const ENDPOINT = process.env.APEX_OBJECT_STORE_ENDPOINT || process.env.S3_ENDPOINT || "";
const FORCE_PATH_STYLE = /^(1|true|yes)$/i.test(process.env.APEX_S3_FORCE_PATH_STYLE || "true");

let db;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function openDb() {
  if (db) return db;
  db = new sqlite3.Database(DB_FILE);
  db.configure("busyTimeout", 10000);
  return db;
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => openDb().run(sql, params, function (err) {
    if (err) reject(err); else resolve(this);
  }));
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => openDb().all(sql, params, (err, rows) => {
    if (err) reject(err); else resolve(rows);
  }));
}

async function initSchema() {
  await run(`
    CREATE TABLE IF NOT EXISTS production_jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0,
      available_at INTEGER NOT NULL DEFAULT (unixepoch()),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      started_at INTEGER,
      finished_at INTEGER,
      heartbeat_at INTEGER,
      output_key TEXT,
      output_bytes INTEGER,
      error TEXT,
      result_json TEXT
    )
  `);
  await run("CREATE INDEX IF NOT EXISTS idx_production_jobs_pick ON production_jobs(status, available_at, priority DESC, created_at)");
}

export async function enqueueProductionJob(payload, options = {}) {
  await initSchema();
  const id = options.id || `av1_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  await run(
    "INSERT INTO production_jobs (id,type,payload_json,status,priority,available_at) VALUES (?,?,?,?,?,?)",
    [id, "av1.encode", JSON.stringify(payload ?? {}), "queued", Number(options.priority || 0), Math.floor(Date.now() / 1000)]
  );
  return id;
}

function objectClient() {
  if (!OUTPUT_BUCKET) throw new Error("APEX_OBJECT_STORE_BUCKET or S3_BUCKET is required");
  return new S3Client({
    region: REGION,
    endpoint: ENDPOINT || undefined,
    forcePathStyle: FORCE_PATH_STYLE
  });
}

function splitS3Url(value) {
  const u = new URL(value);
  if (u.protocol !== "s3:") return null;
  return { bucket: u.hostname, key: decodeURIComponent(u.pathname.replace(/^\//, "")) };
}

function objectLocation(input) {
  if (!input) throw new Error("Missing input");
  const s3 = splitS3Url(input);
  if (s3) return s3;
  return null;
}

function bodyToNodeStream(body) {
  if (!body) throw new Error("Input has no body");
  if (typeof body.pipe === "function") return body;
  if (typeof body.transformToWebStream === "function") return Readable.fromWeb(body.transformToWebStream());
  throw new Error("Unsupported object-store body stream");
}

async function openInput(input) {
  const s3 = objectLocation(input);
  if (!s3) {
    const response = await fetch(input);
    if (!response.ok) throw new Error(`Input fetch failed: HTTP ${response.status}`);
    return { kind: "stream", value: bodyToNodeStream(response.body) };
  }
  const client = objectClient();
  const result = await client.send(new GetObjectCommand({ Bucket: s3.bucket, Key: s3.key }));
  return { kind: "stream", value: bodyToNodeStream(result.Body) };
}

function ffmpegArgs(job) {
  const p = job.payload || {};
  const input = p.input_url || p.inputUrl;
  if (!input) throw new Error("Job requires input_url");
  const fps = Math.max(1, Math.min(120, Number(p.fps || 24)));
  const crf = Math.max(0, Math.min(63, Number(p.crf ?? 30)));
  const cpu = Math.max(0, Math.min(8, Number(p.cpuUsed ?? 4)));
  const width = p.width ? Math.max(16, Number(p.width)) : null;
  const height = p.height ? Math.max(16, Number(p.height)) : null;
  const scale = width && height ? ["-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`] : [];
  const format = String(p.format || "mp4").toLowerCase() === "webm" ? "webm" : "mp4";
  if (format === "webm") {
    return { input, format, args: ["-hide_banner","-loglevel","error","-i","pipe:0","-map","0:v:0","-an","-c:v","libsvtav1","-crf",String(crf),"-preset",String(Math.max(0,Math.min(13,cpu))),"-r",String(fps),...scale,"-f","webm","pipe:1"] };
  }
  return { input, format, args: ["-hide_banner","-loglevel","error","-i","pipe:0","-map","0:v:0","-an","-c:v","libsvtav1","-crf",String(crf),"-preset",String(Math.max(0,Math.min(13,cpu))),"-r",String(fps),...scale,"-pix_fmt","yuv420p","-movflags","frag_keyframe+empty_moov+default_base_moof","-f","mp4","pipe:1"] };
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

async function encode(job) {
  const spec = ffmpegArgs(job);
  const input = await openInput(spec.input);
  const ffmpeg = spawn(FFMPEG, spec.args, { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  let bytes = 0;
  ffmpeg.stderr.on("data", chunk => { stderr += chunk.toString(); if (stderr.length > 12000) stderr = stderr.slice(-12000); });
  ffmpeg.stdout.on("data", chunk => { bytes += chunk.length; });

  const inputDone = new Promise((resolve, reject) => {
    input.value.once("error", reject);
    ffmpeg.stdin.once("error", reject);
    ffmpeg.stdin.once("finish", resolve);
    input.value.pipe(ffmpeg.stdin);
  });

  const key = `${OUTPUT_PREFIX ? OUTPUT_PREFIX + "/" : ""}${job.id}.${spec.format}`;
  const outputPromise = streamToObjectStore(ffmpeg.stdout, key, spec.format === "webm" ? "video/webm" : "video/mp4");
  await inputDone;
  ffmpeg.stdin.end();
  const [exit] = await once(ffmpeg, "close");
  const upload = await outputPromise;
  if (exit !== 0) throw new Error(`ffmpeg exited ${exit}: ${stderr.trim()}`);
  return { key, bucket: OUTPUT_BUCKET, bytes, etag: upload?.ETag || null };
}

async function claimJob() {
  const now = Math.floor(Date.now() / 1000);
  return new Promise((resolve, reject) => {
    const database = openDb();
    database.serialize(() => {
      database.run("BEGIN IMMEDIATE", err => {
        if (err) return reject(err);
        database.get(
          "SELECT * FROM production_jobs WHERE status='queued' AND available_at<=? ORDER BY priority DESC, created_at ASC LIMIT 1",
          [now],
          (selectErr, row) => {
            if (selectErr) {
              database.run("ROLLBACK", () => reject(selectErr));
              return;
            }
            if (!row) {
              database.run("COMMIT", commitErr => commitErr ? reject(commitErr) : resolve(null));
              return;
            }
            database.run(
              "UPDATE production_jobs SET status='running', attempts=attempts+1, started_at=?, heartbeat_at=? WHERE id=? AND status='queued'",
              [now, now, row.id],
              function (updateErr) {
                if (updateErr) {
                  database.run("ROLLBACK", () => reject(updateErr));
                  return;
                }
                database.run("COMMIT", commitErr => commitErr ? reject(commitErr) : resolve({ ...row, attempts: row.attempts + 1 }));
              }
            );
          }
        );
      });
    });
  });
}

async function finish(job, result) {
  await run("UPDATE production_jobs SET status='completed',finished_at=?,heartbeat_at=?,output_key=?,output_bytes=?,result_json=?,error=NULL WHERE id=?", [
    Math.floor(Date.now()/1000), Math.floor(Date.now()/1000), result.key, result.bytes, JSON.stringify(result), job.id
  ]);
}

async function fail(job, error) {
  const retry = job.attempts < Number(process.env.APEX_AV1_MAX_ATTEMPTS || 3);
  const status = retry ? "queued" : "failed";
  const delay = retry ? Math.min(300, 2 ** job.attempts * 5) : 0;
  await run("UPDATE production_jobs SET status=?,available_at=?,error=?,heartbeat_at=? WHERE id=?", [
    status, Math.floor(Date.now()/1000) + delay, String(error?.stack || error).slice(0, 20000), Math.floor(Date.now()/1000), job.id
  ]);
}

async function workerLoop() {
  while (!stopping) {
    const job = await claimJob();
    if (!job) { await sleep(POLL_MS); continue; }
    try {
      const payload = JSON.parse(job.payload_json || "{}");
      job.payload = payload;
      const result = await encode(job);
      await finish(job, result);
    } catch (error) {
      await fail(job, error);
    }
  }
}

let stopping = false;
export async function startProductionDaemon() {
  await initSchema();
  const loops = Array.from({ length: CONCURRENCY }, () => workerLoop());
  await Promise.all(loops);
}

async function shutdown(signal) {
  stopping = true;
  await sleep(50);
  try { db?.close(); } finally { process.exit(signal === "SIGTERM" ? 0 : 1); }
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void shutdown(signal));

if (process.argv[1] && new URL(import.meta.url).pathname === new URL(process.argv[1], "file:").pathname) {
  await startProductionDaemon();
}
