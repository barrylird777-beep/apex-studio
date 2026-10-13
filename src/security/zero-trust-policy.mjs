import { randomUUID } from "node:crypto";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function setHeader(res, name, value) {
  if (typeof res.setHeader === "function") res.setHeader(name, value);
}

/**
 * Shared baseline for the six canonical Apex apps.
 * Authentication remains route-specific: this middleware never treats an
 * Origin, client ID, network location, or request ID as proof of identity.
 */
export function createApexZeroTrustPolicy({
  allowedOrigins = [],
  production = process.env.NODE_ENV === "production",
  makeRequestId = randomUUID
} = {}) {
  const allowlist = new Set(
    allowedOrigins.map(value => String(value || "").trim()).filter(Boolean)
  );

  return function apexZeroTrustPolicy(req, res, next) {
    const requestId = makeRequestId();
    req.apexRequestId = requestId;
    setHeader(res, "X-Request-ID", requestId);
    setHeader(res, "X-Content-Type-Options", "nosniff");
    setHeader(res, "X-Frame-Options", "DENY");
    setHeader(res, "Referrer-Policy", "no-referrer");
    setHeader(res, "X-DNS-Prefetch-Control", "off");
    setHeader(res, "Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
    setHeader(res, "Vary", "Origin");

    if (production) {
      setHeader(res, "Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }

    const pathname = String(req.path || req.url || "").split("?")[0];
    const isApi = pathname === "/api" || pathname.startsWith("/api/");
    if (isApi) setHeader(res, "Cache-Control", "no-store");

    const origin = String(req.headers?.origin || "").trim();
    const fetchSite = String(req.headers?.["sec-fetch-site"] || "").toLowerCase();
    if (production && isApi && origin && !allowlist.has(origin)) {
      return res.status(403).json({
        success: false,
        error: "This website is not allowed to access the Apex API.",
        requestId
      });
    }
    if (production && isApi && fetchSite === "cross-site" && !origin) {
      return res.status(403).json({
        success: false,
        error: "Cross-site API requests are not allowed.",
        requestId
      });
    }

    req.apexRequestMethodIsSafe = SAFE_METHODS.has(String(req.method || "GET").toUpperCase());
    return next();
  };
}
