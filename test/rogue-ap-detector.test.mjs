import test from "node:test";
import assert from "node:assert/strict";
import { createRogueApDetector, normalizeObservation } from "../src/network/rogue-ap-detector.mjs";

test("rogue AP detector accepts authorized Wi-Fi telemetry", () => {
  const detector = createRogueApDetector({ trusted: ["aa:bb:cc:dd:ee:ff"] });
  const result = detector.observe({
    ssid: "Apex",
    bssid: "aa:bb:cc:dd:ee:ff",
    channel: 36,
    rssi: -48
  });
  assert.equal(result.trustedBssid, true);
  assert.equal(result.decision, "trusted");
});

test("rogue AP detector flags untrusted observations without claiming certainty", () => {
  const detector = createRogueApDetector();
  const result = detector.observe({
    ssid: "Apex",
    bssid: "11:22:33:44:55:66",
    channel: 149,
    rssi: -61
  });
  assert.equal(result.trustedBssid, false);
  assert.equal(result.decision, "untrusted-observation");
  assert.match(result.warning, /not proof/i);
});

test("invalid radio telemetry is rejected", () => {
  assert.throws(() => normalizeObservation({
    ssid: "Apex",
    bssid: "not-a-bssid",
    channel: 36,
    rssi: -50
  }), /bssid/i);
});
