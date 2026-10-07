import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { paths } from '../core/sovereign-local-storage.mjs';
import { sendProtocol } from '../network/sovereign-peer.mjs';

const ROOT = process.env.APEX_CONSENSUS_ROOT || path.join(paths.ROOT, 'consensus');
const RPC = '/apex/raft/1.0.0';
const enc = new TextEncoder();
const dec = new TextDecoder();

const sleep = ms => new Promise(r => setTimeout(r, ms));
const stable = v => JSON.stringify(v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const hash = v => createHash('sha256').update(stable(v)).digest('hex');

async function ensureDir(dir) { await fs.mkdir(dir, { recursive: true, mode: 0o700 }); }
async function atomicWrite(file, value) {
  const tmp = file + '.' + process.pid + '.' + randomUUID() + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(tmp, file);
}
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}

export class SovereignRaftNode {
  constructor({ nodeId = process.env.APEX_NODE_ID || `${os.hostname()}-${process.pid}`, peers = [], apply = async () => {} } = {}) {
    this.nodeId = nodeId;
    this.peers = peers.filter(p => p && p.id && p.multiaddr && p.id !== nodeId);
    this.apply = apply;
    this.dir = path.join(ROOT, nodeId);
    this.metaFile = path.join(this.dir, 'raft-meta.json');
    this.logFile = path.join(this.dir, 'raft-log.jsonl');
    this.snapshotFile = path.join(this.dir, 'snapshot.json');
    this.state = { term: 0, votedFor: null, commitIndex: 0, lastApplied: 0 };
    this.log = [];
    this.role = 'follower';
    this.leaderId = null;
    this.running = false;
    this.electionTimer = null;
    this.heartbeatTimer = null;
    this.votes = new Set();
    this.stateMachine = new Map();
  }

  async load() {
    await ensureDir(this.dir);
    this.state = await readJson(this.metaFile, this.state);
    const raw = await fs.readFile(this.logFile, 'utf8').catch(e => e.code === 'ENOENT' ? '' : Promise.reject(e));
    this.log = raw.split('\n').filter(Boolean).map(JSON.parse);
    const snapshot = await readJson(this.snapshotFile, null);
    if (snapshot?.state) this.stateMachine = new Map(Object.entries(snapshot.state));
    await this.replayCommitted();
    return this;
  }

  async persistMeta() { await atomicWrite(this.metaFile, this.state); }

  async appendLocal(entry) {
    const previous = this.log.at(-1);
    const record = {
      index: (previous?.index || 0) + 1,
      term: this.state.term,
      command: entry.command,
      payload: entry.payload,
      id: entry.id || randomUUID(),
      prev: previous?.hash || null
    };
    record.hash = hash(record);
    await fs.appendFile(this.logFile, JSON.stringify(record) + '\n', { mode: 0o600 });
    const handle = await fs.open(this.logFile, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
    this.log.push(record);
    return record;
  }

  lastIndex() { return this.log.at(-1)?.index || 0; }
  lastTerm() { return this.log.at(-1)?.term || 0; }

  resetElectionTimer() {
    if (this.electionTimer) clearTimeout(this.electionTimer);
    const min = Math.max(250, Number(process.env.APEX_RAFT_ELECTION_MIN_MS || 750));
    const max = Math.max(min + 1, Number(process.env.APEX_RAFT_ELECTION_MAX_MS || 1500));
    const delay = min + Math.floor(Math.random() * (max - min));
    this.electionTimer = setTimeout(() => void this.startElection(), delay);
  }

  majority() { return Math.floor((this.peers.length + 1) / 2) + 1; }

  async startElection() {
    if (!this.running) return;
    this.role = 'candidate';
    this.state.term += 1;
    this.state.votedFor = this.nodeId;
    this.votes = new Set([this.nodeId]);
    await this.persistMeta();
    const request = { rpc: 'requestVote', term: this.state.term, candidateId: this.nodeId, lastIndex: this.lastIndex(), lastTerm: this.lastTerm() };
    await Promise.allSettled(this.peers.map(async peer => {
      try {
        const response = await sendProtocol(this.transport, peer.multiaddr, RPC, request);
        if (response?.accepted && response?.payload?.voteGranted && response.payload.term === this.state.term) this.votes.add(peer.id);
        if (response?.payload?.term > this.state.term) await this.stepDown(response.payload.term);
      } catch {}
    }));
    if (this.role === 'candidate' && this.votes.size >= this.majority()) await this.becomeLeader();
    else this.resetElectionTimer();
  }

  async becomeLeader() {
    this.role = 'leader';
    this.leaderId = this.nodeId;
    this.nextIndex = new Map(this.peers.map(peer => [peer.id, this.lastIndex() + 1]));
    this.matchIndex = new Map(this.peers.map(peer => [peer.id, 0]));
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => void this.replicate(), Math.max(25, Number(process.env.APEX_RAFT_HEARTBEAT_MS || 100)));
    await this.replicate();
  }

  async stepDown(term) {
    if (term > this.state.term) {
      this.state.term = term;
      this.state.votedFor = null;
      await this.persistMeta();
    }
    this.role = 'follower';
    this.leaderId = null;
    this.resetElectionTimer();
  }

  async handleRpc(rpc) {
    if (rpc.term < this.state.term) return { term: this.state.term, ok: false };
    if (rpc.term > this.state.term) await this.stepDown(rpc.term);
    if (rpc.rpc === 'requestVote') {
      const upToDate = rpc.lastTerm > this.lastTerm() || (rpc.lastTerm === this.lastTerm() && rpc.lastIndex >= this.lastIndex());
      const grant = (!this.state.votedFor || this.state.votedFor === rpc.candidateId) && upToDate;
      if (grant) { this.state.votedFor = rpc.candidateId; await this.persistMeta(); this.resetElectionTimer(); }
      return { term: this.state.term, voteGranted: grant };
    }
    if (rpc.rpc === 'appendEntries') {
      this.resetElectionTimer();
      this.leaderId = rpc.leaderId;
      this.role = 'follower';
      const previous = rpc.prevIndex ? this.log.find(x => x.index === rpc.prevIndex) : null;
      if (rpc.prevIndex && (!previous || previous.term !== rpc.prevTerm)) return { term: this.state.term, success: false, matchIndex: this.lastIndex() };
      for (const entry of rpc.entries || []) {
        const existing = this.log.find(x => x.index === entry.index);
        if (existing && existing.hash !== entry.hash) {
          this.log = this.log.filter(x => x.index < entry.index);
          await fs.writeFile(this.logFile, this.log.map(x => JSON.stringify(x)).join('\n') + (this.log.length ? '\n' : ''), { mode: 0o600 });
        }
        if (!this.log.some(x => x.index === entry.index)) {
          await fs.appendFile(this.logFile, JSON.stringify(entry) + '\n', { mode: 0o600 });
          this.log.push(entry);
        }
      }
      if (rpc.leaderCommit > this.state.commitIndex) {
        this.state.commitIndex = Math.min(rpc.leaderCommit, this.lastIndex());
        await this.persistMeta();
        await this.replayCommitted();
      }
      return { term: this.state.term, success: true, matchIndex: this.lastIndex() };
    }
    return { term: this.state.term, ok: false, error: 'unknown rpc' };
  }

  async replicatePeer(peer) {
    if (!this.running || this.role !== 'leader') return false;
    const next = Math.max(1, this.nextIndex?.get(peer.id) || 1);
    const previous = this.log.find(x => x.index === next - 1);
    const entries = this.log.filter(x => x.index >= next);
    const request = {
      rpc: 'appendEntries',
      term: this.state.term,
      leaderId: this.nodeId,
      prevIndex: previous?.index || 0,
      prevTerm: previous?.term || 0,
      entries,
      leaderCommit: this.state.commitIndex
    };
    try {
      const response = await sendProtocol(this.transport, peer.multiaddr, RPC, request);
      const result = response?.payload;
      if (result?.term > this.state.term) {
        await this.stepDown(result.term);
        return false;
      }
      if (result?.success) {
        this.matchIndex.set(peer.id, result.matchIndex);
        this.nextIndex.set(peer.id, result.matchIndex + 1);
        return true;
      }
      this.nextIndex.set(peer.id, Math.max(1, next - 1));
      return false;
    } catch {
      return false;
    }
  }

  async replicate() {
    if (!this.running || this.role !== 'leader') return;
    await Promise.allSettled(this.peers.map(peer => this.replicatePeer(peer)));
    const indexes = [this.lastIndex(), ...this.peers.map(peer => this.matchIndex?.get(peer.id) || 0)].sort((a, b) => b - a);
    const quorumIndex = indexes[this.majority() - 1] || 0;
    if (quorumIndex > this.state.commitIndex) {
      const candidate = this.log.find(x => x.index === quorumIndex);
      if (candidate?.term === this.state.term) {
        this.state.commitIndex = quorumIndex;
        await this.persistMeta();
        await this.replayCommitted();
      }
    }
  }

  async propose(command, payload = {}) {
    if (this.role !== 'leader') throw new Error(`consensus leader unavailable; current role=${this.role}`);
    const entry = await this.appendLocal({ command, payload });
    if (!this.matchIndex) this.matchIndex = new Map();
    this.matchIndex.set(this.nodeId, entry.index);
    await this.replicate();
    if (this.state.commitIndex < entry.index) throw new Error('quorum unavailable; state remains uncommitted');
    return entry;
  }

  async replayCommitted() {
    while (this.state.lastApplied < this.state.commitIndex) {
      const entry = this.log.find(x => x.index === this.state.lastApplied + 1);
      if (!entry) throw new Error('committed entry missing from local log');
      await this.apply(entry, this.stateMachine);
      this.state.lastApplied = entry.index;
    }
    await this.persistMeta();
  }

  async snapshot() {
    const snapshot = { lastIncludedIndex: this.state.lastApplied, lastIncludedTerm: this.log.find(x => x.index === this.state.lastApplied)?.term || 0, state: Object.fromEntries(this.stateMachine) };
    await atomicWrite(this.snapshotFile, snapshot);
    if (this.state.lastApplied > 0) {
      this.log = this.log.filter(x => x.index > this.state.lastApplied);
      await fs.writeFile(this.logFile, this.log.map(x => JSON.stringify(x)).join('\n') + (this.log.length ? '\n' : ''), { mode: 0o600 });
    }
    return snapshot;
  }

  attachTransport(node) {
    this.transport = node;
    node.handle(RPC, async ({ stream }) => {
      let body = '';
      for await (const chunk of stream.source) { body += dec.decode(chunk, { stream: true }); if (body.includes('\n')) break; }
      const rpc = JSON.parse(body.split('\n')[0]);
      const result = await this.handleRpc(rpc);
      await stream.sink([enc.encode(JSON.stringify({ accepted: true, payload: result }) + '\n')]);
    });
    return this;
  }

  async start(node) {
    await this.load();
    this.attachTransport(node);
    this.running = true;
    this.resetElectionTimer();
    return this;
  }

  async stop() {
    this.running = false;
    if (this.electionTimer) clearTimeout(this.electionTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    await this.persistMeta();
  }
}

export { RPC };
