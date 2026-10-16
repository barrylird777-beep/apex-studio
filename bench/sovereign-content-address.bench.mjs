import { bench, describe } from "vitest";
import {
  canonicalizeSovereignContent,
  sovereignContentAddress,
  verifySovereignContentAddress
} from "../src/core/sovereign-content-address.mjs";

const handoff = { appId: "planetapex", waveId: "wave-1", data: { value: 1, tags: ["a", "b"] } };

const largePayload = {
  appId: "koinkob",
  round: 17,
  workers: Array.from({ length: 500 }, (_, i) => ({
    id: `worker-${i}`,
    balance: i * 13.5,
    holdings: { gold: i % 7, grain: i % 11, cloth: i % 5 },
    active: i % 3 !== 0
  }))
};

const largeAddress = sovereignContentAddress(largePayload);

describe("sovereign-content-address", () => {
  bench("sovereignContentAddress small handoff (100x)", () => {
    for (let i = 0; i < 100; i += 1) sovereignContentAddress(handoff);
  });

  bench("canonicalizeSovereignContent 500 workers", () => {
    canonicalizeSovereignContent(largePayload);
  });

  bench("verifySovereignContentAddress 500 workers", () => {
    verifySovereignContentAddress(largePayload, largeAddress);
  });
});
