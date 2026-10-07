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
