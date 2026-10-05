import path from "node:path";
import { readFile } from "node:fs/promises";
import { TitanConcurrencyLock } from "./titan-concurrency-lock.mjs";
import { TitanSafetyAuditor } from "./titan-safety-auditor.mjs";
import { AtomicDiskWriter } from "./atomic-disk-writer.mjs";

export class TitanMutator {
  constructor(pool, { workspaceRoot = process.cwd() } = {}) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.lock = new TitanConcurrencyLock(pool);
    this.auditor = new TitanSafetyAuditor(this.workspaceRoot);
  }
  async safeMutate(filePath, payload) {
    const absolute = this.resolveTarget(filePath);
    return this.lock.executeWithLock(absolute, async () => {
      let current = "";
      try { current = await readFile(absolute, "utf8"); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
      const verified = this.auditor.verifyPayloadSafety(path.relative(this.workspaceRoot, absolute), current, payload);
      await AtomicDiskWriter.write(absolute, verified);
    });
  }
  resolveTarget(filePath) {
    if (typeof filePath !== "string" || !filePath.trim()) throw new Error("BAD_REQUEST: targetFile required");
    const absolute = path.resolve(this.workspaceRoot, filePath);
    const relative = path.relative(this.workspaceRoot, absolute);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("AST_TARGET_OUTSIDE_WORKSPACE");
    if (relative.split(path.sep).includes(".git")) throw new Error("AST_TARGET_FORBIDDEN");
    return absolute;
  }
}
