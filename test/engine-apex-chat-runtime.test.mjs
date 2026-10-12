import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ApexPureStore } from "../src/core/apex-pure-store.mjs";
import { ApexRingWAL } from "../src/core/apex-ring-wal.mjs";
import { createPureWalChatRuntime } from "../src/core/pure-wal-chat-runtime.mjs";

test("EngineApex chat runtime uses durable, namespaced Pure-WAL storage without DATABASE_URL", async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const runtimeModule = await import("../src/core/engine-apex-chat-runtime.mjs");
  assert.equal(typeof runtimeModule.getChatRuntimeState, "function");
  assert.equal(typeof runtimeModule.updateChatRuntimeState, "function");
  assert.equal(typeof runtimeModule.listChatRuntimeEvents, "function");
  if (previous === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous;
});

test("Pure-WAL chat state is durable, versioned, isolated, and evented", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apex-chat-runtime-"));
  const store = new ApexPureStore({
    root: path.join(dir, "projects"),
    wal: new ApexRingWAL({ file: path.join(dir, "wal", "ring.wal.jsonl") })
  });
  try {
    await store.init();
    const runtime = createPureWalChatRuntime({ namespace: "engine_apex_test", actor: "engine-apex", store });
    const initial = await runtime.getChatRuntimeState("session-1");
    assert.equal(initial.durable, true);
    assert.equal(initial.version, 0);
    assert.equal(initial.state.mission, null);

    const updated = await runtime.updateChatRuntimeState({
      scope: "session-1",
      expectedVersion: 0,
      patch: { mission: "verify sovereign network", activeWork: ["peer transport"] }
    });
    assert.equal(updated.durable, true);
    assert.equal(updated.version, 1);
    assert.equal(updated.state.mission, "verify sovereign network");

    await assert.rejects(
      runtime.updateChatRuntimeState({ scope: "session-1", expectedVersion: 0, patch: { mission: "stale write" } }),
      error => error.code === "RUNTIME_VERSION_CONFLICT" && error.currentVersion === 1
    );

    const restored = await runtime.getChatRuntimeState("session-1");
    assert.equal(restored.version, 1);
    assert.equal(restored.state.mission, "verify sovereign network");
    const events = await runtime.listChatRuntimeEvents("session-1");
    assert.equal(events.durable, true);
    assert.equal(events.events.length, 1);
    assert.equal(events.events[0].event_type, "state.updated");
    assert.equal(events.events[0].payload.version, 1);

    const other = await runtime.getChatRuntimeState("session-2");
    assert.equal(other.version, 0);
    assert.equal(other.state.mission, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
