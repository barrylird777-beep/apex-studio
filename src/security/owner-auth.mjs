import crypto from 'node:crypto';

const PUBLIC_API_PATHS = new Set(['/api/health']);

function safeEqual(left, right) {
  const a = Buffer.from(String(left), 'utf8');
  const b = Buffer.from(String(right), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function extractBearer(req) {
  const header = String(req.get('authorization') || '');
  const match = /^Bearer[ \t]+([^ \t]+)$/i.exec(header);
  return match ? match[1] : null;
}

export function isPublicApiPath(pathname) {
  return PUBLIC_API_PATHS.has(pathname);
}

export function ownerAuthMiddleware(req, res, next) {
  const requestPath = String(req.originalUrl || req.path || '').split('?')[0];
  if (req.method === 'OPTIONS' || isPublicApiPath(requestPath)) return next();

  const configuredToken = String(process.env.APEX_COMMANDER_TOKEN || '');
  if (!configuredToken) {
    res.set('Cache-Control', 'no-store');
    return res.status(503).json({
      success: false,
      error: 'Owner authentication is not configured'
    });
  }

  const presentedToken = extractBearer(req);
  if (!presentedToken || !safeEqual(presentedToken, configuredToken)) {
    res.set('Cache-Control', 'no-store');
    return res.status(401).json({
      success: false,
      error: 'Owner authentication required'
    });
  }

  return next();
}
