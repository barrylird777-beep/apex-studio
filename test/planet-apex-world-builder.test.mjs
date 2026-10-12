import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("PlanetApeX world builder is wired to authenticated durable record endpoints", async () => {
  const html = await fs.readFile(path.join(root, "public", "planet-apex.html"), "utf8");
  assert.match(html, /\/api\/apex\/apps\/planet-apex\/status/);
  assert.match(html, /\/api\/mobile\/apps\/planet-apex\/records\//);
  assert.match(html, /\/api\/mobile\/apps\/planet-apex\/records["']/);
  assert.match(html, /method:"PUT"/);
  assert.match(html, /x-apex-shortcut-token/);
  assert.match(html, /sessionStorage/);
  assert.match(html, /Save world/);
  assert.match(html, /Load by ID/);
  assert.match(html, /List saved worlds/);
  assert.doesNotMatch(html, /localStorage/);
});

test("PlanetApeX record IDs match the durable fabric's safe key format", async () => {
  const html = await fs.readFile(path.join(root, "public", "planet-apex.html"), "utf8");
  assert.match(html, /function validId\(id\)\{return \^?\/\[A-Za-z0-9\]/);
  assert.match(html, /!id\.includes\("\.\."\)/);
});
