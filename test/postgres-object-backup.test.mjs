import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../scripts/backup-postgres-to-object-store.mjs", import.meta.url), "utf8");

test("object-store PostgreSQL backup streams pg_dump without writing a local dump", () => {
  assert.match(source, /--format=custom/);
  assert.match(source, /new Upload\(/);
  assert.match(source, /PutObjectCommand/);
  assert.match(source, /APEX_BACKUP_OBJECT_BUCKET/);
  assert.match(source, /createHash\("sha256"\)/);
  assert.doesNotMatch(source, /writeFile|createWriteStream|APEX_BACKUP_DIR/);
});
