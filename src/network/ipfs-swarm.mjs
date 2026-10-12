const peers = new Map();

export function swarmPeers() {
  return [...peers.values()].map(peer => ({ ...peer }));
}

export function registerSwarmPeer(peer = {}) {
  const id = String(peer.id || peer.peerId || "").trim();
  if (!id) throw new TypeError("swarm peer id is required");
  const record = { id, address: peer.address || null, state: peer.state || "ready", updatedAt: new Date().toISOString() };
  peers.set(id, record);
  return { ...record };
}

export function removeSwarmPeer(id) {
  return peers.delete(String(id));
}

export function clearSwarmPeers() {
  peers.clear();
}
