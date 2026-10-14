/* Stateless Stripe Checkout + Ed25519 entitlement issuance for APEX ANCHOR.
 * No database, card data, or payment secrets are sent to the browser.
 */
const PRODUCTS = Object.freeze({
  "planet-apex": { entitlement: "advanced-research", priceEnv: "PRICE_PLANET_APEX_RESEARCH" },
  "xshield": { entitlement: "advanced-protection", priceEnv: "PRICE_XSHIELD_ADVANCED" },
  "kernel-vision": { entitlement: "advanced-render", priceEnv: "PRICE_KERNELVISION_RENDER" },
  "kernelodies": { entitlement: "advanced-audio", priceEnv: "PRICE_KERNELODIES_AUDIO" },
  "kash-korner": { entitlement: "transaction-service", priceEnv: "PRICE_KASHKORNER_TRANSACTION" },
  "koin-kob": { entitlement: "advanced-simulation", priceEnv: "PRICE_KOINKOB_SIMULATION" }
});
const TOKEN_SECONDS = 7 * 24 * 60 * 60;
const json = (body, status = 200, origin = "") => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}) }
});
const decode64 = value => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
const encode64 = value => btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const equalHex = (a, b) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.APEX_ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  return origin && allowed.includes(origin) ? origin : "";
}
async function stripeRequest(env, path, options = {}) {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe secret is not configured");
  const response = await fetch("https://api.stripe.com/v1/" + path, {
    ...options, headers: { authorization: "Bearer " + env.STRIPE_SECRET_KEY, ...(options.headers || {}) }
  });
  const result = await response.json();
  if (!response.ok) throw new Error("Stripe request failed (" + response.status + ")");
  return result;
}
export async function verifyStripeWebhook(rawBody, signatureHeader, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret || typeof signatureHeader !== "string" || rawBody.length > 1024 * 1024) return false;
  const parts = signatureHeader.split(",").map(part => part.split("=", 2));
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300 || !signatures.length) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + "." + rawBody)));
  const expected = Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
  return signatures.some(value => /^[a-f0-9]{64}$/i.test(value) && equalHex(expected, value.toLowerCase()));
}
async function issueLicense(env, claims) {
  if (!env.APEX_LICENSE_PRIVATE_KEY_PKCS8) throw new Error("License signing key is not configured");
  const fields = ["apex-anchor-v1", claims.appId, claims.entitlement, String(claims.issuedAt), String(claims.expiresAt), claims.priceId, claims.sessionId];
  if (fields.some(value => typeof value !== "string" || /[\r\n]/.test(value))) throw new Error("Invalid entitlement claims");
  const payload = encode64(new TextEncoder().encode(fields.join("\n")));
  const signingInput = new TextEncoder().encode("v1." + payload);
  const key = await crypto.subtle.importKey("pkcs8", decode64(env.APEX_LICENSE_PRIVATE_KEY_PKCS8), { name: "Ed25519" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, signingInput));
  return "v1." + payload + "." + encode64(signature);
}
async function readJson(request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 8192) throw Object.assign(new Error("Request too large"), { status: 413 });
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error("Invalid JSON"), { status: 400 }); }
}
async function createCheckout(request, env, origin) {
  const body = await readJson(request);
  const product = PRODUCTS[body?.appId];
  if (!product || body?.entitlement !== product.entitlement) return json({ error: "Unknown premium operation" }, 400, origin);
  const priceId = env[product.priceEnv];
  if (!priceId || !/^price_[A-Za-z0-9]+$/.test(priceId)) return json({ error: "Premium price is not configured" }, 503, origin);
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("line_items[0][price]", priceId);
  form.set("line_items[0][quantity]", "1");
  form.set("success_url", origin + "/billing/success?session_id={CHECKOUT_SESSION_ID}");
  form.set("cancel_url", origin + "/billing/cancel");
  form.set("metadata[appId]", body.appId);
  form.set("metadata[entitlement]", product.entitlement);
  form.set("metadata[productId]", priceId);
  const session = await stripeRequest(env, "checkout/sessions", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
  if (!session.id || !session.url) throw new Error("Stripe did not return a Checkout URL");
  return json({ checkoutUrl: session.url, sessionId: session.id, appId: body.appId, entitlement: product.entitlement }, 200, origin);
}
async function issueFromPaidSession(request, env, origin) {
  const body = await readJson(request);
  const sessionId = body?.sessionId;
  if (typeof sessionId !== "string" || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return json({ error: "Invalid Checkout Session ID" }, 400, origin);
  const session = await stripeRequest(env, "checkout/sessions/" + encodeURIComponent(sessionId));
  if (session.id !== sessionId || session.status !== "complete" || session.payment_status !== "paid" || session.mode !== "payment") return json({ error: "Payment is not confirmed" }, 402, origin);
  const appId = session.metadata?.appId;
  const product = PRODUCTS[appId];
  if (!product || session.metadata?.entitlement !== product.entitlement) return json({ error: "Checkout metadata is invalid" }, 403, origin);
  const expectedPrice = env[product.priceEnv];
  const lines = await stripeRequest(env, "checkout/sessions/" + encodeURIComponent(sessionId) + "/line_items?limit=10");
  if (!expectedPrice || !Array.isArray(lines.data) || lines.data.length !== 1 || lines.data[0]?.price?.id !== expectedPrice || lines.data[0]?.quantity !== 1) return json({ error: "Paid line item does not match the configured product" }, 403, origin);
  const issuedAt = Math.floor(Date.now() / 1000);
  const token = await issueLicense(env, { appId, entitlement: product.entitlement, issuedAt, expiresAt: issuedAt + TOKEN_SECONDS, priceId: expectedPrice, sessionId });
  return json({ token, appId, entitlement: product.entitlement, issuedAt, expiresAt: issuedAt + TOKEN_SECONDS }, 200, origin);
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") return json({ service: "apex-anchor-billing", status: "ready", database: false });
    if (url.pathname === "/public-key" && request.method === "GET") {
      const origin = allowedOrigin(request, env);
      if (!origin) return json({ error: "Origin not allowed" }, 403);
      if (!env.APEX_LICENSE_PUBLIC_KEY) return json({ error: "License public key is not configured" }, 503, origin);
      return json({ algorithm: "Ed25519", publicKey: env.APEX_LICENSE_PUBLIC_KEY }, 200, origin);
    }
    if (url.pathname === "/webhook" && request.method === "POST") {
      const rawBody = await request.text();
      const valid = await verifyStripeWebhook(rawBody, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET);
      if (!valid) return json({ error: "Invalid Stripe webhook signature" }, 400);
      try { JSON.parse(rawBody); } catch { return json({ error: "Invalid webhook body" }, 400); }
      return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    }
    const origin = allowedOrigin(request, env);
    if (request.method === "OPTIONS" && origin) return new Response(null, { status: 204, headers: { "access-control-allow-origin": origin, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "600", vary: "Origin" } });
    if (!origin) return json({ error: "Origin not allowed" }, 403);
    if (request.method !== "POST" || !["/checkout", "/license"].includes(url.pathname)) return json({ error: "not found" }, 404, origin);
    try { return url.pathname === "/checkout" ? await createCheckout(request, env, origin) : await issueFromPaidSession(request, env, origin); }
    catch (error) { return json({ error: String(error?.message || "billing request failed") }, Number(error?.status) || 502, origin); }
  }
};
