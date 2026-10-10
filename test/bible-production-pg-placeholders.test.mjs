import test from "node:test";
import assert from "node:assert/strict";
import { toPostgresPlaceholders } from "../src/core/bible-production-pg.mjs";

test("PostgreSQL placeholder conversion ignores question marks inside SQL literals and comments", () => {
  const sql = "SELECT ?, '?' AS literal, \"?\" AS quoted, $$?$$ AS dollar_literal, $tag$?$tag$ AS tagged, ? -- ? in comment\n/* ? outer /* ? nested */ still ? */ WHERE note = 'it''s ?' AND id = ?";
  assert.equal(
    toPostgresPlaceholders(sql),
    "SELECT $1, '?' AS literal, \"?\" AS quoted, $$?$$ AS dollar_literal, $tag$?$tag$ AS tagged, $2 -- ? in comment\n/* ? outer /* ? nested */ still ? */ WHERE note = 'it''s ?' AND id = $3"
  );
});

test("PostgreSQL placeholder conversion handles escaped quote characters", () => {
  assert.equal(
    toPostgresPlaceholders("SELECT 'escaped \\' ?' , ?"),
    "SELECT 'escaped \\' ?' , $1"
  );
});
