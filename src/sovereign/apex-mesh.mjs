import { APEX_APPLICATIONS } from './apex-applications.mjs';
import { SovereignDeterministicScheduler } from '../scheduler/sovereign-deterministic-scheduler.mjs';
import { SovereignRaftNode } from '../consensus/sovereign-raft.mjs';

export class ApexSovereignMesh {
  constructor({ nodeId, peers = [], rootState = new Map() } = {}) {
    this.scheduler = new SovereignDeterministicScheduler();
    this.state = rootState;
    this.raft = new SovereignRaftNode({
      nodeId,
      peers,
      apply: async (entry, state) => {
        const application = entry.payload?.application;
        if (!APEX_APPLICATIONS.includes(application)) throw new Error('consensus entry targets unknown Apex application');
        state.set(application, { command: entry.command, payload: entry.payload, index: entry.index });
      }
    });
  }

  async propose(application, command, payload = {}) {
    if (!APEX_APPLICATIONS.includes(application)) throw new Error('unknown Apex application');
    return this.raft.propose(command, { application, ...payload });
  }

  async schedule(application, task, options = {}) {
    if (!APEX_APPLICATIONS.includes(application)) throw new Error('unknown Apex application');
    return this.scheduler.enqueue(task, { ...options, metadata: { application, ...(options.metadata || {}) } });
  }

  async stop() {
    this.scheduler.stop();
    await this.raft.stop();
  }
}

export { APEX_APPLICATIONS };
