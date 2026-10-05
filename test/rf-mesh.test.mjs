import test from "node:test";
import assert from "node:assert/strict";
import { validateBssid, validateEmbedding } from "../src/core/mesh/rf-mesh-swarm.mjs";

test("RF validation accepts canonical BSSID and 1536 finite embedding", () => {
  assert.equal(validateBssid("AA:BB:CC:DD:EE:FF"), "aa:bb:cc:dd:ee:ff");
  assert.equal(validateEmbedding(Array(1536).fill(0)).startsWith("[0,0"), true);
});

test("RF validation rejects malformed BSSID", () => {
  assert.throws(() => validateBssid("not-a-bssid"), /Invalid RF BSSID/);
});

test("RF validation rejects wrong vector dimension and non-finite values", () => {
  assert.throws(() => validateEmbedding([]), /1536 dimensions/);
  const values = Array(1536).fill(0);
  values[42] = Number.NaN;
  assert.throws(() => validateEmbedding(values), /non-finite/);
});
