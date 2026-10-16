import { bench, describe } from "vitest";
import { buildSafariContentBlockerRules, classifyNetworkRequest } from "../src/network/apex-content-filter.mjs";

const requests = [
  ["https://ads.example.test/banner.js", { firstPartyHost: "news.example", resourceType: "script" }],
  ["https://cdn.example.com/video.mp4", { firstPartyHost: "example.com", resourceType: "media" }],
  ["https://cdn.vendor.example/library.js", { firstPartyHost: "example.com", resourceType: "script" }],
  ["https://rr1---sn.example.googlevideo.com/videoplayback?expire=999", { firstPartyHost: "youtube.com", resourceType: "media" }],
  ["https://tracker.analytics.example/pixel.gif?id=42", { firstPartyHost: "shop.example", resourceType: "image" }],
  ["https://static.example.org/styles/main.css", { firstPartyHost: "example.org", resourceType: "stylesheet" }]
];

describe("apex-content-filter", () => {
  bench("classifyNetworkRequest mixed batch (600 requests)", () => {
    for (let i = 0; i < 100; i += 1) {
      for (const [url, options] of requests) classifyNetworkRequest(url, options);
    }
  });

  bench("buildSafariContentBlockerRules", () => {
    buildSafariContentBlockerRules();
  });
});
