import { createHash } from 'node:crypto';
import { writeFile, rename, rm, access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { canonicalStringify } from './identity.mjs';

export const contentId = (obj) =>
  createHash('sha256').update(canonicalStringify(obj)).digest('hex').slice(0, 32);

export async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

export async function atomicWrite(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
  return file;
}

export async function cachedFile({ dir, id, exts, make }) {
  for (const ext of exts) {
    const file = path.join(dir, `${id}.${ext}`);
    if (await exists(file)) return { path: file, cached: true, ext };
  }
  const made = await make();
  if (!made?.buffer || !made?.ext) throw new Error('cachedFile: make() must return { buffer, ext }');
  const file = path.join(dir, `${id}.${made.ext}`);
  await atomicWrite(file, made.buffer);
  return { path: file, cached: false, ext: made.ext };
}
