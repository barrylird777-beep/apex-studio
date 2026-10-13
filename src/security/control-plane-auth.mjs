import crypto from "node:crypto";
import { hasValidOwnerSession, isOwnerAuthConfigured } from "./owner-session-auth.mjs";

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
    res.set("Cache-Control", "no-store");
    // The single owner session is the browser-friendly sign-in path.
    if (hasValidOwnerSession(req)) return next();

    const expected = String(getExpectedToken() || "");
    if (!expected) {
      if (isOwnerAuthConfigured()) {
        return res.status(401).json({ success: false, error: "Sign in as the owner to continue" });
      }
      return res.status(503).json({ success: false, error: "Authorization is not configured" });
    }
    const authorization = String(req.get("authorization") || "");
    const bearer = /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1] || "";
    const supplied = req.get("x-apex-shortcut-token") || req.get("x-apex-control-token") || bearer;
    if (!safeEqual(expected, supplied)) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    return next();
  };
}

export const requireControlPlaneAuth = createControlPlaneAuth();
