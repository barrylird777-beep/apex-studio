/* Stateless APEX entitlement verification. Embed only the public key in clients. */
const APP_IDS = new Set(["planet-apex", "xshield", "kernel-vision", "koin-kob", "kash-korner", "kernelodies"]);
const MAX_TOKEN_SECONDS = 7 * 24 * 60 * 60;
const decode64 = value => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
const validField = (value, max = 120) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\r\n]/.test(value);

export async function verifyApexLicense({ token, publicKeyBase64, expectedAppId, nowSeconds = Math.floor(Date.now() / 1000) }) {
  if (!APP_IDS.has(expectedAppId)) throw new TypeError("Unknown canonical app audience");
  if (typeof token !== "string" || token.length > 4096) throw new TypeError("Invalid entitlement token");
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("Unsupported entitlement token format");
  const signedBytes = new TextEncoder().encode(parts[0] + "." + parts[1]);
  const key = await crypto.subtle.importKey("raw", decode64(publicKeyBase64), { name: "Ed25519" }, false, ["verify"]);
  if (!await crypto.subtle.verify({ name: "Ed25519" }, key, decode64(parts[2]), signedBytes)) throw new Error("Entitlement signature invalid");
  const fields = new TextDecoder("utf-8", { fatal: true }).decode(decode64(parts[1])).split("\n");
  if (fields.length !== 7 || fields[0] !== "apex-anchor-v1") throw new Error("Invalid entitlement claims");
  const [, appId, entitlement, issuedRaw, expiresRaw, productId, checkoutSessionId] = fields;
  if (appId !== expectedAppId) throw new Error("Entitlement belongs to another app");
  if (![appId, entitlement, productId, checkoutSessionId].every(value => validField(value))) throw new Error("Invalid entitlement fields");
  const issuedAt = Number(issuedRaw), expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) || issuedAt > nowSeconds + 60 || expiresAt <= nowSeconds || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_TOKEN_SECONDS) throw new Error("Entitlement expired or outside allowed lifetime");
  return Object.freeze({ issuer: fields[0], appId, entitlement, issuedAt, expiresAt, productId, checkoutSessionId });
}
