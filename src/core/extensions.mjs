import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function loadExtension(entry, { root = process.env.APEX_EXTENSION_DIR ?? "./extensions" } = {}) {
  const base = path.resolve(root);
  const target = path.resolve(base, entry);
  if (!target.startsWith(base + path.sep)) throw new Error("Extension path escapes extension directory");
  if (!target.endsWith(".mjs")) throw new Error("Only .mjs extensions are permitted");
  await fs.access(target);
  const mod = await import(pathToFileURL(target).href);
  if (typeof mod.default !== "function" && typeof mod.activate !== "function") throw new Error("Extension must export activate() or default()");
  return mod;
}
