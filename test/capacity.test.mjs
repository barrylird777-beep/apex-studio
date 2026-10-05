import test from "node:test";
import assert from "node:assert/strict";

test("production capacity has no SQLite persistence fallback", async () => {
  const { CAPACITY, capacitySnapshot } = await import("../src/core/capacity.mjs");
  assert.equal("omniBackend" in CAPACITY, false);
  assert.equal("omniDatabase" in CAPACITY, false);
  assert.equal(capacitySnapshot().scalable, Boolean(CAPACITY.databaseUrl));
});
