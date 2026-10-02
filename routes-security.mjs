import crypto from "node:crypto";
import { sanitizeApexInput } from "./sanitize.mjs";

function sanitizeDeep(value) {
  if (typeof value === "string") return sanitizeApexInput(value);
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeDeep(item)]));
  }
  return value;
}

export function apexRouterGate(req, res, next) {
  res.removeHeader("X-Powered-By");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  try {
    if (req.body) req.body = sanitizeDeep(req.body);
    req.sanitizedQuery = sanitizeDeep({ ...req.query });
    next();
  } catch (error) {
    res.status(403).json({ error: error.message });
  }
}

const digest = (value) => crypto.createHash("sha256").update(String(value)).digest();

export function verifyApexCommander(req, res, next) {
  const expected = process.env.APEX_COMMANDER_TOKEN;
  const given = req.headers["x-apex-token"];
  if (!expected || !given || !crypto.timingSafeEqual(digest(expected), digest(given))) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
