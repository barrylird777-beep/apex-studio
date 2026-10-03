import { Worker } from "node:worker_threads";

const DEFAULT_DB = process.env.APEX_OMNI_DB_FILE ?? "./apex-omni.sqlite";
const BUSY_TIMEOUT = Math.max(5000, Math.min(120000, Number(process.env.APEX_OMNI_BUSY_TIMEOUT_MS ?? 60000)));\nconst READ_CONNECTIONS = Math.max(1, Math.min(8, Number(process.env.APEX_OMNI_READ_CONNECTIONS ?? 2)));

export class OmniStore {
  constructor(file = DEFAULT_DB) {
    this.file = file;
    this.worker = new Worker(new URL("../workers/omni-db-worker.mjs", import.meta.url), {
      workerData: { file, busyTimeout: BUSY_TIMEOUT, readConnections: READ_CONNECTIONS }
    });
    this.pending = new Map();
    this.nextId = 1;
    this.ready = new Promise((resolve, reject) => {
      this._readyResolve = resolve;
      this._readyReject = reject;
    });
    this.worker.on("message", message => {
      if (message.id === 0) {
        if (message.ok) this._readyResolve(message.value);
        else this._readyReject(new Error(message.error));
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.ok ? pending.resolve(message.value) : pending.reject(new Error(message.error));
    });
    this.worker.on("error", error => {
      this._readyReject(error);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }

  init() { return this.ready; }

  call(op, payload = {}) {
    return this.ready.then(() => {
      const id = this.nextId++;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.worker.postMessage({ id, op, payload });
      });
    });
  }

  run(sql, params = []) { return this.call("run", { sql, params }); }
  get(sql, params = []) { return this.call("get", { sql, params }); }
  all(sql, params = []) { return this.call("all", { sql, params }); }

  indexPassage(input) { return this.call("indexPassage", input); }
  searchPassages(query, limit = 50) { return this.call("searchPassages", { query, limit }); }
  migrateLegacyText(limit = 1000) { return this.call("migrateLegacyText", { limit }); }
  append(table, record) { return this.call("append", { table, record }); }
  list(table, limit = 500) { return this.call("list", { table, limit }); }
  createProductionTimeline(input = {}) { return this.call("createProductionTimeline", { input }); }
  getProductionTimeline(nodeId) { return this.call("getProductionTimeline", { nodeId }); }
  listProductionTimelines(limit = 500) { return this.call("listProductionTimelines", { limit }); }
  createTimelineMutation(input = {}) { return this.call("createTimelineMutation", { input }); }
  getTimelineMutation(id) { return this.call("getTimelineMutation", { id }); }
  listTimelineMutations(parentNodeId = null, limit = 500) {
    return this.call("listTimelineMutations", { parentNodeId, limit });
  }

  close() {
    return this.call("close").finally(() => this.worker.terminate());
  }
}

export const OMNI_SCHEMA = Object.freeze({
  normalized: [
    "narrative_blocks",
    "timeline_mutation_visual",
    "timeline_mutation_vocal",
    "production_timeline_audio_tags",
    "search_run_fragments",
    "parsed_passage_fragments"
  ],
  immutableAssetPointers: ["playback_uri", "media_uri", "asset_id"],
  requiredIndexes: [
    "idx_narrative_blocks_track_position",
    "idx_timeline_mutation_visual_mutation_position",
    "idx_timeline_mutation_vocal_mutation_position",
    "idx_production_timeline_audio_tags_timeline_position",
    "idx_search_results_run"
  ]
});
