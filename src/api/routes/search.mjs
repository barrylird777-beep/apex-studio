import express from 'express';
import { BibleSearch } from '../../db/dal/bible-search.mjs';

export function createSearchRouter(pool) {
  const router = express.Router();
  const searchDal = new BibleSearch(pool);

  router.get('/bible', async (req, res) => {
    try {
      const query = String(req.query.q || '').normalize('NFKC').trim();
      const limit = Math.max(1, Math.min(500, Number.parseInt(String(req.query.limit || '50'), 10) || 50));
      const mode = String(req.query.mode || (req.query.exact === 'true' ? 'partial' : 'fuzzy'));

      if (query.length < 3) {
        return res.status(400).json({ success: false, error: 'Query must be at least 3 characters.' });
      }

      let data;
      if (mode === 'partial') data = await searchDal.partialSearch(query, { limit });
      else if (mode === 'reference') data = await searchDal.referenceSearch(query, { limit });
      else if (mode === 'fuzzy') data = await searchDal.fuzzySearch(query, { limit });
      else return res.status(400).json({ success: false, error: 'mode must be fuzzy, partial, or reference' });

      return res.json({ success: true, data, count: data.length, mode });
    } catch (error) {
      console.error('[SEARCH BINDING] Failure:', error);
      return res.status(503).json({ success: false, error: 'Bible search unavailable' });
    }
  });

  return router;
}
