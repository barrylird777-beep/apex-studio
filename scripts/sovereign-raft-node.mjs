import { startSovereignPeer } from '../src/network/sovereign-peer.mjs';
import { SovereignRaftNode } from '../src/consensus/sovereign-raft.mjs';

const node = await startSovereignPeer();
const peers = (process.env.APEX_RAFT_PEERS || '').split(',').map(x => x.trim()).filter(Boolean).map(value => {
  const [id, multiaddr] = value.split('|');
  return { id, multiaddr };
});
const raft = new SovereignRaftNode({ peers, apply: async (entry, state) => {
  state.set(String(entry.index), { command: entry.command, payload: entry.payload });
}});
await raft.start(node);
console.log('[SE-X RAFT] ONLINE', JSON.stringify({ nodeId: raft.nodeId, role: raft.role, term: raft.state.term, commitIndex: raft.state.commitIndex }));
const stop = async signal => { await raft.stop(); await node.stop(); console.log('[SE-X RAFT] STOP', signal); };
process.once('SIGTERM', () => void stop('SIGTERM'));
process.once('SIGINT', () => void stop('SIGINT'));
