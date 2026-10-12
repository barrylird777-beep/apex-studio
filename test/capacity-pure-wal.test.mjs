import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CAPACITY, capacitySnapshot } from "../src/core/capacity.mjs";

test("canonical capacity configuration selects Pure-WAL without SQL backends", () => {
  assert.equal(CAPACITY.storageBackend, "pure-wal");
  assert.equal(CAPACITY.omniBackend, "pure-wal");
  assert.equal(CAPACITY.omniDatabase, null);
  assert.equal(CAPACITY.databaseUrl, "");
  const snapshot = capacitySnapshot();
  assert.equal(snapshot.externalDatabaseConfigured, false);
  assert.equal(snapshot.scalable, true);
  assert.ok(snapshot.notes.some(note => note.includes("Pure-WAL/Ring-WAL")));
  assert.ok(snapshot.notes.some(note => note.includes("does not by itself prove cross-device replication") || note.includes("does not by itself prove")));
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(server, /postgresql-worker-fabric|Durable PostgreSQL worker fabric/);
});
