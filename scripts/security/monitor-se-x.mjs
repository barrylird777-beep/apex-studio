import { execFileSync } from "node:child_process";
import fs from "node:fs";

const container = process.env.APEX_SEX_CONTAINER ?? "apex-se-x";
const network = process.env.APEX_SEX_NETWORK ?? "apex-search";
const intervalMs = Math.max(1000, Number(process.env.APEX_SECURITY_POLL_MS ?? 5000));
const debounceMs = Math.max(1000, Number(process.env.APEX_SECURITY_DEBOUNCE_MS ?? 30000));
const autoIsolate = process.env.APEX_SECURITY_AUTO_ISOLATE === "true";
const evidenceDir = process.env.APEX_SECURITY_EVIDENCE_DIR ?? "./data/security";
const lockFile = process.env.APEX_SECURITY_LOCK_FILE ?? "./data/security/production.lock";

fs.mkdirSync(evidenceDir, { recursive: true });

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    return `ERROR: ${String(error.stderr ?? error.stdout ?? error.message ?? error).trim()}`;
  }
}

function snapshot() {
  return {
    network: run("docker", ["network", "inspect", network]),
    inspect: run("docker", ["inspect", "--format={{.HostConfig.Privileged}}|{{json .HostConfig.Binds}}|{{json .HostConfig.Tmpfs}}|{{json .HostConfig.CapDrop}}|{{json .HostConfig.SecurityOpt}}|{{.HostConfig.NetworkMode}}", container]),
    routes: run("ip", ["route", "show", "table", "all"]),
    rules: run("ip", ["rule", "show"]),
    listeners: run("ss", ["-lntup"]),
    namespace: run("docker", ["inspect", "--format={{.State.Pid}}", container]),
  };
}

function hashSnapshot(value) {
  return JSON.stringify(value);
}

function logEvent(type, detail) {
  const record = JSON.stringify({ at: new Date().toISOString(), type, detail }) + "\n";
  fs.appendFileSync(`${evidenceDir}/se-x-monitor.jsonl`, record, { mode: 0o600 });
  console.log(record.trim());
}

let baseline = snapshot();
let lastAlert = new Map();

function alert(type, detail) {
  const now = Date.now();
  const previous = lastAlert.get(type) ?? 0;
  if (now - previous < debounceMs) return;
  lastAlert.set(type, now);
  logEvent(type, detail);

  const critical = new Set([
    "container-privilege-change",
    "host-root-or-bind-change",
    "docker-socket-bind",
    "network-namespace-change",
    "route-change",
    "listener-change",
    "network-membership-change"
  ]);

  if (!critical.has(type)) return;

  fs.writeFileSync(lockFile, JSON.stringify({
    lockedAt: new Date().toISOString(),
    reason: type,
    container,
    network
  }, null, 2) + "\n", { mode: 0o600 });

  if (autoIsolate) {
    const result = run("docker", ["network", "disconnect", network, container]);
    logEvent("se-x-isolation-requested", { result });
  }
}

function compare(next) {
  if (next.inspect !== baseline.inspect) {
    if (next.inspect.includes("true|")) alert("container-privilege-change", next.inspect);
    if (next.inspect.includes("/var/run/docker.sock")) alert("docker-socket-bind", next.inspect);
    if (next.inspect.includes("/:/")) alert("host-root-or-bind-change", next.inspect);
    if (next.inspect.includes("ERROR:")) alert("container-inspection-failure", next.inspect);
  }
  if (next.namespace !== baseline.namespace) alert("network-namespace-change", { before: baseline.namespace, after: next.namespace });
  if (next.routes !== baseline.routes) alert("route-change", { before: baseline.routes, after: next.routes });
  if (next.listeners !== baseline.listeners) alert("listener-change", { before: baseline.listeners, after: next.listeners });
  if (next.network !== baseline.network) alert("network-membership-change", { before: baseline.network, after: next.network });
}

console.log(`SE-X runtime monitor active: ${container} on ${network}`);
console.log(`Polling every ${intervalMs}ms; automatic isolation=${autoIsolate}`);

while (true) {
  await new Promise(resolve => setTimeout(resolve, intervalMs));
  const next = snapshot();
  compare(next);
  baseline = next;
}
