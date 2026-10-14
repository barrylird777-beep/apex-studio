/* APEX ANCHOR browser chunk encryption.
 * Keys are derived in memory and never written to IndexedDB or manifests.
 * Persisted peer bytes must be ciphertext; this module does not claim durability.
 */
const VERSION = 1;
const APP_NAMES = new Set(["PlanetApeX", "XShield", "KernelVision", "KoinKob", "KashKorner", "Kernelodies"]);
export const APEX_CHUNK_BYTES = 256 * 1024;

function bytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("Expected binary data");
}
function hex(value) {
  return Array.from(value, b => b.toString(16).padStart(2, "0")).join("");
}
export async function sha256Hex(value) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(value))));
}
function aad(namespace, index, count, totalBytes) {
  return new TextEncoder().encode([VERSION, namespace, index, count, totalBytes].join(":"));
}
async function deriveKey(secret, salt) {
  if (typeof secret !== "string" || secret.length < 12) throw new TypeError("Encryption secret must be at least 12 characters");
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 310000 }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function encryptPeerObject({ namespace, secret, data, chunkBytes = APEX_CHUNK_BYTES }) {
  if (!APP_NAMES.has(namespace)) throw new TypeError("Invalid canonical app namespace");
  if (!Number.isInteger(chunkBytes) || chunkBytes < 16384 || chunkBytes > APEX_CHUNK_BYTES) throw new RangeError("Invalid chunk size");
  const input = bytes(data);
  if (!input.byteLength) throw new TypeError("Empty objects are not accepted");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(secret, salt);
  const count = Math.ceil(input.byteLength / chunkBytes);
  const chunks = [];
  for (let index = 0; index < count; index++) {
    const part = input.slice(index * chunkBytes, Math.min(input.byteLength, (index + 1) * chunkBytes));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(namespace, index, count, input.byteLength), tagLength: 128 }, key, part));
    chunks.push({ index, iv, ciphertext: encrypted, plainBytes: part.byteLength, sha256: await sha256Hex(encrypted) });
  }
  return { version: VERSION, algorithm: "PBKDF2-SHA256/AES-256-GCM", namespace, salt, chunkBytes, totalBytes: input.byteLength, chunks };
}
export async function decryptPeerObject({ manifest, secret }) {
  if (!manifest || manifest.version !== VERSION || manifest.algorithm !== "PBKDF2-SHA256/AES-256-GCM" || !Array.isArray(manifest.chunks)) throw new TypeError("Unsupported encrypted object manifest");
  if (!APP_NAMES.has(manifest.namespace) || !Number.isInteger(manifest.totalBytes) || manifest.totalBytes < 1) throw new TypeError("Invalid encrypted object metadata");
  const count = Math.ceil(manifest.totalBytes / manifest.chunkBytes);
  if (count !== manifest.chunks.length || count < 1 || count > 100000) throw new Error("Chunk count mismatch");
  const key = await deriveKey(secret, bytes(manifest.salt));
  const output = new Uint8Array(manifest.totalBytes);
  let offset = 0;
  for (let index = 0; index < count; index++) {
    const chunk = manifest.chunks[index];
    if (chunk.index !== index || await sha256Hex(chunk.ciphertext) !== chunk.sha256) throw new Error("Ciphertext integrity check failed");
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(chunk.iv), additionalData: aad(manifest.namespace, index, count, manifest.totalBytes), tagLength: 128 }, key, bytes(chunk.ciphertext)));
    if (plain.byteLength !== chunk.plainBytes || offset + plain.byteLength > output.byteLength) throw new Error("Decrypted chunk size mismatch");
    output.set(plain, offset);
    offset += plain.byteLength;
  }
  if (offset !== output.byteLength) throw new Error("Recovered object length mismatch");
  return output;
}
