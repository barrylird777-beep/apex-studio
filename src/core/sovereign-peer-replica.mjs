import { verifySovereignRecord } from './sovereign-mesh-engine.mjs';

/**
 * Resolve a source event that this peer previously accepted from the requesting
 * authenticated peer. A transport ACK is not sufficient: the record and its
 * checksum must still be present in this peer's own recovered mesh history.
 */
export function readSovereignPeerReplica(engine, request, { remotePeerId = '' } = {}) {
  if (!engine || typeof engine.snapshot !== 'function') {
    throw new TypeError('a sovereign mesh engine is required');
  }
  if (!remotePeerId) throw new Error('authenticated remote peer identity missing');
  const waveId = String(request?.waveId || '');
  const checksum = String(request?.checksum || '');
  if (!waveId || !/^[a-f0-9]{64}$/i.test(checksum)) {
    throw new Error('invalid sovereign replica read request');
  }

  const receipt = engine.snapshot().find(record => {
    if (record.action !== 'PeerReceive') return false;
    // dispatchAutonomousPayload wraps its argument in record.payload.payload.
    // Accept the historical flat form too, so older recovered records remain readable.
    const received = record.payload?.payload ?? record.payload;
    return received?.originWaveId === waveId &&
      received?.sourcePeerId === remotePeerId &&
      received?.sourceChecksum === checksum;
  });
  const received = receipt?.payload?.payload ?? receipt?.payload;
  const sourceRecord = received?.sourceRecord;
  if (!sourceRecord || sourceRecord.waveId !== waveId ||
      sourceRecord.checksum !== checksum || !verifySovereignRecord(sourceRecord)) {
    throw new Error('verified sovereign replica not found');
  }
  return { waveId, checksum, record: sourceRecord };
}
