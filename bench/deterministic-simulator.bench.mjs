import { bench, describe } from "vitest";
import { DeterministicSimulator, SimulatedNetwork } from "../src/testing/deterministic-simulator.mjs";

async function runLossScenario(seed, packets) {
  const sim = new DeterministicSimulator({ seed, startTime: 1000 });
  const network = new SimulatedNetwork(sim, { latencyMs: 2, jitterMs: 5, dropRate: 0.2 });
  let received = 0;
  network.register("peer-b", () => {
    received += 1;
  });
  for (let i = 0; i < packets; i += 1) network.send("peer-a", "peer-b", { sequence: i }, { label: "chaos-packet" });
  await sim.run();
  return received;
}

describe("deterministic-simulator", () => {
  bench("lossy network scenario (500 packets)", async () => {
    await runLossScenario("bench-seed-42", 500);
  });
});
