#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required for a PostgreSQL backup.");
  process.exit(2);
}

let database;
try {
  database = new URL(databaseUrl);
} catch {
  console.error("DATABASE_URL is not a valid PostgreSQL connection URL.");
  process.exit(2);
}

if (!["postgres:", "postgresql:"].includes(database.protocol)) {
  console.error("DATABASE_URL must use the postgres:// or postgresql:// scheme.");
  process.exit(2);
}

if (database.pathname.length <= 1) {
  console.error("DATABASE_URL must include a database name.");
  process.exit(2);
}

const pgDump = process.env.PG_DUMP_BIN || "pg_dump";
const backupRoot = resolve(process.env.APEX_BACKUP_DIR || "./backups/postgres");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = join(backupRoot, `apex-postgres-${stamp}.dump`);
const manifestPath = `${output}.sha256`;

const pgEnv = { ...process.env };
pgEnv.PGHOST = database.hostname;
if (database.port) pgEnv.PGPORT = database.port;
if (database.username) pgEnv.PGUSER = decodeURIComponent(database.username);
if (database.password) pgEnv.PGPASSWORD = decodeURIComponent(database.password);
pgEnv.PGDATABASE = decodeURIComponent(database.pathname.slice(1));

const sslmode = database.searchParams.get("sslmode");
if (sslmode) pgEnv.PGSSLMODE = sslmode;

await mkdir(dirname(output), { recursive: true, mode: 0o700 });

const args = [
  "--format=custom",
  "--no-password",
  "--file",
  output
];

const exitCode = await new Promise((resolveExit) => {
  const child = spawn(pgDump, args, {
    stdio: ["ignore", "inherit", "inherit"],
    env: pgEnv
  });

  child.once("error", (error) => {
    console.error(`Unable to execute ${pgDump}: ${error.message}`);
    resolveExit(127);
  });

  child.once("exit", (code, signal) => {
    if (signal) {
      console.error(`pg_dump terminated by signal ${signal}`);
      resolveExit(1);
      return;
    }
    resolveExit(code ?? 1);
  });
});

if (exitCode !== 0) {
  await unlink(output).catch(() => {});
  await unlink(manifestPath).catch(() => {});
  console.error(`pg_dump failed with exit code ${exitCode}; no backup is considered valid.`);
  process.exit(exitCode);
}

const hash = createHash("sha256");
await new Promise((resolveHash, rejectHash) => {
  const stream = createReadStream(output);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("error", rejectHash);
  stream.on("end", resolveHash);
});

const digest = hash.digest("hex");
const fileName = basename(output);

await chmod(output, 0o600);
await writeFile(manifestPath, `${digest}  ${fileName}\n`, { encoding: "utf8", mode: 0o600 });

console.log(JSON.stringify({
  status: "complete",
  format: "postgresql-custom",
  backup: output,
  sha256: digest,
  manifest: manifestPath
}, null, 2));
