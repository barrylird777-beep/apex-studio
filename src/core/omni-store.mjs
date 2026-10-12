import path from "node:path";

const DEFAULT_DB = process.env.APEX_OMNI_DB_FILE ?? "./apex-omni.sqlite";

function asJson(value, fallback = null) {
  if (value == null) return fallback;
  return JSON.stringify(value);
}

function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export class OmniStore {
  constructor(file = DEFAULT_DB) {
    this.file = path.resolve(file);
    this.db = null;
    this.ready = null;
  }

  async init() {
    if (this.ready) return this.ready;

    const { default: sqlite3 } = await import("sqlite3");
    this.ready = new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.file, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, error => {
        if (error) return reject(error);
        this.db.exec(`
          PRAGMA journal_mode=WAL;
          PRAGMA synchronous=NORMAL;
          PRAGMA foreign_keys=ON;
          PRAGMA busy_timeout=5000;

          CREATE TABLE IF NOT EXISTS production_timelines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            node_id TEXT NOT NULL UNIQUE,
            scene_label TEXT NOT NULL,
            timecode TEXT NOT NULL,
            aesthetic_profile TEXT,
            prompt TEXT,
            audio_tags TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          );

          CREATE INDEX IF NOT EXISTS idx_production_timelines_scene
            ON production_timelines(scene_label);
          CREATE INDEX IF NOT EXISTS idx_production_timelines_timecode
            ON production_timelines(timecode);
          CREATE INDEX IF NOT EXISTS idx_production_timelines_node
            ON production_timelines(node_id);

          CREATE TABLE IF NOT EXISTS timeline_mutations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parent_node_id TEXT NOT NULL,
            branch_id TEXT NOT NULL,
            altered_visual TEXT NOT NULL DEFAULT '[]',
            altered_vocal TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(parent_node_id)
              REFERENCES production_timelines(node_id)
              ON UPDATE CASCADE
              ON DELETE CASCADE
          );

          CREATE INDEX IF NOT EXISTS idx_timeline_mutations_parent
            ON timeline_mutations(parent_node_id);
          CREATE INDEX IF NOT EXISTS idx_timeline_mutations_branch
            ON timeline_mutations(branch_id);

          CREATE TABLE IF NOT EXISTS search_runs (
            id TEXT PRIMARY KEY,
            query TEXT NOT NULL,
            mode TEXT,
            started_at TEXT,
            finished_at TEXT,
            status TEXT,
            fragments TEXT,
            sources TEXT,
            results TEXT
          );

          CREATE TABLE IF NOT EXISTS search_results (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            url TEXT NOT NULL,
            status INTEGER,
            content_type TEXT,
            text TEXT,
            created_at TEXT,
            FOREIGN KEY(run_id) REFERENCES search_runs(id) ON DELETE CASCADE
          );

          CREATE INDEX IF NOT EXISTS idx_search_results_run
            ON search_results(run_id);

          CREATE TABLE IF NOT EXISTS narrative_tracks (
            id TEXT PRIMARY KEY,
            project_id TEXT,
            branch_id TEXT,
            timeline_id TEXT,
            blocks TEXT NOT NULL DEFAULT '[]',
            created_at TEXT
          );

          CREATE TABLE IF NOT EXISTS voice_assets (
            id TEXT PRIMARY KEY,
            track_id TEXT,
            filepath TEXT,
            metadata TEXT,
            created_at TEXT
          );
        `, error => error ? reject(error) : resolve(this));
      });
    });

    return this.ready;
  }

  async close() {
    await this.init();
    return new Promise((resolve, reject) => {
      this.db.close(error => error ? reject(error) : resolve());
    });
  }

  run(sql, params = []) {
    return this.init().then(() => new Promise((resolve, reject) => {
      this.db.run(sql, params, function(error) {
        if (error) return reject(error);
        resolve({ changes: this.changes, lastID: this.lastID });
      });
    }));
  }

  get(sql, params = []) {
    return this.init().then(() => new Promise((resolve, reject) => {
      this.db.get(sql, params, (error, row) => error ? reject(error) : resolve(row ?? null));
    }));
  }

  all(sql, params = []) {
    return this.init().then(() => new Promise((resolve, reject) => {
      this.db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows ?? []));
    }));
  }

  async append(table, record) {
    if (table === "search_runs") {
      await this.run(
        `INSERT INTO search_runs
          (id, query, mode, started_at, finished_at, status, fragments, sources, results)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           query=excluded.query, mode=excluded.mode,
           started_at=excluded.started_at, finished_at=excluded.finished_at,
           status=excluded.status, fragments=excluded.fragments,
           sources=excluded.sources, results=excluded.results`,
        [record.id, record.query, record.mode, record.startedAt, record.finishedAt,
          record.status, asJson(record.fragments, []), asJson(record.sources, []), asJson(record.results, [])]
      );
      return record;
    }

    if (table === "search_results") {
      await this.run(
        `INSERT OR REPLACE INTO search_results
          (id, run_id, url, status, content_type, text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [record.id, record.runId, record.url, record.status, record.contentType, record.text, record.createdAt]
      );
      return record;
    }

    if (table === "narrative_tracks") {
      await this.run(
        `INSERT OR REPLACE INTO narrative_tracks
          (id, project_id, branch_id, timeline_id, blocks, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [record.id, record.projectId, record.branchId, record.timelineId, asJson(record.blocks, []), record.createdAt]
      );
      return record;
    }

    if (table === "voice_assets") {
      await this.run(
        `INSERT OR REPLACE INTO voice_assets
          (id, track_id, filepath, metadata, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [record.id, record.trackId, record.filepath, asJson(record.metadata, {}), record.createdAt]
      );
      return record;
    }

    throw new Error(`Unsupported OMNI table: ${table}`);
  }

  async list(table, limit = 500) {
    const n = Math.max(1, Math.min(5000, Number(limit) || 500));

    const queries = {
      search_runs: [`SELECT * FROM search_runs ORDER BY rowid DESC LIMIT ?`, row => ({
        ...row,
        fragments: parseJson(row.fragments, []),
        sources: parseJson(row.sources, []),
        results: parseJson(row.results, [])
      })],
      search_results: [`SELECT * FROM search_results ORDER BY rowid DESC LIMIT ?`, row => row],
      narrative_tracks: [`SELECT * FROM narrative_tracks ORDER BY rowid DESC LIMIT ?`, row => ({
        ...row,
        blocks: parseJson(row.blocks, [])
      })],
      voice_assets: [`SELECT * FROM voice_assets ORDER BY rowid DESC LIMIT ?`, row => ({
        ...row,
        metadata: parseJson(row.metadata, {})
      })]
    };

    const entry = queries[table];
    if (!entry) throw new Error(`Unsupported OMNI table: ${table}`);

    const rows = await this.all(entry[0], [n]);
    return rows.map(entry[1]);
  }

  async createProductionTimeline(input = {}) {
    const record = {
      nodeId: String(input.nodeId ?? input.node_id ?? ""),
      sceneLabel: String(input.sceneLabel ?? input.scene_label ?? ""),
      timecode: String(input.timecode ?? ""),
      aestheticProfile: input.aestheticProfile ?? input.aesthetic_profile ?? null,
      prompt: input.prompt ?? null,
      audioTags: Array.isArray(input.audioTags) ? input.audioTags : []
    };

    if (!record.nodeId || !record.sceneLabel || !record.timecode) {
      throw new Error("nodeId, sceneLabel, and timecode are required");
    }

    await this.run(
      `INSERT INTO production_timelines
        (node_id, scene_label, timecode, aesthetic_profile, prompt, audio_tags)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [record.nodeId, record.sceneLabel, record.timecode,
        record.aestheticProfile, record.prompt, asJson(record.audioTags, [])]
    );

    return this.getProductionTimeline(record.nodeId);
  }

  async listProductionTimelines(limit = 500) {
    const n = Math.max(1, Math.min(5000, Number(limit) || 500));
    const rows = await this.all(
      `SELECT * FROM production_timelines ORDER BY id ASC LIMIT ?`,
      [n]
    );
    return rows.map(row => ({
      ...row,
      nodeId: row.node_id,
      sceneLabel: row.scene_label,
      timecode: row.timecode,
      aestheticProfile: row.aesthetic_profile,
      audioTags: parseJson(row.audio_tags, [])
    }));
  }

  async getProductionTimeline(nodeId) {
    const row = await this.get(
      `SELECT * FROM production_timelines WHERE node_id = ?`,
      [String(nodeId)]
    );
    if (!row) return null;

    return {
      ...row,
      nodeId: row.node_id,
      sceneLabel: row.scene_label,
      timecode: row.timecode,
      aestheticProfile: row.aesthetic_profile,
      audioTags: parseJson(row.audio_tags, [])
    };
  }

  async createTimelineMutation(input = {}) {
    const parentNodeId = String(input.parentNodeId ?? input.parent_node_id ?? "");
    const branchId = String(input.branchId ?? input.branch_id ?? "");

    if (!parentNodeId || !branchId) {
      throw new Error("parentNodeId and branchId are required");
    }

    const result = await this.run(
      `INSERT INTO timeline_mutations
        (parent_node_id, branch_id, altered_visual, altered_vocal)
       VALUES (?, ?, ?, ?)`,
      [
        parentNodeId,
        branchId,
        asJson(Array.isArray(input.alteredVisual) ? input.alteredVisual : [], []),
        asJson(Array.isArray(input.alteredVocal) ? input.alteredVocal : [], [])
      ]
    );

    return this.getTimelineMutation(result.lastID);
  }

  async listTimelineMutations(parentNodeId = null, limit = 500) {
    const n = Math.max(1, Math.min(5000, Number(limit) || 500));

    const rows = parentNodeId
      ? await this.all(
          `SELECT * FROM timeline_mutations
           WHERE parent_node_id = ?
           ORDER BY id DESC LIMIT ?`,
          [String(parentNodeId), n]
        )
      : await this.all(
          `SELECT * FROM timeline_mutations
           ORDER BY id DESC LIMIT ?`,
          [n]
        );

    return rows.map(row => ({
      ...row,
      parentNodeId: row.parent_node_id,
      branchId: row.branch_id,
      alteredVisual: parseJson(row.altered_visual, []),
      alteredVocal: parseJson(row.altered_vocal, [])
    }));
  }

  async getTimelineMutation(id) {
    const row = await this.get(
      `SELECT * FROM timeline_mutations WHERE id = ?`,
      [Number(id)]
    );
    if (!row) return null;

    return {
      ...row,
      parentNodeId: row.parent_node_id,
      branchId: row.branch_id,
      alteredVisual: parseJson(row.altered_visual, []),
      alteredVocal: parseJson(row.altered_vocal, [])
    };
  }
}

export const OMNI_SCHEMA = Object.freeze({
  production_timelines: {
    node_id: "TEXT UNIQUE NOT NULL",
    scene_label: "TEXT NOT NULL",
    timecode: "TEXT NOT NULL",
    aesthetic_profile: "TEXT",
    prompt: "TEXT",
    audio_tags: "JSON TEXT"
  },
  timeline_mutations: {
    parent_node_id: "TEXT NOT NULL REFERENCES production_timelines(node_id)",
    branch_id: "TEXT NOT NULL",
    altered_visual: "JSON TEXT NOT NULL",
    altered_vocal: "JSON TEXT NOT NULL"
  },
  search_runs: ["id", "query", "mode", "started_at", "finished_at", "status"],
  search_results: ["id", "run_id", "url", "status", "content_type", "text", "created_at"],
  narrative_tracks: ["id", "project_id", "branch_id", "timeline_id", "blocks", "created_at"],
  voice_assets: ["id", "track_id", "filepath", "metadata", "created_at"]
});
