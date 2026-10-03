import sqlite3 from "sqlite3";
import path from "node:path";
import { Worker } from "node:worker_threads";

const DEFAULT_DB = process.env.APEX_OMNI_DB_FILE ?? "./apex-omni.sqlite";
const BUSY_TIMEOUT = Math.max(5000, Number(process.env.APEX_OMNI_BUSY_TIMEOUT_MS ?? 30000));

function asJson(value, fallback = null) {
  return value == null ? fallback : JSON.stringify(value);
}
function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

class TextWorker {
  constructor() {
    this.worker = new Worker(new URL("../workers/omni-text-worker.mjs", import.meta.url));
    this.pending = new Map();
    this.nextId = 1;
    this.worker.on("message", message => {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.ok ? pending.resolve(message.value) : pending.reject(new Error(message.error));
    });
    this.worker.on("error", error => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }
  call(op, payload) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, op, ...payload });
    });
  }
  fragment(text) { return this.call("fragment", { text }); }
  close() { return this.worker.terminate(); }
}

export class OmniStore {
  constructor(file = DEFAULT_DB) {
    this.file = path.resolve(file);
    this.db = null;
    this.ready = null;
    this.textWorker = new TextWorker();
  }

  async init() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(
        this.file,
        sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
        error => {
          if (error) return reject(error);
          this.db.configure("busyTimeout", BUSY_TIMEOUT);
          this.db.exec(`
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=NORMAL;
            PRAGMA foreign_keys=ON;
            PRAGMA temp_store=MEMORY;

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
                ON UPDATE CASCADE ON DELETE CASCADE
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

            CREATE TABLE IF NOT EXISTS search_run_fragments (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              run_id TEXT NOT NULL,
              fragment_index INTEGER NOT NULL,
              text TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY(run_id) REFERENCES search_runs(id) ON DELETE CASCADE,
              UNIQUE(run_id, fragment_index)
            );
            CREATE INDEX IF NOT EXISTS idx_search_run_fragments_run
              ON search_run_fragments(run_id);
            CREATE INDEX IF NOT EXISTS idx_search_run_fragments_run_position
              ON search_run_fragments(run_id, fragment_index);

            CREATE TABLE IF NOT EXISTS parsed_passage_fragments (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              run_id TEXT,
              result_id TEXT,
              fragment_index INTEGER NOT NULL,
              char_offset INTEGER NOT NULL DEFAULT 0,
              text TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY(run_id) REFERENCES search_runs(id) ON DELETE CASCADE,
              FOREIGN KEY(result_id) REFERENCES search_results(id) ON DELETE CASCADE,
              UNIQUE(result_id, fragment_index)
            );
            CREATE INDEX IF NOT EXISTS idx_parsed_passage_run
              ON parsed_passage_fragments(run_id);
            CREATE INDEX IF NOT EXISTS idx_parsed_passage_result
              ON parsed_passage_fragments(result_id);
            CREATE INDEX IF NOT EXISTS idx_parsed_passage_position
              ON parsed_passage_fragments(result_id, fragment_index);

            CREATE VIRTUAL TABLE IF NOT EXISTS parsed_passage_fragments_fts
              USING fts5(
                text,
                content='parsed_passage_fragments',
                content_rowid='id'
              );

            CREATE TRIGGER IF NOT EXISTS parsed_passage_fragments_ai
            AFTER INSERT ON parsed_passage_fragments BEGIN
              INSERT INTO parsed_passage_fragments_fts(rowid, text)
              VALUES (new.id, new.text);
            END;

            CREATE TRIGGER IF NOT EXISTS parsed_passage_fragments_ad
            AFTER DELETE ON parsed_passage_fragments BEGIN
              INSERT INTO parsed_passage_fragments_fts(
                parsed_passage_fragments_fts,
                rowid,
                text
              ) VALUES ('delete', old.id, old.text);
            END;

            CREATE TRIGGER IF NOT EXISTS parsed_passage_fragments_au
            AFTER UPDATE OF text ON parsed_passage_fragments BEGIN
              INSERT INTO parsed_passage_fragments_fts(
                parsed_passage_fragments_fts,
                rowid,
                text
              ) VALUES ('delete', old.id, old.text);
              INSERT INTO parsed_passage_fragments_fts(rowid, text)
              VALUES (new.id, new.text);
            END;

            CREATE TABLE IF NOT EXISTS narrative_tracks (
              id TEXT PRIMARY KEY,
              project_id TEXT,
              branch_id TEXT,
              timeline_id TEXT,
              blocks TEXT NOT NULL DEFAULT '[]',
              created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS narrative_blocks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              track_id TEXT NOT NULL,
              position INTEGER NOT NULL,
              block_type TEXT,
              text_ref TEXT,
              visual_ref TEXT,
              vocal_ref TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY(track_id) REFERENCES narrative_tracks(id) ON DELETE CASCADE,
              UNIQUE(track_id, position)
            );
            CREATE INDEX IF NOT EXISTS idx_narrative_blocks_track
              ON narrative_blocks(track_id);
            CREATE INDEX IF NOT EXISTS idx_narrative_blocks_track_position
              ON narrative_blocks(track_id, position);

            CREATE TABLE IF NOT EXISTS voice_assets (
              id TEXT PRIMARY KEY,
              track_id TEXT,
              playback_uri TEXT,
              content_type TEXT,
              content_length INTEGER,
              content_hash TEXT,
              metadata TEXT,
              created_at TEXT
            );

            CREATE TABLE IF NOT EXISTS production_timeline_audio_tags (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timeline_id TEXT NOT NULL,
              tag TEXT NOT NULL,
              position INTEGER NOT NULL,
              FOREIGN KEY(timeline_id) REFERENCES production_timelines(node_id) ON DELETE CASCADE,
              UNIQUE(timeline_id, position)
            );
            CREATE INDEX IF NOT EXISTS idx_timeline_audio_tags_timeline
              ON production_timeline_audio_tags(timeline_id);
            CREATE INDEX IF NOT EXISTS idx_timeline_audio_tags_tag
              ON production_timeline_audio_tags(tag);

            CREATE TABLE IF NOT EXISTS timeline_mutation_visual (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              mutation_id INTEGER NOT NULL,
              position INTEGER NOT NULL,
              value TEXT NOT NULL,
              FOREIGN KEY(mutation_id) REFERENCES timeline_mutations(id) ON DELETE CASCADE,
              UNIQUE(mutation_id, position)
            );
            CREATE INDEX IF NOT EXISTS idx_mutation_visual_mutation
              ON timeline_mutation_visual(mutation_id, position);

            CREATE TABLE IF NOT EXISTS timeline_mutation_vocal (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              mutation_id INTEGER NOT NULL,
              position INTEGER NOT NULL,
              value TEXT NOT NULL,
              FOREIGN KEY(mutation_id) REFERENCES timeline_mutations(id) ON DELETE CASCADE,
              UNIQUE(mutation_id, position)
            );
            CREATE INDEX IF NOT EXISTS idx_mutation_vocal_mutation
              ON timeline_mutation_vocal(mutation_id, position);
          `, error => error ? reject(error) : resolve(this));
        }
      );
    });
    return this.ready;
  }

  async close() {
    await this.init();
    await new Promise((resolve, reject) => this.db.close(error => error ? reject(error) : resolve()));
    await this.textWorker.close();
    this.db = null;
    this.ready = null;
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

  async indexPassage({ runId = null, resultId = null, text }) {
    const fragments = await this.textWorker.fragment(text);
    if (!fragments.length) return [];
    await this.run("BEGIN");
    try {
      for (const fragment of fragments) {
        await this.run(
          `INSERT INTO parsed_passage_fragments
             (run_id, result_id, fragment_index, char_offset, text)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(result_id, fragment_index) DO UPDATE SET
             char_offset=excluded.char_offset, text=excluded.text`,
          [runId, resultId, fragment.index, fragment.offset, fragment.text]
        );
      }
      await this.run("COMMIT");
    } catch (error) {
      await this.run("ROLLBACK").catch(() => {});
      throw error;
    }
    return fragments;
  }

  async searchPassages(query, limit = 50) {
    const q = String(query ?? "").trim();
    if (!q) return [];
    const n = Math.max(1, Math.min(500, Number(limit) || 50));
    const rows = await this.all(
      `SELECT p.id, p.run_id, p.result_id, p.fragment_index, p.char_offset,
              p.text, r.url, r.content_type,
              bm25(parsed_passage_fragments_fts) AS rank
       FROM parsed_passage_fragments_fts f
       JOIN parsed_passage_fragments p ON p.id = f.rowid
       LEFT JOIN search_results r ON r.id = p.result_id
       WHERE parsed_passage_fragments_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
      [q, n]
    );
    return rows;
  }

  async migrateLegacyText(limit = 1000) {
    const rows = await this.all(
      `SELECT id, run_id, text FROM search_results
       WHERE text IS NOT NULL AND length(text) > 0
       ORDER BY rowid ASC LIMIT ?`,
      [Math.max(1, Math.min(10000, Number(limit) || 1000))]
    );
    for (const row of rows) await this.indexPassage({ runId: row.run_id, resultId: row.id, text: row.text });
    return { migrated: rows.length };
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
      if (Array.isArray(record.fragments)) {
        await this.run("DELETE FROM search_run_fragments WHERE run_id = ?", [record.id]);
        for (const [index, fragment] of record.fragments.entries()) {
          await this.run(
            `INSERT INTO search_run_fragments(run_id, fragment_index, text)
             VALUES (?, ?, ?)`,
            [record.id, index, String(fragment)]
          );
        }
      }
      return record;
    }

    if (table === "search_results") {
      await this.run(
        `INSERT OR REPLACE INTO search_results
          (id, run_id, url, status, content_type, text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [record.id, record.runId, record.url, record.status, record.contentType, record.text, record.createdAt]
      );
      if (record.text) await this.indexPassage({ runId: record.runId, resultId: record.id, text: record.text });
      return record;
    }

    if (table === "narrative_tracks") {
      await this.run(
        `INSERT OR REPLACE INTO narrative_tracks
          (id, project_id, branch_id, timeline_id, blocks, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [record.id, record.projectId, record.branchId, record.timelineId, asJson(record.blocks, []), record.createdAt]
      );
      await this.run("DELETE FROM narrative_blocks WHERE track_id = ?", [record.id]);
      for (const [position, block] of (record.blocks ?? []).entries()) {
        await this.run(
          `INSERT INTO narrative_blocks(track_id, position, block_type, text_ref, visual_ref, vocal_ref)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [record.id, position, block?.type ?? null, asJson(block?.text, null),
            asJson(block?.visualFrames ?? block?.visual ?? null, null),
            asJson(block?.vocal ?? null, null)]
        );
      }
      return record;
    }

    if (table === "voice_assets") {
      await this.run(
        `INSERT OR REPLACE INTO voice_assets
          (id, track_id, playback_uri, content_type, content_length, content_hash, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [record.id, record.trackId, record.playbackUri ?? record.filepath ?? null,
          record.contentType ?? null, record.contentLength ?? null, record.contentHash ?? null,
          asJson(record.metadata, {})]
      );
      return record;
    }

    throw new Error(`Unsupported OMNI table: ${table}`);
  }

  async list(table, limit = 500) {
    const n = Math.max(1, Math.min(5000, Number(limit) || 500));
    if (table === "search_runs") {
      const rows = await this.all("SELECT * FROM search_runs ORDER BY rowid DESC LIMIT ?", [n]);
      return rows.map(row => ({ ...row, fragments: parseJson(row.fragments, []), sources: parseJson(row.sources, []), results: parseJson(row.results, []) }));
    }
    if (table === "search_results") return this.all("SELECT * FROM search_results ORDER BY rowid DESC LIMIT ?", [n]);
    if (table === "narrative_tracks") {
      const rows = await this.all("SELECT * FROM narrative_tracks ORDER BY rowid DESC LIMIT ?", [n]);
      return rows.map(row => ({ ...row, blocks: parseJson(row.blocks, []) }));
    }
    if (table === "voice_assets") {
      const rows = await this.all("SELECT * FROM voice_assets ORDER BY rowid DESC LIMIT ?", [n]);
      return rows.map(row => ({ ...row, metadata: parseJson(row.metadata, {}) }));
    }
    throw new Error(`Unsupported OMNI table: ${table}`);
  }

  async createProductionTimeline(input = {}) {
    const nodeId = String(input.nodeId ?? input.node_id ?? "");
    const sceneLabel = String(input.sceneLabel ?? input.scene_label ?? "");
    const timecode = String(input.timecode ?? "");
    if (!nodeId || !sceneLabel || !timecode) throw new Error("nodeId, sceneLabel, and timecode are required");
    await this.run(
      `INSERT INTO production_timelines(node_id, scene_label, timecode, aesthetic_profile, prompt)
       VALUES (?, ?, ?, ?, ?)`,
      [nodeId, sceneLabel, timecode, input.aestheticProfile ?? input.aesthetic_profile ?? null, input.prompt ?? null]
    );
    const tags = Array.isArray(input.audioTags) ? input.audioTags : [];
    for (const [position, tag] of tags.entries()) {
      await this.run(
        `INSERT INTO production_timeline_audio_tags(timeline_id, tag, position) VALUES (?, ?, ?)`,
        [nodeId, String(tag), position]
      );
    }
    return this.getProductionTimeline(nodeId);
  }

  async getProductionTimeline(nodeId) {
    const row = await this.get("SELECT * FROM production_timelines WHERE node_id = ?", [String(nodeId)]);
    if (!row) return null;
    const tags = await this.all(
      "SELECT tag FROM production_timeline_audio_tags WHERE timeline_id = ? ORDER BY position",
      [row.node_id]
    );
    return { ...row, nodeId: row.node_id, sceneLabel: row.scene_label, timecode: row.timecode,
      aestheticProfile: row.aesthetic_profile, audioTags: tags.map(x => x.tag) };
  }

  async listProductionTimelines(limit = 500) {
    const rows = await this.all("SELECT * FROM production_timelines ORDER BY id ASC LIMIT ?", [
      Math.max(1, Math.min(5000, Number(limit) || 500))
    ]);
    return Promise.all(rows.map(row => this.getProductionTimeline(row.node_id)));
  }

  async createTimelineMutation(input = {}) {
    const parentNodeId = String(input.parentNodeId ?? input.parent_node_id ?? "");
    const branchId = String(input.branchId ?? input.branch_id ?? "");
    if (!parentNodeId || !branchId) throw new Error("parentNodeId and branchId are required");
    const result = await this.run(
      "INSERT INTO timeline_mutations(parent_node_id, branch_id) VALUES (?, ?)",
      [parentNodeId, branchId]
    );
    for (const [position, value] of (Array.isArray(input.alteredVisual) ? input.alteredVisual : []).entries()) {
      await this.run("INSERT INTO timeline_mutation_visual(mutation_id, position, value) VALUES (?, ?, ?)",
        [result.lastID, position, JSON.stringify(value)]);
    }
    for (const [position, value] of (Array.isArray(input.alteredVocal) ? input.alteredVocal : []).entries()) {
      await this.run("INSERT INTO timeline_mutation_vocal(mutation_id, position, value) VALUES (?, ?, ?)",
        [result.lastID, position, JSON.stringify(value)]);
    }
    return this.getTimelineMutation(result.lastID);
  }

  async getTimelineMutation(id) {
    const row = await this.get("SELECT * FROM timeline_mutations WHERE id = ?", [Number(id)]);
    if (!row) return null;
    const visual = await this.all("SELECT value FROM timeline_mutation_visual WHERE mutation_id = ? ORDER BY position", [row.id]);
    const vocal = await this.all("SELECT value FROM timeline_mutation_vocal WHERE mutation_id = ? ORDER BY position", [row.id]);
    return {
      ...row,
      parentNodeId: row.parent_node_id,
      branchId: row.branch_id,
      alteredVisual: visual.map(x => parseJson(x.value, x.value)),
      alteredVocal: vocal.map(x => parseJson(x.value, x.value))
    };
  }

  async listTimelineMutations(parentNodeId = null, limit = 500) {
    const rows = parentNodeId
      ? await this.all("SELECT * FROM timeline_mutations WHERE parent_node_id = ? ORDER BY id DESC LIMIT ?", [String(parentNodeId), Math.max(1, Math.min(5000, Number(limit) || 500))])
      : await this.all("SELECT * FROM timeline_mutations ORDER BY id DESC LIMIT ?", [Math.max(1, Math.min(5000, Number(limit) || 500))]);
    return Promise.all(rows.map(row => this.getTimelineMutation(row.id)));
  }
}

export const OMNI_SCHEMA = Object.freeze({
  parsed_passage_fragments: ["id", "run_id", "result_id", "fragment_index", "char_offset", "text"],
  fts5: "parsed_passage_fragments_fts",
  production_timeline_audio_tags: ["timeline_id", "tag", "position"],
  timeline_mutation_visual: ["mutation_id", "position", "value"],
  timeline_mutation_vocal: ["mutation_id", "position", "value"],
  narrative_blocks: ["id", "track_id", "position", "block_type", "text_ref", "visual_ref", "vocal_ref"]
});
