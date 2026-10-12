import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("dashboard telemetry client identity does not persist in browser storage", async () => {
  const script = await fs.readFile(path.join(root, "public", "apex-dashboard.js"), "utf8");
  assert.match(script, /function getApexClientId\(\)/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|indexedDB/i);
});
