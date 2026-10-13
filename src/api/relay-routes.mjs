import { Router } from 'express';

const denyByDefault = (_req, res) => res.status(503).set('Cache-Control', 'no-store').json({
  success: false,
  error: 'Relay control authorization is not configured'
});

export function createRelayRouter(relay, { requireAuth = denyByDefault } = {}) {
  if (!relay || typeof relay.status !== 'function') {
    throw new TypeError('relay controller is required');
  }
  if (typeof requireAuth !== 'function') {
    throw new TypeError('relay authorization middleware is required');
  }

  const router = Router();

  // Status stays readable for basic diagnostics. Starting/stopping a live
  // stream changes service state and must never be exposed as an open control.
  router.get('/status', (_req, res) => {
    res.status(200).json({
      success: true,
      relay: relay.status(),
    });
  });

  router.post('/start', requireAuth, async (_req, res, next) => {
    try {
      const status = await relay.start();
      res.status(200).json({
        success: true,
        relay: status,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/stop', requireAuth, (_req, res, next) => {
    try {
      res.status(200).json({
        success: true,
        relay: relay.stop(),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
