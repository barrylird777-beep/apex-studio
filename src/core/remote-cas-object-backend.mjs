import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
const text = value => String(value || "").trim();
export class RemoteCasObjectBackend {
  constructor(env = process.env) {
    const endpoint = text(env.APEX_OBJECT_STORAGE_ENDPOINT);
    const bucket = text(env.APEX_OBJECT_STORAGE_BUCKET);
    const accessKeyId = text(env.APEX_OBJECT_STORAGE_ACCESS_KEY_ID);
    const secretAccessKey = text(env.APEX_OBJECT_STORAGE_SECRET_ACCESS_KEY);
    this.enabled = Boolean(endpoint && bucket && accessKeyId && secretAccessKey);
    if (!this.enabled) return;
    this.bucket = bucket;
    this.prefix = text(env.APEX_CAS_OBJECT_PREFIX) || "apex-cas/objects/sha256";
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
