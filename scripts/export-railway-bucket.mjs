#!/usr/bin/env node
/**
 * Read-only export of an S3-compatible Railway bucket.
 *
 * Required environment:
 *   APEX_OBJECT_STORAGE_ENDPOINT
 *   APEX_OBJECT_STORAGE_BUCKET
 *   APEX_OBJECT_STORAGE_ACCESS_KEY_ID
 *   APEX_OBJECT_STORAGE_SECRET_ACCESS_KEY
 * Optional:
 *   APEX_OBJECT_STORAGE_REGION (default: auto)
 *   APEX_OBJECT_STORAGE_URL_STYLE (virtual-host by default; set "path" only if provider requires it)
 *   APEX_EXPORT_DIR (default: ./railway-bucket-export)
 *
 * This never deletes or mutates source objects. Use a fresh, empty export directory.
 * Object keys are percent-encoded in the TSV manifest; bytes are stored under SHA-256-of-key paths in objects/.
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readdir, stat, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';

const endpoint = process.env.APEX_OBJECT_STORAGE_ENDPOINT;
const bucket = process.env.APEX_OBJECT_STORAGE_BUCKET;
const accessKeyId = process.env.APEX_OBJECT_STORAGE_ACCESS_KEY_ID;
const secretAccessKey = process.env.APEX_OBJECT_STORAGE_SECRET_ACCESS_KEY;
const region = process.env.APEX_OBJECT_STORAGE_REGION || 'auto';
const forcePathStyle = process.env.APEX_OBJECT_STORAGE_URL_STYLE === 'path';
const outputRoot = path.resolve(process.env.APEX_EXPORT_DIR || './railway-bucket-export');
const objectsRoot = path.join(outputRoot, 'objects');

if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
  console.error('Missing required bucket connection environment. No source data was changed.');
  process.exit(2);
}

try {
  const existing = await readdir(outputRoot);
  if (existing.length) {
    console.error('Export directory is not empty; refusing to overwrite or mix exports:', outputRoot);
    process.exit(2);
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(objectsRoot, { recursive: true });
const manifest = path.join(outputRoot, 'inventory.tsv');
const metadataFile = path.join(outputRoot, 'metadata.tsv');
await writeFile(manifest, 'key_percent_encoded\texport_path\tsize_bytes\tlisted_etag\tsha256\n', { flag: 'wx' });
await writeFile(metadataFile, 'key_percent_encoded\tcontent_type\tcache_control\tcontent_encoding\tcontent_language\tcontent_disposition\texpires\tstorage_class\tuser_metadata\n', { flag: 'wx' });

const client = new S3Client({
  endpoint,
  region,
  forcePathStyle,
  credentials: { accessKeyId, secretAccessKey },
});
const tsv = (value) => String(value ?? '').replaceAll('\\', '\\\\').replaceAll('\t', '\\t').replaceAll('\r', '\\r').replaceAll('\n', '\\n');
const enc = (key) => encodeURIComponent(key);
const objectLocation = (key) => {
  // Hashing the key avoids traversal, separator, trailing-slash, and long-filename problems.
  const keyHash = createHash('sha256').update(key, 'utf8').digest('hex');
  const relative = path.posix.join(keyHash.slice(0, 2), keyHash);
  return { relative, absolute: path.join(objectsRoot, keyHash.slice(0, 2), keyHash) };
};
const writeObject = async (entry) => {
  const key = entry.Key;
  if (typeof key !== 'string') throw new Error('Listed object has no key');
  const location = objectLocation(key);
  const destination = location.absolute;
  await mkdir(path.dirname(destination), { recursive: true });
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error('Object body missing: ' + enc(key));
  const hash = createHash('sha256');
  const hashing = new Transform({
    transform(chunk, encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  const output = createWriteStream(destination, { flags: 'wx' });
  await pipeline(response.Body, hashing, output);
  const digest = hash.digest('hex');
  const actual = (await stat(destination)).size;
  if (Number.isFinite(entry.Size) && actual !== entry.Size) {
    throw new Error('Size mismatch for ' + enc(key) + ': expected ' + entry.Size + ', got ' + actual);
  }
  await appendFile(manifest, [enc(key), location.relative, actual, tsv(entry.ETag), digest].join('\t') + '\n');
  const userMetadata = Object.entries(response.Metadata || {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => k + '=' + v).join(';');
  await appendFile(metadataFile, [
    enc(key), tsv(response.ContentType), tsv(response.CacheControl), tsv(response.ContentEncoding),
    tsv(response.ContentLanguage), tsv(response.ContentDisposition),
    tsv(response.Expires?.toISOString?.() || response.Expires), tsv(response.StorageClass), tsv(userMetadata),
  ].join('\t') + '\n');
  console.log('EXPORTED', enc(key), actual, digest);
};

let token;
let count = 0;
let bytes = 0;
try {
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: token,
    }));
    for (const entry of page.Contents || []) {
      await writeObject(entry);
      count += 1;
      bytes += Number(entry.Size || 0);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  await writeFile(path.join(outputRoot, 'EXPORT-COMPLETE.txt'),
    'Source bucket: ' + bucket + '\nEndpoint: ' + endpoint + '\nRegion: ' + region +
    '\nObjects exported: ' + count + '\nListed total bytes: ' + bytes +
    '\nEach exported object was SHA-256 hashed while streaming.\nSource objects were not modified or deleted.\n',
    { flag: 'wx' });
  console.log('EXPORT COMPLETE', { bucket, count, bytes, outputRoot });
} catch (error) {
  console.error('EXPORT INCOMPLETE. Preserve the partial directory for diagnosis; do not treat it as a verified backup.');
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  client.destroy();
}
