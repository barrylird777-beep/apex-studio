import crypto from "node:crypto";

function timingSafeSecret(expected, supplied) {
  if (!expected || !supplied) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(supplied));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createKernelodiesLibraryAuth({
  getToken = () => process.env.KERNELODIES_LIBRARY_TOKEN,
  getControlToken = () => process.env.APEX_SHORTCUT_TOKEN || process.env.APEX_CONTROL_TOKEN
} = {}) {
  return function requireKernelodiesLibraryAuth(req, res, next) {
    const libraryExpected = String(getToken() || "");
    const controlExpected = String(getControlToken() || "");
    if (!libraryExpected && !controlExpected) {
      return res.status(503).json({ ok: false, error: "Kernelodies shared-library authorization is not configured" });
    }
    const supplied = req.get("x-kernelodies-token") ||
      req.get("x-apex-shortcut-token") ||
      req.get("x-apex-control-token") ||
      req.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!timingSafeSecret(libraryExpected, supplied) && !timingSafeSecret(controlExpected, supplied)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    return next();
  };
}
