const PRODUCTION_HSTS = "max-age=31536000; includeSubDomains";

export function isCorsOriginAllowed({ origin, allowedOrigins = [], production = false, allowAllCors = false } = {}) {
  if (!origin) return true; // Non-browser clients have no Origin header; authorization still applies.
  if (allowedOrigins.includes(origin)) return true;
  return !production && allowAllCors;
}

export function createApexSecurityHeaders({ production = false } = {}) {
  return function apexSecurityHeaders(_req, res, next) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "geolocation=(), payment=(), usb=()");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    if (production) {
      res.setHeader("Strict-Transport-Security", PRODUCTION_HSTS);
    }
    if (String(_req.path || "").startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
    }
    return next();
  };
}

export function createHttpsOnlyRedirect({ production = false, publicHosts = [] } = {}) {
  const allowedHosts = new Set(publicHosts.map(host => String(host).trim().toLowerCase()).filter(Boolean));
  return function httpsOnlyRedirect(req, res, next) {
    if (!production) return next();
    const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '')
      .split(',')[0].trim().toLowerCase();
    if (forwardedProto !== 'http') return next();

    const host = String(req?.headers?.host || '').trim().toLowerCase();
    if (!allowedHosts.has(host)) {
      return res.status(400).type('text/plain').send('HTTPS required');
    }
    const path = String(req?.originalUrl || req?.url || '/');
    return res.redirect(308, `https://${host}${path}`);
  };
}
