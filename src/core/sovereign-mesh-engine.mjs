import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assertSovereignPersistenceAdapter, createFileWalPersistenceAdapter } from './sovereign-persistence-adapter.mjs';

const DEFAULT_STORAGE_DIR =
  process.env.APEX_SOVEREIGN_STORAGE_DIR || '/srv/apex/se-x/projects';

function stableJson(value) {
  const normalize = (input) => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.keys(input).sort().map((key) => [key, normalize(value[key])]));
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

export function sovereignRecordChecksum(record) {
  const body = stableJson({
    seq: record.seq,
    waveId: record.waveId,
    peerId: record.peerId,
    action: record.action,
    timestamp: record.timestamp,
    status: record.status,
    payload: record.payload
  });
  return createHash('sha256').update(body).digest('hex');
}

export function verifySovereignRecord(record) {
  return Boolean(record && typeof record === 'object' && typeof record.checksum === 'string' && sovereignRecordChecksum(record) === record.checksum);
}

export class SovereignMeshEngine {
  constructor(storageDir = DEFAULT_STORAGE_DIR, options = {}) {
    // Backward-compatible string argument; callers can inject another backend via { persistence }.
    this.storageDir = path.resolve(storageDir);
    this.persistence = assertSovereignPersistenceAdapter(
      options.persistence || createFileWalPersistenceAdapter(this.storageDir)
    );
    this.walFilePath = path.join(this.storageDir, 'apex-ring-wal.ndjson');
    this.state = new Map();
    this.nextSeq = 1;
    this._writeTail = Promise.resolve();
    this._writeError = null;
    this._initialized = this._initializeStorage();
  }

  async ready() {
    await this._initialized;
    return this;
  }

  async _initializeStorage() {
    const records = await this.persistence.load();
    let lastSeq = 0;
    for (let index = 0; index < records.length; index += 1) {
      const entry = records[index];
      if (!Number.isSafeInteger(entry.seq) || entry.seq <= lastSeq) {
        throw new Error(`Sovereign persistence recovery failed at record ${index + 1}: invalid sequence`);
      }
      if (!entry.waveId || !entry.timestamp || !entry.checksum) {
        throw new Error(`Sovereign persistence recovery failed at record ${index + 1}: incomplete record`);
      }
      if (sovereignRecordChecksum(entry) !== entry.checksum) {
        throw new Error(`Sovereign persistence recovery failed at record ${index + 1}: checksum mismatch`);
      }
      this.state.set(entry.waveId, entry);
      lastSeq = entry.seq;
    }
    this.nextSeq = lastSeq + 1;
  }

  async dispatchAutonomousPayload(payload) {
    await this.ready();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new TypeError('Invalid payload object provided.');
    }
    const waveId = payload.waveId || randomUUID();
    const existing = this.state.get(waveId);
    if (existing) return { ...existing };
    const peerId = payload.peerId || process.env.APEX_SOVEREIGN_PEER_ID;
    if (!peerId) throw new Error('No sovereign peer identity configured.');

    const record = {
      seq: this.nextSeq++,
      waveId,
      peerId,
      action: payload.action || 'SovereignPublish',
      timestamp: new Date().toISOString(),
      status: 'DISPATCHED',
      payload
    };
    record.checksum = sovereignRecordChecksum(record);
    const write = this._writeTail.catch(() => {}).then(() => this.persistence.append(record));
    this._writeTail = write.catch((error) => {
      this._writeError = error;
      throw error;
    });
    await this._writeTail;
    this._writeError = null;
    this.state.set(record.waveId, record);
    return { ...record };
  }

  async acknowledge(waveId, acceptance = {}) {
    await this.ready();
    const current = this.state.get(waveId);
    if (!current) throw new Error(`Unknown sovereign wave: ${waveId}`);
    if (current.status === 'ACKNOWLEDGED') return { ...current };
    const record = {
      seq: this.nextSeq++,
      waveId,
      peerId: current.peerId,
      action: current.action,
      timestamp: new Date().toISOString(),
      status: 'ACKNOWLEDGED',
      payload: { ...current.payload, acceptance }
    };
    record.checksum = sovereignRecordChecksum(record);
    const write = this._writeTail.catch(() => {}).then(() => this.persistence.append(record));
    this._writeTail = write.catch((error) => {
      this._writeError = error;
      throw error;
    });
    await this._writeTail;
    this._writeError = null;
    this.state.set(waveId, record);
    return { ...record };
  }

  get(waveId) { return this.state.get(waveId); }
  get writeError() { return this._writeError; }
  snapshot() { return Array.from(this.state.values(), (entry) => ({ ...entry })); }
  get size() { return this.state.size; }
}

export default SovereignMeshEngine;
