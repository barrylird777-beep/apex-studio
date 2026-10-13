import test from "node:test";
import assert from "node:assert/strict";
import {
  createOwnerSessionToken,
  hasValidOwnerSession,
  isOwnerAuthConfigured,
  ownerSessionClearCookie,
  ownerSessionSetCookie,
  verifyOwnerPassword,
  verifyOwnerSessionToken
} from "../src/security/owner-session-auth.mjs";

test("owner sign-in fails closed until a long owner password is configured", () => {
  const previous = process.env.APEX_OWNER_PASSWORD;
  delete process.env.APEX_OWNER_PASSWORD;
  try {
    assert.equal(isOwnerAuthConfigured(), false);
    assert.equal(verifyOwnerPassword("anything"), false);
    assert.throws(() => createOwnerSessionToken(), /APEX_OWNER_PASSWORD/);
  } finally {
    if (previous === undefined) delete process.env.APEX_OWNER_PASSWORD;
    else process.env.APEX_OWNER_PASSWORD = previous;
  }
});

test("single owner password creates an expiring signed HttpOnly session cookie", () => {
  const previous = process.env.APEX_OWNER_PASSWORD;
  process.env.APEX_OWNER_PASSWORD = "test-owner-password-0123456789-long";
  try {
    assert.equal(isOwnerAuthConfigured(), true);
    assert.equal(verifyOwnerPassword("wrong"), false);
    assert.equal(verifyOwnerPassword(process.env.APEX_OWNER_PASSWORD), true);
    const now = 1_800_000_000_000;
    const token = createOwnerSessionToken(now);
    assert.equal(verifyOwnerSessionToken(token, now), true);
    assert.equal(verifyOwnerSessionToken(token, now + 13 * 60 * 60 * 1000), false);
    assert.equal(verifyOwnerSessionToken(token + "x", now), false);
    const request = { headers: { cookie: "other=value; apex.owner.session=" + token } };
    assert.equal(hasValidOwnerSession(request), true);
    const cookie = ownerSessionSetCookie(token, { production: true });
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Secure/);
    assert.match(ownerSessionClearCookie({ production: true }), /Max-Age=0/);
  } finally {
    if (previous === undefined) delete process.env.APEX_OWNER_PASSWORD;
    else process.env.APEX_OWNER_PASSWORD = previous;
  }
});
