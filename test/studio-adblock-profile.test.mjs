import test from "node:test";
import assert from "node:assert/strict";
import { studioAdBlockMobileConfig } from "../src/network/studio-adblock-profile.mjs";

test("Studio ad blocker profile is a manual-install system DNS profile", () => {
  const xml = studioAdBlockMobileConfig();
  assert.match(xml, /<key>PayloadType<\/key>\s*<string>Configuration<\/string>/);
  assert.match(xml, /com\.apple\.dnsSettings\.managed/);
  assert.match(xml, /<key>DNSProtocol<\/key>\s*<string>HTTPS<\/string>/);
  assert.match(xml, /https:\/\/dns\.adguard-dns\.com\/dns-query/);
  assert.match(xml, /<key>Action<\/key>\s*<string>Connect<\/string>/);
});
