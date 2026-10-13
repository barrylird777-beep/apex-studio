import { randomUUID, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { SovereignCloudCoordinator } from "../core/mesh/sovereign-cloud-coordinator.mjs";

const app = String(process.env.APEX_CLOUD_WORKER_APP || "");
const workerId = String(process.env.APEX_CLOUD_WORKER_ID || randomUUID());
const handlerModule = String(process.env.APEX_CLOUD_HANDLER_MODULE || "");
const pollMs = Math.max(250, Number(process.env.APEX_CLOUD_WORKER_POLL_MS || 1500));
const leaseMs = Math.max(5000, Math.min(300000, Number(process.env.APEX_CLOUD_WORKER_LEASE_MS || 30000)));
const coordinator = new SovereignCloudCoordinator();
let stopping = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

if (!handlerModule) throw new Error("APEX_CLOUD_HANDLER_MODULE is required; no simulated handler is permitted");

function moduleUrl(specifier) {
  return specifier.startsWith("https://") || specifier.startsWith("file:") ? specifier : pathToFileURL(path.resolve(specifier)).href;
}

async function execute(job, lease) {
  try {
    const payloadBytes = await coordinator.getPayload({ app, payloadHash: job.payloadHash });
    let payload;
    try { payload = JSON.parse(payloadBytes.toString("utf8")); }
    catch { payload = { bytesBase64: payloadBytes.toString("base64"), contentType: "application/octet-stream" }; }
    const mod = await import(moduleUrl(handlerModule));
    const handler = mod.handlers?.[job.taskType] ?? mod.default?.[job.taskType] ?? mod.handleJob ?? mod.default;
    if (typeof handler !== "function") throw new Error("No real handler registered for cloud job type: " + job.taskType);
    const result = await handler({ id: job.jobId, type: job.taskType, app, payload, capability: job.capability, workerId, leaseToken: lease.token });
    const resultBytes = Buffer.from(JSON.stringify(result ?? null));
    const persisted = await coordinator.putPayload({ app, bytes: resultBytes, contentType: "application/json" });
    const completed = await coordinator.finishJob({ app, jobId: job.jobId, workerId, leaseToken: lease.token, resultHash: persisted.payloadHash, status: "completed" });
    if (!completed.accepted) throw new Error("Cloud job completion rejected: " + completed.reason);
    console.log("[APEX CLOUD WORKER] completed", JSON.stringify({ app, jobId: job.jobId, workerId, resultHash: persisted.payloadHash }));
  } catch (error) {
    const bytes = Buffer.from(JSON.stringify({ error: String(error?.message || error), at: new Date().toISOString() }));
    let errorHash = null;
    try { errorHash = (await coordinator.putPayload({ app, bytes, contentType: "application/json" })).payloadHash; } catch {}
    const failed = await coordinator.finishJob({ app, jobId: job.jobId, workerId, leaseToken: lease.token, resultHash: errorHash, status: "failed" }).catch(() => ({ accepted: false }));
    console.error("[APEX CLOUD WORKER] job failed", JSON.stringify({ app, jobId: job.jobId, workerId, persisted: failed.accepted, error: String(error?.message || error) }));
  }
}

async function main() {
  if (!["KernelVision", "XShield", "Kernelodies", "PlanetApeX", "KashKorner", "KoinKob"].includes(app)) throw new Error("APEX_CLOUD_WORKER_APP must be one of the six canonical apps");
  const health = await coordinator.health();
  console.log("[APEX CLOUD WORKER] cloud storage verified", JSON.stringify({ app, workerId, persistence: health.persistence, readAfterWrite: health.readAfterWrite }));
  while (!stopping) {
    try {
      const claimed = await coordinator.claimNextJob({ app, workerId, leaseMs });
      if (claimed) await execute(claimed.job, claimed.lease);
      else await sleep(pollMs);
    } catch (error) {
      console.error("[APEX CLOUD WORKER] cloud operation failed; retrying without local fallback", String(error?.message || error));
      await sleep(Math.min(30000, pollMs * 4));
    }
  }
}

process.once("SIGTERM", () => { stopping = true; });
process.once("SIGINT", () => { stopping = true; });
main().catch(error => { console.error("[APEX CLOUD WORKER] fatal; refusing local fallback", error); process.exitCode = 1; });
