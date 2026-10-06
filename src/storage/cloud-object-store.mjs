import crypto from 'node:crypto';
import { S3Client, ListObjectsV2Command, DeleteObjectCommand, HeadObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, ListPartsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function storageConfig(prefix = 'apex-business') {
  const phone = String(prefix) === 'phone-private';
  const env = name => process.env[phone ? `APEX_PHONE_OBJECT_STORAGE_${name}` : `APEX_OBJECT_STORAGE_${name}`];
  return {
    endpoint: String(env('ENDPOINT') || '').trim(),
    bucket: String(env('BUCKET') || '').trim(),
    region: String(env('REGION') || 'auto').trim(),
    accessKeyId: String(env('ACCESS_KEY_ID') || '').trim(),
    secretAccessKey: String(env('SECRET_ACCESS_KEY') || '').trim()
  };
}

function assertConfigured(prefix = 'apex-business') {
  const config = storageConfig(prefix);
  if (!config.endpoint || !config.bucket || !config.accessKeyId || !config.secretAccessKey) {
    const error = new Error(`Cloud storage namespace "${prefix}" is not configured`);
    error.status = 503;
    throw error;
  }
  return config;
}

function client(prefix = 'apex-business') {
  const config = assertConfigured(prefix);
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: false,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
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

const MAX_OBJECT_BYTES = 5 * 1024 * 1024 * 1024 * 1024;
const FREE_MODE = String(process.env.APEX_FREE_MODE ?? 'true').toLowerCase() !== 'false';
const FREE_MAX_OBJECT_BYTES = Math.max(1, Number(process.env.APEX_FREE_MAX_OBJECT_BYTES || 25 * 1024 * 1024 * 1024));
const FREE_MAX_ACTIVE_UPLOADS = Math.max(1, Number(process.env.APEX_FREE_MAX_ACTIVE_UPLOADS || 8));
const FREE_MAX_DAILY_UPLOAD_BYTES = 0;
const FREE_MAX_DAILY_DOWNLOAD_BYTES = 0;
const MULTIPART_PART_BYTES = Math.max(64 * 1024 * 1024, Math.min(512 * 1024 * 1024, Number(process.env.APEX_STORAGE_PART_BYTES || 512 * 1024 * 1024)));
const MAX_SIGNED_URL_SECONDS = Math.min(3600, Math.max(60, Number(process.env.APEX_STORAGE_SIGNED_URL_SECONDS || 900)));

export function cloudStorageStatus(prefix = 'apex-business') {
  const config = storageConfig(prefix);
  return {
    configured: Boolean(config.endpoint && config.bucket && config.accessKeyId && config.secretAccessKey),
    provider: 'railway-s3-compatible',
    bucket: config.bucket || null,
    region: config.region || null,
    endpoint: config.endpoint || null,
    namespace: prefix,
    deviceMode: 'cloud-offload',
    localDeviceStorageRole: 'cache-and-working-set',
    maxObjectBytes: FREE_MODE ? FREE_MAX_OBJECT_BYTES : MAX_OBJECT_BYTES,
    freeMode: FREE_MODE,
    freePolicy: freeStoragePolicy(),
    multipartPartBytes: MULTIPART_PART_BYTES,
    maxMultipartParts: 10000,
    resumableUploads: true,
    directToObjectStorage: true,
    serverMemoryForLargeUploads: 'not required',
    note: 'Large media stays in cloud object storage; the iPhone receives streams or signed transfers.'
  };
}

export async function listCloudObjects({ prefix = 'iphone', limit = 100, continuationToken = '' } = {}) {
  const s3 = client(prefix);
  const safePrefix = `mobile/${safeSegment(prefix, 'iphone')}/`;
  const result = await s3.send(new ListObjectsV2Command({
    Bucket: storageConfig(prefix).bucket,
    Prefix: safePrefix,
    MaxKeys: Math.min(1000, Math.max(1, Number(limit) || 100)),
    ...(continuationToken ? { ContinuationToken: String(continuationToken) } : {})
  }));
  const objects = (result.Contents || []).map(item => ({
    key: item.Key,
    bytes: Number(item.Size || 0),
    modifiedAt: item.LastModified?.toISOString?.() || null,
    etag: item.ETag || null
  }));
  return { ...cloudStorageStatus(prefix), prefix: safePrefix, objects, total: objects.length, nextContinuationToken: result.NextContinuationToken || null, truncated: Boolean(result.IsTruncated) };
}

export async function createUploadUrl({ filename, contentType = 'application/octet-stream', size = 0, prefix = 'iphone' } = {}) {
  const s3 = client(prefix);
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
    Bucket: storageConfig(prefix).bucket,
    Key: key,
    ContentType: String(contentType || 'application/octet-stream').slice(0, 200)
  }), { expiresIn });
  return { ...cloudStorageStatus(prefix), key, url, expiresIn, maxBytes };
}

export async function createDownloadUrl({ key, prefix = 'iphone' } = {}) {
  const s3 = client(prefix);
  const scoped = scopedKey(key, prefix);
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: storageConfig(prefix).bucket, Key: scoped }), {
    expiresIn: MAX_SIGNED_URL_SECONDS
  });
  return { key: scoped, url };
}

export async function inspectCloudObject({ key, prefix = 'iphone' } = {}) {
  const s3 = client(prefix);
  const scoped = scopedKey(key, prefix);
  try {
    const result = await s3.send(new HeadObjectCommand({ Bucket: storageConfig(prefix).bucket, Key: scoped }));
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
  const s3 = client(prefix);
  const scoped = scopedKey(key, prefix);
  await s3.send(new DeleteObjectCommand({ Bucket: storageConfig(prefix).bucket, Key: scoped }));
  return { deleted: true, key: scoped };
}


export function freeStoragePolicy() {
  return {
    enabled: FREE_MODE,
    maxObjectBytes: FREE_MODE ? FREE_MAX_OBJECT_BYTES : MAX_OBJECT_BYTES,
    maxActiveUploads: FREE_MAX_ACTIVE_UPLOADS,
    maxDailyUploadBytes: null,
    maxDailyDownloadBytes: null,
    enforcement: 'provider-quota-or-explicit-budget-only',
    billingSafety: 'hard-cap-before-new-storage-transfer'
  };
}

export function multipartPlan({ size = 0 } = {}) {
  const bytes = Math.max(0, Number(size) || 0);
  if (FREE_MODE && bytes > FREE_MAX_OBJECT_BYTES) { const error = new Error(`Free-mode object cap is ${FREE_MAX_OBJECT_BYTES} bytes`); error.status = 413; throw error; }
  const partSize = MULTIPART_PART_BYTES;
  const partCount = Math.max(1, Math.ceil(bytes / partSize));
  if (bytes > MAX_OBJECT_BYTES || partCount > 10000) {
    const error = new Error('Object exceeds the S3-compatible 5 TB / 10,000-part ceiling');
    error.status = 413;
    throw error;
  }
  return { partSize, partCount, maxObjectBytes: MAX_OBJECT_BYTES, maxParts: 10000 };
}

export async function initiateMultipartUpload({ filename, contentType = 'application/octet-stream', size = 0, prefix = 'iphone', checksum = '' } = {}) {
  const s3 = client(prefix);
  const plan = multipartPlan({ size });
  const cleanName = safeSegment(filename, `upload-${crypto.randomUUID()}`);
  const key = scopedKey(`${Date.now()}-${crypto.randomUUID()}-${cleanName}`, prefix);
  const result = await s3.send(new CreateMultipartUploadCommand({
    Bucket: storageConfig(prefix).bucket,
    Key: key,
    ContentType: String(contentType || 'application/octet-stream').slice(0, 200),
    Metadata: { apex: 'mobile-cloud-vault', ...(checksum ? { 'apex-sha256': String(checksum).slice(0, 128) } : {}) }
  }));
  if (!result.UploadId) throw new Error('Storage provider did not return an upload ID');
  return { ...cloudStorageStatus(prefix), key, uploadId: result.UploadId, ...plan };
}

export async function signMultipartPart({ key, uploadId, partNumber, prefix = 'iphone' } = {}) {
  const s3 = client(prefix);
  const scoped = scopedKey(key, prefix);
  const part = Number(partNumber);
  if (!Number.isInteger(part) || part < 1 || part > 10000) {
    const error = new Error('Invalid multipart part number');
    error.status = 400;
    throw error;
  }
  const url = await getSignedUrl(s3, new UploadPartCommand({
    Bucket: storageConfig(prefix).bucket, Key: scoped, UploadId: String(uploadId), PartNumber: part
  }), { expiresIn: MAX_SIGNED_URL_SECONDS });
  return { key: scoped, uploadId: String(uploadId), partNumber: part, url, expiresIn: MAX_SIGNED_URL_SECONDS };
}

export async function listMultipartParts({ key, uploadId, prefix = 'iphone' } = {}) {
  const s3 = client(prefix);
  const scoped = scopedKey(key, prefix);
  const result = await s3.send(new ListPartsCommand({ Bucket: storageConfig(prefix).bucket, Key: scoped, UploadId: String(uploadId), MaxParts: 1000 }));
  return { key: scoped, uploadId: String(uploadId), parts: (result.Parts || []).map(p => ({ partNumber: p.PartNumber, etag: p.ETag, bytes: Number(p.Size || 0) })) };
}

export async function completeMultipartUpload({ key, uploadId, parts = [], prefix = 'iphone', checksum = '' } = {}) {
  const s3 = client(prefix);
  const scoped = scopedKey(key, prefix);
  const normalized = parts.map(p => ({ PartNumber: Number(p.partNumber), ETag: String(p.etag) }))
    .filter(p => Number.isInteger(p.PartNumber) && p.PartNumber >= 1 && p.PartNumber <= 10000 && p.ETag)
    .sort((a, b) => a.PartNumber - b.PartNumber);
  if (!normalized.length) {
    const error = new Error('Multipart completion requires uploaded parts');
    error.status = 400; throw error;
  }
  const result = await s3.send(new CompleteMultipartUploadCommand({
    Bucket: storageConfig(prefix).bucket, Key: scoped, UploadId: String(uploadId), MultipartUpload: { Parts: normalized }
  }));
  return { ...cloudStorageStatus(prefix), key: scoped, etag: result.ETag || null, location: result.Location || null, checksum: checksum || null, completed: true };
}

export async function abortMultipartUpload({ key, uploadId, prefix = 'iphone' } = {}) {
  const s3 = client(prefix);
  const scoped = scopedKey(key, prefix);
  await s3.send(new AbortMultipartUploadCommand({ Bucket: storageConfig(prefix).bucket, Key: scoped, UploadId: String(uploadId) }));
  return { key: scoped, uploadId: String(uploadId), aborted: true };
}
