import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { RemoteContentAddressedStore } from "../src/core/remote-content-addressed-store.mjs";

class FakeS3 {
  constructor() { this.objects = new Map(); this.sequence = 0; }
  async send(command) {
    const { Bucket, Key, Body, IfNoneMatch, IfMatch, Prefix, ContinuationToken } = command.input;
    const id = Bucket + "/" + Key;
    if (command.constructor.name === "PutObjectCommand") {
      const old = this.objects.get(id);
      if (IfNoneMatch === "*" && old) throw Object.assign(new Error("exists"), { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } });
      if (IfMatch && (!old || old.etag !== IfMatch.replaceAll('"', ""))) throw Object.assign(new Error("changed"), { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } });
      const bytes = typeof Body === "string" ? Body : Buffer.from(Body).toString("utf8");
      const etag = "etag-" + (++this.sequence);
      this.objects.set(id, { bytes, etag });
      return { ETag: '"' + etag + '"' };
    }
    if (command.constructor.name === "GetObjectCommand") {
      const row = this.objects.get(id);
      if (!row) throw Object.assign(new Error("missing"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
      return { Body: { transformToString: async () => row.bytes }, ETag: '"' + row.etag + '"' };
    }
    if (command.constructor.name === "ListObjectsV2Command") {
      const keys = [...this.objects.keys()].filter(k => k.startsWith(Bucket + "/" + Prefix)).map(k => k.slice(Bucket.length + 1)).sort();
      const offset = Number(ContinuationToken || 0), page = keys.slice(offset, offset + 2);
      return { Contents: page.map(Key => ({ Key })), IsTruncated: offset + 2 < keys.length, NextContinuationToken: String(offset + 2) };
    }
    if (command.constructor.name === "DeleteObjectCommand") {
      const old = this.objects.get(id);
      if (IfMatch && (!old || old.etag !== IfMatch.replaceAll('"', ""))) throw Object.assign(new Error("changed"), { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } });
      this.objects.delete(id); return {};
    }
    throw new Error("Unexpected S3 command " + command.constructor.name);
  }
}

function makeStore(client) {
  return new RemoteContentAddressedStore({
    endpoint: "https://storage.example.test", bucket: "test-bucket", region: "auto",
    accessKeyId: "test-key", secretAccessKey: "test-secret", client
  });
}

test("remote CAS stores immutable objects and verifies SHA-256 on read", async () => {
  const client = new FakeS3(), store = makeStore(client);
  const saved = await store.putObject({ hello: "world" });
  assert.equal(saved.hash, createHash("sha256").update('{"hello":"world"}').digest("hex"));
  assert.deepEqual(await store.getObject(saved.hash), { hello: "world" });
});

test("remote manifests round-trip and enforce compare-and-swap", async () => {
  const store = makeStore(new FakeS3());
  const first = await store.writeRef("state", "record-1", { revision: 1 }, { expectedHash: null });
  assert.deepEqual((await store.readRef("state", "record-1")).value, { revision: 1 });
  await assert.rejects(store.writeRef("state", "record-1", { revision: 2 }, { expectedHash: "0".repeat(64) }), e => e.code === "CAS_CONFLICT");
  const second = await store.writeRef("state", "record-1", { revision: 2 }, { expectedHash: first.hash });
  assert.notEqual(second.hash, first.hash);
  assert.deepEqual((await store.readRef("state", "record-1")).value, { revision: 2 });
  assert.equal(await store.deleteRef("state", "record-1", { expectedHash: second.hash }), true);
  assert.equal(await store.readRef("state", "record-1"), null);
});

test("remote CAS paginates namespace references without local filesystem locks", async () => {
  const store = makeStore(new FakeS3());
  await Promise.all(["one", "two", "three"].map(key => store.writeRef("jobs", key, { id: key })));
  const refs = await store.listRefs("jobs");
  assert.deepEqual(refs.map(ref => ref.key).sort(), ["one", "three", "two"]);
});

test("remote CAS refuses missing credentials rather than falling back to disk", () => {
  const keys = ["APEX_OBJECT_STORAGE_ENDPOINT", "APEX_OBJECT_STORAGE_BUCKET", "APEX_OBJECT_STORAGE_REGION", "APEX_OBJECT_STORAGE_ACCESS_KEY_ID", "APEX_OBJECT_STORAGE_SECRET_ACCESS_KEY"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  try {
    assert.throws(() => new RemoteContentAddressedStore({ endpoint: "https://storage.example.test", bucket: "b" }), /requires APEX_OBJECT_STORAGE/);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
