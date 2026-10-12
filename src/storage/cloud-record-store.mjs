import { createHash } from "node:crypto";
import {
  S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command
} from "@aws-sdk/client-s3";

const segment = value => {
  const s = String(value ?? "");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(s) || s.includes("..")) {
    throw new Error("Invalid cloud record key segment");
  }
  return s;
};
const digest = value => createHash("sha256").update(value).digest("hex");

export function createCloudRecordStore({ client, bucket, namespace = "planetapex/v1" } = {}) {
  const targetBucket = String(bucket || process.env.APEX_OBJECT_STORAGE_BUCKET || "").trim();
  const endpoint = String(process.env.APEX_OBJECT_STORAGE_ENDPOINT || "").trim();
  const accessKeyId = String(process.env.APEX_OBJECT_STORAGE_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.APEX_OBJECT_STORAGE_SECRET_ACCESS_KEY || "").trim();
  if (!targetBucket) throw new Error("Cloud record store requires APEX_OBJECT_STORAGE_BUCKET");
  if (!client && (!endpoint || !accessKeyId || !secretAccessKey)) {
    throw new Error("Cloud record store requires configured S3-compatible credentials; local fallback is forbidden");
  }
  const s3 = client || new S3Client({
    endpoint,
    region: String(process.env.APEX_OBJECT_STORAGE_REGION || "auto"),
    forcePathStyle: false,
    credentials: { accessKeyId, secretAccessKey }
  });
  const root = String(namespace).split("/").map(segment).join("/");
  const keyFor = (collection, id) => `${root}/${segment(collection)}/${segment(id)}.json`;

  async function get(collection, id) {
    const Key = keyFor(collection, id);
    try {
      const response = await s3.send(new GetObjectCommand({ Bucket: targetBucket, Key }));
      const raw = await response.Body.transformToString();
      const envelope = JSON.parse(raw);
      if (!envelope || envelope.collection !== String(collection) || envelope.id !== String(id) ||
          envelope.sha256 !== digest(JSON.stringify(envelope.record))) {
        throw new Error("Cloud record integrity check failed");
      }
      return envelope.record;
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NoSuchKey" || error?.name === "NotFound") return null;
      throw error;
    }
  }

  async function put(collection, id, record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new TypeError("Cloud record must be an object");
    const stableCollection = String(collection), stableId = String(id);
    const canonical = JSON.stringify(record);
    const envelope = JSON.stringify({ version: 1, collection: stableCollection, id: stableId, sha256: digest(canonical), record });
    const Key = keyFor(stableCollection, stableId);
    await s3.send(new PutObjectCommand({
      Bucket: targetBucket, Key, Body: envelope, ContentType: "application/json",
      Metadata: { "apex-sha256": digest(envelope), "apex-store-version": "1" }
    }));
    const verified = await get(stableCollection, stableId);
    if (JSON.stringify(verified) !== canonical) throw new Error("Cloud record write/read verification failed");
    return verified;
  }

  async function query(collection, { limit = 100, filters = {} } = {}) {
    const safeCollection = segment(collection);
    const Prefix = `${root}/${safeCollection}/`;
    const max = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    const results = [];
    let ContinuationToken;
    do {
      const page = await s3.send(new ListObjectsV2Command({
        Bucket: targetBucket, Prefix, MaxKeys: Math.min(1000, max - results.length),
        ...(ContinuationToken ? { ContinuationToken } : {})
      }));
      for (const item of page.Contents || []) {
        if (!item.Key?.endsWith(".json")) continue;
        const id = item.Key.slice(Prefix.length, -5);
        const record = await get(safeCollection, id);
        if (record && Object.entries(filters).every(([k, v]) => record[k] === v)) results.push(record);
        if (results.length >= max) break;
      }
      ContinuationToken = page.IsTruncated && results.length < max ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);
    return results;
  }

  async function remove(collection, id) {
    await s3.send(new DeleteObjectCommand({ Bucket: targetBucket, Key: keyFor(collection, id) }));
    return true;
  }

  return Object.freeze({ get, put, query, delete: remove, provider: "s3-compatible-cloud", bucket: targetBucket, namespace: root, localFallback: false });
}
