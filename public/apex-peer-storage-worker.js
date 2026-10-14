/*
 * Experimental browser-side storage peer primitive.
 * Stores caller-supplied encrypted CAS bytes in IndexedDB and emits staged proofs.
 * This module does not claim that iOS will preserve browser data indefinitely.
 * The broker must not count a replica as durable until a new-session recovery proof passes.
 */
const DB_NAME = 'apex-peer-cache-v1';
const DB_VERSION = 1;
const STORE = 'objects';
const APPS = new Set(['KernelVision', 'XShield', 'Kernelodies', 'PlanetApeX', 'KashKorner', 'KoinKob']);
const SHA256 = /^[a-f0-9]{64}$/;
const sessionId = globalThis.crypto?.randomUUID?.();

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked'));
  });
}

function transact(mode, operation) {
  return openDb().then(db => new Promise((resolve, reject) => {
    let result;
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    try { result = operation(store); } catch (error) { db.close(); reject(error); return; }
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('IndexedDB transaction failed')); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('IndexedDB transaction aborted')); };
  }));
}

export async function sha256Hex(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function address(appNamespace, hash) {
  if (!APPS.has(appNamespace)) throw new TypeError('invalid canonical app namespace');
  if (!SHA256.test(String(hash || ''))) throw new TypeError('invalid SHA-256 content address');
  return appNamespace + ':' + hash;
}

async function getRecord(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('IndexedDB read failed'));
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error || new Error('IndexedDB read transaction failed')); };
  });
}

/**
 * Persist an already-encrypted object. postReceipt sends an authenticated binary-protocol
 * receipt to the broker; it must bind the receipt to this peer identity/session upstream.
 */
export async function commitEncryptedObject({ appNamespace, hash, encryptedBytes, peerId, postReceipt }) {
  const key = address(appNamespace, hash);
  if (!sessionId) throw new Error('secure session ID generation unavailable');
  if (!(encryptedBytes instanceof Uint8Array)) throw new TypeError('encryptedBytes must be a Uint8Array');
  if (await sha256Hex(encryptedBytes) !== hash) throw new Error('object bytes do not match the content address');
  if (typeof postReceipt !== 'function') throw new TypeError('postReceipt callback required');

  await transact('readwrite', store => store.put({
    key, appNamespace, hash, bytes: encryptedBytes.slice().buffer,
    byteLength: encryptedBytes.byteLength, peerId, writeSessionId: sessionId,
    stage: 'locally_committed', writtenAt: Date.now()
  }));

  const local = await getRecord(key);
  if (!local || local.byteLength !== encryptedBytes.byteLength) throw new Error('stored object metadata read-back failed');
  await postReceipt({
    type: 'peer.storage.receipt', stage: 'locally_committed', appNamespace, hash,
    bytes: encryptedBytes.byteLength, peerId, sessionId, receiptId: crypto.randomUUID()
  });

  const readback = new Uint8Array(local.bytes);
  const readbackHash = await sha256Hex(readback);
  if (readbackHash !== hash) throw new Error('IndexedDB read-back hash mismatch');
  await transact('readwrite', store => store.put({ ...local, stage: 'readback_verified', readbackHash, readbackAt: Date.now() }));
  await postReceipt({
    type: 'peer.storage.receipt', stage: 'readback_verified', appNamespace, hash,
    bytes: readback.byteLength, readbackHash, peerId, sessionId, receiptId: crypto.randomUUID()
  });
  return { appNamespace, hash, bytes: readback.byteLength, stage: 'readback_verified', sessionId };
}

/**
 * Call only in a newly created page/worker session. A stored read-back proof from a
 * different session is required before a recovery receipt is emitted.
 */
export async function verifyAfterNewSession({ appNamespace, hash, peerId, postReceipt }) {
  const key = address(appNamespace, hash);
  if (!sessionId) throw new Error('secure session ID generation unavailable');
  if (typeof postReceipt !== 'function') throw new TypeError('postReceipt callback required');
  const record = await getRecord(key);
  if (!record || record.stage !== 'readback_verified' || !record.readbackHash ||
      !record.writeSessionId || record.writeSessionId === sessionId) {
    throw new Error('restart recovery requires a read-back-verified object from an earlier session');
  }
  const bytes = new Uint8Array(record.bytes);
  const readbackHash = await sha256Hex(bytes);
  if (readbackHash !== hash || readbackHash !== record.readbackHash || bytes.byteLength !== record.byteLength) {
    throw new Error('restart recovery failed content hash or byte-length verification');
  }
  await postReceipt({
    type: 'peer.storage.receipt', stage: 'restart_recovery_verified', appNamespace, hash,
    bytes: bytes.byteLength, readbackHash, peerId, sessionId,
    previousSessionId: record.writeSessionId, receiptId: crypto.randomUUID()
  });
  await transact('readwrite', store => store.put({
    ...record, stage: 'restart_recovery_verified', recoverySessionId: sessionId,
    recoveryVerifiedAt: Date.now()
  }));
  return { appNamespace, hash, bytes: bytes.byteLength, stage: 'restart_recovery_verified', sessionId };
}

export function getPeerSessionId() {
  return sessionId || null;
}
