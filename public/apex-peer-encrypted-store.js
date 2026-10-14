/* Encrypted object adapter for public/apex-peer-store-worker.js.
 * Binary APXM manifests avoid a JSON system-of-record. Browser writes are not durable receipts.
 */
import { encryptPeerObject, decryptPeerObject, sha256Hex, APEX_CHUNK_BYTES } from "./apex-anchor-crypto.js";
const APPS = ["PlanetApeX", "XShield", "KernelVision", "KoinKob", "KashKorner", "Kernelodies"];
const MAGIC = [0x41, 0x50, 0x58, 0x4d];
const HEADER_BYTES = 34;
const CHUNK_META_BYTES = 52;
const u32 = (view, offset, value) => view.setUint32(offset, value, false);
const hexBytes = hex => Uint8Array.from(hex.match(/.{2}/g) || [], pair => parseInt(pair, 16));
const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");

export function encodeEncryptedManifest(manifest) {
  const appCode = APPS.indexOf(manifest.namespace) + 1;
  if (!appCode || manifest.version !== 1 || !manifest.chunks.length || manifest.chunks.length > 100000) throw new TypeError("Invalid encrypted manifest");
  const out = new Uint8Array(HEADER_BYTES + manifest.chunks.length * CHUNK_META_BYTES);
  out.set(MAGIC, 0); out[4] = 1; out[5] = appCode; out.set(manifest.salt, 6);
  const view = new DataView(out.buffer);
  u32(view, 22, manifest.chunkBytes); u32(view, 26, manifest.totalBytes); u32(view, 30, manifest.chunks.length);
  let offset = HEADER_BYTES;
  for (const chunk of manifest.chunks) {
    out.set(chunk.iv, offset); u32(view, offset + 12, chunk.plainBytes);
    u32(view, offset + 16, chunk.ciphertext.byteLength); out.set(hexBytes(chunk.sha256), offset + 20);
    offset += CHUNK_META_BYTES;
  }
  return out;
}
export function decodeEncryptedManifest(value) {
  const input = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (input.byteLength < HEADER_BYTES || !MAGIC.every((byte, i) => input[i] === byte) || input[4] !== 1) throw new Error("Invalid APXM manifest header");
  const namespace = APPS[input[5] - 1];
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const chunkBytes = view.getUint32(22, false), totalBytes = view.getUint32(26, false), count = view.getUint32(30, false);
  if (!namespace || chunkBytes < 16384 || chunkBytes > APEX_CHUNK_BYTES || !totalBytes || !count || count > 100000 || input.byteLength !== HEADER_BYTES + count * CHUNK_META_BYTES || Math.ceil(totalBytes / chunkBytes) !== count) throw new Error("Invalid APXM manifest dimensions");
  const chunks = [];
  let offset = HEADER_BYTES, sum = 0;
  for (let index = 0; index < count; index++) {
    const iv = input.slice(offset, offset + 12);
    const plainBytes = view.getUint32(offset + 12, false), cipherBytes = view.getUint32(offset + 16, false);
    const hash = toHex(input.slice(offset + 20, offset + 52));
    const expectedPlain = Math.min(chunkBytes, totalBytes - sum);
    if (plainBytes !== expectedPlain || cipherBytes !== plainBytes + 16 || !/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid APXM chunk metadata");
    chunks.push({ index, iv, plainBytes, cipherBytes, sha256: hash });
    sum += plainBytes; offset += CHUNK_META_BYTES;
  }
  if (sum !== totalBytes) throw new Error("APXM total length mismatch");
  return { version: 1, algorithm: "PBKDF2-SHA256/AES-256-GCM", namespace, salt: input.slice(6, 22), chunkBytes, totalBytes, chunks };
}
export async function storeEncryptedObject({ call, namespace, secret, data, chunkBytes = APEX_CHUNK_BYTES }) {
  if (typeof call !== "function") throw new TypeError("Peer worker call function is required");
  const encrypted = await encryptPeerObject({ namespace, secret, data, chunkBytes });
  const chunkHashes = [];
  for (const chunk of encrypted.chunks) {
    const result = await call({ type: "PUT", namespace, hash: chunk.sha256, bytes: chunk.ciphertext.slice().buffer });
    if (result?.readbackVerified !== true) throw new Error("Peer worker did not verify encrypted chunk read-back");
    chunkHashes.push(chunk.sha256);
  }
  const manifestBytes = encodeEncryptedManifest(encrypted);
  const manifestHash = await sha256Hex(manifestBytes);
  const result = await call({ type: "PUT", namespace, hash: manifestHash, bytes: manifestBytes.buffer });
  if (result?.readbackVerified !== true) throw new Error("Peer worker did not verify manifest read-back");
  return Object.freeze({ namespace, manifestHash, totalBytes: encrypted.totalBytes, chunkCount: chunkHashes.length, chunkHashes, writeVerified: true, recoveryVerified: false, durable: false });
}
export async function retrieveEncryptedObject({ call, namespace, secret, manifestHash }) {
  if (typeof call !== "function") throw new TypeError("Peer worker call function is required");
  const storedManifest = await call({ type: "GET", namespace, hash: manifestHash });
  const manifestBytes = new Uint8Array(storedManifest.bytes);
  if (await sha256Hex(manifestBytes) !== manifestHash) throw new Error("Manifest hash verification failed");
  const manifest = decodeEncryptedManifest(manifestBytes);
  if (manifest.namespace !== namespace) throw new Error("Manifest belongs to another app");
  for (const chunk of manifest.chunks) {
    const stored = await call({ type: "GET", namespace, hash: chunk.sha256 });
    const ciphertext = new Uint8Array(stored.bytes);
    if (ciphertext.byteLength !== chunk.cipherBytes || await sha256Hex(ciphertext) !== chunk.sha256) throw new Error("Stored encrypted chunk verification failed");
    chunk.ciphertext = ciphertext;
  }
  const data = await decryptPeerObject({ manifest, secret });
  return { data, receipt: Object.freeze({ namespace, manifestHash, recoveredAt: Date.now(), readbackVerified: true, durable: false }) };
}
