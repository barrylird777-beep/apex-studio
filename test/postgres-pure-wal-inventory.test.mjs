import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { quoteIdentifier, parseArgs } from "../scripts/audit-postgres-for-pure-wal.mjs";

const script = new URL("../scripts/audit-postgres-for-pure-wal.mjs", import.meta.url);

function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script.pathname, ...args], {
      env: { ...process.env, DATABASE_URL: "", ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test("Pure-WAL inventory safely quotes catalog-derived SQL identifiers", () => {
  assert.equal(quoteIdentifier("public"), '"public"');
  assert.equal(quoteIdentifier('table"name'), '"table""name"');
});

test("Pure-WAL inventory argument parsing is explicit and rejects unknown options", () => {
  assert.deepEqual(parseArgs(["--exact-counts", "--output=/tmp/report.json"]), {
    exactCounts: true, output: "/tmp/report.json", help: false
  });
  assert.throws(() => parseArgs(["--drop-database"]), /Unknown or incomplete option/);
  assert.throws(() => parseArgs(["--output="]), /Unknown or incomplete option/);
});

test("Pure-WAL inventory help is available without a database connection", async () => {
  const result = await run(["--help"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /read-only PostgreSQL inventory/i);
  assert.match(result.stdout, /--exact-counts/);
});

test("Pure-WAL inventory refuses to run without DATABASE_URL", async () => {
  const result = await run([]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /DATABASE_URL is required/);
});

test("Pure-WAL inventory rejects non-PostgreSQL connection URLs", async () => {
  const result = await run([], { DATABASE_URL: "mysql://localhost/example" });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /postgres:\/\/ or postgresql:\/\//);
});
