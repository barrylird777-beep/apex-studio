import test from "node:test";
import assert from "node:assert/strict";
import { createStudio } from "../src/runtime/studio.mjs";
import { EncryptedStore } from "../src/core/encrypted-store.mjs";

test("studio boots with STARK dependencies", () => {
  const studio = createStudio();
  assert.ok(studio.egress);
  assert.ok(studio.auth);
  assert.ok(studio.strategy);
  assert.ok(studio.decisions);
  assert.ok(studio.research);
  const strategy = studio.strategy.create({ name: "Smoke" });
  assert.equal(studio.strategy.get(strategy.id).name, "Smoke");
});

test("egress denies by default and audits the attempt", () => {
  const studio = createStudio();
  assert.throws(() => studio.egress.check("https://example.com"), /Egress denied/);
  assert.equal(studio.egress.listAudit().length, 1);
  studio.egress.allowHost("example.com");
  assert.equal(studio.egress.check("https://example.com/path"), true);
});

test("encrypted store round-trips structured values", () => {
  const store = new EncryptedStore("test-passphrase");
  store.set("x", { ok: true, n: 7 });
  assert.deepEqual(store.get("x"), { ok: true, n: 7 });
});
