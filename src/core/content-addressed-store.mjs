import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { RemoteCasObjectBackend } from "./remote-cas-object-backend.mjs";

const canonical = value => JSON.stringify(value);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function syncDir(dir) {
  const handle = await open(dir, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

/**
 * Immutable SHA-256 object store with atomic, compare-and-swap manifests.
 * No append log, SQL engine, or mutable object blobs are used.
 */
export class ContentAddressedStore {
  constructor({ root } = {}) {
    if (!root) throw new TypeError("ContentAddressedStore requires an explicit root");
    this.root = path.resolve(root);
    this.objects = path.join(this.root, "objects", "sha256");
    this.refs = path.join(this.root, "refs");
    this.lockTimeoutMs = 180000;
    this.remoteObjects = new RemoteCasObjectBackend();
    this.remoteRefsEnabled = this.remoteObjects.enabled;
  }

  async init() {
    await Promise.all([
      mkdir(this.objects, { recursive: true, mode: 0o700 }),
      mkdir(this.refs, { recursive: true, mode: 0o700 })
    ]);
    return this;
  }

  objectPath(digest) {
    if (!/^[a-f0-9]{64}$/.test(String(digest))) throw new Error("Invalid SHA-256 object id");
    return path.join(this.objects, digest.slice(0, 2), digest + ".json");
  }

  refPath(namespace, key) {
    const safe = value => {
      const s = String(value);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(s) || s.includes("..")) {
        throw new Error("Invalid manifest path segment");
      }
      return s;
    };
    return path.join(this.refs, safe(namespace), safe(key) + ".json");
  }

  async atomicWrite(file, text) {
    const dir = path.dirname(file);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = file + "." + process.pid + "." + randomUUID() + ".tmp";
    const handle = await open(temp, "wx", 0o600);
    try { await handle.writeFile(text, "utf8"); await handle.sync(); }
    catch (error) { await handle.close().catch(() => {}); await unlink(temp).catch(() => {}); throw error; }
    await handle.close();
    try { await rename(temp, file); await syncDir(dir); }
    catch (error) { await unlink(temp).catch(() => {}); throw error; }
  }

  async putObject(value) {
    await this.init();
    const bytes = canonical(value);
    const digest = hash(bytes);
    if (this.remoteObjects.enabled) {
      await this.remoteObjects.put(digest, bytes);
      return { hash: digest, bytes: Buffer.byteLength(bytes), uri: "cas://sha256/" + digest, backend: "object-storage" };
    }
    const file = this.objectPath(digest);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    try {
      const existing = await readFile(file, "utf8");
      if (hash(existing) !== digest) throw new Error("Object integrity mismatch for existing content address");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      try { await this.atomicWrite(file, bytes); }
      catch (writeError) {
        if (writeError.code !== "EEXIST") throw writeError;
        const existing = await readFile(file, "utf8");
        if (hash(existing) !== digest) throw new Error("Object integrity mismatch after concurrent write");
      }
    }
    return { hash: digest, bytes: Buffer.byteLength(bytes), uri: "cas://sha256/" + digest, backend: "local" };
  }

  async getObject(digest) {
    await this.init();
    if (this.remoteObjects.enabled) {
      const remoteBytes = await this.remoteObjects.get(digest);
      if (remoteBytes !== null) {
        if (hash(remoteBytes) !== digest) throw new Error("Remote object integrity verification failed: " + digest);
        return JSON.parse(remoteBytes);
      }
    }
    const bytes = await readFile(this.objectPath(digest), "utf8");
    if (hash(bytes) !== digest) throw new Error("Object integrity verification failed: " + digest);
    return JSON.parse(bytes);
  }

  async readRef(namespace, key) {
    await this.init();
    const file = this.refPath(namespace, key);
    if (this.remoteRefsEnabled) {
      const remote = await this.remoteObjects.getRef(namespace, key);
      if (remote !== null) {
        const manifest = JSON.parse(remote);
        if (!manifest || manifest.version !== 1 || !/^[a-f0-9]{64}$/.test(manifest.hash)) throw new Error("Invalid remote content-addressed manifest");
        return { ...manifest, value: await this.getObject(manifest.hash) };
      }
    }
    try {
      const manifest = JSON.parse(await readFile(file, "utf8"));
      if (!manifest || manifest.version !== 1 || !/^[a-f0-9]{64}$/.test(manifest.hash)) throw new Error("Invalid content-addressed manifest");
      return { ...manifest, value: await this.getObject(manifest.hash) };
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async withRefLock(file, operation) {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const lock = file + ".lock";
    const started = Date.now();
    // A manifest write may wait on a slow or nearly-full volume; do not steal a
    // live writer's lock based on a short 30-second age threshold.
    const staleAfterMs = 120000;
    let handle, token;
    while (!handle) {
      token = randomUUID();
      try {
        handle = await open(lock, "wx", 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now(), token }), "utf8");
        await handle.sync();
      } catch (error) {
        if (error.code === "ENOSPC" && handle) { await handle.sync().catch(() => {}); break; }
        if (handle) {
          // Failed metadata writes (notably ENOSPC) must not strand a lock file.
          try {
            const [opened, current] = await Promise.all([handle.stat(), stat(lock)]);
            if (opened.dev === current.dev && opened.ino === current.ino) await unlink(lock).catch(e => { if (e.code !== "ENOENT") throw e; });
          } catch (cleanupError) { if (cleanupError.code !== "ENOENT") {} }
          await handle.close().catch(() => {});
          handle = undefined;
        }
        if (error.code !== "EEXIST") throw error;
        let stale = false;
        try { stale = Date.now() - (await stat(lock)).mtimeMs > staleAfterMs; }
        catch (statError) { if (statError.code === "ENOENT") continue; throw statError; }
        if (stale) {
          // Only one waiter may recover a stale lock. Otherwise a second waiter
          // can rename the new lock acquired immediately after the first recovery.
          const reaper = lock + ".reaper";
          let reapHandle;
          try { reapHandle = await open(reaper, "wx", 0o600); }
          catch (recoveryLockError) {
            if (recoveryLockError.code === "EEXIST") { await sleep(25); continue; }
            throw recoveryLockError;
          }
          try {
            await sleep(250);
            let stillStale = false;
            try { stillStale = Date.now() - (await stat(lock)).mtimeMs > staleAfterMs; }
            catch (statError) { if (statError.code === "ENOENT") continue; throw statError; }
            if (stillStale) {
              const quarantine = lock + ".stale." + randomUUID();
              try {
                await rename(lock, quarantine);
                await unlink(quarantine).catch(e => { if (e.code !== "ENOENT") throw e; });
              } catch (recoveryError) {
                if (recoveryError.code !== "ENOENT" && recoveryError.code !== "EEXIST") throw recoveryError;
              }
            }
          } finally {
            const owned = reapHandle;
            try {
              const [opened, current] = await Promise.all([owned.stat(), stat(reaper)]);
              if (opened.dev === current.dev && opened.ino === current.ino) await unlink(reaper).catch(e => { if (e.code !== "ENOENT") throw e; });
            } catch (cleanupError) { if (cleanupError.code !== "ENOENT") {} }
            await owned.close().catch(() => {});
          }
          continue;
        }
        if (Date.now() - started > this.lockTimeoutMs) throw new Error("Timed out waiting for manifest lock");
        await sleep(10 + Math.floor(Math.random() * 20));
      }
    }
    const heartbeat = setInterval(() => {
      const now = new Date();
      handle?.utimes(now, now).catch(() => {});
    }, 10000);
    heartbeat.unref?.();
    try { return await operation(); }
    finally {
      clearInterval(heartbeat);
      let ownsPath = false;
      try {
        const [opened, current, contents] = await Promise.all([handle.stat(), stat(lock), readFile(lock, "utf8")]);
        if (opened.dev === current.dev && opened.ino === current.ino) { try { ownsPath = JSON.parse(contents).token === token; } catch { ownsPath = true; } }
      } catch (error) {
        if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      }
      await handle.close().catch(() => {});
      if (ownsPath) await unlink(lock).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
  }

  async writeRef(namespace, key, value, { expectedHash = undefined } = {}) {
    await this.init();
    const file = this.refPath(namespace, key);
    return this.withRefLock(file, async () => {
      const current = await this.readRef(namespace, key);
      const actual = current?.hash ?? null;
      if (expectedHash !== undefined && actual !== expectedHash) {
        const error = new Error("Manifest compare-and-swap conflict");
        error.code = "CAS_CONFLICT";
        error.expectedHash = expectedHash;
        error.actualHash = actual;
        throw error;
      }
      const object = await this.putObject(value);
      const manifest = {
        version: 1,
        namespace: String(namespace),
        key: String(key),
        hash: object.hash,
        updatedAt: new Date().toISOString()
      };
      if (this.remoteRefsEnabled) await this.remoteObjects.putRef(namespace, key, canonical(manifest) + "\n");
      else await this.atomicWrite(file, canonical(manifest) + "\n");
      return { ...manifest, uri: object.uri, bytes: object.bytes, backend: this.remoteRefsEnabled ? "object-storage" : "local" };
    });
  }

  async listRefs(namespace) {
    await this.init();
    const keys = new Set();
    if (this.remoteRefsEnabled) for (const key of await this.remoteObjects.listRefs(namespace)) keys.add(key);
    const dir = path.join(this.refs, String(namespace));
    try {
      const names = await (await import("node:fs/promises")).readdir(dir);
      for (const name of names) if (name.endsWith(".json")) keys.add(name.slice(0, -5));
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const candidates = [...keys];
    const out = [];
    const batchSize = 32;
    for (let offset = 0; offset < candidates.length; offset += batchSize) {
      const batch = await Promise.all(candidates.slice(offset, offset + batchSize).map(async key => this.readRef(namespace, key)));
      out.push(...batch.filter(Boolean));
    }
    return out;
  }

  async deleteRef(namespace, key, { expectedHash = undefined } = {}) {
    await this.init();
    const file = this.refPath(namespace, key);
    return this.withRefLock(file, async () => {
      const current = await this.readRef(namespace, key);
      if (!current) return false;
      if (expectedHash !== undefined && current.hash !== expectedHash) {
        const error = new Error("Manifest compare-and-swap conflict");
        error.code = "CAS_CONFLICT";
        throw error;
      }
      if (this.remoteRefsEnabled) await this.remoteObjects.deleteRef(namespace, key);
      try { await unlink(file); await syncDir(path.dirname(file)); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      return true;
    });
  }
}
