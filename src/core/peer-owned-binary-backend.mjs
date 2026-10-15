import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { encodeCanonical, decodeCanonical } from './apex-cbor.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const refId = (namespace, key) => sha256(Buffer.from(namespace + '\0' + key));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function durableWrite(file, bytes) {
  const dir = path.dirname(file);
  const temp = path.join(dir, '.pending-' + process.pid + '-' + createHash('sha256').update(bytes).digest('hex'));
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, file);
  const directory = await open(dir, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

async function withRefLock(lockPath, operation, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let acquired = false;
  while (!acquired) {
    try { await mkdir(lockPath, { mode: 0o700 }); acquired = true; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error('reference lock timed out; refusing non-atomic update');
      await wait(5 + Math.floor(Math.random() * 15));
    }
  }
  try { return await operation(); } finally { await rm(lockPath, { recursive: true, force: true }); }
}

/**
 * Peer-owned durable binary store. The root must be explicitly provisioned by
 * the peer operator; it is never the coordinator's cache or a default path.
 * Immutable objects and references are canonical CBOR/binary, never JSON/WAL.
 */
export async function createPeerOwnedBinaryBackend({ peerId, namespaceAcl } = {}) {
  const root = path.resolve(String(process.env.APEX_PEER_OWNED_STORAGE_ROOT || '').trim());
  const signingSecret = Buffer.from(String(process.env.APEX_PEER_STORAGE_RECEIPT_KEY_BASE64 || ''), 'base64');
  if (!process.env.APEX_PEER_OWNED_STORAGE_ROOT?.trim()) throw new Error('APEX_PEER_OWNED_STORAGE_ROOT must explicitly name peer-owned durable capacity');
  if (!peerId || typeof peerId !== 'string') throw new Error('authenticated local peer ID is required');
  if (signingSecret.length < 32 || signingSecret.toString('base64') !== process.env.APEX_PEER_STORAGE_RECEIPT_KEY_BASE64) {
    throw new Error('APEX_PEER_STORAGE_RECEIPT_KEY_BASE64 must be canonical base64 containing at least 32 secret bytes');
  }
  let acl = namespaceAcl && typeof namespaceAcl === 'object' ? namespaceAcl : null;
  if (typeof namespaceAcl === 'string' && namespaceAcl.trim()) {
    acl = Object.create(null);
    for (const entry of namespaceAcl.split(';')) {
      const split = entry.indexOf('=');
      if (split < 1) throw new Error('namespace ACL must use AppName=peer-a,peer-b entries');
      const app = entry.slice(0, split).trim();
      const ids = entry.slice(split + 1).split(',').map(value => value.trim()).filter(Boolean);
      if (!app || !ids.length || Object.hasOwn(acl, app)) throw new Error('invalid or duplicate namespace ACL entry');
      acl[app] = ids;
    }
  }
  if (!acl || !Object.keys(acl).length) throw new Error('explicit namespace ACL is required');
  const objectsDir = path.join(root, 'objects');
  const refsDir = path.join(root, 'refs');
  const transactionsDir = path.join(root, 'transactions');
  const transactionHeadsDir = path.join(root, 'transaction-heads');
  await mkdir(objectsDir, { recursive: true, mode: 0o700 });
  await mkdir(refsDir, { recursive: true, mode: 0o700 });
  await mkdir(transactionsDir, { recursive: true, mode: 0o700 });
  await mkdir(transactionHeadsDir, { recursive: true, mode: 0o700 });

  // Startup integrity pass fails closed. Corrupt data is quarantined by refusal,
  // never silently deleted or treated as a cache miss.
  async function verifyDisk() {
    for (const name of await readdir(objectsDir)) {
      if (!/^[a-f0-9]{64}\.bin$/.test(name)) continue;
      const bytes = await readFile(path.join(objectsDir, name));
      if (sha256(bytes) !== name.slice(0, 64)) throw new Error('peer CAS startup integrity failure: corrupt immutable object ' + name);
      decodeCanonical(bytes);
    }
    for (const name of await readdir(refsDir)) {
      if (!/^[a-f0-9]{64}\.cbor$/.test(name)) continue;
      const value = decodeCanonical(await readFile(path.join(refsDir, name)));
      if (!value || typeof value.namespace !== 'string' || typeof value.key !== 'string' ||
          refId(value.namespace, value.key) + '.cbor' !== name ||
          !/^[a-f0-9]{64}$/.test(value.hash) || !Buffer.isBuffer(value.bytes) ||
          sha256(value.bytes) !== value.hash) throw new Error('peer CAS startup integrity failure: invalid reference ' + name);
      const object = await readFile(path.join(objectsDir, value.hash + '.bin')).catch(error => {
        if (error.code === 'ENOENT') throw new Error('peer CAS startup recovery failure: reference target is missing ' + value.hash);
        throw error;
      });
      if (sha256(object) !== value.hash || !object.equals(value.bytes)) throw new Error('peer CAS startup integrity failure: reference target does not match immutable object ' + value.hash);
    }
    for (const name of await readdir(transactionsDir)) {
      if (!/^[a-f0-9]{64}\.cbor$/.test(name)) continue;
      const bytes = await readFile(path.join(transactionsDir, name));
      if (sha256(bytes) !== name.slice(0, 64)) throw new Error('peer CAS startup integrity failure: transaction CID mismatch ' + name);
      const tx = decodeCanonical(bytes);
      if (!tx || tx.version !== 1 || typeof tx.transactionId !== 'string' ||
          typeof tx.namespace !== 'string' || typeof tx.key !== 'string' ||
          !/^[a-f0-9]{64}$/.test(String(tx.hash || '')) ||
          !Buffer.isBuffer(tx.bytes) || sha256(tx.bytes) !== tx.hash ||
          !['prepared', 'commit-decided', 'committed', 'aborted'].includes(tx.state)) {
        throw new Error('peer CAS startup integrity failure: invalid transaction record ' + name);
      }
    }
    for (const name of await readdir(transactionHeadsDir)) {
      if (!/^[a-f0-9]{64}\.cbor$/.test(name)) continue;
      const head = decodeCanonical(await readFile(path.join(transactionHeadsDir, name)));
      if (!head || typeof head.transactionId !== 'string' ||
          sha256(Buffer.from(head.transactionId)) + '.cbor' !== name ||
          !/^[a-f0-9]{64}$/.test(String(head.recordHash || ''))) {
        throw new Error('peer CAS startup integrity failure: invalid transaction head ' + name);
      }
      const record = await readFile(path.join(transactionsDir, head.recordHash + '.cbor'));
      if (sha256(record) !== head.recordHash || decodeCanonical(record).transactionId !== head.transactionId) {
        throw new Error('peer CAS startup integrity failure: transaction head points to invalid record ' + name);
      }
    }
    return true;
  }
  await verifyDisk();

  const transactionHeadFile = transactionId =>
    path.join(transactionHeadsDir, sha256(Buffer.from(String(transactionId))) + '.cbor');
  async function readTransaction(transactionId) {
    const headBytes = await readFile(transactionHeadFile(transactionId)).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!headBytes) return null;
    const head = decodeCanonical(headBytes);
    if (head.transactionId !== transactionId || !/^[a-f0-9]{64}$/.test(String(head.recordHash || ''))) {
      throw new Error('peer CAS transaction head integrity failure');
    }
    const recordBytes = await readFile(path.join(transactionsDir, head.recordHash + '.cbor'));
    if (sha256(recordBytes) !== head.recordHash) throw new Error('peer CAS transaction record CID mismatch');
    const tx = decodeCanonical(recordBytes);
    if (tx.transactionId !== transactionId) throw new Error('peer CAS transaction ID mismatch');
    return { tx, recordHash: head.recordHash };
  }
  async function writeTransaction(tx, expectedRecordHash = null) {
    const recordBytes = encodeCanonical(tx);
    const recordHash = sha256(recordBytes);
    const recordFile = path.join(transactionsDir, recordHash + '.cbor');
    const existingRecord = await readFile(recordFile).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (existingRecord) {
      if (sha256(existingRecord) !== recordHash || !existingRecord.equals(recordBytes)) {
        throw new Error('peer CAS immutable transaction CID collision or corruption');
      }
    } else {
      await durableWrite(recordFile, recordBytes);
    }
    const current = await readTransaction(tx.transactionId);
    if ((current?.recordHash ?? null) !== expectedRecordHash) {
      const error = new Error('peer CAS transaction head compare-and-swap conflict');
      error.code = 'TRANSACTION_HEAD_CONFLICT';
      throw error;
    }
    await durableWrite(transactionHeadFile(tx.transactionId),
      encodeCanonical({ transactionId: tx.transactionId, recordHash }));
    return recordHash;
  }

  const receiptFor = claims => {
    const body = encodeCanonical(claims);
    return { body: body.toString('base64'), mac: createHmac('sha256', signingSecret).update(body).digest('base64') };
  };
  return Object.freeze({
    async putBytes(hash, input) {
      const bytes = Buffer.from(input);
      if (!/^[a-f0-9]{64}$/.test(hash) || sha256(bytes) !== hash) throw new Error('peer CAS object hash mismatch');
      decodeCanonical(bytes);
      const file = path.join(objectsDir, hash + '.bin');
      try {
        const existing = await readFile(file);
        if (sha256(existing) !== hash || !existing.equals(bytes)) throw new Error('existing peer CAS object is corrupt or conflicting');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await durableWrite(file, bytes);
      }
      const verified = await readFile(file);
      if (sha256(verified) !== hash || !verified.equals(bytes)) throw new Error('peer CAS durable write verification failed');
      return { hash, bytes: verified.length };
    },
    async getBytes(hash) {
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('invalid peer CAS hash');
      const bytes = await readFile(path.join(objectsDir, hash + '.bin'));
      if (sha256(bytes) !== hash) throw new Error('peer CAS object integrity failure');
      return bytes;
    },
    async readRef(namespace, key) {
      const file = path.join(refsDir, refId(namespace, key) + '.cbor');
      let bytes;
      try { bytes = await readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      const value = decodeCanonical(bytes);
      if (value.namespace !== namespace || value.key !== key || sha256(value.bytes) !== value.hash) throw new Error('peer CAS reference integrity or namespace failure');
      return { hash: value.hash, bytes: Buffer.from(value.bytes) };
    },
    async writeRef(namespace, key, expectedHash, hash, input) {
      const bytes = Buffer.from(input);
      if (sha256(bytes) !== hash) throw new Error('reference payload hash mismatch');
      decodeCanonical(bytes);
      // A ref may only point at a verified immutable object. Persist and verify
      // the object before the atomic pointer update; an interrupted update can
      // leave an unreferenced object, but never a ref to missing content.
      await this.putBytes(hash, bytes);
      const id = refId(namespace, key);
      return withRefLock(path.join(refsDir, id + '.lock'), async () => {
        const current = await this.readRef(namespace, key);
        if ((current?.hash ?? null) !== expectedHash) {
          const error = new Error('peer CAS reference compare-and-swap conflict');
          error.code = 'REFERENCE_CONFLICT';
          throw error;
        }
        await durableWrite(path.join(refsDir, id + '.cbor'), encodeCanonical({ namespace, key, hash, bytes }));
        const saved = await this.readRef(namespace, key);
        if (!saved || saved.hash !== hash || !saved.bytes.equals(bytes)) throw new Error('peer CAS atomic reference read-back failed');
        return { hash };
      });
    },
    async prepareRef({ transactionId, namespace, key, expectedHash, hash, bytes: input, participants }) {
      if (typeof transactionId !== 'string' || !transactionId || transactionId.length > 256) throw new Error('invalid transaction ID');
      if (typeof namespace !== 'string' || !namespace || typeof key !== 'string' || !key || key.length > 512) throw new Error('invalid transaction reference');
      if (expectedHash !== null && !/^[a-f0-9]{64}$/.test(String(expectedHash))) throw new Error('invalid transaction expected hash');
      const bytes = Buffer.from(input);
      if (!/^[a-f0-9]{64}$/.test(String(hash)) || sha256(bytes) !== hash) throw new Error('transaction reference hash mismatch');
      decodeCanonical(bytes);
      if (!Array.isArray(participants) || !participants.length || participants.some(id => typeof id !== 'string' || !id) ||
          new Set(participants).size !== participants.length) throw new Error('invalid transaction participant set');
      await this.putBytes(hash, bytes);
      return withRefLock(path.join(refsDir, refId(namespace, key) + '.lock'), async () => {
        const existing = await readTransaction(transactionId);
        if (existing) {
          const tx = existing.tx;
          if (tx.namespace !== namespace || tx.key !== key || tx.hash !== hash ||
              tx.expectedHash !== expectedHash ||
              encodeCanonical([...participants].sort()).compare(encodeCanonical(tx.participants)) !== 0) {
            throw new Error('transaction ID reused for a different proposal or participant set');
          }
          return { transactionId, state: tx.state, hash: tx.hash };
        }
        for (const name of await readdir(transactionHeadsDir)) {
          if (!/^[a-f0-9]{64}\.cbor$/.test(name)) continue;
          const head = decodeCanonical(await readFile(path.join(transactionHeadsDir, name)));
          if (sha256(Buffer.from(String(head.transactionId || ''))) + '.cbor' !== name) {
            throw new Error('peer CAS transaction head index integrity failure');
          }
          const result = await readTransaction(head.transactionId);
          if (!result) continue;
          const pending = result.tx;
          if (pending.namespace === namespace && pending.key === key &&
              ['prepared', 'commit-decided'].includes(pending.state)) {
            const error = new Error('reference has an unresolved prepared transaction; recovery is required');
            error.code = 'REFERENCE_TRANSACTION_BLOCKED';
            throw error;
          }
        }
        const current = await this.readRef(namespace, key);
        if ((current?.hash ?? null) !== expectedHash) {
          const error = new Error('peer CAS transaction prepare conflict');
          error.code = 'REFERENCE_CONFLICT';
          throw error;
        }
        const tx = { version: 1, transactionId, namespace, key, expectedHash, hash, bytes, participants: [...participants].sort(), state: 'prepared' };
        await writeTransaction(tx, null);
        return { transactionId, state: tx.state, hash };
      });
    },
    async decideRefCommit(transactionId, participants) {
      const initial = await readTransaction(transactionId);
      if (!initial) throw new Error('transaction record not found');
      return withRefLock(path.join(refsDir, refId(initial.tx.namespace, initial.tx.key) + '.lock'), async () => {
        const current = await readTransaction(transactionId);
        if (!current) throw new Error('transaction record disappeared during decision');
        const tx = current.tx;
        if (!Array.isArray(participants) || encodeCanonical([...participants].sort()).compare(encodeCanonical(tx.participants)) !== 0) {
          throw new Error('commit decision participant set does not match prepared transaction');
        }
        if (tx.state === 'commit-decided' || tx.state === 'committed') return { transactionId, state: tx.state, hash: tx.hash };
        if (tx.state !== 'prepared') throw new Error('transaction is not in a committable state');
        tx.state = 'commit-decided';
        await writeTransaction(tx, current.recordHash);
        return { transactionId, state: tx.state, hash: tx.hash };
      });
    },
    async commitPreparedRef(transactionId) {
      const initial = await readTransaction(transactionId);
      if (!initial) throw new Error('transaction record not found');
      return withRefLock(path.join(refsDir, refId(initial.tx.namespace, initial.tx.key) + '.lock'), async () => {
        const currentTx = await readTransaction(transactionId);
        if (!currentTx) throw new Error('transaction record disappeared during commit');
        const tx = currentTx.tx;
        if (tx.state === 'committed') return { transactionId, state: tx.state, hash: tx.hash };
        if (tx.state !== 'commit-decided') throw new Error('transaction has no durable commit decision');
        const current = await this.readRef(tx.namespace, tx.key);
        if ((current?.hash ?? null) === tx.expectedHash) {
          await durableWrite(path.join(refsDir, refId(tx.namespace, tx.key) + '.cbor'),
            encodeCanonical({ namespace: tx.namespace, key: tx.key, hash: tx.hash, bytes: tx.bytes }));
        } else if (current?.hash !== tx.hash) {
          const error = new Error('commit recovery found a conflicting reference head');
          error.code = 'REFERENCE_DIVERGENCE';
          throw error;
        }
        tx.state = 'committed';
        await writeTransaction(tx, currentTx.recordHash);
        return { transactionId, state: tx.state, hash: tx.hash };
      });
    },
    async abortPreparedRef(transactionId) {
      const initial = await readTransaction(transactionId);
      if (!initial) return { transactionId, state: 'absent' };
      return withRefLock(path.join(refsDir, refId(initial.tx.namespace, initial.tx.key) + '.lock'), async () => {
        const current = await readTransaction(transactionId);
        if (!current) return { transactionId, state: 'absent' };
        const tx = current.tx;
        if (tx.state === 'aborted') return { transactionId, state: tx.state };
        if (tx.state !== 'prepared') throw new Error('cannot abort a transaction after a durable commit decision');
        tx.state = 'aborted';
        await writeTransaction(tx, current.recordHash);
        return { transactionId, state: tx.state };
      });
    },
    async listRefTransactions(namespace) {
      if (typeof namespace !== 'string' || !namespace) throw new Error('explicit transaction namespace is required');
      const pending = [];
      for (const name of await readdir(transactionHeadsDir)) {
        if (!/^[a-f0-9]{64}\.cbor$/.test(name)) continue;
        const head = decodeCanonical(await readFile(path.join(transactionHeadsDir, name)));
        const result = await readTransaction(head.transactionId);
        if (!result) continue;
        const tx = result.tx;
        if (tx.namespace === namespace && ['prepared', 'commit-decided'].includes(tx.state)) {
          pending.push({ transactionId: tx.transactionId, namespace: tx.namespace, key: tx.key, state: tx.state });
        }
      }
      return pending.sort((a, b) => a.transactionId.localeCompare(b.transactionId));
    },
    async getRefTransaction(transactionId) {
      const result = await readTransaction(transactionId);
      if (!result) return null;
      const { tx } = result;
      return { transactionId: tx.transactionId, namespace: tx.namespace, key: tx.key, expectedHash: tx.expectedHash, hash: tx.hash, participants: tx.participants, state: tx.state };
    },
    async listRefs(namespace) {
      if (typeof namespace !== 'string' || !namespace) throw new Error('explicit reference namespace is required');
      const names = await readdir(refsDir);
      const refs = [];
      for (const name of names) {
        if (!/^[a-f0-9]{64}\.cbor$/.test(name)) continue;
        const bytes = await readFile(path.join(refsDir, name));
        const value = decodeCanonical(bytes);
        if (!value || typeof value.namespace !== 'string' || typeof value.key !== 'string' ||
            refId(value.namespace, value.key) + '.cbor' !== name ||
            !/^[a-f0-9]{64}$/.test(String(value.hash || '')) ||
            !Buffer.isBuffer(value.bytes) || sha256(value.bytes) !== value.hash) {
          throw new Error('peer CAS reference listing encountered corrupt reference metadata');
        }
        if (value.namespace === namespace) refs.push({ key: value.key, hash: value.hash, bytes: Buffer.from(value.bytes) });
      }
      refs.sort((a, b) => a.key.localeCompare(b.key));
      return refs;
    },
    async health({ namespace, peerId: requestedPeerId }) {
      if (requestedPeerId !== peerId || !Array.isArray(acl[namespace]) || !acl[namespace].length) throw new Error('peer CAS health claim does not match peer identity or ACL');
      await verifyDisk();
      const claims = { version: 1, peerId, namespace, ownership: 'peer-owned', durable: true, atomicReferencesVerified: true, restartRecoveryVerified: true };
      return { ...claims, receipt: receiptFor(claims), receiptId: sha256(encodeCanonical(claims)) };
    },
    async verifyDurabilityReceipt(receipt, claims) {
      try {
        if (!receipt || typeof receipt.body !== 'string' || typeof receipt.mac !== 'string' ||
            !claims || typeof claims.peerId !== 'string' || typeof claims.namespace !== 'string') return false;
        const body = Buffer.from(receipt.body, 'base64');
        const mac = Buffer.from(receipt.mac, 'base64');
        if (body.toString('base64') !== receipt.body || mac.toString('base64') !== receipt.mac) return false;
        const expectedMac = createHmac('sha256', signingSecret).update(body).digest();
        if (mac.length !== expectedMac.length || !timingSafeEqual(mac, expectedMac)) return false;
        const signed = decodeCanonical(body);
        const required = {
          version: 1,
          peerId: claims.peerId,
          namespace: claims.namespace,
          ownership: 'peer-owned',
          durable: true,
          atomicReferencesVerified: true,
          restartRecoveryVerified: true
        };
        return Object.entries(required).every(([key, value]) => signed[key] === value) &&
          Object.entries(claims).every(([key, value]) => signed[key] === value);
      } catch { return false; }
    }
  });
}
