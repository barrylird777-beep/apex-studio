export function isSovereignRuntimeReady(identity, now = Date.now(), expectedInstanceId = '') {
  const readiness = identity?.readiness;
  if (!expectedInstanceId || identity?.instanceId !== expectedInstanceId) return false;
  const lastSeenAt = Date.parse(identity?.lastSeenAt || '');
  if (!Number.isFinite(lastSeenAt) || lastSeenAt > now || now - lastSeenAt > 15000) return false;
  return identity?.status === "online"
    && Number(identity?.leaseExpiresAt || 0) > now
    && readiness?.storageReady === true
    && readiness?.peerReady === true
    && readiness?.remoteWalVerified === true
    && readiness?.dispatchReady === true
    && /^[0-9a-f]{64}$/i.test(String(readiness?.remoteWalHash || ""));
}

export function verifyRemoteWalProbe(record, snapshot) {
  if (!record || !Number.isSafeInteger(record.seq) || record.seq < 1) return false;
  if (!/^[0-9a-f]{64}$/i.test(String(record.hash || ""))) return false;
  if (!snapshot || !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < record.seq) return false;
  return Array.isArray(snapshot.ring)
    && snapshot.ring.some(item => item?.seq === record.seq && item?.hash === record.hash);
}
