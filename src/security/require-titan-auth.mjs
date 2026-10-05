import { timingSafeEqual } from 'node:crypto';

export function requireTitanAuth(req, res, next) {
  const authorization = String(req.headers?.authorization || '');
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match) {
    return res.status(401).json({ error: 'UNAUTHORIZED: Missing or malformed Bearer token' });
  }

  const expectedToken = String(process.env.TITAN_WEBHOOK_SECRET || '');
  if (expectedToken.length < 32) {
    return res.status(500).json({ error: 'MISCONFIGURATION: TITAN_WEBHOOK_SECRET missing or insecurely short' });
  }

  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(expectedToken);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return res.status(403).json({ error: 'FORBIDDEN: Invalid token signature' });
  }

  return next();
}
