import test from "node:test";
import assert from "node:assert/strict";
import {
  quoteSqlIdentifier,
  canonicalJson,
  targetCollection,
  targetRecordId,
  classifyTarget,
  parseMigrationArgs
} from "../scripts/migrate-postgres-to-pure-wal.mjs";

test("PostgreSQL migration safely quotes identifiers", () => {
  assert.equal(quoteSqlIdentifier('tab"le'), '"tab""le"');
});

test("canonical JSON is stable across object key order", () => {
  assert.equal(canonicalJson({ z: 2, a: { y: 1, x: true } }), canonicalJson({ a: { x: true, y: 1 }, z: 2 }));
});

test("migration collection IDs are stable and safe for Pure-WAL paths", () => {
  const a = targetCollection("public", "bible_notes");
  assert.equal(a, targetCollection("public", "bible_notes"));
  assert.match(a, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
  assert.notEqual(a, targetCollection("archive", "bible_notes"));
  assert.notEqual(a, targetCollection("public", "bible_books"));
});

test("migration record IDs preserve primary-key identity and detect changed rows as conflicts", () => {
  const row = { id: 7, note: "original" };
  const id = targetRecordId("public", "notes", ["id"], row);
  assert.equal(id, targetRecordId("public", "notes", ["id"], row));
  assert.notEqual(id, targetRecordId("public", "notes", ["id"], { id: 8, note: "original" }));
  assert.equal(classifyTarget(null, { sourceRow: row, sourcePrimaryKey: [["id", 7]], sourceForeignKeys: [] }), "new");
  assert.equal(classifyTarget(
    { sourceRow: row, sourcePrimaryKey: [["id", 7]], sourceForeignKeys: [] },
    { sourceRow: row, sourcePrimaryKey: [["id", 7]], sourceForeignKeys: [] }
  ), "identical");
  assert.equal(classifyTarget(
    { sourceRow: row, sourcePrimaryKey: [["id", 7]], sourceForeignKeys: [] },
    { sourceRow: { id: 7, note: "changed" }, sourcePrimaryKey: [["id", 7]], sourceForeignKeys: [] }
  ), "conflict");
});

test("duplicate rows without primary keys get stable distinct IDs by occurrence", () => {
  const row = { value: "duplicate" };
  assert.equal(targetRecordId("public", "events", [], row, 0), targetRecordId("public", "events", [], row, 0));
  assert.notEqual(targetRecordId("public", "events", [], row, 0), targetRecordId("public", "events", [], row, 1));
});

test("migration requires explicit --apply and rejects unknown options", () => {
  assert.deepEqual(parseMigrationArgs([]), { apply: false, schema: null, output: null, help: false });
  assert.deepEqual(parseMigrationArgs(["--apply", "--schema=public"]), { apply: true, schema: "public", output: null, help: false });
  assert.throws(() => parseMigrationArgs(["--truncate"]), /Unknown or incomplete option/);
  assert.throws(() => parseMigrationArgs(["--schema="]), /Unknown or incomplete option/);
});
