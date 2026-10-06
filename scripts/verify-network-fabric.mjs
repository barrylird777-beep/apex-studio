import { selectNetworkPath } from '../src/network/path-selector.mjs';
import { swarmPeers } from '../src/network/ipfs-swarm.mjs';
import { APEX_THROUGHPUT_TARGETS } from '../src/network/throughput-profile.mjs';

const path = await selectNetworkPath();
const peers = await swarmPeers();

console.log(JSON.stringify({
  path,
  ipfs: peers,
  throughputTargets: APEX_THROUGHPUT_TARGETS,
  note: 'Targets are measured objectives; they are not guaranteed ISP/provider performance.'
}, null, 2));
