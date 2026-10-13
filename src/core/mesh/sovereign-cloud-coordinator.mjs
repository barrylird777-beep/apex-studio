import { createHash, randomUUID } from "node:crypto";
import {
  S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command,
  DeleteObjectCommand
} from "@aws-sdk/client-s3";

/**
 * Cloud-only control plane for the APEX peer mesh.
 *
 * This module intentionally has no filesystem, local database, or WAL fallback.
 * It stores small coordination records in an S3-compatible bucket. The selected
 * object store MUST support conditional writes for safe claims; startup fails
 * closed if a deployment has not explicitly confirmed that contract.
 *
 * Do not store secrets or private job payloads in peer advertisements.
 */
const APPS = new Set(["KernelVision", "XShield", "Kernelodies", "PlanetApeX", "KashKorner", "KoinKob"]);
const now = () => Date.now();
const hash = value => createHash("sha256").update(value).digest("hex");
const segment = value => {
  const s = String(value ?? "");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(s) || s.includes("..")) throw new Error("Invalid cloud mesh key segment");
  return s;
};
async function bodyText(body) {
  if (!body) throw new Error("Cloud mesh object has an empty body");
  if (typeof body.transformToString === "function") return body.transformToString();
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
const notFound = e => e?.$metadata?.httpStatusCode === 404 || ["NoSuchKey", "NotFound"].includes(e?.name);
const conflict = e => [409, 412].includes(e?.$metadata?.httpStatusCode) || ["PreconditionFailed", "ConditionalRequestConflict"].includes(e?.name);

export class SovereignCloudCoordinator {
  constructor({ endpoint, bucket, region = "auto", accessKeyId, secretAccessKey, prefix = "apex-mesh/v1", client, conditionalWritesConfirmed = process.env.APEX_S3_CONDITIONAL_WRITES_CONFIRMED === "true" } = {}) {
    this.endpoint = String(endpoint ?? process.env.APEX_OBJECT_STORAGE_ENDPOINT ?? "").trim();
    this.bucket = String(bucket ?? process.env.APEX_OBJECT_STORAGE_BUCKET ?? "").trim();
    this.region = String(region ?? process.env.APEX_OBJECT_STORAGE_REGION ?? "auto").trim();
    const id = String(accessKeyId ?? process.env.APEX_OBJECT_STORAGE_ACCESS_KEY_ID ?? "").trim();
    const secret = String(secretAccessKey ?? process.env.APEX_OBJECT_STORAGE_SECRET_ACCESS_KEY ?? "").trim();
    this.prefix = String(prefix).replace(/^\/+|\/+$/g, "");
    if (!this.endpoint || !this.bucket || !id || !secret) throw new Error("Cloud-only mesh requires an S3 endpoint, bucket, and credentials");
    if (!conditionalWritesConfirmed) throw new Error("Fail-closed: set APEX_S3_CONDITIONAL_WRITES_CONFIRMED=true only after verifying conditional PUT semantics on the target provider");
    this.client = client ?? new S3Client({ endpoint: this.endpoint, region: this.region, forcePathStyle: process.env.APEX_S3_FORCE_PATH_STYLE === "true", credentials: { accessKeyId: id, secretAccessKey: secret } });
  }
  key(...parts) { return [this.prefix, ...parts.map(segment)].join("/"); }
  async putImmutable(key, value) {
    const body = JSON.stringify(value);
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: "application/json", Metadata: { sha256: hash(body) }, IfNoneMatch: "*" }));
      return { created: true, sha256: hash(body) };
    } catch (e) {
      if (!conflict(e)) throw e;
      return { created: false, sha256: hash(body) };
    }
  }
  async read(key) {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const body = await bodyText(result.Body);
      if (result.Metadata?.sha256 && result.Metadata.sha256 !== hash(body)) throw new Error("Cloud mesh record checksum mismatch");
      return { value: JSON.parse(body), etag: String(result.ETag || "").replaceAll('"', "") };
    } catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
  }
  async advertisePeer({ app, peerId, capabilities = [], maxConcurrent = 1, expiresInMs = 30000, region = "unknown" }) {
    if (!APPS.has(app)) throw new Error("Unknown canonical app scope");
    const id = segment(peerId);
    const record = { version: 1, app, peerId: id, capabilities: [...new Set(capabilities.map(segment))].slice(0, 64), maxConcurrent: Math.max(1, Math.min(256, Number(maxConcurrent) || 1)), region: segment(region), updatedAt: now(), expiresAt: now() + Math.max(5000, Math.min(120000, Number(expiresInMs) || 30000)) };
    const key = this.key("apps", app, "peers", id + ".json");
    // Peer advertisements are replaceable liveness hints, not an authority for job claims.
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: JSON.stringify(record), ContentType: "application/json", Metadata: { sha256: hash(JSON.stringify(record)) } }));
    return record;
  }
  async discoverPeers({ app, limit = 100 } = {}) {
    if (!APPS.has(app)) throw new Error("Unknown canonical app scope");
    const prefix = this.key("apps", app, "peers") + "/";
    const result = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, MaxKeys: Math.min(1000, Math.max(1, Number(limit) || 100)) }));
    const peers = [];
    for (const item of result.Contents || []) {
      const record = await this.read(item.Key);
      if (record?.value?.app === app && record.value.expiresAt > now()) peers.push(record.value);
    }
    return { app, peers, count: peers.length, truncated: Boolean(result.IsTruncated), nextContinuationToken: result.NextContinuationToken || null };
  }
  async publishJob({ app, jobId = randomUUID(), taskType, payloadHash, capability, expiresInMs = 60000 }) {
    if (!APPS.has(app)) throw new Error("Unknown canonical app scope");
    if (!/^[a-f0-9]{64}$/.test(String(payloadHash || ""))) throw new Error("Job requires a SHA-256 payload hash; payload bytes belong in private content-addressed storage");
    const id = segment(jobId);
    const type = segment(taskType);
    const cap = segment(capability);
    const record = { version: 1, app, jobId: id, taskType: type, payloadHash, capability: cap, createdAt: now(), expiresAt: now() + Math.max(5000, Math.min(3600000, Number(expiresInMs) || 60000)), status: "queued" };
    const result = await this.putImmutable(this.key("apps", app, "jobs", id + ".json"), record);
    if (!result.created) throw new Error("Job ID already exists; refusing to overwrite a prior job");
    return { ...record, sha256: result.sha256 };
  }
  async listQueuedJobs({ app, limit = 100 } = {}) {
    if (!APPS.has(app)) throw new Error("Unknown canonical app scope");
    const prefix = this.key("apps", app, "jobs") + "/";
    const listed = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, MaxKeys: Math.min(1000, Math.max(1, Number(limit) || 100)) }));
    const jobs = [];
    for (const item of listed.Contents || []) {
      const stored = await this.read(item.Key);
      if (stored?.value?.app === app && stored.value.status === "queued" && stored.value.expiresAt > now()) jobs.push(stored.value);
    }
    jobs.sort((a, b) => a.createdAt - b.createdAt);
    return { app, jobs, count: jobs.length, truncated: Boolean(listed.IsTruncated), nextContinuationToken: listed.NextContinuationToken || null };
  }
  async claimNextJob({ app, workerId, leaseMs = 30000, limit = 100 } = {}) {
    const listed = await this.listQueuedJobs({ app, limit });
    for (const job of listed.jobs) {
      const claim = await this.claimJob({ app, jobId: job.jobId, workerId, leaseMs });
      if (claim.claimed) return { job, lease: claim.lease };
    }
    return null;
  }
  async getJob({ app, jobId }) {
    if (!APPS.has(app)) throw new Error("Unknown canonical app scope");
    const record = await this.read(this.key("apps", app, "jobs", segment(jobId) + ".json"));
    if (!record) return null;
    if (record.value.app !== app || record.value.jobId !== jobId) throw new Error("App-scope integrity check failed");
    return record.value;
  }
  async claimJob({ app, jobId, workerId, leaseMs = 30000 }) {
    if (!APPS.has(app)) throw new Error("Unknown canonical app scope");
    const id = segment(jobId);
    const worker = segment(workerId);
    const jobKey = this.key("apps", app, "jobs", id + ".json");
    const jobResult = await this.read(jobKey);
    if (!jobResult) return { claimed: false, reason: "not-found" };
    const job = jobResult.value;
    if (job.app !== app || job.jobId !== id) throw new Error("App-scope integrity check failed");
    if (job.expiresAt <= now()) return { claimed: false, reason: "expired" };
    const leaseKey = this.key("apps", app, "leases", id + ".json");
    const lease = { version: 1, app, jobId: id, workerId: worker, token: randomUUID(), fence: now(), claimedAt: now(), expiresAt: now() + Math.max(5000, Math.min(300000, Number(leaseMs) || 30000)) };
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: leaseKey, Body: JSON.stringify(lease), ContentType: "application/json", Metadata: { sha256: hash(JSON.stringify(lease)) }, IfNoneMatch: "*" }));
      return { claimed: true, lease };
    } catch (e) {
      if (!conflict(e)) throw e;
      const existing = await this.read(leaseKey);
      if (!existing || existing.value.expiresAt > now()) return { claimed: false, reason: "leased" };
      // Expired-lease takeover requires provider-verified compare-and-swap semantics.
      if (!existing.etag) return { claimed: false, reason: "lease-etag-unavailable" };
      try {
        await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: leaseKey, Body: JSON.stringify(lease), ContentType: "application/json", Metadata: { sha256: hash(JSON.stringify(lease)) }, IfMatch: existing.etag }));
        return { claimed: true, lease, reclaimed: true };
      } catch (replaceError) {
        if (conflict(replaceError)) return { claimed: false, reason: "lease-race-lost" };
        throw replaceError;
      }
    }
  }
  async finishJob({ app, jobId, workerId, leaseToken, resultHash = null, status = "completed" }) {
    if (!APPS.has(app)) throw new Error("Unknown canonical app scope");
    if (!["completed", "failed"].includes(status)) throw new Error("Invalid terminal job status");
    const id = segment(jobId);
    const worker = segment(workerId);
    const leaseKey = this.key("apps", app, "leases", id + ".json");
    const current = await this.read(leaseKey);
    if (!current || current.value.workerId !== worker || current.value.token !== leaseToken || current.value.expiresAt <= now()) return { accepted: false, reason: "lease-invalid" };
    const record = { version: 1, app, jobId: id, workerId: worker, status, resultHash: resultHash == null ? null : String(resultHash), finishedAt: now(), leaseToken };
    const eventKey = this.key("apps", app, "job-events", id + "/" + randomUUID() + ".json");
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: eventKey, Body: JSON.stringify(record), ContentType: "application/json", Metadata: { sha256: hash(JSON.stringify(record)) }, IfNoneMatch: "*" }));
    return { accepted: true, event: record };
  }
  async health() {
    const key = this.key("health", randomUUID() + ".json");
    const proof = { version: 1, nonce: randomUUID(), timestamp: now() };
    const body = JSON.stringify(proof);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: "application/json", Metadata: { sha256: hash(body) } }));
    const readback = await this.read(key);
    if (!readback || readback.value.nonce !== proof.nonce) throw new Error("Cloud persistence round-trip failed");
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    return { ready: true, persistence: "remote-s3-compatible", readAfterWrite: true, checkedAt: new Date().toISOString() };
  }
}
