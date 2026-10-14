import { createPrivateKey, createPublicKey, sign, verify, randomUUID } from "node:crypto";

const TOKEN_TYPE = "APEX-PAYMENT";
const ENCODING = "base64url";
function encode(value) { return Buffer.from(JSON.stringify(value)).toString(ENCODING); }
function decode(value) {
  try { return JSON.parse(Buffer.from(value, ENCODING).toString("utf8")); }
  catch { throw new Error("Malformed APEX payment token"); }
}
function keyObject(key, kind) {
  if (!key) throw new Error(kind + " Ed25519 key is required");
  return kind === "private" ? createPrivateKey(key) : createPublicKey(key);
}

/**
 * Signed short-lived access tokens issued only after a confirmed payment is
 * atomically claimed in a caller-supplied peer-owned ledger. No file, WAL,
 * localStorage, or database is opened by this module.
 */
export function createPaymentTokenService({
  privateKeyPem,
  publicKeyPem,
  ledger,
  issuer = "apex-payment-issuer",
  audience = "apex-paid-inference",
  tokenTtlSeconds = 900,
  clock = () => Math.floor(Date.now() / 1000)
} = {}) {
  const privateKey = keyObject(privateKeyPem, "private");
  const publicKey = keyObject(publicKeyPem, "public");
  if (privateKey.asymmetricKeyType !== "ed25519" || publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error("APEX payment tokens require Ed25519 keys");
  }
  if (!ledger || typeof ledger.claimPayment !== "function" || typeof ledger.consumeJti !== "function") {
    throw new Error("A peer-owned atomic payment ledger is required");
  }
  if (!Number.isInteger(tokenTtlSeconds) || tokenTtlSeconds < 30 || tokenTtlSeconds > 3600) {
    throw new Error("Payment token TTL must be between 30 and 3600 seconds");
  }

  async function issue({ payment, subject, orderId, requiredRawAmount } = {}) {
    if (!payment || payment.chainId !== 137 ||
        String(payment.token || "").toLowerCase() !== "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359") {
      throw new Error("Only confirmed Polygon PoS native USDC payment records may authorize tokens");
    }
    if (!/^0x[0-9a-f]{64}$/.test(String(payment.txHash || "")) ||
        !Number.isSafeInteger(payment.logIndex) || payment.logIndex < 0) {
      throw new Error("Payment transaction identity is invalid");
    }
    if (!subject || !orderId || !/^\d+$/.test(String(requiredRawAmount))) {
      throw new Error("subject, orderId, and exact required raw USDC amount are required");
    }
    if (String(payment.rawAmount) !== String(requiredRawAmount)) {
      throw new Error("Payment amount does not match the order amount");
    }
    const paymentKey = "polygon:137:" + payment.txHash + ":" + payment.logIndex;
    const claim = await ledger.claimPayment({
      paymentKey, subject: String(subject), orderId: String(orderId),
      token: payment.token, rawAmount: String(payment.rawAmount),
      blockNumber: payment.blockNumber
    });
    if (claim !== true) throw new Error("Payment was already claimed or could not be atomically claimed");

    const iat = clock();
    const claims = {
      typ: TOKEN_TYPE, iss: issuer, aud: audience,
      sub: String(subject), order: String(orderId),
      payment: paymentKey, jti: randomUUID(),
      chainId: 137, token: payment.token,
      rawAmount: String(payment.rawAmount),
      iat, nbf: iat, exp: iat + tokenTtlSeconds
    };
    const payload = encode(claims);
    const signingInput = "apx1." + payload;
    const signature = sign(null, Buffer.from(signingInput), privateKey).toString(ENCODING);
    return signingInput + "." + signature;
  }

  async function verifyAndConsume(token, { subject, orderId } = {}) {
    if (typeof token !== "string" || token.length > 8192) throw new Error("Invalid APEX payment token");
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "apx1") throw new Error("Malformed APEX payment token");
    const signingInput = parts[0] + "." + parts[1];
    const signature = Buffer.from(parts[2], ENCODING);
    if (!verify(null, Buffer.from(signingInput), publicKey, signature)) throw new Error("Invalid payment token signature");
    const claims = decode(parts[1]);
    const now = clock();
    if (claims.typ !== TOKEN_TYPE || claims.iss !== issuer || claims.aud !== audience ||
        !Number.isInteger(claims.iat) || !Number.isInteger(claims.nbf) || !Number.isInteger(claims.exp) ||
        claims.nbf > now || claims.iat > now + 30 || claims.exp <= now || claims.exp - claims.iat > tokenTtlSeconds ||
        claims.chainId !== 137 || typeof claims.payment !== "string" || typeof claims.jti !== "string") {
      throw new Error("APEX payment token claims are invalid or expired");
    }
    if (subject && claims.sub !== String(subject)) throw new Error("Payment token subject mismatch");
    if (orderId && claims.order !== String(orderId)) throw new Error("Payment token order mismatch");
    if (await ledger.consumeJti(claims.jti, claims.exp) !== true) throw new Error("Payment token has already been consumed");
    return claims;
  }

  return Object.freeze({ issue, verifyAndConsume });
}
