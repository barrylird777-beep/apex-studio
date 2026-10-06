import test from "node:test";
import assert from "node:assert/strict";
import { internetCapabilities, internetFetch, internetSearch } from "../src/core/internet/internet-gateway.mjs";

test("internet gateway exposes hardened capability metadata", async () => {
  const capabilities = await internetCapabilities();
  assert.equal(capabilities.fetch, true);
  assert.equal(capabilities.httpsOnly, true);
  assert.equal(capabilities.ssrfPrivateAddressProtection, true);
  assert.equal(capabilities.maxSearchResults, 20);
});

test("internet gateway blocks insecure and private destinations", async () => {
  await assert.rejects(() => internetFetch("http://example.com"), /HTTPS/);
  await assert.rejects(() => internetFetch("https://127.0.0.1/"), /private IPv4/i);
  await assert.rejects(() => internetFetch("https://localhost/"), /local hostname/i);
  await assert.rejects(() => internetFetch("https://[::ffff:127.0.0.1]/"), /private IPv6/i);
});

test("internet search rejects empty queries", async () => {
  await assert.rejects(() => internetSearch("   "), /query is required/i);
});
