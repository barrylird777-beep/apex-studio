import test from "node:test";
import assert from "node:assert/strict";
import {isPublicAddress,validateOutboundUrl} from "../src/security/safe-outbound-fetch.mjs";

test("rejects private, loopback, link-local, reserved and mapped addresses",()=>{
  for(const ip of ["127.0.0.1","10.0.0.1","172.16.0.1","192.168.1.1","169.254.169.254","100.64.0.1","224.0.0.1","::1","::ffff:127.0.0.1","fc00::1","fe80::1","ff02::1","2001:db8::1"])assert.equal(isPublicAddress(ip),false,ip);
  assert.equal(isPublicAddress("8.8.8.8"),true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"),true);
});
test("only allows HTTPS without credentials or unsafe ports",()=>{
  assert.equal(validateOutboundUrl("https://api.example.com/v1").hostname,"api.example.com");
  for(const url of ["http://example.com","https://user:pass@example.com","https://localhost","https://127.0.0.1","https://example.com:8443","https://service.internal"])assert.throws(()=>validateOutboundUrl(url),undefined,url);
});
test("supports exact/subdomain allowlist boundaries",()=>{
  assert.doesNotThrow(()=>validateOutboundUrl("https://api.example.com",{allowedHosts:["example.com"]}));
  assert.throws(()=>validateOutboundUrl("https://notexample.com",{allowedHosts:["example.com"]}));
});
