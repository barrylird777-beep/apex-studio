import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ContentAddressedStore } from "./content-addressed-store.mjs";

const DEFAULT_STORAGE_DIR = process.env.APEX_SOVEREIGN_STORAGE_DIR || "/srv/apex/se-x/projects";
function stableJson(value) {
  const normalize = input => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === "object") return Object.fromEntries(Object.keys(input).sort().map(key => [key, normalize(input[key])]));
    return input;
  };
  return JSON.stringify(normalize(value));
}
const digest = value => createHash("sha256").update(String(value)).digest("hex");

export function sovereignRecordChecksum(record) {
  return createHash("sha256").update(stableJson({
    seq: record.seq, waveId: record.waveId, peerId: record.peerId,
    action: record.action, timestamp: record.timestamp, status: record.status, payload: record.payload
  })).digest("hex");
}
export function verifySovereignRecord(record) {
  return Boolean(record && typeof record === "object" && typeof record.checksum === "string" && sovereignRecordChecksum(record) === record.checksum);
}

/**
 * Sovereign mesh state uses immutable SHA-256 objects and atomic per-wave manifests.
 * The former NDJSON log is read once for migration only; this engine never appends to it.
 */
export class SovereignMeshEngine {
  constructor(storageDir = DEFAULT_STORAGE_DIR) {
    this.storageDir = path.resolve(storageDir);
    this.legacyLogPath = path.join(this.storageDir, "apex-ring-wal.ndjson");
    this.migrationFile = path.join(this.storageDir, ".sovereign-cas-migrated-v1.json");
    this.cas = new ContentAddressedStore({ root: path.join(this.storageDir, ".sovereign-cas") });
    this.state = new Map();
    this._writeTail = Promise.resolve();
    this._writeError = null;
    this._initialized = this._initializeStorage();
  }
  key(waveId) { return digest(waveId); }
  async ready() { await this._initialized; return this; }

  async _initializeStorage() {
    await fs.mkdir(this.storageDir, { recursive: true, mode: 0o700 });
    await this.cas.init();
    let migrated = false;
    try { await fs.stat(this.migrationFile); migrated = true; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!migrated) {
      let raw = "";
      try { raw = await fs.readFile(this.legacyLogPath, "utf8"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      let lastSeq = 0;
      for (const [index, lineRaw] of raw.split("\\n").entries()) {
        const line = lineRaw.trim();
        if (!line) continue;
        let entry;
        try { entry = JSON.parse(line); }
        catch (error) { throw new Error("Legacy mesh migration failed at line " + (index + 1) + ": invalid JSON (" + error.message + ")"); }
        if (!Number.isSafeInteger(entry.seq) || entry.seq <= lastSeq || !entry.waveId || !entry.timestamp || !verifySovereignRecord(entry)) {
          throw new Error("Legacy mesh migration integrity failure at line " + (index + 1));
        }
        await this.cas.writeRef("waves", this.key(entry.waveId), entry);
        lastSeq = entry.seq;
      }
      const marker = this.migrationFile + "." + randomUUID() + ".tmp";
      await fs.writeFile(marker, JSON.stringify({ version: 1, storage: "content-addressed", migratedAt: new Date().toISOString() }) + "\\n", { flag: "wx", mode: 0o600 });
      await fs.rename(marker, this.migrationFile);
    }
    const refs = await this.cas.listRefs("waves");
    for (const ref of refs) {
      const entry = ref.value;
      if (!verifySovereignRecord(entry)) throw new Error("Content-addressed sovereign record integrity failure");
      this.state.set(entry.waveId, entry);
    }
  }

  async dispatchAutonomousPayload(payload) {
    await this.ready();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new TypeError("Invalid payload object provided.");
    const waveId = String(payload.waveId || randomUUID());
    const existing = this.state.get(waveId);
    if (existing) return { ...existing };
    const peerId = payload.peerId || process.env.APEX_SOVEREIGN_PEER_ID;
    if (!peerId) throw new Error("No sovereign peer identity configured.");
    const record = { seq: 1, waveId, peerId, action: payload.action || "SovereignPublish", timestamp: new Date().toISOString(), status: "DISPATCHED", payload };
    record.checksum = sovereignRecordChecksum(record);
    const write = this._writeTail.catch(() => {}).then(async () => {
      const refKey = this.key(waveId);
      try { await this.cas.writeRef("waves", refKey, record, { expectedHash: null }); }
      catch (error) {
        if (error.code !== "CAS_CONFLICT") throw error;
        const current = await this.cas.readRef("waves", refKey);
        if (current?.value) return current.value;
        throw error;
      }
      return record;
    });
    this._writeTail = write.catch(error => { this._writeError = error; throw error; });
    const saved = await this._writeTail;
    this._writeError = null;
    this.state.set(waveId, saved);
    return { ...saved };
  }

  async acknowledge(waveId, acceptance = {}) {
    await this.ready();
    const current = this.state.get(String(waveId));
    if (!current) throw new Error("Unknown sovereign wave: " + waveId);
    if (current.status === "ACKNOWLEDGED") return { ...current };
    const record = { seq: Number(current.seq || 0) + 1, waveId: current.waveId, peerId: current.peerId, action: current.action,
      timestamp: new Date().toISOString(), status: "ACKNOWLEDGED", payload: { ...current.payload, acceptance } };
    record.checksum = sovereignRecordChecksum(record);
    const write = this._writeTail.catch(() => {}).then(async () => {
      const refKey = this.key(waveId);
      const manifest = await this.cas.readRef("waves", refKey);
      if (!manifest) throw new Error("Sovereign wave manifest disappeared before acknowledgment");
      await this.cas.writeRef("waves", refKey, record, { expectedHash: manifest.hash });
      return record;
    });
    this._writeTail = write.catch(error => { this._writeError = error; throw error; });
    const saved = await this._writeTail;
    this._writeError = null;
    this.state.set(String(waveId), saved);
    return { ...saved };
  }

  get(waveId) { return this.state.get(String(waveId)); }
  get writeError() { return this._writeError; }
  snapshot() { return Array.from(this.state.values(), entry => ({ ...entry })); }
  get size() { return this.state.size; }
}
export default SovereignMeshEngine;
