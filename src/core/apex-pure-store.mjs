import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function resolveWithinRoot(root, name) {
  if (typeof name !== 'string' || name.length === 0 || name.includes(String.fromCharCode(0))) {
    throw new TypeError('store path must be a non-empty relative path');
  }
  if (path.isAbsolute(name)) throw new Error('STORE_PATH_OUTSIDE_ROOT: absolute paths are not allowed');
  const base = path.resolve(root);
  const target = path.resolve(base, name);
  const relative = path.relative(base, target);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('STORE_PATH_OUTSIDE_ROOT: path must remain inside the store root');
  }
  return target;
}

async function durableAtomicWrite(target, value) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = target + '.tmp-' + process.pid + '-' + randomUUID();
  const handle = await fs.open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.unlink(temp).catch(() => {});
    throw error;
  }
  await handle.close();
  await fs.rename(temp, target);
  const directory = await fs.open(path.dirname(target), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

export function createPureStore({ root = '/srv/apex/se-x/projects' } = {}) {
  async function ensure() { await fs.mkdir(root, { recursive: true }); }
  async function read(name, fallback = null) {
    await ensure();
    const target = resolveWithinRoot(root, name);
    try { return JSON.parse(await fs.readFile(target, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
  }
  async function write(name, value) {
    await ensure();
    const target = resolveWithinRoot(root, name);
    await durableAtomicWrite(target, value);
    return target;
  }
  return { root, ensure, read, write };
}
