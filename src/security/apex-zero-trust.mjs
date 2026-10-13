import crypto from "node:crypto";

/**
 * Apex Zero Trust law: every protected operation must name an exact action and
 * resource, use a server-verified principal, and match an explicit capability.
 * This module intentionally does not read identity or capability claims from
 * client-controlled headers.
 */
export function evaluateApexZeroTrust({
  principal,
  action,
  resource,
  now = Date.now()
} = {}) {
  if (!action || typeof action !== "string" || !resource || typeof resource !== "string") {
    return { allowed: false, status: 403, reason: "policy_not_specific" };
  }
  if (!principal || typeof principal !== "object" || principal.authenticated !== true ||
      principal.identityVerified !== true || typeof principal.id !== "string" ||
      principal.id.trim() === "") {
    return { allowed: false, status: 401, reason: "identity_not_verified" };
  }
  if (principal.active !== true || !Number.isFinite(principal.expiresAt) || principal.expiresAt <= now) {
    return { allowed: false, status: 401, reason: "identity_inactive_or_expired" };
  }
  if (!Array.isArray(principal.capabilities)) {
    return { allowed: false, status: 403, reason: "capabilities_missing" };
  }
  const exactCapability = action + ":" + resource;
  if (!principal.capabilities.some(value => typeof value === "string" && value === exactCapability)) {
    return { allowed: false, status: 403, reason: "capability_not_granted" };
  }
  return { allowed: true, status: 200, reason: "explicit_capability_match", principalId: principal.id };
}

function safeAudit(audit, event) {
  try {
    audit({
      type: "apex.zero-trust.decision",
      allowed: event.allowed,
      reason: event.reason,
      action: event.action,
      resource: event.resource,
      principalFingerprint: event.principalId ? apexZeroTrustFingerprint(event.principalId) : null,
      requestId: event.requestId || null
    });
  } catch {
    // Audit sink failures must not accidentally grant access or leak request data.
  }
}

export function createApexZeroTrustGuard({
  action,
  resource,
  getPrincipal = req => req.apexPrincipal,
  clock = () => Date.now(),
  audit = () => {}
} = {}) {
  return function requireApexZeroTrust(req, res, next) {
    const principal = getPrincipal(req);
    const decision = evaluateApexZeroTrust({ principal, action, resource, now: clock() });
    safeAudit(audit, {
      ...decision,
      action: typeof action === "string" ? action : "unspecified",
      resource: typeof resource === "string" ? resource : "unspecified",
      requestId: typeof req.id === "string" ? req.id : null
    });
    if (!decision.allowed) {
      res.set("Cache-Control", "no-store");
      res.set("Vary", "Authorization");
      return res.status(decision.status).json({
        success: false,
        error: decision.status === 401 ? "Verified identity required" : "Access denied"
      });
    }
    return next();
  };
}

/** Fingerprint an identifier for audit correlation without recording secrets. */
export function apexZeroTrustFingerprint(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex").slice(0, 16);
}
