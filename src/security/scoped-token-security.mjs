import crypto from 'node:crypto';

const TOKEN_PREFIX = 'apx1.';
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 30;
const MAX_BUCKETS = 10_000;
const LEGACY_TOKEN_ENV = [
  'APEX_SHORTCUT_TOKEN',
  'APEX_CONTROL_TOKEN',
  'APEX_WORKER_TOKEN',
  'APEX_RESEARCH_TOKEN',
  'APEX_OPPORTUNITY_ENGINE_TOKEN',
  'APEX_OPPORTUNITY_ENGINE_SYNC_TOKEN',
  'APEX_RELAY_TOKEN'
];

function safeEqual(leftValue, rightValue) {
  if (!leftValue || !rightValue) return false;
  const left = Buffer.from(String(leftValue), 'utf8');
  const right = Buffer.from(String(rightValue), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requestToken(req) {
  const authorization = String(req.get?.('authorization') || '');
  const bearer = /^Bearer\\s+([^\\s]+)$/i.exec(authorization)?.[1] || '';
  return bearer
    || req.get?.('x-apex-control-token')
    || req.get?.('x-apex-shortcut-token')
    || req.get?.('x-apex-worker-token')
    || req.get?.('x-apex-research-token')
    || req.get?.('x-apex-opportunity-token')
    || '';
}

function decodeScopedToken(token, secret, nowSeconds) {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  if (!secret || token.length > 8192) return { valid: false, reason: 'scoped token verification is not configured' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'apx1' || !parts[1] || !parts[2]) {
    return { valid: false, reason: 'malformed scoped token' };
  }
  const [version, payloadPart, signaturePart] = parts;
  const expected = crypto.createHmac('sha256', secret).update(version + '.' + payloadPart).digest();
  let supplied;
  try { supplied = Buffer.from(signaturePart, 'base64url'); } catch { return { valid: false, reason: 'invalid scoped token signature' }; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(expected, supplied)) {
    return { valid: false, reason: 'invalid scoped token signature' };
  }
  let claims;
  try { claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')); }
  catch { return { valid: false, reason: 'invalid scoped token payload' }; }
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return { valid: false, reason: 'invalid scoped token claims' };
  const id = String(claims.sub || claims.jti || claims.id || '').trim();
  if (!id || id.length > 160) return { valid: false, reason: 'scoped token ID is missing or invalid' };
  if (!Array.isArray(claims.scopes) || claims.scopes.length > 64 || claims.scopes.some(scope => typeof scope !== 'string' || !/^[a-z0-9][a-z0-9:_-]{0,63}$/i.test(scope))) {
    return { valid: false, reason: 'scoped token scopes are missing or invalid' };
  }
  if (claims.exp != null && (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= nowSeconds)) {
    return { valid: false, reason: 'scoped token has expired' };
  }
  if (claims.nbf != null && (!Number.isFinite(Number(claims.nbf)) || Number(claims.nbf) > nowSeconds)) {
    return { valid: false, reason: 'scoped token is not active yet' };
  }
  return { valid: true, token: { kind: 'scoped', id, scopes: [...new Set(claims.scopes)], expiresAt: claims.exp == null ? null : Number(claims.exp) } };
}

function knownLegacyToken(token, env) {
  if (!token) return null;
  for (const name of LEGACY_TOKEN_ENV) {
    const configured = String(env[name] || '');
    if (safeEqual(configured, token)) {
      return { kind: 'legacy', id: 'legacy:' + crypto.createHash('sha256').update(token).digest('hex').slice(0, 24), scopes: null, source: name };
    }
  }
  return null;
}

export function createTokenSecurity({
  env = process.env,
  now = () => Date.now(),
  limit = Number(env.APEX_AI_INFERENCE_RATE_LIMIT || DEFAULT_LIMIT),
  windowMs = Number(env.APEX_AI_INFERENCE_RATE_WINDOW_MS || DEFAULT_WINDOW_MS)
} = {}) {
  const buckets = new Map();
  const safeLimit = Math.max(1, Math.min(10_000, Math.floor(Number.isFinite(limit) ? limit : DEFAULT_LIMIT)));
  const safeWindowMs = Math.max(1_000, Math.min(3_600_000, Math.floor(Number.isFinite(windowMs) ? windowMs : DEFAULT_WINDOW_MS)));

  function parseTokenScopes(req, _res, next) {
    const supplied = String(requestToken(req) || '');
    req.apexToken = null;
    req.apexTokenError = null;
    if (!supplied) return next();
    if (supplied.startsWith(TOKEN_PREFIX)) {
      const parsed = decodeScopedToken(supplied, String(env.APEX_TOKEN_SIGNING_SECRET || ''), Math.floor(now() / 1000));
      if (parsed?.valid) req.apexToken = parsed.token;
      else req.apexTokenError = parsed?.reason || 'invalid scoped token';
      return next();
    }
    req.apexToken = knownLegacyToken(supplied, env);
    return next();
  }

  function requireTokenScope(scope, { legacyMode = 'allow' } = {}) {
    const required = String(scope || '').trim();
    return function tokenScopeGuard(req, res, next) {
      if (req.apexToken?.kind === 'scoped') {
        if (req.apexToken.scopes.includes(required)) return next();
        res.set?.('Cache-Control', 'no-store');
        return res.status(403).json({ success: false, error: 'Token lacks required scope', requiredScope: required });
      }
      // During rollout, known legacy tokens keep their existing route-level authorization.
      if (req.apexToken?.kind === 'legacy' && legacyMode === 'allow') return next();
      // This guard adds no new authentication requirement by itself; existing route auth remains authoritative.
      return next();
    };
  }

  function requireAiInferenceAuth(legacyAuth) {
    const scopeGuard = requireTokenScope('ai:inference');
    return function aiInferenceAuth(req, res, next) {
      if (req.apexTokenError) {
        res.set?.('Cache-Control', 'no-store');
        return res.status(401).json({ success: false, error: 'Invalid scoped token' });
      }
      if (req.apexToken?.kind === 'scoped') return scopeGuard(req, res, next);
      return legacyAuth(req, res, next);
    };
  }

  function aiInferenceRateLimit(req, res, next) {
    const nowMs = now();
    const tokenId = req.apexToken?.id;
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 160);
    const key = tokenId ? 'token:' + tokenId : 'ip:' + ip;
    let bucket = buckets.get(key);
    if (!bucket || nowMs - bucket.startedAt >= safeWindowMs || nowMs < bucket.startedAt) {
      bucket = { startedAt: nowMs, count: 0 };
    }
    if (bucket.count >= safeLimit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.startedAt + safeWindowMs - nowMs) / 1000));
      buckets.set(key, bucket);
      res.set?.('Retry-After', String(retryAfter));
      res.set?.('Cache-Control', 'no-store');
      return res.status(429).json({ success: false, error: 'AI inference rate limit reached', retryAfterSeconds: retryAfter });
    }
    bucket.count += 1;
    buckets.set(key, bucket);
    if (buckets.size > MAX_BUCKETS) {
      for (const [entryKey, entry] of buckets) {
        if (nowMs - entry.startedAt >= safeWindowMs || nowMs < entry.startedAt) buckets.delete(entryKey);
      }
      while (buckets.size > MAX_BUCKETS) {
        const oldest = buckets.keys().next().value;
        if (oldest === undefined) break;
        buckets.delete(oldest);
      }
    }
    return next();
  }

  return { parseTokenScopes, requireTokenScope, requireAiInferenceAuth, aiInferenceRateLimit };
}

export function createScopedToken({ id, scopes, expiresAt, notBefore, secret }) {
  if (!secret) throw new TypeError('signing secret is required');
  if (!id || !Array.isArray(scopes)) throw new TypeError('token ID and scopes are required');
  const claims = { sub: String(id), scopes: [...new Set(scopes.map(String))] };
  if (expiresAt != null) claims.exp = Math.floor(Number(expiresAt));
  if (notBefore != null) claims.nbf = Math.floor(Number(notBefore));
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const unsigned = 'apx1.' + payload;
  const signature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  return unsigned + '.' + signature;
}
