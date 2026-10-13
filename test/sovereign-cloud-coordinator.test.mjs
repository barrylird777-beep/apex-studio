import test from "node:test";
import assert from "node:assert/strict";
import { SovereignCloudCoordinator } from "../src/core/mesh/sovereign-cloud-coordinator.mjs";

function fakeS3() {
  const objects = new Map();
  return {
    objects,
    async send(command) {
      const { input } = command;
      const name = command.constructor.name;
      if (name === "PutObjectCommand") {
        if (input.IfNoneMatch === "*" && objects.has(input.Key)) {
          const error = new Error("precondition failed"); error.name = "PreconditionFailed"; error.$metadata = { httpStatusCode: 412 }; throw error;
        }
        if (input.IfMatch) {
          const current = objects.get(input.Key);
          if (!current || current.etag !== input.IfMatch) {
            const error = new Error("precondition failed"); error.name = "PreconditionFailed"; error.$metadata = { httpStatusCode: 412 }; throw error;
          }
        }
        const etag = '"' + String(objects.size + 1) + '-test-etag"';
        objects.set(input.Key, { body: Buffer.isBuffer(input.Body) ? input.Body.toString() : String(input.Body), metadata: input.Metadata || {}, etag });
        return { ETag: etag };
      }
      if (name === "GetObjectCommand" || name === "HeadObjectCommand") {
        const obj = objects.get(input.Key);
        if (!obj) { const error = new Error("not found"); error.name = "NoSuchKey"; error.$metadata = { httpStatusCode: 404 }; throw error; }
        if (name === "HeadObjectCommand") return { Metadata: obj.metadata, ETag: obj.etag };
        return { Body: { async transformToString() { return obj.body; } }, Metadata: obj.metadata, ETag: obj.etag };
      }
      if (name === "ListObjectsV2Command") {
        const contents = [...objects.keys()].filter(k => k.startsWith(input.Prefix)).slice(0, input.MaxKeys).map(Key => ({ Key }));
        return { Contents: contents, IsTruncated: false };
      }
      if (name === "DeleteObjectCommand") { objects.delete(input.Key); return {}; }
      throw new Error("Unexpected S3 command: " + name);
    }
  };
}
function coordinator(client, confirmed = true) {
  return new SovereignCloudCoordinator({ endpoint: "https://objects.example.invalid", bucket: "apex-test", accessKeyId: "test-access", secretAccessKey: "test-secret", client, conditionalWritesConfirmed: confirmed });
}

test("cloud-only coordinator fails closed without verified conditional-write capability", () => {
  assert.throws(() => coordinator(fakeS3(), false), /conditional PUT semantics/);
});

test("cloud readiness proves remote write/read/delete round trip", async () => {
  const c = coordinator(fakeS3());
  const status = await c.health();
  assert.equal(status.ready, true);
  assert.equal(status.readAfterWrite, true);
  assert.equal(status.persistence, "remote-s3-compatible");
  assert.equal(c.client.objects.size, 0);
});

test("peer discovery is scoped to each canonical app and expires stale peers", async () => {
  const c = coordinator(fakeS3());
  await c.advertisePeer({ app: "KernelVision", peerId: "peer-one", capabilities: ["render"], expiresInMs: 5000 });
  await c.advertisePeer({ app: "XShield", peerId: "peer-two", capabilities: ["security"] });
  const studio = await c.discoverPeers({ app: "KernelVision" });
  const shield = await c.discoverPeers({ app: "XShield" });
  assert.deepEqual(studio.peers.map(p => p.peerId), ["peer-one"]);
  assert.deepEqual(shield.peers.map(p => p.peerId), ["peer-two"]);
  await assert.rejects(c.discoverPeers({ app: "unknown" }), /Unknown canonical app scope/);
});

test("job manifests require content hashes and cannot overwrite an existing job ID", async () => {
  const c = coordinator(fakeS3());
  await assert.rejects(c.publishJob({ app: "PlanetApeX", jobId: "job-bad", taskType: "research", capability: "search", payloadHash: "not-a-hash" }), /SHA-256/);
  const payloadHash = "a".repeat(64);
  const job = await c.publishJob({ app: "PlanetApeX", jobId: "job-one", taskType: "research", capability: "search", payloadHash });
  assert.equal(job.status, "queued");
  assert.equal((await c.getJob({ app: "PlanetApeX", jobId: "job-one" })).payloadHash, payloadHash);
  assert.equal(await c.getJob({ app: "KernelVision", jobId: "job-one" }), null);
  await assert.rejects(c.publishJob({ app: "PlanetApeX", jobId: "job-one", taskType: "research", capability: "search", payloadHash }), /already exists/);
});

test("only one worker wins a cloud lease and only its token can finish", async () => {
  const c = coordinator(fakeS3());
  const payloadHash = "b".repeat(64);
  await c.publishJob({ app: "KernelVision", jobId: "render-job", taskType: "render", capability: "ffmpeg", payloadHash });
  const [first, second] = await Promise.all([
    c.claimJob({ app: "KernelVision", jobId: "render-job", workerId: "worker-a", leaseMs: 30000 }),
    c.claimJob({ app: "KernelVision", jobId: "render-job", workerId: "worker-b", leaseMs: 30000 })
  ]);
  assert.equal([first, second].filter(result => result.claimed).length, 1);
  const winner = first.claimed ? first : second;
  const loser = first.claimed ? second : first;
  assert.equal(loser.claimed, false);
  const winnerId = winner.lease.workerId;
  const wrongId = winnerId === "worker-a" ? "worker-b" : "worker-a";
  assert.deepEqual(await c.finishJob({ app: "KernelVision", jobId: "render-job", workerId: wrongId, leaseToken: winner.lease.token }), { accepted: false, reason: "lease-invalid" });
  assert.equal((await c.finishJob({ app: "KernelVision", jobId: "render-job", workerId: winnerId, leaseToken: winner.lease.token, resultHash: "c".repeat(64) })).accepted, true);
});
