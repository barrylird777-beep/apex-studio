import test from "node:test";
import assert from "node:assert/strict";
import { APEX_APPS, assertSixAppInvariant, getApexApp } from "../src/apps/apex-six-apps.mjs";
import { evaluatePayPex, payPexSnapshot, payPexStatus } from "../src/apps/paypex.mjs";
import { teeveeStatus } from "../src/apps/teevee.mjs";
import { gardenStatus } from "../src/apps/garden-of-apex.mjs";
import { kornKnobStatus } from "../src/apps/korn-knob.mjs";
import { studioStatus } from "../src/apps/apex-studio.mjs";
import { xshieldStatus } from "../src/apps/xshield.mjs";

test("Apex exposes exactly six canonical apps", () => {
  assert.equal(assertSixAppInvariant(), true);
  assert.equal(Object.keys(APEX_APPS).length, 6);
  assert.deepEqual(Object.values(APEX_APPS).map(app => app.name), ["KornKnob","TeeVee","PayPex","ApexStudio","GardenOfApex","XShield"]);
});

test("six app boundaries resolve to their locked systems", () => {
  assert.equal(getApexApp("korn-knob").system, "kornknob");
  assert.equal(getApexApp("teevee").system, "apex-studio");
  assert.equal(getApexApp("paypex").system, "apex-studio");
  assert.equal(getApexApp("apex-studio").system, "apex-studio");
  assert.equal(getApexApp("garden-of-apex").system, "garden-of-apex");
  assert.equal(getApexApp("xshield").system, "apex-studio");
});

test("PayPex evaluates money-making opportunities deterministically", () => {
  const result = evaluatePayPex({ demand: 1, evidence: 1, audienceFit: 1, revenuePotential: 1, speedToMarket: 1, repeatability: 1, novelty: 1, risk: 0, productionCost: 0 });
  assert.equal(result.engine, "PayPex");
  assert.ok(result.score >= 0 && result.score <= 100);
});

test("PayPex status uses the implemented snapshot/status contract", async () => {
  const snapshot = await payPexSnapshot();
  const status = payPexStatus(snapshot);
  assert.equal(status.app.id, "paypex");
  assert.equal(status.engine, "PayPex");
  assert.equal(status.productionSeparated, true);
  assert.equal(status.evidenceBacked, snapshot.state === "evidence-backed");
});

test("TeeVee is a continuous 24/7 TV network", () => {
  const result = teeveeStatus();
  assert.equal(result.product, "24/7 TV show/network");
  assert.equal(result.mode, "continuous-linear-programming");
  assert.equal(result.continuousScheduling, true);
});

test("Garden, KornKnob, Studio and XShield expose operational status", () => {
  assert.equal(gardenStatus().app.id, "garden-of-apex");
  assert.equal(kornKnobStatus().app.id, "korn-knob");
  assert.equal(studioStatus().app.id, "apex-studio");
  assert.equal(xshieldStatus().app.id, "xshield");
});

test("all six app modules expose the same canonical app identity", async () => {
  const modules = [
    ["korn-knob", "../src/apps/korn-knob.mjs", "kornKnobStatus"],
    ["teevee", "../src/apps/teevee.mjs", "teeveeStatus"],
    ["paypex", "../src/apps/paypex.mjs", "payPexStatus"],
    ["apex-studio", "../src/apps/apex-studio.mjs", "studioStatus"],
    ["garden-of-apex", "../src/apps/garden-of-apex.mjs", "gardenStatus"],
    ["xshield", "../src/apps/xshield.mjs", "xshieldStatus"]
  ];
  for (const [id, path, fn] of modules) {
    const mod = await import(path);
    const status = fn === "payPexStatus"
      ? mod[fn]()
      : mod[fn]();
    assert.equal(status.app.id, id);
    assert.equal(status.app.name, getApexApp(id).name);
  }
});
