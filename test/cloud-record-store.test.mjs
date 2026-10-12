import test from "node:test";
import assert from "node:assert/strict";
import { createCloudRecordStore } from "../src/storage/cloud-record-store.mjs";

test("cloud record store writes, reads, hashes, lists, filters, and deletes through S3 only", async () => {
  const objects = new Map();
  const client = { async send(command) {
    const { constructor, input } = command;
    if (constructor.name === "PutObjectCommand") {
      objects.set(input.Key, { body: input.Body, metadata: input.Metadata });
      return {};
    }
    if (constructor.name === "GetObjectCommand") {
      const item = objects.get(input.Key);
      if (!item) { const e = new Error("missing"); e.name = "NoSuchKey"; throw e; }
      return { Body: { async transformToString() { return item.body; } } };
    }
    if (constructor.name === "ListObjectsV2Command") {
      const Contents = [...objects.keys()].filter(k => k.startsWith(input.Prefix)).map(Key => ({ Key }));
      return { Contents, IsTruncated: false };
    }
    if (constructor.name === "DeleteObjectCommand") { objects.delete(input.Key); return {}; }
    throw new Error("Unexpected command " + constructor.name);
  } };
  const store = createCloudRecordStore({ client, bucket: "test-bucket" });
  const record = { id: "e1", title: "Cloud survives", revision: 1 };
  assert.deepEqual(await store.put("episodes", "e1", record), record);
  assert.deepEqual(await store.get("episodes", "e1"), record);
  assert.deepEqual(await store.query("episodes", { filters: { revision: 1 } }), [record]);
  assert.deepEqual(await store.query("episodes", { filters: { revision: 2 } }), []);
  const object = [...objects.values()][0];
  object.body = object.body.replace('"title":"Cloud survives"', '"title":"tampered"');
  await assert.rejects(() => store.get("episodes", "e1"), /integrity check failed/);
  await store.delete("episodes", "e1");
  assert.equal(await store.get("episodes", "e1"), null);
  assert.equal(store.localFallback, false);
});

test("cloud record store fails closed when cloud credentials are missing", () => {
  const keys = ["APEX_OBJECT_STORAGE_ENDPOINT", "APEX_OBJECT_STORAGE_ACCESS_KEY_ID", "APEX_OBJECT_STORAGE_SECRET_ACCESS_KEY"];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const key of keys) delete process.env[key];
  try {
    assert.throws(() => createCloudRecordStore({ bucket: "test-bucket" }), /local fallback is forbidden/);
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value !== undefined) process.env[key] = value;
  }
});


test("Cloud-required core mode fails closed instead of falling back to local files", async () => {
  const { ApexPureStore } = await import("../src/core/apex-pure-store.mjs");
  const previous = process.env.APEX_STORAGE_MODE;
  process.env.APEX_STORAGE_MODE = "cloud";
  try {
    await assert.rejects(() => new ApexPureStore().init(), /refusing local filesystem fallback/);
  } finally {
    if (previous === undefined) delete process.env.APEX_STORAGE_MODE;
    else process.env.APEX_STORAGE_MODE = previous;
  }
});
