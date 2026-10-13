import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createScopedToken, createTokenSecurity } from '../src/security/scoped-token-security.mjs';

function request(headers = {}, ip = '203.0.113.8') {
  return {
    headers,
    ip,
    socket: { remoteAddress: ip },
    get(name) { return headers[String(name).toLowerCase()] || ''; }
  };
}

function response() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(name, value) { this.headers[String(name).toLowerCase()] = value; return this; }
  };
}

function parse(security, req) {
  security.parseTokenScopes(req, response(), () => {});
}

test('signed scoped token parses only with a valid HMAC and carries scopes without exposing its secret', () => {
  const secret = 'test-signing-secret';
  const env = { APEX_TOKEN_SIGNING_SECRET: secret };
  const security = createTokenSecurity({ env, now: () => 1_800_000_000_000 });
  const token = createScopedToken({ id: 'mobile-ai-1', scopes: ['ai:inference'], expiresAt: 1_900_000_000, secret });
  const req = request({ authorization: 'Bearer ' + token });
  parse(security, req);
  assert.equal(req.apexToken.kind, 'scoped');
  assert.equal(req.apexToken.id, 'mobile-ai-1');
  assert.deepEqual(req.apexToken.scopes, ['ai:inference']);
  assert.equal(JSON.stringify(req.apexToken).includes(token), false);

  const tampered = request({ authorization: 'Bearer ' + token.slice(0, -2) + 'aa' });
  parse(security, tampered);
  assert.equal(tampered.apexToken, null);
  assert.match(tampered.apexTokenError, /signature/i);
});

test('expired and not-yet-active scoped tokens are rejected', () => {
  const secret = 'test-signing-secret';
  const security = createTokenSecurity({ env: { APEX_TOKEN_SIGNING_SECRET: secret }, now: () => 1_800_000_000_000 });
  const expired = createScopedToken({ id: 'old', scopes: ['ai:inference'], expiresAt: 1_799_999_999, secret });
  const future = createScopedToken({ id: 'future', scopes: ['ai:inference'], notBefore: 1_800_000_001, secret });
  for (const token of [expired, future]) {
    const req = request({ authorization: 'Bearer ' + token });
    parse(security, req);
    assert.equal(req.apexToken, null);
    assert.ok(req.apexTokenError);
  }
});

test('scope guard rejects a valid scoped token that lacks the requested capability', () => {
  const secret = 'test-signing-secret';
  const security = createTokenSecurity({ env: { APEX_TOKEN_SIGNING_SECRET: secret } });
  const token = createScopedToken({ id: 'read-only', scopes: ['status:read'], secret });
  const req = request({ authorization: 'Bearer ' + token });
  parse(security, req);
  const res = response();
  let nextCalled = false;
  security.requireTokenScope('ai:inference')(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test('AI inference auth accepts the required scope and preserves legacy control-token behavior', () => {
  const secret = 'test-signing-secret';
  const env = { APEX_TOKEN_SIGNING_SECRET: secret, APEX_CONTROL_TOKEN: 'legacy-secret' };
  const security = createTokenSecurity({ env });
  const scoped = request({ authorization: 'Bearer ' + createScopedToken({ id: 'ai-worker', scopes: ['ai:inference'], secret }) });
  parse(security, scoped);
  let scopedNext = false;
  security.requireAiInferenceAuth((_req, _res, next) => assert.fail('scoped token should not need the legacy secret'))(scoped, response(), () => { scopedNext = true; });
  assert.equal(scopedNext, true);

  const legacy = request({ 'x-apex-control-token': 'legacy-secret' });
  parse(security, legacy);
  assert.equal(legacy.apexToken.kind, 'legacy');
  let legacyAuthCalled = false;
  security.requireAiInferenceAuth((_req, _res, next) => { legacyAuthCalled = true; next(); })(legacy, response(), () => {});
  assert.equal(legacyAuthCalled, true);
});

test('AI inference requests are throttled by verified token ID or by client IP when unauthenticated', () => {
  let now = 10_000;
  const security = createTokenSecurity({ env: {}, now: () => now, limit: 2, windowMs: 60_000 });
  const first = request({}, '198.51.100.1');
  const second = request({}, '198.51.100.1');
  const third = request({}, '198.51.100.1');
  for (const req of [first, second]) {
    const res = response();
    security.aiInferenceRateLimit(req, res, () => { res.statusCode = 204; });
    assert.equal(res.statusCode, 204);
  }
  const denied = response();
  security.aiInferenceRateLimit(third, denied, () => assert.fail('third request should be throttled'));
  assert.equal(denied.statusCode, 429);
  assert.equal(denied.headers['retry-after'], '60');

  now += 60_001;
  const reset = response();
  security.aiInferenceRateLimit(request({}, '198.51.100.1'), reset, () => { reset.statusCode = 204; });
  assert.equal(reset.statusCode, 204);
});

test('public health routes stay outside AI inference auth and rate limiting', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(server, /app\.get\(['"]\/health['"],\s*\(_req, res\)/);
  assert.match(server, /app\.get\(['"]\/api\/health['"],\s*async/);
  for (const route of ['/api/ai/generate-max', '/api/ai/generate-grok', '/api/ai/generate/:provider', '/api/ai/generate', '/api/ai/collaborate']) {
    assert.ok(server.includes(`app.post('${route}', aiInferenceRateLimit, requireAiInferenceAuth(requireControlPlaneAuth),`), route + ' must be rate-limited and scope-aware');
  }
});
