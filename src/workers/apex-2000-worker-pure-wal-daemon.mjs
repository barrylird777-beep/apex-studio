import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { apexPureStore } from "../core/apex-pure-store.mjs";
import { createApexWorkerDispatcher } from "./apex-worker-dispatch.mjs";
import { APEX_WORKER_COUNT, assertWorkerFabric } from "./apex-2000-worker-fabric.mjs";

const pollMs = Math.max(100, Number(process.env.APEX_WORKER_FABRIC_POLL_MS || 250));
const leaseMs = Math.max(15000, Number(process.env.APEX_WORKER_LEASE_MS || 30000));
const maxInFlight = Math.max(1, Math.min(APEX_WORKER_COUNT, Number(process.env.APEX_WORKER_FABRIC_IN_FLIGHT || 64)));
const runnerId = process.env.APEX_WORKER_ID || `pure-wal-${os.hostname()}-${process.pid}`;
const handlerModulePath = process.env.APEX_JOB_HANDLER_MODULE || "";
let stopping = false;

function resolveHandler(module) {
  const handler = module?.handlers?.["apex.worker.assigned-task"]
    ?? module?.default?.handlers?.["apex.worker.assigned-task"]
    ?? module?.handleJob
    ?? module?.default?.handleJob
    ?? (typeof module?.default === "function" ? module.default : null);
  if (typeof handler !== "function") {
    throw new Error("APEX_JOB_HANDLER_MODULE must export a handler for apex.worker.assigned-task (or a generic handleJob)");
  }
  return handler;
}

async function main() {
  assertWorkerFabric();
  if (!handlerModulePath) throw new Error("APEX_JOB_HANDLER_MODULE is required for Pure-WAL worker execution");
  const moduleSpecifier = handlerModulePath.startsWith(".") || path.isAbsolute(handlerModulePath)
    ? pathToFileURL(path.resolve(process.cwd(), handlerModulePath)).href
    : handlerModulePath;
  const handlersModule = await import(moduleSpecifier);
  const executeTask = resolveHandler(handlersModule);
  const dispatcher = createApexWorkerDispatcher({ store: apexPureStore });

  await apexPureStore.init();
  console.log("[APEX PURE-WAL WORKERS] online", JSON.stringify({
    fixedWorkers: APEX_WORKER_COUNT,
    runnerId,
    maxInFlight,
    pollMs,
    leaseMs,
    storage: "local-pure-wal",
    note: "logical identities are fixed; concurrent execution is resource-bounded"
  }));

  while (!stopping) {
    await apexPureStore.recoverExpired();
    const batch = await dispatcher.runQueued({
      workerId: runnerId,
      limit: maxInFlight,
      leaseMs,
      executeTask: assignment => executeTask({
        id: assignment.jobId,
        type: assignment.type,
        payload: assignment.payload,
        workerId: assignment.workerId,
        workerRole: assignment.role,
        workerTask: assignment.assignedTask,
        context: assignment.context,
        runnerId: assignment.runnerId,
        leaseFence: assignment.leaseFence
      })
    });
    if (batch.claimed > 0) {
      console.log("[APEX PURE-WAL WORKERS] batch", JSON.stringify({
        claimed: batch.claimed,
        completed: batch.completed,
        failed: batch.failed
      }));
    } else {
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }
  }
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log("[APEX PURE-WAL WORKERS] stopping", signal);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error("[APEX PURE-WAL WORKERS] fatal", error);
    process.exitCode = 1;
  });
}

export { main as runApexPureWalWorkerDaemon, resolveHandler };
