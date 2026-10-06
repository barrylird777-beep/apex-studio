import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const DEFAULT_STORAGE_DIR =
  process.env.APEX_SOVEREIGN_STORAGE_DIR || '/srv/apex/se-x/projects';

function stableJson(value) {
  const normalize = (input) => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => [key, normalize(input[key])])
      );
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

function checksum(record) {
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

export class SovereignMeshEngine {
  constructor(storageDir = DEFAULT_STORAGE_DIR) {
    this.storageDir = path.resolve(storageDir);
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
    await fs.mkdir(this.storageDir, { recursive: true });

    let raw = '';
    try {
      raw = await fs.readFile(this.walFilePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    let lastSeq = 0;
    const lines = raw.split('\n');

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;

      let entry;
      try {
        entry = JSON.parse(line);
      } catch (error) {
        throw new Error(
          `WAL recovery failed at line ${index + 1}: invalid JSON (${error.message})`
        );
      }

      if (!Number.isSafeInteger(entry.seq) || entry.seq <= lastSeq) {
        throw new Error(`WAL recovery failed at line ${index + 1}: invalid sequence`);
      }

      if (!entry.waveId || !entry.timestamp || !entry.checksum) {
        throw new Error(`WAL recovery failed at line ${index + 1}: incomplete record`);
      }

      if (checksum(entry) !== entry.checksum) {
        throw new Error(`WAL recovery failed at line ${index + 1}: checksum mismatch`);
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

    if (!peerId) {
      throw new Error('No sovereign peer identity configured.');
    }

    const record = {
      seq: this.nextSeq++,
      waveId,
      peerId,
      action: payload.action || 'SovereignPublish',
      timestamp: new Date().toISOString(),
      status: 'DISPATCHED',
      payload
    };

    record.checksum = checksum(record);

    // Serialize writers in-process and recover the chain after a failed write.
    const write = this._writeTail.catch(() => {}).then(() => this._appendDurably(record));
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
      payload: {
        ...current.payload,
        acceptance
      }
    };
    record.checksum = checksum(record);

    const write = this._writeTail.catch(() => {}).then(() => this._appendDurably(record));
    this._writeTail = write.catch((error) => {
      this._writeError = error;
      throw error;
    });
    await this._writeTail;
    this._writeError = null;
    this.state.set(waveId, record);
    return { ...record };
  }

  async _appendDurably(record) {
    const handle = await fs.open(this.walFilePath, 'a', 0o600);
    try {
      await handle.write(stableJson(record) + '\n', null, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  get(waveId) {
    return this.state.get(waveId);
  }

  get writeError() {
    return this._writeError;
  }

  snapshot() {
    return Array.from(this.state.values(), (entry) => ({ ...entry }));
  }

  get size() {
    return this.state.size;
  }
}

export default SovereignMeshEngine;
