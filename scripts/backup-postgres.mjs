#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required for a PostgreSQL backup.");
  process.exit(2);
}

const pgDump = process.env.PG_DUMP_BIN || "pg_dump";
const backupRoot = resolve(process.env.APEX_BACKUP_DIR || "./backups/postgres");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = join(backupRoot, `apex-postgres-${stamp}.dump`);
const manifestPath = `${output}.sha256`;

await mkdir(dirname(output), { recursive: true });

const args = ["--format=custom", "--no-password", "--file", output, databaseUrl];

const exitCode = await new Promise((resolveExit) => {
  const child = spawn(pgDump, args, { stdio: ["ignore", "inherit", "inherit"], env: process.env });
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
await writeFile(manifestPath, `${digest}  ${output.split("/").pop()}\n`, "utf8");

console.log(JSON.stringify({
  status: "complete",
  format: "postgresql-custom",
  backup: output,
  sha256: digest,
  manifest: manifestPath
}, null, 2));
