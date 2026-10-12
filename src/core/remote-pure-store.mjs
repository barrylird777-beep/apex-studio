import { randomUUID } from "node:crypto";

const API_URL = String(process.env.APEX_WORKER_API_URL || "").trim().replace(/\/+$/, "");
const TOKEN = String(process.env.APEX_WORKER_TOKEN || "");

function assertRemoteConfig() {
  if (!API_URL || !TOKEN) throw new Error("TeeVee remote store requires APEX_WORKER_API_URL and APEX_WORKER_TOKEN");
}

async function request(route, body) {
  assertRemoteConfig();
  const response = await fetch(new URL(route, API_URL), {
    method: "POST",
    headers: { "content-type": "application/json", "x-apex-worker-token": TOKEN },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`TeeVee remote store ${response.status}: ${String(result.error || response.statusText).slice(0, 300)}`);
  return result;
}

export function createRemotePureStore() {
  return {
    async get(collection, id) {
      return (await request("/api/internal/store/get", { collection, id: String(id) })).record || null;
    },
    async list(collection) {
      return (await request("/api/internal/store/list", { collection })).records || [];
    },
    async put(collection, id, record) {
      return (await request("/api/internal/store/put", { collection, id: String(id), record })).record;
    },
    async create(collection, record = {}) {
      const id = String(record.id || randomUUID());
      return (await request("/api/internal/store/put", { collection, id, record: { ...record, id } })).record;
    },
    async queryFiltered(collection, filters = {}, { sortField = "", descending = false, limit = 10000 } = {}) {
      const records = await this.list(collection);
      let result = records.filter(record => Object.entries(filters).every(([key, value]) => record?.[key] === value));
      if (sortField) result.sort((a, b) => {
        const left = a?.[sortField], right = b?.[sortField];
        const order = typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left ?? "").localeCompare(String(right ?? ""));
        return descending ? -order : order;
      });
      return result.slice(0, Math.max(1, Math.min(10000, Number(limit) || 10000)));
    },
    async enqueue({ id = randomUUID(), type, payload = {}, maxAttempts = 8, dedupeKey = null, priority = 0 } = {}) {
      return (await request("/api/internal/teevee/enqueue", {
        id: String(id), task: String(type || ""), payload, maxAttempts, dedupeKey, priority
      })).task;
    },
    async withMutationLock(operation) {
      // Each remote put is serialized by the API's durable WAL. The pipeline
      // advances one stage at a time, so no worker-local filesystem lock is used.
      return operation();
    }
  };
}
