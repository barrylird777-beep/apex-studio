import test from "node:test";
import assert from "node:assert/strict";
import { verifyPostgresMigrations } from "../scripts/verify-postgres-migrations.mjs";

const expectations = {
  tables: ["projects", "scenes", "shoot_days", "shoot_day_scenes"],
  primaryKeys: [{ table: "shoot_day_scenes", columns: ["scene_id"] }],
  unique: [{ table: "shoot_days", columns: ["project_id", "date"] }],
  indexes: [
    { table: "shoot_day_scenes", columns: ["shoot_day_id", "position"] },
    { table: "shoot_days", columns: ["project_id", "date"] },
  ],
  foreignKeys: [
    { table: "shoot_day_scenes", column: "shoot_day_id", references: "shoot_days", onDelete: "CASCADE" },
    { table: "shoot_day_scenes", column: "scene_id", references: "scenes", onDelete: "CASCADE" },
  ],
};

test("committed PostgreSQL migrations rebuild the expected SPEC-005 schema from empty", { skip: !process.env.DATABASE_URL }, async () => {
  const result = await verifyPostgresMigrations({ expectations });
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.ok(result.migrationCount > 0);
});
