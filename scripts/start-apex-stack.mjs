import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// server.mjs starts the sovereign runtime in-process so both share one Pure-WAL store.
const services = [
  { name: "apex-api", script: path.join(root, "server.mjs") }
];
const children = [];
let stopping = false;
let exitCode = 0;

function stopAll(code = 0, signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  console.log("[APEX STACK] stopping services", JSON.stringify({ code, signal }));
  for (const child of children) {
    if (child.exitCode == null && child.signalCode == null) child.kill(signal);
  }
  const force = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL");
    }
  }, 10000);
  force.unref?.();
}

for (const service of services) {
  const child = spawn(process.execPath, [service.script], {
    cwd: root,
    env: process.env,
    stdio: "inherit"
  });
  children.push(child);
  console.log("[APEX STACK] started", JSON.stringify({ service: service.name, pid: child.pid }));
  child.on("error", error => {
    console.error("[APEX STACK] failed to start", service.name, error);
    stopAll(1, "SIGTERM");
  });
  child.on("exit", (code, signal) => {
    console.log("[APEX STACK] service exited", JSON.stringify({ service: service.name, code, signal }));
    if (!stopping) stopAll(code ?? 1, "SIGTERM");
    if (stopping && children.every(item => item.exitCode != null || item.signalCode != null)) {
      process.exitCode = exitCode;
    }
  });
}

process.once("SIGTERM", () => stopAll(0, "SIGTERM"));
process.once("SIGINT", () => stopAll(0, "SIGINT"));
