import { Router } from 'express';
import crypto from 'node:crypto';
import { assertSafeResearchUrl, validateResearchQuery } from '../core/security/research-boundary.mjs';

export function createResearchRouter(engine) {
  if (!engine || typeof engine.resolveWork !== 'function') {
    throw new TypeError('research engine is required');
  }

  const router = Router();

  const requireResearchAuth = (req, res, next) => {
    const expected = process.env.APEX_RESEARCH_TOKEN || process.env.APEX_SHORTCUT_TOKEN;
    if (!expected) return res.status(503).json({ success: false, error: 'Research authorization is not configured' });
    const supplied = req.get('x-apex-research-token') || req.get('x-apex-shortcut-token') || req.get('authorization')?.replace(/^Bearer\\s+/i, '');
    const a = Buffer.from(String(expected));
    const b = Buffer.from(String(supplied || ''));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    return next();
  };

  router.get('/resolve', requireResearchAuth, async (req, res, next) => {
    try {
      const query = validateResearchQuery(req.query.q || req.query.query);
      if (!query) return res.status(400).json({ success: false, error: 'query is required' });
      const work = await engine.resolveWork(query);
      return res.status(200).json({ success: true, work });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/expand', requireResearchAuth, async (req, res, next) => {
    try {
      const query = validateResearchQuery(req.body?.query);
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

  router.post('/syndication', requireResearchAuth, async (req, res, next) => {
    try {
      const url = String(req.body?.url || '').trim();
      if (!/^https?:\/\//i.test(url)) {
      const feed = await engine.ingestSyndication(url);
      return res.status(200).json({ success: true, feed });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
