import { sanitizeApexInput } from './sanitize.mjs';

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function deep(v, strict, depth = 0) {
  if (depth > 20) throw new Error('Payload too deep');
  if (typeof v === 'string') return sanitizeApexInput(v, strict);
  if (Array.isArray(v)) return v.map((x) => deep(x, strict, depth + 1));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (BAD_KEYS.has(k)) continue;
      out[sanitizeApexInput(k, strict)] = deep(x, strict, depth + 1);
    }
    return out;
  }
  return v;
}

export function apexRouterGate(req, res, next) {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  try {
    const strict = !req.apexOwner;
    if (req.body) req.body = deep(req.body, strict);
    req.sanitizedQuery = deep({ ...req.query }, strict);
    next();
  } catch (e) {
    res.status(403).json({ error: e.message });
  }
}

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();

export function verifyApexCommander(req, res, next) {
  const expected = process.env.APEX_COMMANDER_TOKEN;
  const given = req.headers['x-apex-token'];
  if (!expected || !given || !crypto.timingSafeEqual(digest(expected), digest(given))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
