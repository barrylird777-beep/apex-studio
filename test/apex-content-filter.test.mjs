import test from "node:test";
import assert from "node:assert/strict";
import { classifyNetworkRequest, buildSafariContentBlockerRules } from "../src/network/apex-content-filter.mjs";

test("content filter blocks dedicated third-party ad hosts", () => {
  const result = classifyNetworkRequest("https://ads.example.test/banner.js", {
    firstPartyHost: "news.example",
    resourceType: "script"
  });
  assert.equal(result.action, "block");
});

test("content filter always allows first-party content", () => {
  const result = classifyNetworkRequest("https://cdn.example.com/video.mp4", {
    firstPartyHost: "example.com",
    resourceType: "media"
  });
  assert.equal(result.action, "allow");
  assert.equal(result.reason, "first-party");
});

test("content filter allows uncertain third-party requests by default", () => {
  const result = classifyNetworkRequest("https://cdn.vendor.example/library.js", {
    firstPartyHost: "example.com",
    resourceType: "script"
  });
  assert.equal(result.action, "allow");
  assert.equal(result.reason, "uncertain-allow-by-default");
});

test("Safari rules contain resource-level blocking rather than whole-site blocking", () => {
  const rules = buildSafariContentBlockerRules();
  assert.ok(rules.length > 0);
  assert.ok(rules.every(rule => rule.action.type === "block"));
  assert.ok(rules.every(rule => rule.trigger["resource-type"].includes("script")));
});
