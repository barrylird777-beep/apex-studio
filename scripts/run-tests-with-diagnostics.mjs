import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { startTestPeerBridge } from "../test/helpers/test-peer-storage-bridge.mjs";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const testCommand = packageJson.scripts?.["test:files"];
const files = testCommand?.match(/test\/[^\s"]+\.mjs/g) ?? [];
if (!files.length) throw new Error("Could not discover test files from package.json test script");

const concurrency = Math.max(1, Number(process.env.APEX_TEST_CONCURRENCY || 4));
const timeoutMs = Math.max(1000, Number(process.env.APEX_TEST_FILE_TIMEOUT_MS || 180000));
let next = 0;
const failures = [];
const peerBridgeFiles = new Set([
  "test/voiceover-pure-wal.test.mjs",
  "test/storage-scenes.test.mjs",
  "test/bible-production-pure-wal.test.mjs",
  "test/durable-worker-race.test.mjs",
  "test/apex-intelligence.test.mjs",
  "test/apex-worker-dispatch.test.mjs",
  "test/sovereign-app-fabric.test.mjs",
  "test/teevee-production-api.test.mjs",
  "test/engine-apex-chat-runtime.test.mjs",
  "test/kernelodies-discovery.test.mjs"
]);

async function runFile(file, index) {
  const started = Date.now();
  console.log(`\n[TEST-FILE START] ${file}`);
  const testRoot = path.join(tmpdir(), `apex-test-${process.pid}-${file.replace(/[^A-Za-z0-9]+/g, "-")}`);
  const childEnv = {
    ...process.env,
    APEX_SE_X_ROOT: testRoot,
    APEX_PROJECTS_DIR: path.join(testRoot, "projects"),
    APEX_WAL_DIR: path.join(testRoot, "wal"),
    APEX_WAL_FILE: path.join(testRoot, "wal", "ring.wal.jsonl")
  };
  let peerBridge = null;
  if (peerBridgeFiles.has(file)) {
    const socketPath = path.join(tmpdir(), `apex-test-peer-${process.pid}-${index}.sock`);
    peerBridge = await startTestPeerBridge(socketPath);
    Object.assign(childEnv, {
      APEX_APP_NAMESPACE: "KernelVision",
      APEX_PEER_STORAGE_API_TOKEN_KERNELVISION: peerBridge.tokens.KernelVision,
      APEX_PEER_STORAGE_API_SOCKET: socketPath
    });
  }
  const child = spawn(process.execPath, ["--test", file], { stdio: "inherit", env: childEnv });
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
  await peerBridge?.close();
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
    await runFile(files[index], index);
  }
}

console.log(`[TEST-DIAGNOSTICS] files=${files.length} concurrency=${concurrency} perFileTimeoutMs=${timeoutMs}`);
await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, () => worker()));
console.log(`[TEST-DIAGNOSTICS SUMMARY] total=${files.length} failed=${failures.length}`);
for (const failure of failures) console.error(JSON.stringify(failure));
if (failures.length) process.exitCode = 1;
