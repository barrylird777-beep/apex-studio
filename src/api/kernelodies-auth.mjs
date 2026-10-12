import crypto from "node:crypto";

function timingSafeSecret(expected, supplied) {
  if (!expected || !supplied) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(supplied));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createKernelodiesLibraryAuth({ getToken = () => process.env.KERNEL..._TOKEN } = {}) {
  return function requireKernelodiesLibraryAuth(req, res, next) {
    const expected = getToken();
    if (!expected) {
      return res.status(503).json({ ok: false, error: "Kernelodies shared-library authorization is not configured" });
    }
    const supplied = req.get("x-kernelodies-token") || req.get("authorization")?.replace(/^Bearer\\s+/i, "");
    if (!timingSafeSecret(expected, supplied)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    return next();
  };
}
