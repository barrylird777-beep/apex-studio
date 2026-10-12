import { mkdir, open, readFile, readdir, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function stableJson(value) {
  const normalize = (input) => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') return Object.fromEntries(Object.keys(input).sort().map((key) => [key, normalize(input[key])]));
    return input;
  };
  return JSON.stringify(normalize(value));
}

export function assertSovereignPersistenceAdapter(adapter) {
  if (!adapter || typeof adapter.load !== 'function' || typeof adapter.append !== 'function') throw new TypeError('Sovereign persistence adapter must implement load() and append().');
  return adapter;
}

export function createFileWalPersistenceAdapter(storageDir) {
  const root = path.resolve(storageDir);
  const filePath = path.join(root, 'apex-ring-wal.ndjson');
  return {
    kind: 'file-wal',
    async load() {
      await mkdir(root, { recursive: true });
      try {
        return (await readFile(filePath, 'utf8')).split('\n').map((line) => line.trim()).filter(Boolean).map((line, index) => {
          try { return JSON.parse(line); } catch (error) { throw new Error(`WAL recovery failed at line ${index + 1}: invalid JSON (${error.message})`); }
        });
      } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    },
    async append(record) {
      await mkdir(root, { recursive: true });
      const handle = await open(filePath, 'a', 0o600);
      try { await handle.write(stableJson(record) + '\n'); await handle.sync(); } finally { await handle.close(); }
    }
  };
}

/** Experimental opt-in backend: immutable record files, not a write-ahead log. */
export function createContentAddressedPersistenceAdapter(storageDir) {
  const root = path.resolve(storageDir);
  const filename = (record) => {
    if (!Number.isSafeInteger(record?.seq) || record.seq < 1 || typeof record.checksum !== 'string' || !/^[a-f0-9]{64}$/i.test(record.checksum)) throw new TypeError('Content-addressed record requires a positive sequence and SHA-256 checksum.');
    return `${String(record.seq).padStart(16, '0')}-${record.checksum}.json`;
  };
  return {
    kind: 'content-addressed-files',
    async load() {
      await mkdir(root, { recursive: true, mode: 0o700 });
      const names = (await readdir(root)).filter((name) => /^\d{16}-[a-f0-9]{64}\.json$/i.test(name)).sort();
      const records = [];
      for (const name of names) records.push(JSON.parse(await readFile(path.join(root, name), 'utf8')));
      return records;
    },
    async append(record) {
      await mkdir(root, { recursive: true, mode: 0o700 });
      const finalPath = path.join(root, filename(record));
      const temporaryPath = path.join(root, `.pending-${randomUUID()}`);
      let handle;
      try {
        handle = await open(temporaryPath, 'wx', 0o600);
        await handle.writeFile(stableJson(record), 'utf8');
        await handle.sync();
        await handle.close();
        handle = undefined;
        try {
          // link() creates the final name atomically without overwriting an existing immutable record.
          await link(temporaryPath, finalPath);
          await unlink(temporaryPath);
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          const existing = await readFile(finalPath, 'utf8');
          if (existing !== stableJson(record)) throw new Error('Conflicting immutable record already exists.');
          await unlink(temporaryPath).catch(() => {});
        }
        const dir = await open(root, 'r');
        try { await dir.sync(); } finally { await dir.close(); }
      } catch (error) {
        if (handle) await handle.close().catch(() => {});
        await unlink(temporaryPath).catch(() => {});
        throw error;
      }
    }
  };
}
