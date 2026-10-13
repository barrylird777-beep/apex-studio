const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Defense-in-depth CSRF origin check for cookie-authenticated owner mutations.
 * Existing SameSite=Strict cookies remain the baseline. Token-authenticated clients
 * without an owner session continue through their route-specific authorization guards.
 */
export function createOwnerSessionCsrfGuard({ allowedOrigins = [], hasValidOwnerSession } = {}) {
  if (typeof hasValidOwnerSession !== "function") throw new TypeError("owner-session verifier required");
  const origins = new Set(allowedOrigins.map(value => String(value).trim()).filter(Boolean));
  return function ownerSessionCsrfGuard(req, res, next) {
    if (!MUTATING_METHODS.has(String(req.method || "").toUpperCase())) return next();
    if (!hasValidOwnerSession(req)) return next();

    const origin = String(typeof req.get === "function" ? req.get("origin") || "" : req.headers?.origin || "").trim();
    // Some trusted non-browser clients omit Origin; they still require a valid owner session.
    // Browser-supplied origins are never inferred from Host or forwarded headers.
    if (!origin) return next();
    if (!origins.has(origin)) {
      res.setHeader?.("Cache-Control", "no-store");
      return res.status(403).json({ success: false, error: "Origin rejected for owner-session mutation" });
    }
    return next();
  };
}
