import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicApiPath, ownerAuthMiddleware } from '../src/security/owner-auth.mjs';

test('only health is public in the API surface', () => {
  assert.equal(isPublicApiPath('/api/health'), true);
  assert.equal(isPublicApiPath('/api/oracle'), false);
  assert.equal(isPublicApiPath('/api/mesh/jobs'), false);
  assert.equal(isPublicApiPath('/api/voiceover/jobs'), false);
});

test('missing owner token fails closed', () => {
  const previous = process.env.APEX_COMMANDER_TOKEN;
  delete process.env.APEX_COMMANDER_TOKEN;
  const response = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, set() {} };
  ownerAuthMiddleware({ method: 'POST', path: '/api/oracle', get() { return ''; } }, response, () => {
    throw new Error('unauthorized request reached protected route');
  });
  assert.equal(response.statusCode, 503);
  if (previous === undefined) delete process.env.APEX_COMMANDER_TOKEN;
  else process.env.APEX_COMMANDER_TOKEN = previous;
});

test('invalid bearer token is rejected', () => {
  const previous = process.env.APEX_COMMANDER_TOKEN;
  process.env.APEX_COMMANDER_TOKEN = 'expected-secret';
  const response = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, set() {} };
  ownerAuthMiddleware({ method: 'POST', path: '/api/oracle', get(name) { return name.toLowerCase() === 'authorization' ? 'Bearer invalid-secret' : ''; } }, response, () => {
    throw new Error('invalid credentials reached protected route');
  });
  assert.equal(response.statusCode, 401);
  process.env.APEX_COMMANDER_TOKEN = previous;
});

test('valid bearer token reaches the protected route', () => {
  const previous = process.env.APEX_COMMANDER_TOKEN;
  process.env.APEX_COMMANDER_TOKEN = 'expected-secret';
  const response = { set() {}, status() { throw new Error('valid credentials were rejected'); } };
  let reached = false;
  ownerAuthMiddleware({ method: 'POST', path: '/api/oracle', get(name) { return name.toLowerCase() === 'authorization' ? 'Bearer expected-secret' : ''; } }, response, () => { reached = true; });
  assert.equal(reached, true);
  process.env.APEX_COMMANDER_TOKEN = previous;
});


test('public health path remains allowlisted when middleware is mounted at /api', () => {
  assert.equal(isPublicApiPath('/api/health'), true);
  assert.equal(isPublicApiPath('/api/health?probe=1'), false);
});


test('privileged route families reject missing credentials', () => {
  const routes = [
    '/api/oracle', '/api/forge', '/api/audio',
    '/api/media/image', '/api/media/video',
    '/api/render/export', '/api/ai/generate',
    '/api/ai/collaborate', '/api/mesh/jobs',
    '/api/voiceover/jobs', '/api/workers/durable'
  ];
  for (const path of routes) {
    const response = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, set() {} };
    const previous = process.env.APEX_COMMANDER_TOKEN;
    process.env.APEX_COMMANDER_TOKEN = 'expected-secret';
    ownerAuthMiddleware({ method: 'POST', path, originalUrl: path, get() { return ''; } }, response, () => {
      throw new Error('protected route reached without credentials: ' + path);
    });
    process.env.APEX_COMMANDER_TOKEN = previous;
    assert.equal(response.statusCode, 401, path);
  }
});
