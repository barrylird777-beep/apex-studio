import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("SPEC-004 scene API exposes list, update, and delete persistence paths", async () => {
  const source = await readFile("src/api/server.ts", "utf8");
  assert.match(source, /p\[3\]===\"scenes\"&&req\.method===\"GET\"/);
  assert.match(source, /p\[0\]===\"api\"&&p\[1\]===\"scenes\"/);
  assert.match(source, /req\.method===\"PUT\"/);
  assert.match(source, /req\.method===\"DELETE\"/);
});

test("SPEC-004 editor implements empty state and scene editing controls", async () => {
  const source = await readFile("src/pages/SceneList.tsx", "utf8");
  assert.match(source, /No scenes yet/);
  assert.match(source, /Save changes/);
  assert.match(source, /Delete scene/);
  assert.match(source, /Move up/);
  assert.match(source, /Move down/);
});
