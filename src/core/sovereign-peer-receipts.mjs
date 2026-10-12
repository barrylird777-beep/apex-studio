export async function acknowledgeLocalPeerReceive(engine, waveId, peerId = '') {
  if (!engine || typeof engine.get !== 'function' || typeof engine.acknowledge !== 'function') {
    throw new TypeError('a sovereign mesh engine is required');
  }
  const record = engine.get(waveId);
  if (!record || record.status !== 'DISPATCHED' || record.action !== 'PeerReceive') return false;
  await engine.acknowledge(waveId, {
    storage: 'local-pure-wal',
    status: 'LOCAL_RECEIPT',
    peer: String(peerId || record.peerId || '')
  });
  return true;
}

export async function acknowledgePendingLocalPeerReceives(engine) {
  if (!engine || typeof engine.snapshot !== 'function') throw new TypeError('a sovereign mesh engine is required');
  const pending = engine.snapshot().filter(record => record.status === 'DISPATCHED' && record.action === 'PeerReceive');
  let acknowledged = 0;
  for (const record of pending) {
    if (await acknowledgeLocalPeerReceive(engine, record.waveId, record.peerId)) acknowledged += 1;
  }
  return acknowledged;
}
