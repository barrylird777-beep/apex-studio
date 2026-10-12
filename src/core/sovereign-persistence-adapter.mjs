import fs from 'node:fs/promises';
import path from 'node:path';

function stableJson(value) {
  const normalize = (input) => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.keys(input).sort().map((key) => [key, normalize(input[key])]));
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

/**
 * Persistence adapter contract for SovereignMeshEngine.
 * Implementations must return the complete ordered record history from load()
 * and durably persist each record before append() resolves.
 */
export function assertSovereignPersistenceAdapter(adapter) {
  if (!adapter || typeof adapter.load !== 'function' || typeof adapter.append !== 'function') {
    throw new TypeError('Sovereign persistence adapter must implement load() and append().');
  }
  return adapter;
}

/** Existing durable newline-delimited WAL backend, retained as the safe default. */
export function createFileWalPersistenceAdapter(storageDir) {
  const root = path.resolve(storageDir);
  const filePath = path.join(root, 'apex-ring-wal.ndjson');

  return {
    kind: 'file-wal',
    async load() {
      await fs.mkdir(root, { recursive: true });
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        return raw.split('\n').map((line) => line.trim()).filter(Boolean).map((line, index) => {
          try {
            return JSON.parse(line);
          } catch (error) {
            throw new Error(`WAL recovery failed at line ${index + 1}: invalid JSON (${error.message})`);
          }
        });
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    },
    async append(record) {
      await fs.mkdir(root, { recursive: true });
      const handle = await fs.open(filePath, 'a', 0o600);
      try {
        await handle.write(stableJson(record) + '\n', null, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
  };
}
