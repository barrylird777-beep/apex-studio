// Compatibility entrypoint for the historical AV1 daemon.
// Production persistence and execution now belong to the PostgreSQL durable worker.
// Keeping this entrypoint avoids breaking legacy launch commands while removing the SQLite queue.
import pg from "pg";
import { createDurableJobsStore } from "../jobs/durable-jobs-store.mjs";

const { Pool } = pg;

function poolOptions() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the AV1 durable worker");
  return {
    connectionString: process.env.DATABASE_URL,
    max: Math.max(5, Number(process.env.APEX_PG_POOL_SIZE || 20)),
    connectionTimeoutMillis: Math.max(1000, Number(process.env.APEX_PG_CONNECTION_TIMEOUT_MS || 5000)),
    idleTimeoutMillis: 30000,
    ssl: process.env.APEX_PG_SSL === "false" ? false : { rejectUnauthorized: false }
  };
}

export async function enqueueProductionJob(payload, options = {}) {
  const pool = new Pool(poolOptions());
  try {
    const store = createDurableJobsStore(pool);
    const id = options.id;
    return (await store.enqueue({
      id,
      type: "av1.encode",
      payload: payload ?? {},
      priority: undefined,
      maxAttempts: Number(options.maxAttempts || process.env.APEX_AV1_MAX_ATTEMPTS || 3),
      dedupeKey: options.dedupeKey || null
    })).id;
  } finally {
    await pool.end();
  }
}

export async function startProductionDaemon() {
  // The durable worker self-starts on import and owns polling, leasing, heartbeats,
  // retries, fencing, recovery, and graceful shutdown.
  await import("../jobs/durable-worker-daemon.mjs");
  await new Promise(() => {});
}

if (process.argv[1] && new URL(import.meta.url).pathname === new URL(process.argv[1], "file:").pathname) {
  await startProductionDaemon();
}
