import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

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
    this.lockTimeoutMs = 30000;
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
    return { hash: digest, bytes: Buffer.byteLength(bytes), uri: "cas://sha256/" + digest };
  }

  async getObject(digest) {
    await this.init();
    const bytes = await readFile(this.objectPath(digest), "utf8");
    if (hash(bytes) !== digest) throw new Error("Object integrity verification failed: " + digest);
    return JSON.parse(bytes);
  }

  async readRef(namespace, key) {
    await this.init();
    try {
      const manifest = JSON.parse(await readFile(this.refPath(namespace, key), "utf8"));
      if (!manifest || manifest.version !== 1 || !/^[a-f0-9]{64}$/.test(manifest.hash)) {
        throw new Error("Invalid content-addressed manifest");
      }
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
    const staleAfterMs = 120000;
    let handle, token;
    while (!handle) {
      token = randomUUID();
      try {
        handle = await open(lock, "wx", 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now(), token }), "utf8");
        await handle.sync();
      } catch (error) {
        if (handle) { await handle.close().catch(() => {}); handle = undefined; }
        if (error.code !== "EEXIST") throw error;
        let stale = false;
        try { stale = Date.now() - (await stat(lock)).mtimeMs > staleAfterMs; }
        catch (statError) { if (statError.code === "ENOENT") continue; throw statError; }
        if (stale) {
          const quarantine = lock + ".stale." + randomUUID();
          try {
            await rename(lock, quarantine);
            await unlink(quarantine).catch(e => { if (e.code !== "ENOENT") throw e; });
          } catch (recoveryError) {
            if (recoveryError.code !== "ENOENT" && recoveryError.code !== "EEXIST") throw recoveryError;
          }
          continue;
        }
        if (Date.now() - started > this.lockTimeoutMs) throw new Error("Timed out waiting for manifest lock");
        await sleep(10 + Math.floor(Math.random() * 20));
      }
    }
    try { return await operation(); }
    finally {
      let ownsPath = false;
      try {
        const [opened, current, contents] = await Promise.all([handle.stat(), stat(lock), readFile(lock, "utf8")]);
        ownsPath = opened.dev === current.dev && opened.ino === current.ino && JSON.parse(contents).token === token;
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
      await this.atomicWrite(file, canonical(manifest) + "\n");
      return { ...manifest, uri: object.uri, bytes: object.bytes };
    });
  }

  async listRefs(namespace) {
    await this.init();
    const dir = path.join(this.refs, String(namespace));
    let names;
    try { names = await (await import("node:fs/promises")).readdir(dir); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
    const out = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const key = name.slice(0, -5);
      try {
        const manifest = JSON.parse(await readFile(path.join(dir, name), "utf8"));
        if (!manifest || manifest.version !== 1 || !/^[a-f0-9]{64}$/.test(manifest.hash)) {
          throw new Error("Invalid content-addressed manifest");
        }
        out.push({ ...manifest, value: await this.getObject(manifest.hash) });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
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
      await unlink(file);
      await syncDir(path.dirname(file));
      return true;
    });
  }
}
