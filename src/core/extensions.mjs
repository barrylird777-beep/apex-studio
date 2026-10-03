import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function configuredRoots(roots) {
  return (roots ?? String(process.env.APEX_EXTENSION_ROOTS ?? process.env.APEX_EXTENSION_DIR ?? "./extensions")
    .split(","))
    .map(x => path.resolve(String(x).trim()))
    .filter(Boolean);
}

function insideRoot(target, root) {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export async function loadExtension(entry, { roots } = {}) {
  const target = path.resolve(String(entry));
  const trustedRoots = configuredRoots(roots);
  if (!trustedRoots.some(root => insideRoot(target, root))) {
    throw new Error("Extension path is outside configured trusted roots");
  }

  const extension = path.extname(target).toLowerCase();
  if (![".js", ".mjs", ".cjs"].includes(extension)) {
    throw new Error("Unsupported extension format");
  }

  await fs.access(target);
  const mod = await import(pathToFileURL(target).href);
  if (typeof mod.default !== "function" && typeof mod.activate !== "function") {
    throw new Error("Extension must export activate() or default()");
  }
  return mod;
}
