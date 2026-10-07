import { Router } from 'express';

export function createResearchRouter(engine) {
  if (!engine || typeof engine.resolveWork !== 'function') {
    throw new TypeError('research engine is required');
  }

  const router = Router();

  router.get('/resolve', async (req, res, next) => {
    try {
      const query = String(req.query.q || req.query.query || '').trim();
      if (!query) return res.status(400).json({ success: false, error: 'query is required' });
      const work = await engine.resolveWork(query);
      return res.status(200).json({ success: true, work });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/expand', async (req, res, next) => {
    try {
      const query = String(req.body?.query || '').trim();
      if (!query) return res.status(400).json({ success: false, error: 'query is required' });
      const work = await engine.resolveWork(query);
      const evidence = await engine.expandEvidence(work, {
        maxReferences: Math.min(100, Math.max(1, Number(req.body?.maxReferences || 20)))
      });
      const graph = engine.buildEvidenceGraph(work, evidence);
      const reconstruction = await engine.reconstruct(work, evidence);
      return res.status(200).json({
        success: true,
        work,
        evidence,
        graph,
        reconstruction
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/syndication', async (req, res, next) => {
    try {
      const url = String(req.body?.url || '').trim();
      if (!/^https?:\/\//i.test(url)) {
        return res.status(400).json({ success: false, error: 'http(s) syndication URL is required' });
      }
      const feed = await engine.ingestSyndication(url);
      return res.status(200).json({ success: true, feed });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
