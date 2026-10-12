import crypto from "node:crypto";

function safeEqual(expected, supplied) {
  if (!expected || !supplied) return false;
  const left = Buffer.from(String(expected), "utf8");
  const right = Buffer.from(String(supplied), "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createControlPlaneAuth({
  getExpectedToken = () => process.env.APEX_SHORTCUT_TOKEN || process.env.APEX_CONTROL_TOKEN
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
    return next();
  };
}

export const requireControlPlaneAuth = createControlPlaneAuth();
