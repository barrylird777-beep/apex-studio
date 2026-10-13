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
  assert.match(html, /function validId/);
  assert.match(html, /!id\.includes\("\.\."\)/);
});


test("PlanetApeX observatory redesign preserves core destinations and world controls", async () => {
  const html = await fs.readFile(path.join(root, "public", "planet-apex.html"), "utf8");
  assert.match(html, /px-command-hero/);
  assert.match(html, /px-globe-scene/);
  assert.match(html, /id="pa-world-enter"/);
  assert.match(html, /id="analytics"/);
  assert.match(html, /id="scripture"/);
  assert.match(html, /id="research"/);
  assert.match(html, /id="garden"/);
  assert.match(html, /id="world-tools"/);
  assert.match(html, /id="pa-life-toggle"/);
  assert.match(html, /id="pa-life-step"/);
  assert.match(html, /id="pa-life-reset"/);
  assert.match(html, /id="save"/);
  assert.match(html, /id="load"/);
  assert.match(html, /id="list"/);
});
