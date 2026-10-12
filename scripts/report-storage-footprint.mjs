import fs from "node:fs/promises";
import path from "node:path";

const MAX_ENTRIES_PER_ROOT = 6000;
const MAX_DEPTH = 8;
const toGiB = bytes => Number((bytes / (1024 ** 3)).toFixed(4));

async function inspectRoot(root) {
  let rootInfo;
  try { rootInfo = await fs.stat(root); }
  catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    return { root, error: error.code || error.message };
  }
  if (!rootInfo.isDirectory()) return null;

  let filesystem = null;
  try {
    const statfs = await fs.statfs(root);
    const blockSize = Number(statfs.bsize || statfs.frsize || 1);
    const total = Number(statfs.blocks) * blockSize;
    const available = Number(statfs.bavail) * blockSize;
    const used = Math.max(0, total - Number(statfs.bfree) * blockSize);
    filesystem = {
      totalGiB: toGiB(total),
      usedGiB: toGiB(used),
      availableGiB: toGiB(available),
      usedPercent: total > 0 ? Number((used / total * 100).toFixed(2)) : null
    };
  } catch (error) {
    filesystem = { error: error.code || error.message };
  }

  const stack = [{ file: root, depth: 0, top: null }];
  const sizes = new Map();
  let entries = 0;
  let truncated = false;
  while (stack.length && entries < MAX_ENTRIES_PER_ROOT) {
    const current = stack.pop();
    let children;
    try { children = await fs.readdir(current.file, { withFileTypes: true }); }
    catch { continue; }
    for (const child of children) {
      if (++entries > MAX_ENTRIES_PER_ROOT) { truncated = true; break; }
      const fullPath = path.join(current.file, child.name);
      let info;
      try { info = await fs.lstat(fullPath); } catch { continue; }
      if (info.isSymbolicLink()) continue;
      const top = current.top || child.name;
      if (!sizes.has(top)) sizes.set(top, 0);
      if (info.isFile()) sizes.set(top, sizes.get(top) + Number(info.size || 0));
      if (info.isDirectory() && current.depth < MAX_DEPTH) {
        stack.push({ file: fullPath, depth: current.depth + 1, top });
      }
    }
    if (truncated) break;
  }

  return {
    root,
    filesystem,
    entriesScanned: entries,
    truncated,
    largestEntries: [...sizes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, bytes]) => ({ name, bytes, MiB: Number((bytes / (1024 ** 2)).toFixed(2)) }))
  };
}

export async function reportStorageFootprint() {
  const candidates = [
    process.env.APEX_SE_X_ROOT,
    process.env.APEX_PROJECTS_DIR,
    process.env.APEX_SOVEREIGN_STORAGE_DIR,
    process.env.APEX_WAL_DIR,
    process.env.APEX_WAL_FILE ? path.dirname(process.env.APEX_WAL_FILE) : null,
    "/data"
  ].filter(Boolean).map(value => path.resolve(value));
  const roots = [...new Set(candidates)];
  const results = [];
  for (const root of roots) {
    const result = await inspectRoot(root);
    if (result) results.push(result);
  }
  return { readOnly: true, maxEntriesPerRoot: MAX_ENTRIES_PER_ROOT, roots: results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("[STORAGE FOOTPRINT]", JSON.stringify(await reportStorageFootprint()));
}
