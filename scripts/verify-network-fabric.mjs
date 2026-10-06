import { selectNetworkPath } from '../src/network/path-selector.mjs';
import { swarmPeers } from '../src/network/ipfs-swarm.mjs';

const path = await selectNetworkPath();
const peers = await swarmPeers();

console.log(JSON.stringify({
  path,
  ipfs: peers,
  targets: {
    downloadMbps: '150-250+ target',
    uploadMbps: '25-40 target',
    rttMs: '25-50 target'
  },
  note: 'Targets are measured objectives; the runtime does not claim or enforce guaranteed ISP/provider performance.'
}, null, 2));
