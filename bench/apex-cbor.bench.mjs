import { bench, describe } from "vitest";
import { decodeCanonical, encodeCanonical } from "../src/core/apex-cbor.mjs";

const smallRecord = {
  app: "PlanetApeX",
  nested: { count: 42, active: true, empty: null, values: ["a", -7, 3.25] },
  bytes: Buffer.from([0, 1, 2, 250, 255])
};

const manifest = {
  appId: "kernelvision",
  version: 3,
  chunks: Array.from({ length: 256 }, (_, i) => ({
    index: i,
    size: 65536 + i,
    digest: `sha256-${i.toString(16).padStart(64, "0")}`,
    replicas: ["peer-a", "peer-b", "peer-c"].slice(0, (i % 3) + 1),
    verified: i % 2 === 0
  })),
  payload: Buffer.alloc(16 * 1024, 7)
};

const encodedSmall = encodeCanonical(smallRecord);
const encodedManifest = encodeCanonical(manifest);

describe("apex-cbor", () => {
  bench("encodeCanonical small record", () => {
    encodeCanonical(smallRecord);
  });

  bench("decodeCanonical small record", () => {
    decodeCanonical(encodedSmall);
  });

  bench("encodeCanonical 256-chunk manifest", () => {
    encodeCanonical(manifest);
  });

  bench("decodeCanonical 256-chunk manifest", () => {
    decodeCanonical(encodedManifest);
  });
});
