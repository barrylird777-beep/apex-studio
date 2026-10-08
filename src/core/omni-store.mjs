import pg from "pg";

const { Pool } = pg;

function jsonOrFallback(value, fallback) {
  if (value == null) return fallback;
  return value;
}

function databaseSsl() {
  return process.env.APEX_PG_SSL === "false"
    ? false
    : { rejectUnauthorized: false };
}

export class OmniStore {
  constructor(options = {}) {
    if (typeof options === "string") {
      throw new TypeError("OmniStore no longer accepts SQLite database paths; pass a PostgreSQL pool/options instead");
    }

    this.pool = options.pool || new Pool({
      connectionString: options.connectionString || process.env.DATABASE_URL,
      max: Number(options.max ?? process.env.APEX_DB_POOL_MAX ?? 20),
      idleTimeoutMillis: Number(options.idleTimeoutMillis ?? process.env.APEX_DB_IDLE_TIMEOUT_MS ?? 30000),
      connectionTimeoutMillis: Number(options.connectionTimeoutMillis ?? process.env.APEX_DB_CONNECTION_TIMEOUT_MS ?? 10000),
      ssl: options.ssl ?? databaseSsl()
    });
    this.ownsPool = !options.pool;
    this.ready = null;
  }

  async init() {
    if (this.ready) return this.ready;
    this.ready = this.pool.query("SELECT 1").then(() => this);
    return this.ready;
  }

  async close() {
    if (this.ownsPool) await this.pool.end();
  }

  async run(sql, params = []) {
    const result = await this.init().then(() => this.pool.query(sql, params));
    return {
      changes: result.rowCount,
      lastID: result.rows[0]?.id ?? null,
      rows: result.rows
    };
  }

  async get(sql, params = []) {
    const result = await this.init().then(() => this.pool.query(sql, params));
    return result.rows[0] ?? null;
  }

  async all(sql, params = []) {
    const result = await this.init().then(() => this.pool.query(sql, params));
    return result.rows;
  }

  async append(table, record) {
    if (table === "search_runs") {
      await this.run(
        `INSERT INTO search_runs
          (id, query, mode, started_at, finished_at, status, fragments, sources, results)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT(id) DO UPDATE SET
           query=excluded.query, mode=excluded.mode,
           started_at=excluded.started_at, finished_at=excluded.finished_at,
           status=excluded.status, fragments=excluded.fragments,
           sources=excluded.sources, results=excluded.results`,
        [
          record.id,
          record.query,
          record.mode,
          record.startedAt,
          record.finishedAt,
          record.status,
          jsonOrFallback(record.fragments, []),
          jsonOrFallback(record.sources, []),
          jsonOrFallback(record.results, [])
        ]
      );
      return record;
    }

    if (table === "search_results") {
      await this.run(
        `INSERT INTO search_results
          (id, run_id, url, status, content_type, text, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT(id) DO UPDATE SET
           run_id=excluded.run_id, url=excluded.url, status=excluded.status,
           content_type=excluded.content_type, text=excluded.text,
           created_at=excluded.created_at`,
        [
          record.id,
          record.runId,
          record.url,
          record.status,
          record.contentType,
          record.text,
          record.createdAt
        ]
      );
      return record;
    }

    if (table === "narrative_tracks") {
      await this.run(
        `INSERT INTO narrative_tracks
          (id, project_id, branch_id, timeline_id, blocks, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT(id) DO UPDATE SET
           project_id=excluded.project_id, branch_id=excluded.branch_id,
           timeline_id=excluded.timeline_id, blocks=excluded.blocks,
           created_at=excluded.created_at`,
        [
          record.id,
          record.projectId,
          record.branchId,
          record.timelineId,
          jsonOrFallback(record.blocks, []),
          record.createdAt
        ]
      );
      return record;
    }

    if (table === "voice_assets") {
      await this.run(
        `INSERT INTO voice_assets
          (id, track_id, filepath, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT(id) DO UPDATE SET
           track_id=excluded.track_id, filepath=excluded.filepath,
           metadata=excluded.metadata, created_at=excluded.created_at`,
        [
          record.id,
          record.trackId,
          record.filepath,
          jsonOrFallback(record.metadata, {}),
          record.createdAt
        ]
      );
      return record;
    }

    throw new Error(`Unsupported OMNI table: ${table}`);
  }

  async list(table, limit = 500) {
    const n = Math.max(1, Math.min(5000, Number(limit) || 500));

    const queries = {
      search_runs: [
        `SELECT * FROM search_runs
         ORDER BY COALESCE(finished_at, started_at, 'epoch'::timestamptz) DESC
         LIMIT $1`,
        row => ({
          ...row,
          fragments: jsonOrFallback(row.fragments, []),
          sources: jsonOrFallback(row.sources, []),
          results: jsonOrFallback(row.results, [])
        })
      ],
      search_results: [
        `SELECT * FROM search_results
         ORDER BY created_at DESC, id DESC
         LIMIT $1`,
        row => row
      ],
      narrative_tracks: [
        `SELECT * FROM narrative_tracks
         ORDER BY created_at DESC, id DESC
         LIMIT $1`,
        row => ({
          ...row,
          blocks: jsonOrFallback(row.blocks, [])
        })
      ],
      voice_assets: [
        `SELECT * FROM voice_assets
         ORDER BY created_at DESC, id DESC
         LIMIT $1`,
        row => ({
          ...row,
          metadata: jsonOrFallback(row.metadata, {})
        })
      ]
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
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        record.nodeId,
        record.sceneLabel,
        record.timecode,
        record.aestheticProfile,
        record.prompt,
        record.audioTags
      ]
    );

    return this.getProductionTimeline(record.nodeId);
  }

  async listProductionTimelines(limit = 500) {
    const n = Math.max(1, Math.min(5000, Number(limit) || 500));
    const rows = await this.all(
      `SELECT * FROM production_timelines
       ORDER BY id ASC
       LIMIT $1`,
      [n]
    );

    return rows.map(row => ({
      ...row,
      nodeId: row.node_id,
      sceneLabel: row.scene_label,
      timecode: row.timecode,
      aestheticProfile: row.aesthetic_profile,
      audioTags: jsonOrFallback(row.audio_tags, [])
    }));
  }

  async getProductionTimeline(nodeId) {
    const row = await this.get(
      `SELECT * FROM production_timelines WHERE node_id = $1`,
      [String(nodeId)]
    );
    if (!row) return null;

    return {
      ...row,
      nodeId: row.node_id,
      sceneLabel: row.scene_label,
      timecode: row.timecode,
      aestheticProfile: row.aesthetic_profile,
      audioTags: jsonOrFallback(row.audio_tags, [])
    };
  }

  async createTimelineMutation(input = {}) {
    const parentNodeId = String(input.parentNodeId ?? input.parent_node_id ?? "");
    const branchId = String(input.branchId ?? input.branch_id ?? "");

    if (!parentNodeId || !branchId) {
      throw new Error("parentNodeId and branchId are required");
    }

    const result = await this.pool.query(
      `INSERT INTO timeline_mutations
        (parent_node_id, branch_id, altered_visual, altered_vocal)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        parentNodeId,
        branchId,
        Array.isArray(input.alteredVisual) ? input.alteredVisual : [],
        Array.isArray(input.alteredVocal) ? input.alteredVocal : []
      ]
    );

    return this.getTimelineMutation(result.rows[0].id);
  }

  async listTimelineMutations(parentNodeId = null, limit = 500) {
    const n = Math.max(1, Math.min(5000, Number(limit) || 500));

    const rows = parentNodeId
      ? await this.all(
          `SELECT * FROM timeline_mutations
           WHERE parent_node_id = $1
           ORDER BY id DESC
           LIMIT $2`,
          [String(parentNodeId), n]
        )
      : await this.all(
          `SELECT * FROM timeline_mutations
           ORDER BY id DESC
           LIMIT $1`,
          [n]
        );

    return rows.map(row => ({
      ...row,
      parentNodeId: row.parent_node_id,
      branchId: row.branch_id,
      alteredVisual: jsonOrFallback(row.altered_visual, []),
      alteredVocal: jsonOrFallback(row.altered_vocal, [])
    }));
  }

  async getTimelineMutation(id) {
    const row = await this.get(
      `SELECT * FROM timeline_mutations WHERE id = $1`,
      [Number(id)]
    );
    if (!row) return null;

    return {
      ...row,
      parentNodeId: row.parent_node_id,
      branchId: row.branch_id,
      alteredVisual: jsonOrFallback(row.altered_visual, []),
      alteredVocal: jsonOrFallback(row.altered_vocal, [])
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
    audio_tags: "JSONB NOT NULL DEFAULT []"
  },
  timeline_mutations: {
    parent_node_id: "TEXT NOT NULL REFERENCES production_timelines(node_id)",
    branch_id: "TEXT NOT NULL",
    altered_visual: "JSONB NOT NULL DEFAULT []",
    altered_vocal: "JSONB NOT NULL DEFAULT []"
  },
  search_runs: ["id", "query", "mode", "started_at", "finished_at", "status"],
  search_results: ["id", "run_id", "url", "status", "content_type", "text", "created_at"],
  narrative_tracks: ["id", "project_id", "branch_id", "timeline_id", "blocks", "created_at"],
  voice_assets: ["id", "track_id", "filepath", "metadata", "created_at"]
});
