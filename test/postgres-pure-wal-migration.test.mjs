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

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("migration dry-run reads CI PostgreSQL without writing target records", { skip: !process.env.DATABASE_URL }, async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "apex-pure-wal-migration-"));
  try {
    const script = fileURLToPath(new URL("../scripts/migrate-postgres-to-pure-wal.mjs", import.meta.url));
    const child = spawn(process.execPath, [script, "--schema=public"], {
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL,
        APEX_SE_X_ROOT: tempRoot,
        APEX_PROJECTS_DIR: join(tempRoot, "projects"),
        APEX_WAL_FILE: join(tempRoot, "wal", "ring.wal.jsonl")
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    assert.equal(result.code, 0, stderr);
    const report = JSON.parse(stdout);
    assert.equal(report.mode, "dry-run");
    assert.equal(report.safety.sourceModified, false);
    assert.equal(report.safety.targetOverwriteAllowed, false);
    assert.equal(report.summary.written, 0);
    assert.ok(report.summary.tables >= 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
