import test from "node:test";
import assert from "node:assert/strict";
import { classifyNetworkRequest, buildSafariContentBlockerRules } from "../src/network/apex-content-filter.mjs";

test("content filter blocks a clearly dedicated ad host", () => {
  const result = classifyNetworkRequest("https://ads.example.test/banner.js", {
    firstPartyHost: "news.example",
    resourceType: "script"
  });
  assert.equal(result.action, "block");
  assert.equal(result.reason, "high-confidence-ad-request-pattern");
});

test("content filter always allows first-party content", () => {
  const result = classifyNetworkRequest("https://cdn.example.com/video.mp4", {
    firstPartyHost: "example.com",
    resourceType: "media"
  });
  assert.equal(result.action, "allow");
  assert.equal(result.reason, "first-party");
});

test("content filter allows ordinary third-party content", () => {
  const result = classifyNetworkRequest("https://cdn.vendor.example/library.js", {
    firstPartyHost: "example.com",
    resourceType: "script"
  });
  assert.equal(result.action, "allow");
  assert.equal(result.reason, "uncertain-allow-by-default");
});

test("YouTube video traffic is not blocked by host matching", () => {
  const result = classifyNetworkRequest("https://rr1---sn.example.googlevideo.com/videoplayback?expire=999", {
    firstPartyHost: "youtube.com",
    resourceType: "media"
  });
  assert.equal(result.action, "allow");
});

test("Safari rules are resource-level and include ad-only YouTube presentation hiding", () => {
  const rules = buildSafariContentBlockerRules();
  assert.ok(rules.length >= 3);
  assert.ok(rules.some(rule => rule.action.type === "css-display-none"));
  assert.ok(rules.every(rule => rule.trigger["url-filter"]));
  assert.ok(!rules.some(rule => rule.trigger["if-domain"]?.includes("*.googlevideo.com")));
});
