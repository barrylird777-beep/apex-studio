import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("PlanetApeX opens on one realistic centered planet and nothing else", async () => {
  const html = await fs.readFile(path.join(root, "public", "planet-apex.html"), "utf8");
  assert.match(html, /<title>PlanetApeX<\/title>/);
  assert.match(html, /html,body\{width:100%;height:100%;margin:0;overflow:hidden;background:#02050b\}/);
  assert.match(html, /body\{display:grid;place-items:center/);
  assert.match(html, /<main aria-label="PlanetApeX">/);
  assert.match(html, /<div class="planet" role="img" aria-label="One large realistic blue planet, centered against deep black space">/);
  assert.match(html, /class="land"/);
  assert.match(html, /class="clouds"/);
  assert.match(html, /class="atmosphere"/);
  assert.match(html, /radial-gradient/);
  assert.match(html, /feTurbulence/);
  assert.doesNotMatch(html, /kornworld|kw-command|kw-earth-photo|jpegPIA18033\.jpg/i);
  assert.doesNotMatch(html, /<nav\b|<button\b|<input\b|<h1\b|pa-quick-index|GardenApeX|Study the text|Trace the evidence/i);
  assert.equal((html.match(/class="planet"/g) || []).length, 1, "only one planet is shown");
});
