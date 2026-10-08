import test from "node:test";
import assert from "node:assert/strict";

const originalDatabaseUrl = process.env.DATABASE_URL;
delete process.env.DATABASE_URL;

test("EngineApex chat runtime has a deterministic non-durable fallback", async () => {
  const runtime = await import("../src/core/engine-apex-chat-runtime.mjs");
  const snapshot = await runtime.getChatRuntimeState("test");
  assert.equal(snapshot.durable, false);
  assert.equal(snapshot.scope, "test");
  assert.equal(snapshot.version, undefined);
  assert.deepEqual(snapshot.state, {
    mission: null,
    activeWork: [],
    blockers: [],
    decisions: [],
    verifiedFacts: [],
    pendingVerification: [],
    recovery: null,
    metadata: {}
  });
});

test.after(() => {
  if (originalDatabaseUrl == null) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});
