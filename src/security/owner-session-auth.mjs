import crypto from "node:crypto";

export const OWNER_SESSION_COOKIE = "apex.owner.session";
export const OWNER_SESSION_SECONDS = 12 * 60 * 60;
const MIN_OWNER_PASSWORD_LENGTH = 24;

function safeEqual(expected, supplied) {
  if (!expected || !supplied) return false;
  const left = Buffer.from(String(expected), "utf8");
  const right = Buffer.from(String(supplied), "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function ownerPassword() {
  return String(process.env.APEX_OWNER_PASSWORD || "");
}

export function isOwnerAuthConfigured() {
  return ownerPassword().length >= MIN_OWNER_PASSWORD_LENGTH;
}

export function verifyOwnerPassword(supplied) {
  const expected = ownerPassword();
  return isOwnerAuthConfigured() && safeEqual(expected, supplied);
}

function signingKey() {
  // Domain separation prevents the raw password from being used directly as the HMAC key.
  return crypto.createHash("sha256").update("APEX owner-session signing key\0").update(ownerPassword()).digest();
}

export function createOwnerSessionToken(now = Date.now()) {
  if (!isOwnerAuthConfigured()) throw new Error("APEX_OWNER_PASSWORD must be configured with at least 24 characters");
  const expiresAt = Math.floor(now / 1000) + OWNER_SESSION_SECONDS;
  const nonce = crypto.randomBytes(16).toString("base64url");
  const payload = `v1.${expiresAt}.${nonce}`;
  const signature = crypto.createHmac("sha256", signingKey()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyOwnerSessionToken(token, now = Date.now()) {
  if (!isOwnerAuthConfigured() || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAt)) return false;
  const nowSeconds = Math.floor(now / 1000);
  if (expiresAt <= nowSeconds || expiresAt > nowSeconds + OWNER_SESSION_SECONDS + 60) return false;
  const payload = parts.slice(0, 3).join(".");
  const expected = crypto.createHmac("sha256", signingKey()).update(payload).digest("base64url");
  return safeEqual(expected, parts[3]);
}

function cookieValue(req) {
  const header = String(req?.headers?.cookie || "");
  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    if (entry.slice(0, separator).trim() === OWNER_SESSION_COOKIE) {
      try { return decodeURIComponent(entry.slice(separator + 1).trim()); } catch { return ""; }
    }
  }
  return "";
}

export function hasValidOwnerSession(req, now = Date.now()) {
  return verifyOwnerSessionToken(cookieValue(req), now);
}

export function ownerSessionSetCookie(token, { production = process.env.NODE_ENV === "production" } = {}) {
  const secure = production ? "; Secure" : "";
  return `${OWNER_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${OWNER_SESSION_SECONDS}${secure}`;
}

export function ownerSessionClearCookie({ production = process.env.NODE_ENV === "production" } = {}) {
  const secure = production ? "; Secure" : "";
  return `${OWNER_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}
