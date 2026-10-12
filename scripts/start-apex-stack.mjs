import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiScript = path.join(root, "server.mjs");
const runtimeScript = path.join(root, "src/core/sovereign-runtime-daemon.mjs");
const children = new Map();
let stopping = false;
let exitCode = 0;
let restartTimer;
let restartDelayMs = 1000;

function stopAll(code = 0, signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  clearTimeout(restartTimer);
  console.log("[APEX STACK] stopping services", JSON.stringify({ code, signal }));
  for (const child of children.values()) {
    if (child && child.exitCode == null && child.signalCode == null) child.kill(signal);
  }
  const force = setTimeout(() => {
    for (const child of children.values()) {
      if (child && child.exitCode == null && child.signalCode == null) child.kill("SIGKILL");
    }
  }, 10000);
  force.unref?.();
}

function startApi() {
  const child = spawn(process.execPath, [apiScript], { cwd: root, env: process.env, stdio: "inherit" });
  children.set("apex-api", child);
  console.log("[APEX STACK] started", JSON.stringify({ service: "apex-api", pid: child.pid }));
  child.on("error", error => {
    console.error("[APEX STACK] API failed to start", error);
    stopAll(1);
  });
  child.on("exit", (code, signal) => {
    console.error("[APEX STACK] API exited", JSON.stringify({ code, signal }));
    if (!stopping) stopAll(code ?? 1);
    finishIfStopped();
  });
}

function startRuntime() {
  if (stopping) return;
  const child = spawn(process.execPath, [runtimeScript], { cwd: root, env: process.env, stdio: "inherit" });
  children.set("sovereign-runtime", child);
  console.log("[APEX STACK] started", JSON.stringify({ service: "sovereign-runtime", pid: child.pid }));
  child.on("error", error => {
    console.error("[APEX STACK] sovereign runtime failed to start", error);
    scheduleRuntimeRestart();
  });
  child.on("exit", (code, signal) => {
    console.error("[APEX STACK] sovereign runtime exited", JSON.stringify({ code, signal, apiRemainsAvailable: !stopping }));
    if (!stopping) scheduleRuntimeRestart();
    finishIfStopped();
  });
}

function scheduleRuntimeRestart() {
  if (stopping || restartTimer) return;
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    restartDelayMs = Math.min(30000, restartDelayMs * 2);
    startRuntime();
  }, restartDelayMs);
  restartTimer.unref?.();
  console.warn("[APEX STACK] sovereign runtime restart scheduled", JSON.stringify({ delayMs: restartDelayMs }));
}

function finishIfStopped() {
  if (stopping && [...children.values()].every(child => !child || child.exitCode != null || child.signalCode != null)) {
    process.exitCode = exitCode;
  }
}

process.once("SIGTERM", () => stopAll(0, "SIGTERM"));
process.once("SIGINT", () => stopAll(0, "SIGINT"));
startApi();
startRuntime();
