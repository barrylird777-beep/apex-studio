import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const testCommand = packageJson.scripts?.test;
const files = testCommand?.match(/test\/[^\s"]+\.mjs/g) ?? [];
if (!files.length) throw new Error("Could not discover test files from package.json test script");

const concurrency = Math.max(1, Number(process.env.APEX_TEST_CONCURRENCY || 4));
const timeoutMs = Math.max(1000, Number(process.env.APEX_TEST_FILE_TIMEOUT_MS || 180000));
let next = 0;
const failures = [];

async function runFile(file) {
  const started = Date.now();
  console.log(`\\n[TEST-FILE START] ${file}`);
  const child = spawn(process.execPath, ["--test", file], { stdio: "inherit", env: process.env });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    console.error(`[TEST-FILE TIMEOUT] ${file} exceeded ${timeoutMs}ms; terminating process`);
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 3000).unref();
  }, timeoutMs);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  }).finally(() => clearTimeout(timer));
  const elapsed = Date.now() - started;
  if (timedOut || code.exitCode !== 0) {
    failures.push({ file, elapsedMs: elapsed, timedOut, ...code });
    console.error(`[TEST-FILE FAIL] ${file} elapsedMs=${elapsed} timedOut=${timedOut} exitCode=${code.exitCode} signal=${code.signal ?? "none"}`);
  } else {
    console.log(`[TEST-FILE PASS] ${file} elapsedMs=${elapsed}`);
  }
}

async function worker() {
  while (true) {
    const index = next++;
    if (index >= files.length) return;
    await runFile(files[index]);
  }
}

console.log(`[TEST-DIAGNOSTICS] files=${files.length} concurrency=${concurrency} perFileTimeoutMs=${timeoutMs}`);
await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, () => worker()));
console.log(`[TEST-DIAGNOSTICS SUMMARY] total=${files.length} failed=${failures.length}`);
for (const failure of failures) console.error(JSON.stringify(failure));
if (failures.length) process.exitCode = 1;
