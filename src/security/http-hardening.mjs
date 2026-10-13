const PRODUCTION_HSTS = "max-age=31536000; includeSubDomains";

export function isCorsOriginAllowed({ origin, allowedOrigins = [], production = false, allowAllCors = false } = {}) {
  if (!origin) return true; // Non-browser clients have no Origin header; authorization still applies.
  if (allowedOrigins.includes(origin)) return true;
  return !production && allowAllCors;
}

/**
 * CORS headers alone do not stop a disallowed browser request from reaching a route.
 * In production, reject foreign Origin headers before CORS can answer a preflight.
 * Same-origin requests are allowed by comparing the Origin host with the request Host.
 */
export function createStrictCorsOriginGuard({ allowedOrigins = [], production = false } = {}) {
  const allowlist = new Set(allowedOrigins);
  return function strictCorsOriginGuard(req, res, next) {
    if (!production) return next();
    const origin = String(req.get("origin") || "").trim();
    if (!origin) return next(); // Native/server clients are still subject to route authentication.
    if (allowlist.has(origin)) return next();

    let originHost = "";
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return res.status(403).set("Cache-Control", "no-store").json({
        success: false,
        error: "Origin is not allowed"
      });
    }
    const requestHost = String(req.get("host") || "").toLowerCase();
    if (requestHost && originHost === requestHost) return next();

    return res.status(403).set("Cache-Control", "no-store").json({
      success: false,
      error: "Origin is not allowed"
    });
  };
}

export function createApexSecurityHeaders({ production = false } = {}) {
  return function apexSecurityHeaders(_req, res, next) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "geolocation=(), payment=(), usb=()");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    if (production) {
      res.setHeader("Strict-Transport-Security", PRODUCTION_HSTS);
    }
    if (String(_req.path || "").startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
    return next();
  };
}
