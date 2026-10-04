import test from "node:test";
import assert from "node:assert/strict";
import { verifyPostgresMigrations } from "../scripts/verify-postgres-migrations.mjs";

test("committed PostgreSQL migrations are present and PostgreSQL-only", () => {
  const result = verifyPostgresMigrations("drizzle-pg", "scripts/spec005-expectations.json");
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.ok(result.migrationCount > 0);
});
