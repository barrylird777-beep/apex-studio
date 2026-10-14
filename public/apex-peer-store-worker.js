/* APEX mobile peer object store.
 * Stores opaque, already-encrypted content-addressed bytes on the participating
 * browser device. The broker must never receive payload bytes or count itself
 * as durable storage. Browser quota/eviction remain controlled by the OS.
 */
'use strict';

const DB_NAME = 'apex-peer-objects-v1';
const STORE_NAME = 'objects';
const HASH_RE = /^[a-f0-9]{64}$/;
const APP_IDS = new Set([
  'KernelVision', 'XShield', 'Kernelodies',
  'PlanetApeX', 'KashKorner', 'KoinKob'
]);

let dbPromise;
let allowedNamespaces = new Set();

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('namespace', 'namespace', { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); dbPromise = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
  });
  return dbPromise;
}

function validateNamespace(namespace) {
  if (!APP_IDS.has(namespace) || !allowedNamespaces.has(namespace)) {
    throw new Error('APEX peer denied this app namespace');
  }
}

function asBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('payload must be binary bytes');
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
  });
}

async function status() {
  const [estimate, persisted, db] = await Promise.all([
    navigator.storage?.estimate ? navigator.storage.estimate() : Promise.resolve({ quota: null, usage: null }),
    navigator.storage?.persisted ? navigator.storage.persisted().catch(() => false) : Promise.resolve(false),
    openDb()
  ]);
  const tx = db.transaction(STORE_NAME, 'readonly');
  const done = transactionDone(tx);
  const count = await requestResult(tx.objectStore(STORE_NAME).count());
  await done;
  const quota = Number.isFinite(estimate.quota) ? estimate.quota : null;
  const usage = Number.isFinite(estimate.usage) ? estimate.usage : null;
  return {
    peerStore: 'indexeddb',
    objectCount: count,
    estimatedQuotaBytes: quota,
    estimatedUsageBytes: usage,
    estimatedAvailableBytes: quota === null || usage === null ? null : Math.max(0, quota - usage),
    browserPersistenceGranted: persisted,
    brokerDurableCapacityBytes: 0,
    note: 'Browser storage can be evicted. Only a fresh-session hash recovery check proves survival across that specific restart.'
  };
}

async function put({ namespace, hash, bytes }) {
  validateNamespace(namespace);
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) throw new TypeError('invalid SHA-256 content address');
  const payload = asBytes(bytes);
  if (!payload.byteLength) throw new TypeError('empty payloads are not accepted');
  const actualHash = await sha256(payload);
  if (actualHash !== hash) throw new Error('payload hash does not match content address');
  const db = await openDb();
  const key = namespace + ':' + hash;
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put({
    key, namespace, hash,
    bytes: payload.slice().buffer,
    byteLength: payload.byteLength,
    writtenAt: Date.now()
  });
  await transactionDone(tx);
  const readback = await get({ namespace, hash });
  if (await sha256(asBytes(readback.bytes)) !== hash) throw new Error('post-write read-back verification failed');
  return { accepted: true, namespace, hash, byteLength: payload.byteLength, readbackVerified: true, durable: false };
}

async function get({ namespace, hash }) {
  validateNamespace(namespace);
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) throw new TypeError('invalid SHA-256 content address');
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const done = transactionDone(tx);
  const record = await requestResult(tx.objectStore(STORE_NAME).get(namespace + ':' + hash));
  await done;
  if (!record) throw new Error('peer object not found');
  const bytes = asBytes(record.bytes);
  if (await sha256(bytes) !== hash) throw new Error('stored object failed hash verification');
  return { namespace, hash, bytes: bytes.slice().buffer, byteLength: bytes.byteLength };
}

async function remove({ namespace, hash }) {
  validateNamespace(namespace);
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) throw new TypeError('invalid SHA-256 content address');
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(namespace + ':' + hash);
  await transactionDone(tx);
  return { removed: true, namespace, hash };
}

async function handle(message) {
  switch (message?.type) {
    case 'INIT': {
      const namespaces = message.allowedNamespaces;
      if (!Array.isArray(namespaces) || namespaces.length === 0 ||
          namespaces.some(n => !APP_IDS.has(n)) || new Set(namespaces).size !== namespaces.length) {
        throw new TypeError('INIT requires an explicit unique canonical app allowlist');
      }
      allowedNamespaces = new Set(namespaces);
      await openDb();
      return { initialized: true, ...(await status()) };
    }
    case 'STATUS':
      return status();
    case 'PUT':
      return put(message);
    case 'GET':
      return get(message);
    case 'DELETE':
      return remove(message);
    case 'REQUEST_PERSISTENCE': {
      if (!navigator.storage?.persist) return { supported: false, granted: false };
      const granted = await navigator.storage.persist();
      return { supported: true, granted };
    }
    default:
      throw new Error('unsupported APEX peer-store command');
  }
}

self.onmessage = async event => {
  const { id, message } = event.data || {};
  try {
    const result = await handle(message);
    const transfer = result?.bytes instanceof ArrayBuffer ? [result.bytes] : [];
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message || error) });
  }
};
