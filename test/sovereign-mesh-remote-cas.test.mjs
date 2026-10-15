import test from "node:test";
import assert from "node:assert/strict";
import SovereignMeshEngine from "../src/core/sovereign-mesh-engine.mjs";
import { MemoryMeshCAS } from "./helpers/memory-mesh-cas.mjs";

test("peer CAS is the only mesh persistence provider", async () => {
  const cas = new MemoryMeshCAS();
  const engine = await new SovereignMeshEngine({ cas }).ready();
  const record = await engine.dispatchAutonomousPayload({
    waveId: "remote-wave-1", peerId: "peer-test", action: "test.remote", payload: { durable: true }
  });
  assert.equal(record.status, "DISPATCHED");
  assert.equal((await cas.readRef("waves", engine.key("remote-wave-1"))).value.checksum, record.checksum);
  const recovered = await new SovereignMeshEngine({ cas }).ready();
  assert.equal(recovered.get("remote-wave-1").checksum, record.checksum);
});
