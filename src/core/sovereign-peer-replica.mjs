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

  const receipt = engine.snapshot().find(record =>
    record.action === 'PeerReceive' &&
    record.payload?.originWaveId === waveId &&
    record.payload?.sourcePeerId === remotePeerId &&
    record.payload?.sourceChecksum === checksum
  );
  const sourceRecord = receipt?.payload?.sourceRecord;
  if (!sourceRecord || sourceRecord.waveId !== waveId ||
      sourceRecord.checksum !== checksum || !verifySovereignRecord(sourceRecord)) {
    throw new Error('verified sovereign replica not found');
  }
  return { waveId, checksum, record: sourceRecord };
}
