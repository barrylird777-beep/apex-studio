const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF origin check for cookie-authenticated owner mutations.
 * Non-cookie clients remain subject to their route-specific authorization guards.
 * Missing Origin fails closed: browser mutation requests should provide it; clients that
 * need cross-origin access must use an explicitly allowed origin or non-cookie credentials.
 */
export function createOwnerSessionCsrfGuard({ allowedOrigins = [], hasValidOwnerSession } = {}) {
  if (typeof hasValidOwnerSession !== "function") throw new TypeError("owner-session verifier required");
  const origins = new Set(allowedOrigins.map(value => String(value).trim()).filter(Boolean));
  return function ownerSessionCsrfGuard(req, res, next) {
    if (!MUTATING_METHODS.has(String(req.method || "").toUpperCase())) return next();
    if (!hasValidOwnerSession(req)) return next();

    const origin = String(typeof req.get === "function" ? req.get("origin") || "" : req.headers?.origin || "").trim();
    if (!origin || !origins.has(origin)) {
      res.setHeader?.("Cache-Control", "no-store");
      return res.status(403).json({
        success: false,
        error: origin ? "Origin rejected for owner-session mutation" : "Origin required for owner-session mutation"
      });
    }
    return next();
  };
}
