#!/usr/bin/env node

import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for a PostgreSQL backup.");

const database = new URL(databaseUrl);
if (!["postgres:", "postgresql:"].includes(database.protocol)) {
  throw new Error("DATABASE_URL must use postgres:// or postgresql://.");
}
if (database.pathname.length <= 1) {
  throw new Error("DATABASE_URL must include a database name.");
}

const bucket = String(
  process.env.APEX_BACKUP_OBJECT_BUCKET ||
  process.env.APEX_OBJECT_STORE_BUCKET ||
  process.env.S3_BUCKET ||
  ""
).trim();
if (!bucket) {
  throw new Error("APEX_BACKUP_OBJECT_BUCKET or APEX_OBJECT_STORE_BUCKET/S3_BUCKET is required.");
}

const prefix = (process.env.APEX_BACKUP_OBJECT_PREFIX || "postgres-backups/")
  .replace(/^\/+|\/+$/g, "");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const key = `${prefix}/apex-postgres-${stamp}.dump`;
const manifestKey = `${key}.sha256`;
const pgDump = process.env.PG_DUMP_BIN || "pg_dump";

const pgEnv = { ...process.env };
pgEnv.PGHOST = database.hostname;
if (database.port) pgEnv.PGPORT = database.port;
if (database.username) pgEnv.PGUSER = decodeURIComponent(database.username);
if (database.password) pgEnv.PGPASSWORD = decodeURIComponent(database.password);
pgEnv.PGDATABASE = decodeURIComponent(database.pathname.slice(1));
const sslmode = database.searchParams.get("sslmode");
if (sslmode) pgEnv.PGSSLMODE = sslmode;

const region = process.env.AWS_REGION || process.env.S3_REGION || "auto";
const endpoint = process.env.APEX_OBJECT_STORE_ENDPOINT || process.env.S3_ENDPOINT || "";
const forcePathStyle = /^(1|true|yes)$/i.test(process.env.APEX_S3_FORCE_PATH_STYLE || "true");
const s3 = new S3Client({
  region,
  endpoint: endpoint || undefined,
  forcePathStyle
});

const tee = new PassThrough();
const hash = createHash("sha256");
let bytes = 0;
tee.on("data", chunk => {
  hash.update(chunk);
  bytes += chunk.length;
});

const child = spawn(pgDump, ["--format=custom", "--no-password"], {
  stdio: ["ignore", "pipe", "inherit"],
  env: pgEnv
});

child.stdout.on("error", error => tee.destroy(error));
child.stdout.pipe(tee);

const upload = new Upload({
  client: s3,
  params: {
    Bucket: bucket,
    Key: key,
    Body: tee,
    ContentType: "application/octet-stream"
  },
  queueSize: 1,
  partSize: 8 * 1024 * 1024,
  leavePartsOnError: false
});

let childError = null;
child.once("error", error => {
  childError = error;
  tee.destroy(error);
});

const [exitCode, signal] = await new Promise(resolve => {
  child.once("exit", (code, childSignal) => resolve([code ?? 1, childSignal]));
});

if (exitCode !== 0 || signal) {
  await upload.done().catch(() => {});
  throw new Error(
    childError
      ? `Unable to execute ${pgDump}: ${childError.message}`
      : `pg_dump failed with exit code ${exitCode} (signal=${signal || "none"})`
  );
}

await upload.done();

const digest = hash.digest("hex");
await s3.send(new PutObjectCommand({
  Bucket: bucket,
  Key: manifestKey,
  Body: `${digest}  ${key.split("/").pop()}\\n`,
  ContentType: "text/plain; charset=utf-8"
}));

console.log(JSON.stringify({
  status: "complete",
  format: "postgresql-custom",
  bucket,
  backupKey: key,
  manifestKey,
  bytes,
  sha256: digest
}, null, 2));
