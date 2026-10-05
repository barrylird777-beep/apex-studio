import test from "node:test";
import assert from "node:assert/strict";
import RogueApDetector, { validateObservationEnvelope } from "../../src/network/rogue-ap-detector.mjs";

const base = { ssid: "Apex_Industrial_Mesh", bssid: "00:11:22:33:44:55", rssi: -50, channel: 6 };

test("rejects malformed observation envelopes", () => {
  assert.throws(() => validateObservationEnvelope(null), /body must be an object/);
  assert.throws(() => validateObservationEnvelope({ observations: "bad" }), /observations must be an array/);
  assert.throws(() => validateObservationEnvelope({ observations: [{ ...base, bssid: "bad" }] }), /Invalid BSSID/);
  assert.throws(() => validateObservationEnvelope({ observations: [{ ...base, unknown: true }] }), /Unsupported observation field/);
});

test("empty observations produce a telemetry-only clean report", () => {
  const detector = new RogueApDetector({ authorizedSsid: base.ssid });
  const report = detector.evaluateObservations([]);
  assert.equal(report.scannedCount, 0);
  assert.equal(report.threatCount, 0);
  assert.equal(report.classification, "behavioral_heuristic");
  assert.equal(report.telemetryOnly, true);
});

test("flags an untrusted BSSID for an authorized SSID", () => {
  const detector = new RogueApDetector({
    authorizedSsid: base.ssid,
    trustedBssids: [base.bssid]
  });
  const report = detector.evaluateObservations([
    base,
    { ...base, bssid: "de:ad:be:ef:ca:fe" }
  ]);
  assert.ok(report.threats.some(threat => threat.type === "UNTRUSTED_AUTHORIZED_SSID"));
});

test("flags rapid BSSID changes across vendor OUI blocks", () => {
  const detector = new RogueApDetector({ authorizedSsid: base.ssid, flappingWindowMs: 60_000 });
  const report = detector.evaluateObservations([
    { ...base, bssid: "00:11:22:33:44:55", observedAt: "2026-10-05T15:00:00Z" },
    { ...base, bssid: "aa:bb:cc:33:44:55", observedAt: "2026-10-05T15:00:10Z" }
  ]);
  assert.ok(report.threats.some(threat => threat.type === "BSSID_FLAPPING"));
});

test("flags RSSI spikes against a documented baseline", () => {
  const detector = new RogueApDetector({
    authorizedSsid: base.ssid,
    rssiBaselines: { [base.ssid]: { min: -80, max: -55 } }
  });
  const report = detector.evaluateObservations([{ ...base, rssi: -30 }]);
  assert.ok(report.threats.some(threat => threat.type === "RSSI_ANOMALY"));
});

test("flags conflicting capability signatures for cloned BSSIDs", () => {
  const detector = new RogueApDetector({ authorizedSsid: base.ssid });
  const report = detector.evaluateObservations([
    { ...base, capabilities: ["802.11ax", "WPA3"] },
    { ...base, bssid: "aa:bb:cc:33:44:55", capabilities: ["802.11n", "WPA2"] }
  ]);
  assert.ok(report.threats.some(threat => threat.type === "CLONED_BSSID_SIGNATURE"));
});

test("supports rapid state transitions without leaking stale observations", () => {
  const detector = new RogueApDetector({ authorizedSsid: base.ssid, flappingWindowMs: 1000 });
  detector.evaluateObservations([
    { ...base, observedAt: "2026-10-05T15:00:00Z" },
    { ...base, bssid: "aa:bb:cc:33:44:55", observedAt: "2026-10-05T15:00:00.500Z" }
  ]);
  const report = detector.evaluateObservations([
    { ...base, observedAt: "2026-10-05T15:01:00Z" }
  ]);
  assert.equal(report.threats.some(threat => threat.type === "BSSID_FLAPPING"), false);
});
