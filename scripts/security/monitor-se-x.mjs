import { execFileSync } from "node:child_process";
import fs from "node:fs";\nimport path from "node:path";

const container = process.env.APEX_SEX_CONTAINER ?? "apex-se-x";
const network = process.env.APEX_SEX_NETWORK ?? "apex-search";
const intervalMs = Math.max(1000, Number(process.env.APEX_SECURITY_POLL_MS ?? 5000));
const debounceMs = Math.max(1000, Number(process.env.APEX_SECURITY_DEBOUNCE_MS ?? 30000));
const autoIsolate = process.env.APEX_SECURITY_AUTO_ISOLATE === "true";
const evidenceDir = process.env.APEX_SECURITY_EVIDENCE_DIR ?? "./data/security";
const lockFile = process.env.APEX_SECURITY_LOCK_FILE ?? "./data/security/production.lock";
const expectedMembers = new Set(
  String(process.env.APEX_SEX_EXPECTED_NETWORK_MEMBERS ?? container)
    .split(",").map(value => value.trim()).filter(Boolean)
);

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

function networkMembers(raw) {
  try {
    const parsed = JSON.parse(raw);
    return new Set(Object.values(parsed?.[0]?.Containers ?? {}).map(entry => entry.Name).filter(Boolean));
  } catch {
    return new Set();
  }
}

function logEvent(type, detail, severity = "info") {
  const record = JSON.stringify({
    at: new Date().toISOString(),
    monotonicNs: process.hrtime.bigint().toString(),
    severity,
    type,
    detail
  }) + "\n";
  fs.appendFileSync(`${evidenceDir}/se-x-monitor.jsonl`, record, { mode: 0o600 });
  console.log(record.trim());
}

const bootMonotonic = process.hrtime.bigint();
const bootWallMs = Date.now();
let baseline = snapshot();
let lastAlert = new Map();

function alert(type, detail) {
  const nowMono = process.hrtime.bigint();
  const previous = lastAlert.get(type);
  const elapsedMs = previous === undefined
    ? Number.POSITIVE_INFINITY
    : Number(nowMono - previous) / 1e6;

  if (elapsedMs < debounceMs) return;
  lastAlert.set(type, nowMono);
  logEvent(type, detail, "alert");

  const critical = new Set([
    "container-privilege-change",
    "host-root-or-bind-change",
    "docker-socket-bind",
    "network-namespace-change",
    "route-change",
    "listener-change",
    "network-membership-change",
    "clock-anomaly"
  ]);

  if (!critical.has(type)) return;

  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, JSON.stringify({
    lockedAt: new Date().toISOString(),
    reason: type,
    container,
    network
  }, null, 2) + "\n", { mode: 0o600 });

  if (autoIsolate) {
    const result = run("docker", ["network", "disconnect", network, container]);
    logEvent("se-x-isolation-requested", { result }, "critical");
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
  if (next.network !== baseline.network) {
    const members = [...networkMembers(next.network)];
    const unexpected = members.filter(member => !expectedMembers.has(member));
    const missing = [...expectedMembers].filter(member => !members.includes(member));
    alert("network-membership-change", { members, unexpected, missing });
  }

  const wallElapsed = Date.now() - bootWallMs;
  const monoElapsed = Number(process.hrtime.bigint() - bootMonotonic) / 1e6;
  const driftMs = wallElapsed - monoElapsed;
  if (Math.abs(driftMs) > Math.max(5000, intervalMs * 4)) {
    alert("clock-anomaly", { wallElapsedMs: wallElapsed, monotonicElapsedMs: monoElapsed, driftMs });
  }
}

logEvent("monitor-started", {
  container,
  network,
  expectedMembers: [...expectedMembers],
  intervalMs,
  debounceMs
});

console.log(`SE-X runtime monitor active: ${container} on ${network}`);
console.log(`Polling every ${intervalMs}ms; automatic isolation=${autoIsolate}`);

while (true) {
  await new Promise(resolve => setTimeout(resolve, intervalMs));
  const next = snapshot();
  compare(next);
  baseline = next;
}
