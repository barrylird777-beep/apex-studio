import { createHash, randomUUID } from "node:crypto";
import { encodeCanonical } from "./apex-cbor.mjs";

const digest = value => createHash("sha256").update(String(value)).digest("hex");
const recordDigest = record => createHash("sha256").update(encodeCanonical({
  seq: record.seq, waveId: record.waveId, peerId: record.peerId,
  action: record.action, timestamp: record.timestamp, status: record.status, payload: record.payload
})).digest("hex");

export function sovereignRecordChecksum(record) {
  return recordDigest(record);
}
export function verifySovereignRecord(record) {
  try {
    return Boolean(record && typeof record === "object" &&
      typeof record.checksum === "string" && sovereignRecordChecksum(record) === record.checksum);
  } catch {
    return false;
  }
}

/**
 * Mesh engine backed exclusively by an injected peer-owned CAS adapter.
 * There is deliberately no default filesystem store or legacy-log migration.
 */
export class SovereignMeshEngine {
  constructor({ cas } = {}) {
    if (!cas || typeof cas.init !== "function" || typeof cas.readRef !== "function" ||
        typeof cas.writeRef !== "function" || typeof cas.listRefs !== "function") {
      throw new TypeError("SovereignMeshEngine requires a verified peer-backed CAS; local fallback is forbidden");
    }
    this.cas = cas;
    this.state = new Map();
    this._writeTail = Promise.resolve();
    this._writeError = null;
    this._namespaceFrozen = false;
    this._initialized = this._initializeStorage();
  }

  key(waveId) { return digest(waveId); }
  async ready() { await this._initialized; return this; }

  assertWritable() {
    if (this._namespaceFrozen) {
      const error = new Error("Sovereign namespace is frozen after a write-integrity or quorum failure");
      error.code = "NAMESPACE_FROZEN";
      error.cause = this._writeError || undefined;
      throw error;
    }
  }

  freezeNamespace(error) {
    this._namespaceFrozen = true;
    this._writeError = error instanceof Error ? error : new Error(String(error || "unknown write failure"));
  }

  async _initializeStorage() {
    await this.cas.init();
    const refs = await this.cas.listRefs("waves");
    const seen = new Set();
    for (const ref of refs) {
      const entry = ref.value;
      if (!verifySovereignRecord(entry) || this.key(entry.waveId) !== ref.key || seen.has(entry.waveId)) {
        throw new Error("Peer-backed sovereign record integrity or reference-key verification failed");
      }
      seen.add(entry.waveId);
      this.state.set(entry.waveId, entry);
    }
    const sequence = await this.cas.readRef("meta", "sequence");
    if (!sequence) {
      try {
        await this.cas.writeRef("meta", "sequence", { next: 1 }, { expectedHash: null });
      } catch (error) {
        if (error.code !== "CAS_CONFLICT") throw error;
        if (!(await this.cas.readRef("meta", "sequence"))) throw error;
      }
    }
  }

  async reserveSequence() {
    this.assertWritable();
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        const current = await this.cas.readRef("meta", "sequence");
        const next = Number(current?.value?.next || 1);
        if (!Number.isSafeInteger(next) || next < 1 || next >= Number.MAX_SAFE_INTEGER) {
          const error = new Error("Sovereign sequence state is invalid or exhausted");
          error.code = "SEQUENCE_STATE_INVALID";
          throw error;
        }
        try {
          await this.cas.writeRef("meta", "sequence", { next: next + 1 }, { expectedHash: current?.hash ?? null });
          return next;
        } catch (error) {
          if (error.code !== "CAS_CONFLICT") throw error;
        }
      }
      const error = new Error("Could not reserve sovereign sequence after peer CAS retries");
      error.code = "SEQUENCE_RETRY_EXHAUSTED";
      throw error;
    } catch (error) {
      this.freezeNamespace(error);
      throw error;
    }
  }

  async dispatchAutonomousPayload(payload) {
    await this.ready();
    this.assertWritable();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new TypeError("Invalid payload object provided.");
    const waveId = String(payload.waveId || randomUUID());
    const existing = this.state.get(waveId);
    if (existing) return { ...existing };
    const peerId = payload.peerId || process.env.APEX_SOVEREIGN_PEER_ID;
    if (!peerId) throw new Error("No sovereign peer identity configured.");
    const seq = await this.reserveSequence();
    const record = { seq, waveId, peerId, action: payload.action || "SovereignPublish", timestamp: new Date().toISOString(), status: "DISPATCHED", payload };
    record.checksum = sovereignRecordChecksum(record);
    const write = this._writeTail.then(async () => {
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
    this._writeTail = write.catch(error => { this.freezeNamespace(error); throw error; });
    const saved = await this._writeTail;
    this.state.set(waveId, saved);
    return { ...saved };
  }

  async acknowledge(waveId, acceptance = {}) {
    await this.ready();
    this.assertWritable();
    const current = this.state.get(String(waveId));
    if (!current) throw new Error("Unknown sovereign wave: " + waveId);
    if (current.status === "ACKNOWLEDGED") return { ...current };
    const seq = await this.reserveSequence();
    const record = { seq, waveId: current.waveId, peerId: current.peerId, action: current.action,
      timestamp: new Date().toISOString(), status: "ACKNOWLEDGED", payload: { ...current.payload, acceptance } };
    record.checksum = sovereignRecordChecksum(record);
    const write = this._writeTail.then(async () => {
      const refKey = this.key(waveId);
      const manifest = await this.cas.readRef("waves", refKey);
      if (!manifest) throw new Error("Sovereign wave manifest disappeared before acknowledgment");
      await this.cas.writeRef("waves", refKey, record, { expectedHash: manifest.hash });
      return record;
    });
    this._writeTail = write.catch(error => { this.freezeNamespace(error); throw error; });
    const saved = await this._writeTail;
    this.state.set(String(waveId), saved);
    return { ...saved };
  }

  get(waveId) { return this.state.get(String(waveId)); }
  get writeError() { return this._writeError; }
  get namespaceFrozen() { return this._namespaceFrozen; }
  snapshot() { return Array.from(this.state.values(), entry => ({ ...entry })); }
  get size() { return this.state.size; }
}
export default SovereignMeshEngine;
