import { appendFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export function createFileLedger(file) {
  return {
    async record(entry) {
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
    },
    async read() {
      try {
        const text = await readFile(file, 'utf8');
        return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    },
  };
}

export function createMemoryLedger() {
  const rows = [];
  return {
    async record(entry) {
      rows.push({ ts: new Date().toISOString(), ...entry });
    },
    async read() {
      return rows.map((row) => ({ ...row }));
    },
  };
}
