import crypto from "node:crypto";

function safeEqual(expected, supplied) {
  if (!expected || !supplied) return false;
  const left = Buffer.from(String(expected), "utf8");
  const right = Buffer.from(String(supplied), "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createControlPlaneAuth({
  getExpectedToken = () => process.env.APEX_SHORTCUT_TOKEN || process.env.APEX_CONTROL_TOKEN,
  getCapabilities = () => process.env.APEX_CONTROL_PLANE_CAPABILITIES || "",
  clock = () => Date.now()
} = {}) {
  return function requireControlPlaneAuth(req, res, next) {
    const expected = String(getExpectedToken() || "");
    if (!expected) {
      res.set("Cache-Control", "no-store");
      return res.status(503).json({ success: false, error: "Control plane authorization is not configured" });
    }
    const authorization = String(req.get("authorization") || "");
    const bearer = /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1] || "";
    const supplied = req.get("x-apex-shortcut-token") || req.get("x-apex-control-token") || bearer;
    if (!safeEqual(expected, supplied)) {
      res.set("Cache-Control", "no-store");
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    // Attach a short-lived, server-created principal only after the shared
    // secret is verified. Capabilities come from server configuration, never
    // from request headers or request bodies. Existing routes are unchanged;
    // Zero Trust guards can now enforce exact per-action grants.
    const capabilities = String(getCapabilities() || "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean);
    req.apexPrincipal = {
      id: "apex-control-plane-token",
      authenticated: true,
      identityVerified: true,
      active: true,
      expiresAt: clock() + 30_000,
      capabilities
    };
    return next();
  };
}

export const requireControlPlaneAuth = createControlPlaneAuth();
