import { open, rename, unlink } from "node:fs/promises";
import path from "node:path";

export class AtomicDiskWriter {
  static async write(absolutePath, content) {
    if (typeof absolutePath !== "string" || !path.isAbsolute(absolutePath)) {
      throw new Error("AtomicDiskWriter requires an absolute target path.");
    }
    if (typeof content !== "string") throw new TypeError("AtomicDiskWriter content must be a string.");
    const dir = path.dirname(absolutePath);
    const file = path.basename(absolutePath);
    const tmpPath = path.join(dir, "." + file + ".titan-" + process.pid + "-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".tmp");
    let handle;
    try {
      handle = await open(tmpPath, "wx", 0o600);
      await handle.writeFile(content, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(tmpPath, absolutePath);
      let dirHandle;
      try { dirHandle = await open(dir, "r"); await dirHandle.sync(); }
      finally { await dirHandle?.close().catch(() => {}); }
    } catch (error) {
      await handle?.close().catch(() => {});
      await unlink(tmpPath).catch(() => {});
      throw error;
    }
  }
}
