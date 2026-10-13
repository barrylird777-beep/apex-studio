import { createHash } from "node:crypto";
import {
  S3Client, PutObjectCommand, GetObjectCommand,
  ListObjectsV2Command, DeleteObjectCommand
} from "@aws-sdk/client-s3";
import { encodeCanonical, decodeCanonical } from "./apex-cbor.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const safe = value => {
  const segment = String(value);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(segment) || segment.includes("..")) {
    throw new Error("Invalid binary CAS key segment");
  }
  return segment;
};
const missing = error => ["NoSuchKey", "NotFound", "NoSuchBucket"].includes(error?.name) || error?.$metadata?.httpStatusCode === 404;
const conflict = error => ["PreconditionFailed", "ConditionalRequestConflict"].includes(error?.name) || [409, 412].includes(error?.$metadata?.httpStatusCode);

async function bodyBytes(body) {
  if (!body) throw new Error("Binary CAS returned an empty object body");
  if (typeof body.transformToByteArray === "function") return Buffer.from(await body.transformToByteArray());
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return Buffer.from(body);
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/**
 * Provider-neutral S3-compatible CAS using canonical CBOR binary objects and
 * manifests. It has no filesystem fallback; configuration is mandatory.
 * This is a new v2 namespace and never interprets or overwrites legacy JSON CAS.
 */
export class RemoteBinaryContentAddressedStore {
  constructor({ endpoint, bucket, region = "auto", accessKeyId, secretAccessKey, prefix = "apex-cas/v2", client } = {}) {
    const env = process.env;
    this.endpoint = String(endpoint ?? env.APEX_OBJECT_STORAGE_ENDPOINT ?? "").trim();
    this.bucket = String(bucket ?? env.APEX_OBJECT_STORAGE_BUCKET ?? "").trim();
    this.region = String(region ?? env.APEX_OBJECT_STORAGE_REGION ?? "auto").trim();
    this.accessKeyId = String(accessKeyId ?? env.APEX_OBJECT_STORAGE_ACCESS_KEY_ID ?? "").trim();
    this.secretAccessKey = String(secretAccessKey ?? env.APEX_OBJECT_STORAGE_SECRET_ACCESS_KEY ?? "").trim();
    this.prefix = String(prefix).replace(/^\/+|\/+$/g, "");
    this.client = client || null;
    if (!this.endpoint || !this.bucket || !this.accessKeyId || !this.secretAccessKey) {
      throw new Error("Binary CAS requires APEX_OBJECT_STORAGE_ENDPOINT, BUCKET, ACCESS_KEY_ID, and SECRET_ACCESS_KEY");
    }
    if (!this.client) this.client = new S3Client({
      endpoint: this.endpoint, region: this.region || "auto",
      credentials: { accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey }
    });
  }
  objectKey(digest) {
    if (!/^[a-f0-9]{64}$/.test(String(digest))) throw new Error("Invalid SHA-256 object id");
    return `${this.prefix}/objects/sha256/${digest.slice(0, 2)}/${digest}.cbor`;
  }
  refKey(namespace, key) { return `${this.prefix}/refs/${safe(namespace)}/${safe(key)}.cbor`; }
  async init() { return this; }
  async putObject(value) {
    const bytes = encodeCanonical(value), digest = hash(bytes), key = this.objectKey(digest);
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket, Key: key, Body: bytes, ContentType: "application/cbor",
        Metadata: { sha256: digest }, IfNoneMatch: "*"
      }));
    } catch (error) {
      if (!conflict(error)) throw error;
      await this.getObject(digest);
    }
    return { hash: digest, bytes: bytes.byteLength, uri: "cas://sha256/" + digest };
  }
  async getObject(digest) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(digest) }));
    const bytes = await bodyBytes(result.Body);
    if (hash(bytes) !== digest) throw new Error("Binary CAS integrity verification failed: " + digest);
    return decodeCanonical(bytes);
  }
  async readManifest(namespace, key) {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.refKey(namespace, key) }));
      const bytes = await bodyBytes(result.Body);
      const manifest = decodeCanonical(bytes);
      if (!manifest || manifest.version !== 2 || !/^[a-f0-9]{64}$/.test(manifest.hash)) throw new Error("Invalid binary CAS manifest");
      return { ...manifest, etag: String(result.ETag || "").replaceAll('"', "") };
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }
  async readRef(namespace, key) {
    const manifest = await this.readManifest(namespace, key);
    if (!manifest) return null;
    return { ...manifest, value: await this.getObject(manifest.hash) };
  }
  async writeRef(namespace, key, value, { expectedHash = undefined } = {}) {
    const current = await this.readManifest(namespace, key);
    if (expectedHash !== undefined && (current?.hash ?? null) !== expectedHash) {
      const error = new Error("Binary CAS compare-and-swap conflict");
      error.code = "CAS_CONFLICT"; throw error;
    }
    const object = await this.putObject(value);
    const manifest = { version: 2, namespace: String(namespace), key: String(key), hash: object.hash, updatedAt: new Date().toISOString() };
    try {
      const response = await this.client.send(new PutObjectCommand({
        Bucket: this.bucket, Key: this.refKey(namespace, key), Body: encodeCanonical(manifest),
        ContentType: "application/cbor",
        ...(current ? { IfMatch: current.etag } : { IfNoneMatch: "*" })
      }));
      return { ...manifest, etag: String(response.ETag || "").replaceAll('"', ""), uri: object.uri, bytes: object.bytes };
    } catch (error) {
      if (conflict(error)) {
        const conflictError = new Error("Binary CAS compare-and-swap conflict");
        conflictError.code = "CAS_CONFLICT"; conflictError.cause = error; throw conflictError;
      }
      throw error;
    }
  }
  async listRefs(namespace) {
    const prefix = `${this.prefix}/refs/${safe(namespace)}/`;
    let continuationToken, out = [];
    do {
      const page = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket, Prefix: prefix, ...(continuationToken ? { ContinuationToken: continuationToken } : {})
      }));
      const keys = (page.Contents || []).map(item => item.Key)
        .filter(key => typeof key === "string" && key.endsWith(".cbor"))
        .map(key => key.slice(prefix.length, -5)).filter(key => key && !key.includes("/"));
      for (let i = 0; i < keys.length; i += 64) {
        const refs = await Promise.all(keys.slice(i, i + 64).map(key => this.readRef(namespace, key)));
        out.push(...refs.filter(Boolean));
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
    return out;
  }
  async deleteRef(namespace, key, { expectedHash = undefined } = {}) {
    const current = await this.readManifest(namespace, key);
    if (!current) return false;
    if (expectedHash !== undefined && current.hash !== expectedHash) {
      const error = new Error("Binary CAS compare-and-swap conflict");
      error.code = "CAS_CONFLICT"; throw error;
    }
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.refKey(namespace, key), IfMatch: current.etag }));
      return true;
    } catch (error) {
      if (conflict(error)) { const e = new Error("Binary CAS compare-and-swap conflict"); e.code = "CAS_CONFLICT"; throw e; }
      throw error;
    }
  }
}
