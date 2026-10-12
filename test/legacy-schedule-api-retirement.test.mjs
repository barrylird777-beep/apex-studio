import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("production launch paths use the sovereign API stack, not the legacy SQL TypeScript server", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.start, "node server.mjs");
  assert.equal(pkg.scripts["start:sovereign-stack"], "node scripts/start-apex-stack.mjs");
  assert.doesNotMatch(pkg.scripts.start, /src\/api\/server\.ts/);
  assert.doesNotMatch(pkg.scripts["start:sovereign-stack"], /src\/api\/server\.ts/);
});
