export function describeNetworkSettings(settings = {}) {
  const speed = String(settings.speed || 'maximum');
  const multiple = settings.multipleConnections !== false;
  const failover = settings.failover !== false;
  const adaptive = settings.adaptive !== false;
  return Object.freeze({
    speed: speed === 'maximum' ? 'Maximum speed' : speed === 'balanced' ? 'Balanced' : 'Conservative',
    multipleConnections: multiple ? 'On' : 'Off',
    automaticFailover: failover ? 'On' : 'Off',
    automaticSpeedControl: adaptive ? 'On' : 'Off',
    explanation: speed === 'maximum'
      ? 'Apex uses as much available network capacity as conditions safely allow.'
      : speed === 'balanced'
        ? 'Apex balances speed with network stability.'
        : 'Apex reduces network pressure to favor stability.'
  });
}
