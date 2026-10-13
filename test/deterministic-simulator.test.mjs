import test from "node:test";
import assert from "node:assert/strict";
import { DeterministicSimulator, SimulatedDisk, SimulatedNetwork } from "../src/testing/deterministic-simulator.mjs";

async function runLossScenario(seed) {
  const sim = new DeterministicSimulator({ seed, startTime: 1000 });
  const network = new SimulatedNetwork(sim, { latencyMs: 2, jitterMs: 5, dropRate: 0.5 });
  const received = [];
  network.register("peer-b", (payload, meta) => received.push({ payload, at: meta.at }));
  for (let i = 0; i < 40; i += 1) network.send("peer-a", "peer-b", { sequence: i }, { label: "chaos-packet" });
  await sim.run();
  return { trace: sim.trace, received, now: sim.now };
}

test("same seed replays packet loss, jitter, delivery order, and virtual time exactly", async () => {
  const first = await runLossScenario("replay-seed-42");
  const second = await runLossScenario("replay-seed-42");
  assert.deepEqual(second, first);
  assert.ok(first.trace.some(entry => entry.type === "network:drop" && entry.reason === "packet-loss"));
  assert.ok(first.received.length > 0 && first.received.length < 40);
});

test("network partitions drop packets until the link is healed", async () => {
  const sim = new DeterministicSimulator({ seed: 7 });
  const network = new SimulatedNetwork(sim, { dropRate: 0 });
  const received = [];
  network.register("b", payload => received.push(payload));
  network.partition("a", "b");
  assert.deepEqual(network.send("a", "b", { id: 1 }), { accepted: false, reason: "partition" });
  network.heal("a", "b");
  assert.equal(network.send("a", "b", { id: 2 }).accepted, true);
  await sim.run();
  assert.deepEqual(received, [{ id: 2 }]);
});

test("simulated disk raises ENOSPC without corrupting the last committed value", () => {
  const disk = new SimulatedDisk({ capacityBytes: 40 });
  disk.write("record", { value: "ok" });
  const before = disk.read("record");
  assert.throws(() => disk.write("record", { value: "this write is intentionally much too large for the disk" }), error => error.code === "ENOSPC");
  assert.deepEqual(disk.read("record"), before);
  assert.equal(disk.snapshot().usedBytes, Buffer.byteLength(JSON.stringify(before), "utf8"));
});

test("equal-time events execute in stable insertion order and timers use virtual time", async () => {
  const sim = new DeterministicSimulator({ seed: "clock", startTime: 500 });
  const order = [];
  sim.setTimeout(() => order.push("first"), 10, "first");
  sim.setTimeout(() => order.push("second"), 10, "second");
  await sim.run({ until: 510 });
  assert.deepEqual(order, ["first", "second"]);
  assert.equal(sim.now, 510);
});

test("event-loop runaway reports the replay seed", async () => {
  const sim = new DeterministicSimulator({ seed: "runaway-seed" });
  const loop = () => sim.schedule(0, loop, "runaway");
  loop();
  await assert.rejects(sim.run({ maxEvents: 3 }), /SIMULATOR_EVENT_LIMIT seed=runaway-seed/);
});
