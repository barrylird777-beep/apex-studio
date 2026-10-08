import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("biblical production API module exists and defines the required persistent surfaces",()=>{
  const source=fs.readFileSync(new URL("../src/api/bible-production.mjs",import.meta.url),"utf8");
  for(const route of ["/characters","/characters/:id","/scenes","/scenes/generate","/call-sheets"]) assert.match(source,new RegExp(route.replace(/[/:]/g,"\\$&")));
  for(const field of ["canonicalName","aliases","primaryStories","relationships","keyTraits","scriptureReferences","scriptureReference","emotionalBeat","productionNotes","shootDate","specialRequirements"]) assert.match(source,new RegExp(field));
  assert.match(source,/createBibleProductionStore/);\n  assert.doesNotMatch(source,/sqlite3|apex-bible\\.sqlite|PRAGMA/i);
  assert.match(source,/CREATE TABLE IF NOT EXISTS scenes/);
  assert.match(source,/CREATE TABLE IF NOT EXISTS call_sheets/);
});
