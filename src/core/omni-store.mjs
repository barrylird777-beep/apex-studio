import fs from "node:fs/promises";
import path from "node:path";

export class OmniStore {
  constructor(root = process.env.APEX_OMNI_DATA_DIR ?? "./data/omni") {
    this.root = root;
  }

  async init() {
    await fs.mkdir(this.root, { recursive: true });
    for (const name of ["search_runs", "search_results", "narrative_tracks", "voice_assets"]) {
      const file = path.join(this.root, name + ".jsonl");
      try { await fs.access(file); } catch { await fs.writeFile(file, "", "utf8"); }
    }
    return this;
  }

  #file(table) {
    if (!/^[a-z_]+$/.test(table)) throw new Error("Invalid table");
    return path.join(this.root, table + ".jsonl");
  }

  async append(table, record) {
    await this.init();
    const line = JSON.stringify(record).replace(/\\r?\\n/g, " ") + "\n";
    await fs.appendFile(this.#file(table), line, "utf8");
    return record;
  }

  async list(table, limit = 500) {
    await this.init();
    const text = await fs.readFile(this.#file(table), "utf8");
    return text.split("\n").filter(Boolean).slice(-Math.max(1, Math.min(5000, limit))).map(line => JSON.parse(line));
  }
}

export const OMNI_SCHEMA = Object.freeze({
  search_runs: ["id", "query", "mode", "startedAt", "finishedAt", "status"],
  search_results: ["id", "runId", "url", "status", "contentType", "text", "createdAt"],
  narrative_tracks: ["id", "projectId", "branchId", "timelineId", "blocks", "createdAt"],
  voice_assets: ["id", "trackId", "filepath", "metadata", "createdAt"]
});
