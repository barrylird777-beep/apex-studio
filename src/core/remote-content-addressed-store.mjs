import { createHash } from "node:crypto";
import {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand,
  ListObjectsV2Command, DeleteObjectCommand
} from "@aws-sdk/client-s3";

const canonical = value => JSON.stringify(value);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const safe = value => {
  const segment = String(value);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(segment) || segment.includes("..")) {
    throw new Error("Invalid content-addressed storage key segment");
  }
  return segment;
};
const missing = error => ["NoSuchKey", "NotFound", "NoSuchBucket"].includes(error?.name) || error?.$metadata?.httpStatusCode === 404;
const conflict = error => ["PreconditionFailed", "ConditionalRequestConflict"].includes(error?.name) || [409, 412].includes(error?.$metadata?.httpStatusCode);
async function bodyText(body) {
  if (!body) throw new Error("Remote CAS returned an empty object body");
  if (typeof body.transformToString === "function") return body.transformToString();
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * S3-compatible content-addressed store. Objects are immutable SHA-256 blobs;
 * refs are small manifests updated with conditional S3 writes. No local lock
 * files or device-local persistence are used in remote mode.
 */
export class RemoteContentAddressedStore {
  constructor({ endpoint, bucket, region = "auto", accessKeyId, secretAccessKey, prefix = "apex-cas/v1", client } = {}) {
    const env = process.env;
    this.endpoint = String(endpoint ?? env.APEX_OBJECT_STORAGE_ENDPOINT ?? "").trim();
    this.bucket = String(bucket ?? env.APEX_OBJECT_STORAGE_BUCKET ?? "").trim();
    this.region = String(region ?? env.APEX_OBJECT_STORAGE_REGION ?? "auto").trim();
    this.accessKeyId = String(accessKeyId ?? env.APEX_OBJECT_STORAGE_ACCESS_KEY_ID ?? "").trim();
    this.secretAccessKey = String(secretAccessKey ?? env.APEX_OBJECT_STORAGE_SECRET_ACCESS_KEY ?? "").trim();
    this.prefix = String(prefix).replace(/^\/+|\/+$/g, "");
    this.client = client || null;
    if (!this.endpoint || !this.bucket || !this.accessKeyId || !this.secretAccessKey) {
      throw new Error("Remote CAS requires APEX_OBJECT_STORAGE_ENDPOINT, BUCKET, ACCESS_KEY_ID, and SECRET_ACCESS_KEY");
    }
    if (!this.client) this.client = new S3Client({
      endpoint: this.endpoint, region: this.region || "auto", forcePathStyle: false,
      credentials: { accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey }
    });
  }
  objectKey(digest) {
    if (!/^[a-f0-9]{64}$/.test(String(digest))) throw new Error("Invalid SHA-256 object id");
    return `${this.prefix}/objects/sha256/${digest.slice(0, 2)}/${digest}.json`;
  }
  refKey(namespace, key) { return `${this.prefix}/refs/${safe(namespace)}/${safe(key)}.json`; }
  async init() { return this; }
  async putObject(value) {
    const bytes = canonical(value), digest = hash(bytes), key = this.objectKey(digest);
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket, Key: key, Body: bytes, ContentType: "application/json",
        Metadata: { "sha256": digest }, IfNoneMatch: "*"
      }));
    } catch (error) {
      if (!conflict(error)) throw error;
      const existing = await this.getObject(digest);
      if (hash(canonical(existing)) !== digest) throw new Error("Remote object integrity mismatch");
    }
    return { hash: digest, bytes: Buffer.byteLength(bytes), uri: "cas://sha256/" + digest };
  }
  async getObject(digest) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(digest) }));
    const bytes = await bodyText(result.Body);
    if (hash(bytes) !== digest) throw new Error("Remote object integrity verification failed: " + digest);
    return JSON.parse(bytes);
  }
  async readManifest(namespace, key) {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.refKey(namespace, key) }));
      const text = await bodyText(result.Body);
      const manifest = JSON.parse(text);
      if (!manifest || manifest.version !== 1 || !/^[a-f0-9]{64}$/.test(manifest.hash)) throw new Error("Invalid remote CAS manifest");
      return { ...manifest, etag: String(result.ETag || "").replaceAll('"', "") };
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }
  async readRef(namespace, key) {
    await this.init();
    const manifest = await this.readManifest(namespace, key);
    if (!manifest) return null;
    return { ...manifest, value: await this.getObject(manifest.hash) };
  }
  async writeRef(namespace, key, value, { expectedHash = undefined } = {}) {
    await this.init();
    const current = await this.readManifest(namespace, key);
    const actual = current?.hash ?? null;
    if (expectedHash !== undefined && actual !== expectedHash) {
      const error = new Error("Manifest compare-and-swap conflict");
      error.code = "CAS_CONFLICT"; error.expectedHash = expectedHash; error.actualHash = actual; throw error;
    }
    const object = await this.putObject(value);
    const manifest = { version: 1, namespace: String(namespace), key: String(key), hash: object.hash, updatedAt: new Date().toISOString() };
    try {
      const response = await this.client.send(new PutObjectCommand({
        Bucket: this.bucket, Key: this.refKey(namespace, key), Body: canonical(manifest) + "\n",
        ContentType: "application/json",
        ...(current ? { IfMatch: current.etag } : { IfNoneMatch: "*" })
      }));
      return { ...manifest, etag: String(response.ETag || "").replaceAll('"', ""), uri: object.uri, bytes: object.bytes };
    } catch (error) {
      if (conflict(error)) {
        const conflictError = new Error("Manifest compare-and-swap conflict");
        conflictError.code = "CAS_CONFLICT"; conflictError.cause = error; throw conflictError;
      }
      throw error;
    }
  }
  async listRefs(namespace) {
    await this.init();
    const prefix = `${this.prefix}/refs/${safe(namespace)}/`;
    let continuationToken, out = [];
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: continuationToken }));
      // Read manifests in bounded parallel batches. A serial GET per reference
      // made queue refreshes hold the distributed mutation lease for minutes as
      // the namespace grew, blocking every worker behind the same lock.
      const keys = (page.Contents || [])
        .map(item => item.Key)
        .filter(key => typeof key === "string" && key.endsWith(".json"))
        .map(key => key.slice(prefix.length, -5))
        .filter(key => key && !key.includes("/"));
      const batchSize = 16;
      for (let index = 0; index < keys.length; index += batchSize) {
        const refs = await Promise.all(keys.slice(index, index + batchSize).map(key => this.readRef(namespace, key)));
        for (const ref of refs) if (ref) out.push(ref);
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
    return out;
  }
  async deleteRef(namespace, key, { expectedHash = undefined } = {}) {
    await this.init();
    const current = await this.readManifest(namespace, key);
    if (!current) return false;
    if (expectedHash !== undefined && current.hash !== expectedHash) {
      const error = new Error("Manifest compare-and-swap conflict");
      error.code = "CAS_CONFLICT"; throw error;
    }
    try {
      await this.client.send(new DeleteObjectCommand({
        Bucket: this.bucket, Key: this.refKey(namespace, key), IfMatch: current.etag
      }));
      return true;
    } catch (error) {
      if (conflict(error)) { const e = new Error("Manifest compare-and-swap conflict"); e.code = "CAS_CONFLICT"; throw e; }
      throw error;
    }
  }
}
