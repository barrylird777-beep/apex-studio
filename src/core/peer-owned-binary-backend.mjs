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
  await mkdir(objectsDir, { recursive: true, mode: 0o700 });
  await mkdir(refsDir, { recursive: true, mode: 0o700 });

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
    return true;
  }
  await verifyDisk();

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
    async health({ namespace, peerId: requestedPeerId }) {
      if (requestedPeerId !== peerId || !Array.isArray(acl[namespace]) || !acl[namespace].length) throw new Error('peer CAS health claim does not match peer identity or ACL');
      await verifyDisk();
      const claims = { version: 1, peerId, namespace, ownership: 'peer-owned', durable: true, atomicReferencesVerified: true, restartRecoveryVerified: true };
      return { ...claims, receipt: receiptFor(claims), receiptId: sha256(encodeCanonical(claims)) };
    },
    async verifyDurabilityReceipt(receipt, claims) {
      try {
        const body = Buffer.from(receipt.body, 'base64');
        const mac = Buffer.from(receipt.mac, 'base64');
        const expected = createHmac('sha256', signingSecret).update(body).digest();
        return mac.length === expected.length && timingSafeEqual(mac, expected) &&
          decodeCanonical(body).peerId === claims.peerId &&
          decodeCanonical(body).namespace === claims.namespace &&
          decodeCanonical(body).restartRecoveryVerified === true &&
          decodeCanonical(body).atomicReferencesVerified === true;
      } catch { return false; }
    }
  });
}
