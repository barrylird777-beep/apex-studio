import crypto from "node:crypto";
import { sanitizeApexInput } from "./sanitize.mjs";

const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const AUTH_TTL_MS = Math.max(30000, Math.min(300000, Number(process.env.APEX_AUTH_CACHE_TTL_MS ?? 60000)));
const AUTH_MAX_ENTRIES = Math.max(128, Math.min(100000, Number(process.env.APEX_AUTH_CACHE_MAX ?? 4096)));
const authCache = new Map();

function deep(v, strict, depth = 0) {
  if (depth > 20) throw new Error("Payload too deep");
  if (typeof v === "string") return sanitizeApexInput(v, strict);
  if (Array.isArray(v)) return v.map((x) => deep(x, strict, depth + 1));
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (BAD_KEYS.has(k)) continue;
      out[sanitizeApexInput(k, strict)] = deep(x, strict, depth + 1);
    }
    return out;
  }
  return v;
}

export function apexRouterGate(req, res, next) {
  res.removeHeader("X-Powered-By");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "private, no-cache");
  try {
    const strict = !req.apexOwner;
    if (req.body) req.body = deep(req.body, strict);
    req.sanitizedQuery = deep({ ...req.query }, strict);
    next();
  } catch (e) {
    res.status(403).json({ error: e.message });
  }
}

const digest = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

function cacheGet(key) {
  const hit = authCache.get(key);
  if (!hit) return false;
  if (hit.expiresAt <= Date.now()) {
    authCache.delete(key);
    return false;
  }
  authCache.delete(key);
  authCache.set(key, hit);
  return hit.valid === true;
}

function cacheSet(key) {
  if (authCache.size >= AUTH_MAX_ENTRIES) {
    const oldest = authCache.keys().next().value;
    if (oldest) authCache.delete(oldest);
  }
  authCache.set(key, { valid: true, expiresAt: Date.now() + AUTH_TTL_MS });
}

export function verifyApexCommander(req, res, next) {
  const expected = process.env.APEX_COMMANDER_TOKEN;
  const bearer = String(req.headers.authorization ?? "");
  const legacy = String(req.headers["x-apex-token"] ?? "");
  const given = bearer.startsWith("Bearer ") ? bearer.slice(7).trim() : legacy;
  if (!expected || !given) return res.status(401).json({ error: "Unauthorized" });

  const key = digest(given);
  if (cacheGet(key)) {
    req.apexAuthCacheHit = true;
    return next();
  }

  const valid = crypto.timingSafeEqual(
    crypto.createHash("sha256").update(expected).digest(),
    crypto.createHash("sha256").update(given).digest()
  );
  if (!valid) return res.status(401).json({ error: "Unauthorized" });

  cacheSet(key);
  req.apexAuthCacheHit = false;
  next();
}

export function authCacheStats() {
  return { entries: authCache.size, ttlMs: AUTH_TTL_MS, maxEntries: AUTH_MAX_ENTRIES };
}
