import test from "node:test";
import assert from "node:assert/strict";
import { createSilentAssetCompiler } from "../src/core/silent-asset-compiler.mjs";

function makeStore({ remoteMode = true } = {}) {
  const rows = new Map();
  const events = new Map();
  let sequence = 0;
  return {
    remoteMode,
    rows,
    events,
    async init() {},
    async get(collection, id) { return rows.get(collection + "/" + id) || null; },
    async put(collection, id, value) { rows.set(collection + "/" + id, structuredClone(value)); return value; },
    wal: {
      async append(type, payload, meta) {
        const key = meta.idempotencyKey;
        if (events.has(key)) return events.get(key);
        const record = { type, payload, seq: ++sequence, meta };
        events.set(key, record);
        return record;
      }
    }
  };
}

test("silent compiler stores structured data remotely and records an idempotent Ring-WAL event", async () => {
  const store = makeStore();
  const compiler = createSilentAssetCompiler({ store, clock: () => new Date("2026-01-01T00:00:00.000Z") });
  const input = { id: "asset-1", kind: "ad-spec", data: { prompt: "A clean product ad", durationSeconds: 15 }, metadata: { priceUsd: 25 } };
  const first = await compiler.compile(input);
  const second = await compiler.compile(input);

  assert.equal(first.sourceHash, second.sourceHash);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(store.rows.size, 1);
  assert.equal(store.events.size, 1);
  assert.equal(first.asset.status, "compiled");
  assert.equal(first.asset.source.data.durationSeconds, 15);
  assert.equal(first.walSequence, second.walSequence);
});

test("silent compiler fails closed if remote storage is not enabled", async () => {
  const compiler = createSilentAssetCompiler({ store: makeStore({ remoteMode: false }) });
  await assert.rejects(compiler.compile({ id: "asset-2", data: { prompt: "test" } }), { code: "REMOTE_STORAGE_REQUIRED" });
});

test("silent compiler rejects oversized generation payloads before writing", async () => {
  const store = makeStore();
  const compiler = createSilentAssetCompiler({ store });
  await assert.rejects(
    compiler.compile({ id: "asset-3", data: { prompt: "x".repeat(70 * 1024) } }),
    { code: "GENERATION_DATA_TOO_LARGE" }
  );
  assert.equal(store.rows.size, 0);
  assert.equal(store.events.size, 0);
});

test("silent compiler prevents an asset id from being reused for different content", async () => {
  const compiler = createSilentAssetCompiler({ store: makeStore() });
  await compiler.compile({ id: "asset-4", data: { prompt: "first" } });
  await assert.rejects(compiler.compile({ id: "asset-4", data: { prompt: "different" } }), { code: "ASSET_ID_CONFLICT" });
});

test("silent compiler rejects unsafe ids and non-JSON values", async () => {
  const compiler = createSilentAssetCompiler({ store: makeStore() });
  await assert.rejects(compiler.compile({ id: "../escape", data: { prompt: "test" } }), { code: "INVALID_ASSET_ID" });
  await assert.rejects(compiler.compile({ id: "asset-5", data: { value: Number.NaN } }), /finite/);
});
