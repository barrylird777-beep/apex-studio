import express from 'express';
import crypto from 'node:crypto';

function tokenMatches(expected, supplied) {
  if (!expected || !supplied) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(supplied));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireShortcutAuth(req, res, next) {
  const expected = process.env.APEX_SHORTCUT_TOKEN;
  if (!expected) {
    return res.status(503).json({ success: false, error: 'Apex Shortcut control plane is not configured' });
  }
  const supplied = req.get('x-apex-shortcut-token') || req.get('authorization')?.replace(/^Bearer\\s+/i, '');
  if (!tokenMatches(expected, supplied)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  return next();
}

export function createMobileControlPlane({
  getHealth,
  getAiStatus,
  getCapacity,
  getWorkers,
  getOverseer,
  getNetwork,
  generateAi,
  produceEpisode
}) {
  const router = express.Router();

  // This router is mounted before the server's global JSON parser. Parse its
  // own authenticated Shortcut requests so POST bodies are available.
  router.use(express.json({ limit: '1mb' }));
  router.use(requireShortcutAuth);

  router.get('/status', async (_req, res) => {
    const results = await Promise.allSettled([
      getHealth?.(),
      getAiStatus?.(),
      getCapacity?.(),
      getWorkers?.(),
      getOverseer?.(),
      getNetwork?.()
    ]);

    const value = index => results[index]?.status === 'fulfilled' ? results[index].value : {
      ok: false,
      error: String(results[index]?.reason?.message || results[index]?.reason || 'unavailable')
    };

    return res.json({
      success: true,
      controlPlane: 'iphone',
      version: 1,
      checkedAt: new Date().toISOString(),
      health: value(0),
      ai: value(1),
      capacity: value(2),
      workers: value(3),
      overseer: value(4),
      network: value(5)
    });
  });

  router.get('/health', async (_req, res) => {
    try {
      return res.json({ success: true, ...(await getHealth()) });
    } catch (error) {
      return res.status(503).json({ success: false, error: String(error?.message || error) });
    }
  });

  router.get('/ai', async (_req, res) => {
    try {
      return res.json({ success: true, ...(await getAiStatus()) });
    } catch (error) {
      return res.status(503).json({ success: false, error: String(error?.message || error) });
    }
  });

  router.post('/ai', async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const provider = String(body.provider || '').trim();
      const model = String(body.model || '').trim();
      const prompt = String(body.prompt || '').trim();
      if (!provider || !prompt) {
        return res.status(400).json({ success: false, error: 'provider and prompt are required' });
      }
      const result = await generateAi({
        provider,
        model: model || undefined,
        prompt,
        system: body.system,
        maxTokens: body.maxTokens,
        temperature: body.temperature,
        reasoning: body.reasoning,
        reasoningEffort: body.reasoningEffort,
        thinking: body.thinking,
        thinkingLevel: body.thinkingLevel,
        allowFallback: body.allowFallback === true
      });
      return res.json({ success: true, exactSelection: !body.allowFallback, ...result });
    } catch (error) {
      const status = Number(error?.status);
      return res.status(Number.isInteger(status) && status >= 400 && status < 600 ? status : 502)
        .json({ success: false, error: String(error?.message || error), retryAfterMs: Number(error?.retryAfterMs || 0) || undefined });
    }
  });

  router.get('/workers', async (_req, res) => {
    try {
      return res.json({ success: true, ...(await getWorkers()) });
    } catch (error) {
      return res.status(503).json({ success: false, error: String(error?.message || error) });
    }
  });

  router.get('/network', async (_req, res) => {
    try {
      return res.json({ success: true, ...(await getNetwork()) });
    } catch (error) {
      return res.status(503).json({ success: false, error: String(error?.message || error) });
    }
  });

  router.post('/network/report', async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const network = String(body.network || 'unknown').trim().toLowerCase();
      const transport = String(body.transport || network).trim().toLowerCase();
      const reachable = body.reachable !== false;
      const rttMs = Number.isFinite(Number(body.rttMs)) ? Math.max(0, Number(body.rttMs)) : null;
      const downMbps = Number.isFinite(Number(body.downMbps)) ? Math.max(0, Number(body.downMbps)) : null;
      const upMbps = Number.isFinite(Number(body.upMbps)) ? Math.max(0, Number(body.upMbps)) : null;
      const networks = new Set(['wifi', 'cellular', 'ethernet', 'vpn', 'unknown']);
      if (!networks.has(network)) return res.status(400).json({ success: false, error: 'invalid network' });
      return res.json({
        success: true,
        report: {
          source: 'iphone-shortcut',
          network,
          transport,
          reachable,
          rttMs,
          downMbps,
          upMbps,
          reportedAt: new Date().toISOString(),
          requestId: String(req.get('x-request-id') || crypto.randomUUID())
        },
        policy: {
          automaticFailover: true,
          adaptiveSpeed: true,
          preferWifiWhenHealthy: true,
          preferCellularWhenWifiUnavailable: true
        }
      });
    } catch (error) {
      return res.status(400).json({ success: false, error: String(error?.message || error) });
    }
  });

  router.get('/shortcut-manifest', (_req, res) => res.json({
    success: true,
    version: 1,
    platform: 'iPhone',
    transport: 'Shortcuts -> HTTPS',
    auth: { type: 'Bearer', header: 'Authorization' },
    actions: [
      { name: 'Status', method: 'GET', path: '/api/mobile/status' },
      { name: 'Health', method: 'GET', path: '/api/mobile/health' },
      { name: 'AI', method: 'GET', path: '/api/mobile/ai' },
      { name: 'Workers', method: 'GET', path: '/api/mobile/workers' },
      { name: 'Network', method: 'GET', path: '/api/mobile/network' },
      { name: 'Network Report', method: 'POST', path: '/api/mobile/network/report' },
      { name: 'Production', method: 'GET', path: '/api/mobile/production' },
      { name: 'Episode', method: 'POST', path: '/api/mobile/production/episode' }
    ]
  }));

  router.get('/production', async (_req, res) => {
    try {
      const [workers, overseer] = await Promise.all([
        getWorkers?.(),
        getOverseer?.()
      ]);
      return res.json({ success: true, workers, overseer });
    } catch (error) {
      return res.status(503).json({ success: false, error: String(error?.message || error) });
    }
  });

  router.post('/production/episode', async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const book = String(body.book || '').trim();
      const chapter = Number(body.chapter);
      const verses = String(body.verses || 'full').trim();
      if (!book || !Number.isInteger(chapter)) {
        return res.status(400).json({ success: false, error: 'book and integer chapter are required' });
      }
      const result = await produceEpisode(book, chapter, verses, String(req.get('x-request-id') || crypto.randomUUID()));
      return res.status(202).json({ success: true, ...result });
    } catch (error) {
      return res.status(400).json({ success: false, error: String(error?.message || error) });
    }
  });

  return router;
}
