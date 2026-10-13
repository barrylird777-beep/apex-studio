import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { SovereignCloudCoordinator } from "../core/mesh/sovereign-cloud-coordinator.mjs";

const app = String(process.env.APEX_CLOUD_WORKER_APP || "");
const workerId = String(process.env.APEX_CLOUD_WORKER_ID || randomUUID());
const handlerModule = String(process.env.APEX_CLOUD_HANDLER_MODULE || "");
const pollMs = Math.max(250, Number(process.env.APEX_CLOUD_WORKER_POLL_MS || 1500));
const leaseMs = Math.max(5000, Math.min(300000, Number(process.env.APEX_CLOUD_WORKER_LEASE_MS || 30000)));
const capabilities = (process.env.APEX_CLOUD_WORKER_CAPABILITIES || "").split(",").map(x => x.trim()).filter(Boolean);
const taskTypes = (process.env.APEX_CLOUD_WORKER_TASK_TYPES || "").split(",").map(x => x.trim()).filter(Boolean);
const coordinator = new SovereignCloudCoordinator();
let stopping = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

if (!handlerModule) throw new Error("APEX_CLOUD_HANDLER_MODULE is required; no simulated handler is permitted");

function moduleUrl(specifier) {
  return specifier.startsWith("https://") || specifier.startsWith("file:") ? specifier : pathToFileURL(path.resolve(specifier)).href;
}

async function execute(job, lease) {
  let renewing = false;
  let leaseLost = false;
  const controller = new AbortController();
  const leaseHeartbeat = setInterval(async () => {
    if (renewing) return;
    renewing = true;
    try {
      const result = await coordinator.renewJobLease({ app, jobId: job.jobId, workerId, leaseToken: lease.token, leaseMs });
      if (!result.renewed) {
        leaseLost = true;
        controller.abort(new Error("Cloud lease lost: " + result.reason));
        console.error("[APEX CLOUD WORKER] lease renewal rejected; aborting work", JSON.stringify({ app, jobId: job.jobId, reason: result.reason }));
      }
    } catch (error) {
      leaseLost = true;
      controller.abort(new Error("Cloud lease renewal failed"));
      console.error("[APEX CLOUD WORKER] lease renewal failed; aborting work", JSON.stringify({ app, jobId: job.jobId, error: String(error?.message || error) }));
    } finally {
      renewing = false;
    }
  }, Math.max(1500, Math.floor(leaseMs / 3)));
  leaseHeartbeat.unref?.();
  const stopLeaseHeartbeat = async () => {
    clearInterval(leaseHeartbeat);
    while (renewing) await sleep(10);
  };
  try {
    const payloadBytes = await coordinator.getPayload({ app, payloadHash: job.payloadHash });
    let payload;
    try { payload = JSON.parse(payloadBytes.toString("utf8")); }
    catch { payload = { bytesBase64: payloadBytes.toString("base64"), contentType: "application/octet-stream" }; }
    const mod = await import(moduleUrl(handlerModule));
    const handler = mod.handlers?.[job.taskType] ?? mod.default?.[job.taskType] ?? mod.handleJob ?? mod.default;
    if (typeof handler !== "function") throw new Error("No real handler registered for cloud job type: " + job.taskType);
    const result = await handler({ id: job.jobId, type: job.taskType, app, payload, capability: job.capability, workerId, signal: controller.signal });
    if (leaseLost || controller.signal.aborted) throw new Error("Cloud lease lost; refusing to persist stale worker output");
    const resultBytes = Buffer.from(JSON.stringify(result ?? null));
    const persisted = await coordinator.putPayload({ app, bytes: resultBytes, contentType: "application/json" });
    if (leaseLost || controller.signal.aborted) throw new Error("Cloud lease lost; refusing to finalize stale worker output");
    await stopLeaseHeartbeat();
    if (leaseLost || controller.signal.aborted) throw new Error("Cloud lease lost during heartbeat drain; refusing to finalize stale worker output");
    const completed = await coordinator.finishJob({ app, jobId: job.jobId, workerId, leaseToken: lease.token, resultHash: persisted.payloadHash, status: "completed" });
    if (!completed.accepted) throw new Error("Cloud job completion rejected: " + completed.reason);
    console.log("[APEX CLOUD WORKER] completed", JSON.stringify({ app, jobId: job.jobId, workerId, resultHash: persisted.payloadHash }));
  } catch (error) {
    await stopLeaseHeartbeat();
    const bytes = Buffer.from(JSON.stringify({ error: String(error?.message || error), at: new Date().toISOString() }));
    let errorHash = null;
    if (!leaseLost && !controller.signal.aborted) {
      try { errorHash = (await coordinator.putPayload({ app, bytes, contentType: "application/json" })).payloadHash; } catch {}
    }
    if (leaseLost || controller.signal.aborted) {
      console.error("[APEX CLOUD WORKER] lease lost; leaving job for safe expiry and reclaim", JSON.stringify({ app, jobId: job.jobId, workerId }));
      return;
    }
    const failed = await coordinator.finishJob({ app, jobId: job.jobId, workerId, leaseToken: lease.token, resultHash: errorHash, status: "failed" }).catch(() => ({ accepted: false }));
    console.error("[APEX CLOUD WORKER] job failed", JSON.stringify({ app, jobId: job.jobId, workerId, persisted: failed.accepted, error: String(error?.message || error) }));
  } finally {
    clearInterval(leaseHeartbeat);
  }
}

async function main() {
  if (!["KernelVision", "XShield", "Kernelodies", "PlanetApeX", "KashKorner", "KoinKob"].includes(app)) throw new Error("APEX_CLOUD_WORKER_APP must be one of the six canonical apps");
  if (capabilities.length === 0) throw new Error("APEX_CLOUD_WORKER_CAPABILITIES must explicitly list supported job capabilities");
  const health = await coordinator.health();
  await coordinator.advertisePeer({ app, peerId: workerId, capabilities, maxConcurrent: 1, expiresInMs: 30000 });
  const peerHeartbeat = setInterval(() => {
    coordinator.advertisePeer({ app, peerId: workerId, capabilities, maxConcurrent: 1, expiresInMs: 30000 })
      .catch(error => console.error("[APEX CLOUD WORKER] peer heartbeat failed", String(error?.message || error)));
  }, 10000);
  peerHeartbeat.unref?.();
  console.log("[APEX CLOUD WORKER] cloud storage verified", JSON.stringify({ app, workerId, capabilities, persistence: health.persistence, readAfterWrite: health.readAfterWrite }));
  try {
    while (!stopping) {
      try {
        const claimed = await coordinator.claimNextJob({ app, workerId, leaseMs, capabilities, taskTypes: taskTypes.length ? taskTypes : undefined });
        if (claimed) await execute(claimed.job, claimed.lease);
        else await sleep(pollMs);
      } catch (error) {
        console.error("[APEX CLOUD WORKER] cloud operation failed; retrying without local fallback", String(error?.message || error));
        await sleep(Math.min(30000, pollMs * 4));
      }
    }
  } finally {
    clearInterval(peerHeartbeat);
  }
}

process.once("SIGTERM", () => { stopping = true; });
process.once("SIGINT", () => { stopping = true; });
main().catch(error => { console.error("[APEX CLOUD WORKER] fatal; refusing local fallback", error); process.exitCode = 1; });
