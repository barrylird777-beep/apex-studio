import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { encodeCanonical, decodeCanonical } from './apex-cbor.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const refId = (namespace, key) => sha256(Buffer.from(namespace + '\0' + key));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function durableWrite(file, bytes) {
  const dir = path.dirname(file);
  const temp = path.join(dir, '.pending-' + process.pid + '-' + randomUUID());
  const handle = await open(temp, 'wx', 0o600);
  let renamed = false;
  try {
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
    renamed = true;
    const directory = await open(dir, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    if (!renamed) await rm(temp, { force: true }).catch(() => {});
  }
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
  const assertNamespace = namespace => {
    if (typeof namespace !== 'string' || !Object.hasOwn(acl, namespace) ||
        !Array.isArray(acl[namespace]) || acl[namespace].length === 0) {
      const error = new Error('peer CAS namespace is not authorized by the explicit owner ACL');
      error.code = 'NAMESPACE_DENIED';
      throw error;
    }
  };
  const objectsDir = path.join(root, 'objects');
  const refsDir = path.join(root, 'refs');
  await mkdir(objectsDir, { recursive: true, mode: 0o700 });
  await mkdir(refsDir, { recursive: true, mode: 0o700 });
  for (const directory of [root, objectsDir, refsDir]) {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('peer CAS storage root and namespaces must be real directories, not symlinks');
    }
  }

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
      assertNamespace(value.namespace);
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
      assertNamespace(namespace);
      if (typeof key !== 'string' || !key || key.length > 512) throw new Error('invalid peer CAS reference key');
      const file = path.join(refsDir, refId(namespace, key) + '.cbor');
      let bytes;
      try { bytes = await readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      const value = decodeCanonical(bytes);
      if (value.namespace !== namespace || value.key !== key || sha256(value.bytes) !== value.hash) throw new Error('peer CAS reference integrity or namespace failure');
      return { hash: value.hash, bytes: Buffer.from(value.bytes) };
    },
    async writeRef(namespace, key, expectedHash, hash, input) {
      assertNamespace(namespace);
      if (typeof key !== 'string' || !key || key.length > 512) throw new Error('invalid peer CAS reference key');
      if (expectedHash !== null && (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash))) {
        throw new Error('invalid expected reference hash');
      }
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
    async listRefs(namespace) {
      assertNamespace(namespace);
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
