import test from 'node:test';
import assert from 'node:assert/strict';
import { createRelayRouter } from '../src/api/relay-routes.mjs';

test('relay router exposes status, start, and stop routes', () => {
  const relay = {
    status: () => ({ status: 'idle' }),
    start: async () => ({ status: 'running' }),
    stop: () => ({ status: 'stopped' }),
  };

  const router = createRelayRouter(relay);
  const routes = router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods),
    }));

  assert.deepEqual(routes, [
    { path: '/status', methods: ['get'] },
    { path: '/start', methods: ['post'] },
    { path: '/stop', methods: ['post'] },
  ]);
});

test('relay controls require an explicit authorization middleware', () => {
  const calls = { starts: 0, stops: 0 };
  const relay = {
    status: () => ({ status: 'idle' }),
    start: async () => { calls.starts += 1; return { status: 'running' }; },
    stop: () => { calls.stops += 1; return { status: 'stopped' }; },
  };
  const router = createRelayRouter(relay);
  const response = {
    code: null, body: null, headers: {},
    status(code) { this.code = code; return this; },
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    json(body) { this.body = body; return this; },
  };
  for (const path of ['/start', '/stop']) {
    const route = router.stack.find(layer => layer.route?.path === path).route;
    route.stack[0].handle({}, response, () => assert.fail('authorization must be required'));
    assert.equal(response.code, 503);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.deepEqual(calls, { starts: 0, stops: 0 });
});

test('relay state-changing routes have an authorization middleware slot', () => {
  const relay = { status: () => ({}), start: async () => ({}), stop: () => ({}) };
  const requireAuth = (_req, _res, next) => next();
  const router = createRelayRouter(relay, { requireAuth });
  for (const path of ['/start', '/stop']) {
    const route = router.stack.find(layer => layer.route?.path === path).route;
    assert.equal(route.stack[0].handle, requireAuth);
    assert.equal(route.stack.length, 2);
  }
});
