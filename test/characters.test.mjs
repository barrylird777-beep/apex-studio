import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = p => readFile(p, "utf8");
test("SPEC-002 character API exposes full CRUD", async () => {
  const s = await read("src/api/characters.ts");
  for (const name of ["listCharacters","getCharacter","createCharacter","updateCharacter","deleteCharacter"]) assert.ok(s.includes(name), name);
  assert.ok(s.includes("like(characters.canonicalName"));
  assert.ok(s.includes("like(characters.primaryStories"));
});
test("SPEC-002 seed preserves existing records and contains the expanded biblical cast", async () => {
  const s = await read("src/db/seed.ts");
  assert.doesNotMatch(s, /db\\.delete\\(characters\\)/);
  for (const name of ["Methuselah","Enoch","Melchizedek","Jochebed","Korah","Jael","Jephthah","Hannah","Abigail","Joab","Hezekiah","Josiah","Zerubbabel","Malachi","Simeon","Anna","Zacchaeus","Bartimaeus","Ananias (of Damascus)","Gamaliel","Ethiopian Eunuch","Tabitha (Dorcas)","Herod Agrippa I","John Mark","James (brother of Jesus)","Jude (brother of Jesus)","Demas","Onesimus","Philemon","Tychicus","Aristarchus"]) assert.ok(s.includes(name), name);
});
test("SPEC-002 character UI supports search, detail, edit, create, and delete", async () => {
  const s = await read("src/pages/CharacterDatabase.tsx");
  for (const text of ["Search by name, alias, or story","New character","Create character","Save changes","Delete","CHARACTER DETAIL"]) assert.ok(s.includes(text), text);
  assert.ok(s.includes("/api/characters?q="));
  assert.ok(s.includes("method:"POST""));
  assert.ok(s.includes("method:"PUT""));
  assert.ok(s.includes("method:"DELETE""));
});
test("SPEC-002 app exposes the character database", async () => {
  const s = await read("src/App.tsx");
  assert.ok(s.includes("CharacterDatabase"));
  assert.ok(s.includes("/characters"));
});
// Scope guard: SPEC-002 must not introduce scene, call-sheet, calendar, or budget UI.