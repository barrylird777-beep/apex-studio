import { Router } from 'express';
import { request as httpRequest } from 'node:http';

/**
 * Authenticated HTTP adapter to the local Peer-CAS daemon's private Unix socket.
 * Enabled only by explicit operator configuration; errors never fall back to
 * the legacy app store.
 */
export function createKernelVisionPeerCanaryRouter({
  socketPath = process.env.APEX_PEER_CAS_SOCKET || '/tmp/apex_peer_cas.sock',
  token = process.env.APEX_PEER_CAS_TOKEN || '',
  enabled = String(process.env.APEX_KERNELVISION_PEER_CANARY_ENABLED || '').toLowerCase() === 'true'
} = {}) {
  const router = Router();
  const disabled = (_req, res) => res.status(503).json({ success: false, error: 'KernelVision peer-storage canary is disabled' });

  async function bridge(method, key, value) {
    if (!enabled) throw Object.assign(new Error('KernelVision peer-storage canary is disabled'), { statusCode: 503 });
    if (!socketPath.startsWith('/tmp/') || socketPath.includes('..')) throw new Error('unsafe Peer-CAS socket path');
    if (typeof token !== 'string' || token.length < 32) throw new Error('Peer-CAS bridge token is not configured');
    const body = method === 'PUT' ? Buffer.from(JSON.stringify({ key, value })) : Buffer.alloc(0);
    return await new Promise((resolve, reject) => {
      const req = httpRequest({
        socketPath, path: '/v1/peer-cas/canary/' + encodeURIComponent(key),
        method, headers: { authorization: 'Bearer ' + token, ...(body.length ? { 'content-type': 'application/json', 'content-length': body.length } : {}) },
        timeout: 5000
      }, res => {
        const chunks = [];
        let size = 0;
        res.on('data', chunk => {
          size += chunk.length;
          if (size > 256 * 1024) { req.destroy(new Error('Peer-CAS response exceeded size limit')); return; }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let payload;
          try { payload = JSON.parse(raw); } catch { payload = { error: 'invalid Peer-CAS response' }; }
          if (res.statusCode < 200 || res.statusCode >= 300) return reject(Object.assign(new Error(payload.error || 'Peer-CAS request failed'), { statusCode: res.statusCode || 502 }));
          resolve(payload);
        });
      });
      req.on('timeout', () => req.destroy(new Error('Peer-CAS request timed out')));
      req.on('error', reject);
      if (body.length) req.write(body);
      req.end();
    });
  }

  router.get('/:key', async (req, res) => {
    try {
      const key = String(req.params.key || '');
      if (!/^[A-Za-z0-9._-]{1,120}$/.test(key)) return res.status(400).json({ success: false, error: 'Invalid canary key' });
      return res.json({ success: true, ...(await bridge('GET', key)) });
    } catch (error) {
      return res.status(error.statusCode || 503).json({ success: false, error: String(error.message || error).slice(0, 240) });
    }
  });
  router.put('/:key', async (req, res) => {
    try {
      const key = String(req.params.key || '');
      if (!/^[A-Za-z0-9._-]{1,120}$/.test(key)) return res.status(400).json({ success: false, error: 'Invalid canary key' });
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || !Object.hasOwn(req.body, 'value')) {
        return res.status(400).json({ success: false, error: 'JSON body must contain value' });
      }
      const encoded = JSON.stringify(req.body.value);
      if (Buffer.byteLength(encoded) > 64 * 1024) return res.status(413).json({ success: false, error: 'Canary value exceeds 64 KiB' });
      return res.status(200).json({ success: true, ...(await bridge('PUT', key, req.body.value)) });
    } catch (error) {
      return res.status(error.statusCode || 503).json({ success: false, error: String(error.message || error).slice(0, 240) });
    }
  });
  router.all('*', disabled);
  return router;
}
