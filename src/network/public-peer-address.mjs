export function buildPublicPeerAddress(peerId, env = process.env) {
  const id = String(peerId || '').trim();
  const host = String(env.APEX_P2P_PUBLIC_HOST || env.RAILWAY_TCP_PROXY_DOMAIN || '').trim();
  const port = Number(env.APEX_P2P_PUBLIC_PORT || env.RAILWAY_TCP_PROXY_PORT || 0);
  if (!/^[A-Za-z0-9]+$/.test(id) || !/^[A-Za-z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.') || host.includes('..') || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return `/dns4/${host}/tcp/${port}/p2p/${id}`;
}
