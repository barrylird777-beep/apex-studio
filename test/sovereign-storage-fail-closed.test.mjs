import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initStorage } from "../src/core/storage.mjs";
import { ContentAddressedStore } from "../src/core/content-addressed-store.mjs";
import { ApexRingWAL } from "../src/core/apex-ring-wal.mjs";

test("legacy project asset storage refuses local disk and JSON manifest writes", async () => {
  await assert.rejects(
    initStorage(),
    error => error.message.includes("[NONCOMPLIANT_STORAGE_DISABLED]")
  );
});

test("filesystem CAS rejects object and reference mutations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-storage-policy-"));
  try {
    const store = await new ContentAddressedStore({ root }).init();
    await assert.rejects(store.putObject({ secret: "test" }), /NONCOMPLIANT_STORAGE_DISABLED/);
    await assert.rejects(store.writeRef("PlanetApeX", "policy-test", { value: 1 }), /NONCOMPLIANT_STORAGE_DISABLED/);
    await assert.rejects(store.deleteRef("PlanetApeX", "policy-test"), /NONCOMPLIANT_STORAGE_DISABLED/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local WAL refuses new appends", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-wal-policy-"));
  try {
    const wal = new ApexRingWAL({ file: path.join(root, "legacy.wal") });
    await assert.rejects(wal.append("state.put", { collection: "XShield", id: "policy-test" }), /NONCOMPLIANT_STORAGE_DISABLED/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
