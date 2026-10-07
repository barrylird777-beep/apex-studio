import { Router } from 'express';

export function createRelayRouter(relay) {
  if (!relay || typeof relay.status !== 'function') {
    throw new TypeError('relay controller is required');
  }

  const router = Router();

  router.get('/status', (_req, res) => {
    res.status(200).json({
      success: true,
      relay: relay.status(),
    });
  });

  router.post('/start', async (_req, res, next) => {
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

  router.post('/stop', (_req, res, next) => {
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
