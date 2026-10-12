import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("Apex Browser uses federated search and does not persist browser profile data", async () => {
  const html = await fs.readFile(new URL("../public/apex-browser.html", import.meta.url), "utf8");
  assert.match(html, /fetch\("\/api\/search\?/);
  assert.match(html, /DuckDuckGo/);
  assert.match(html, /Encyclopedia/);
  assert.match(html, /Research papers/);
  assert.match(html, /data-engine="https:\/\/www\.google\.com\/search\?q="/);
  assert.match(html, /data-engine="https:\/\/search\.brave\.com\/search\?q="/);
  assert.match(html, /function openAddress/);
  const scripts = [...html.matchAll(/<script>([\\s\\S]*?)<\\/script>/gi)].map(match => match[1]).join("\\n");\n  assert.doesNotMatch(scripts, /localStorage|sessionStorage|indexedDB/i);
});
