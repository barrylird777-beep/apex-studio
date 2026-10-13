export function isSovereignRuntimeReady(identity, now = Date.now(), expectedInstanceId = '', shuttingDown = false) {
  if (shuttingDown) return false;
  const readiness = identity?.readiness;
  if (!expectedInstanceId || identity?.instanceId !== expectedInstanceId) return false;
  const lastSeenAt = Date.parse(identity?.lastSeenAt || '');
  if (!Number.isFinite(lastSeenAt) || lastSeenAt > now || now - lastSeenAt > 15000) return false;
  return identity?.status === "online"
    && Number(identity?.leaseExpiresAt || 0) > now
    && readiness?.storageReady === true
    && readiness?.peerReady === true
    && readiness?.remotePersistenceVerified === true
    && readiness?.dispatchReady === true
    && /^[0-9a-f]{64}$/i.test(String(readiness?.remotePersistenceHash || ""));
}

export function verifyRemotePersistenceProbe(probe, readback) {
  if (!probe || typeof probe.nonce !== "string" || !probe.nonce) return false;
  if (!readback || !readback.value || readback.value.nonce !== probe.nonce) return false;
  if (readback.value.version !== probe.version || readback.value.peerId !== probe.peerId) return false;
  return /^[0-9a-f]{64}$/i.test(String(readback.hash || ""));
}
