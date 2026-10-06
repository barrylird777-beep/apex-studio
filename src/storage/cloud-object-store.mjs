import crypto from 'node:crypto';
import { S3Client, ListObjectsV2Command, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const endpoint = String(process.env.APEX_OBJECT_STORAGE_ENDPOINT || '').trim();
const bucket = String(process.env.APEX_OBJECT_STORAGE_BUCKET || '').trim();
const region = String(process.env.APEX_OBJECT_STORAGE_REGION || 'auto').trim();
const accessKeyId = String(process.env.APEX_OBJECT_STORAGE_ACCESS_KEY_ID || '').trim();
const secretAccessKey = String(process.env.APEX_OBJECT_STORAGE_SECRET_ACCESS_KEY || '').trim();

function assertConfigured() {
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    const error = new Error('Apex cloud storage is not configured');
    error.status = 503;
    throw error;
  }
}

function client() {
  assertConfigured();
  return new S3Client({
    endpoint,
    region,
    forcePathStyle: false,
    credentials: { accessKeyId, secretAccessKey }
  });
}

function safeSegment(value, fallback = 'file') {
  const cleaned = String(value || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 120) || fallback;
}

function normalizeKey(input) {
  const raw = String(input || '').replace(/^\/+/, '');
  const parts = raw.split('/').filter(Boolean);
  if (parts.some(part => part === '.' || part === '..')) {
    const error = new Error('Invalid storage key');
    error.status = 400;
    throw error;
  }
  const key = parts.join('/');
  if (!key || key.length > 900) {
    const error = new Error('Storage key is required');
    error.status = 400;
    throw error;
  }
  return key;
}

function scopedKey(key, prefix = 'iphone') {
  const normalized = normalizeKey(key);
  return `mobile/${safeSegment(prefix, 'iphone')}/${normalized}`;
}

export function cloudStorageStatus() {
  return {
    configured: Boolean(endpoint && bucket && accessKeyId && secretAccessKey),
    provider: 'railway-s3-compatible',
    bucket: bucket || null,
    region: region || null,
    endpoint: endpoint || null,
    deviceMode: 'cloud-offload',
    localDeviceStorageRole: 'cache-and-working-set',
    note: 'Large media stays in cloud object storage; the iPhone receives streams or signed transfers.'
  };
}

export async function listCloudObjects({ prefix = 'iphone', limit = 100 } = {}) {
  const s3 = client();
  const safePrefix = `mobile/${safeSegment(prefix, 'iphone')}/`;
  const result = await s3.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: safePrefix,
    MaxKeys: Math.min(1000, Math.max(1, Number(limit) || 100))
  }));
  const objects = (result.Contents || []).map(item => ({
    key: item.Key,
    bytes: Number(item.Size || 0),
    modifiedAt: item.LastModified?.toISOString?.() || null,
    etag: item.ETag || null
  }));
  return { ...cloudStorageStatus(), prefix: safePrefix, objects, total: objects.length };
}

export async function createUploadUrl({ filename, contentType = 'application/octet-stream', size = 0, prefix = 'iphone' } = {}) {
  const s3 = client();
  const cleanName = safeSegment(filename, `upload-${crypto.randomUUID()}`);
  const key = scopedKey(`${Date.now()}-${crypto.randomUUID()}-${cleanName}`, prefix);
  const byteSize = Math.max(0, Number(size) || 0);
  const maxBytes = Math.max(1, Number(process.env.APEX_STORAGE_MAX_UPLOAD_BYTES || 50 * 1024 * 1024 * 1024));
  if (byteSize > maxBytes) {
    const error = new Error(`Upload exceeds the ${maxBytes} byte limit`);
    error.status = 413;
    throw error;
  }
  const expiresIn = Math.min(3600, Math.max(60, Number(process.env.APEX_STORAGE_SIGNED_URL_SECONDS || 900)));
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const url = await getSignedUrl(s3, new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: String(contentType || 'application/octet-stream').slice(0, 200)
  }), { expiresIn });
  return { ...cloudStorageStatus(), key, url, expiresIn, maxBytes };
}

export async function createDownloadUrl({ key, prefix = 'iphone' } = {}) {
  const s3 = client();
  const scoped = scopedKey(key, prefix);
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: scoped }), {
    expiresIn: Math.min(3600, Math.max(60, Number(process.env.APEX_STORAGE_SIGNED_URL_SECONDS || 900)))
  });
  return { key: scoped, url };
}

export async function inspectCloudObject({ key, prefix = 'iphone' } = {}) {
  const s3 = client();
  const scoped = scopedKey(key, prefix);
  try {
    const result = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: scoped }));
    return {
      exists: true,
      key: scoped,
      bytes: Number(result.ContentLength || 0),
      contentType: result.ContentType || null,
      modifiedAt: result.LastModified?.toISOString?.() || null,
      etag: result.ETag || null
    };
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return { exists: false, key: scoped };
    throw error;
  }
}

export async function deleteCloudObject({ key, prefix = 'iphone' } = {}) {
  const s3 = client();
  const scoped = scopedKey(key, prefix);
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: scoped }));
  return { deleted: true, key: scoped };
}
