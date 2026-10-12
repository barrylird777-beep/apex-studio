import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("Local AI never stores model files in browser persistence", async () => {
  const html = await fs.readFile(new URL("../public/local-ai.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /indexedDB|localStorage|sessionStorage/i);
  assert.match(html, /used for this session only/i);
  assert.doesNotMatch(html, /persistModel|restoreModel|deleteSavedModel/);
});
