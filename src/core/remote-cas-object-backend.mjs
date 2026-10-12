import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
const text = value => String(value || "").trim();
export class RemoteCasObjectBackend {
  constructor(env = process.env) {
    const endpoint = text(env.APEX_OBJECT_STORAGE_ENDPOINT);
    const bucket = text(env.APEX_OBJECT_STORAGE_BUCKET);
    const accessKeyId = text(env.APEX_OBJECT_STORAGE_ACCESS_KEY_ID);
    const secretAccessKey = text(env.APEX_OBJECT_STORAGE_SECRET_ACCESS_KEY);
    const remoteRequested = text(env.APEX_CAS_REMOTE_ENABLED).toLowerCase() === "true";
    this.required = text(env.APEX_CAS_REMOTE_REQUIRED).toLowerCase() === "true" ||
      text(env.NODE_ENV).toLowerCase() === "production" || remoteRequested;
    const completeCredentials = Boolean(endpoint && bucket && accessKeyId && secretAccessKey);
    if (this.required && (!remoteRequested || !completeCredentials)) {
      throw new Error("Remote-only CAS is required but APEX_CAS_REMOTE_ENABLED or object-storage credentials are missing");
    }
    if (this.required && text(env.APEX_CAS_REMOTE_MIGRATION_VERIFIED).toLowerCase() !== "true") {
      throw new Error("Remote-only CAS migration is not verified; refusing startup to prevent orphaning existing data");
    }
    this.enabled = remoteRequested && completeCredentials;
    this.prefix = text(env.APEX_CAS_OBJECT_PREFIX) || "apex-cas/objects/sha256";
    if (!this.enabled) return;
    this.bucket = bucket;
    this.client = new S3Client({ endpoint, region: text(env.APEX_OBJECT_STORAGE_REGION) || "auto", forcePathStyle: text(env.APEX_OBJECT_STORAGE_URL_STYLE) === "path", credentials: { accessKeyId, secretAccessKey } });
  }
  key(digest) {
    if (!/^[a-f0-9]{64}$/.test(String(digest))) throw new Error("Invalid SHA-256 object id");
    return this.prefix + "/" + digest.slice(0, 2) + "/" + digest + ".json";
  }
  async put(digest, bytes) {
    if (!this.enabled) return false;
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.key(digest), Body: bytes, ContentLength: Buffer.byteLength(bytes), ContentType: "application/json", Metadata: { sha256: digest } }));
    return true;
  }
  refKey(namespace, key) {
    const ns = String(namespace);
    const id = String(key);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(ns) || ns.includes("..") ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id) || id.includes("..")) {
      throw new Error("Invalid remote CAS manifest path");
    }
    return "apex-cas/refs/" + ns + "/" + id + ".json";
  }
  async getRefSnapshot(namespace, key) {
    if (!this.enabled) return null;
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.refKey(namespace, key) }));
      if (!response.Body) throw new Error("Remote CAS manifest response has no body");
      if (!response.ETag) throw new Error("Remote CAS provider omitted manifest ETag; refusing unsafe mutation");
      return { body: await response.Body.transformToString("utf-8"), etag: response.ETag };
    } catch (error) {
      const status = error?.$metadata?.httpStatusCode;
      const code = error?.name || error?.Code || error?.code;
      if (status === 404 || code === "NoSuchKey" || code === "NotFound") return null;
      throw error;
    }
  }
  async getRef(namespace, key) {
    const snapshot = await this.getRefSnapshot(namespace, key);
    return snapshot?.body ?? null;
  }
  async compareAndSwapRef(namespace, key, expectedHash, body) {
    if (!this.enabled) return false;
    const snapshot = await this.getRefSnapshot(namespace, key);
    let actualHash = null;
    if (snapshot) {
      try { actualHash = JSON.parse(snapshot.body)?.hash ?? null; }
      catch { throw new Error("Remote CAS manifest is invalid; refusing conditional update"); }
    }
    if (actualHash !== expectedHash) {
      const error = new Error("Manifest compare-and-swap conflict");
      error.code = "CAS_CONFLICT";
      error.expectedHash = expectedHash;
      error.actualHash = actualHash;
      throw error;
    }
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket, Key: this.refKey(namespace, key), Body: String(body),
        ContentLength: Buffer.byteLength(String(body)), ContentType: "application/json",
        ...(snapshot ? { IfMatch: snapshot.etag } : { IfNoneMatch: "*" })
      }));
      return true;
    } catch (error) {
      if ([409, 412].includes(error?.$metadata?.httpStatusCode) || ["PreconditionFailed", "ConditionalRequestConflict"].includes(error?.name)) {
        const conflict = new Error("Manifest compare-and-swap conflict");
        conflict.code = "CAS_CONFLICT";
        throw conflict;
      }
      throw error;
    }
  }
  async deleteRefIfMatch(namespace, key, expectedHash) {
    if (!this.enabled) return false;
    const snapshot = await this.getRefSnapshot(namespace, key);
    if (!snapshot) return false;
    let actualHash = null;
    try { actualHash = JSON.parse(snapshot.body)?.hash ?? null; }
    catch { throw new Error("Remote CAS manifest is invalid; refusing conditional delete"); }
    if (actualHash !== expectedHash) {
      const error = new Error("Manifest compare-and-swap conflict");
      error.code = "CAS_CONFLICT";
      error.expectedHash = expectedHash;
      error.actualHash = actualHash;
      throw error;
    }
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.refKey(namespace, key), IfMatch: snapshot.etag }));
      return true;
    } catch (error) {
      if ([409, 412].includes(error?.$metadata?.httpStatusCode) || ["PreconditionFailed", "ConditionalRequestConflict"].includes(error?.name)) {
        const conflict = new Error("Manifest compare-and-swap conflict");
        conflict.code = "CAS_CONFLICT";
        throw conflict;
      }
      throw error;
    }
  }
  async putRef(namespace, key, textValue) {
    if (!this.enabled) return false;
    const body = String(textValue);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: this.refKey(namespace, key), Body: body,
      ContentLength: Buffer.byteLength(body), ContentType: "application/json"
    }));
    return true;
  }
  async deleteRef(namespace, key) {
    if (!this.enabled) return false;
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.refKey(namespace, key) }));
    return true;
  }
  async listRefs(namespace) {
    if (!this.enabled) return [];
    const prefix = "apex-cas/refs/" + String(namespace) + "/";
    const keys = [];
    let ContinuationToken;
    do {
      const response = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket, Prefix: prefix, ContinuationToken
      }));
      for (const item of response.Contents || []) {
        if (item.Key && item.Key.startsWith(prefix) && item.Key.endsWith(".json")) keys.push(item.Key.slice(prefix.length, -5));
      }
      ContinuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (ContinuationToken);
    return keys;
  }

  async get(digest) {
    if (!this.enabled) return null;
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(digest) }));
      if (!response.Body) throw new Error("Remote CAS object response has no body");
      return await response.Body.transformToString("utf-8");
    } catch (error) {
      const status = error?.$metadata?.httpStatusCode;
      const code = error?.name || error?.Code || error?.code;
      if (status === 404 || code === "NoSuchKey" || code === "NotFound") return null;
      throw error;
    }
  }
}
