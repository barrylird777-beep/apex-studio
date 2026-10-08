import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { APEX_APPS, assertSixAppInvariant, getApexApp } from "../src/apps/apex-six-apps.mjs";
import { evaluatePayPex, payPexSnapshot, payPexStatus } from "../src/apps/paypex.mjs";
import { teeveeStatus } from "../src/apps/teevee.mjs";
import { gardenStatus } from "../src/apps/garden-of-apex.mjs";
import { kornKnobStatus } from "../src/apps/korn-knob.mjs";
import { studioStatus } from "../src/apps/apex-studio.mjs";
import { xshieldStatus } from "../src/apps/xshield.mjs";
import { createPayPexBrief } from "../src/apps/paypex.mjs";
import { kornPopzAppStatus } from "../src/apps/korn-popz.mjs";

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

test("KornPopz exposes its canonical evaluator status", () => {
  const status = kornPopzAppStatus();
  assert.equal(status.ratingSystem, "KornPopz");
  assert.equal(status.active, true);
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

test("PayPex creates a production handoff brief", () => {
  const brief = createPayPexBrief({ topic: "Biblical short-form series", objective: "Test a small production", audience: "Bible story viewers" });
  assert.equal(brief.engine, "PayPex");
  assert.equal(brief.system, "apex-studio");
  assert.equal(brief.evidenceRequired, true);
  assert.equal(brief.handoff, "TeeVee");
  assert.ok(brief.id);
});

test("entry paths point to reachable public surfaces", async () => {
  for (const app of Object.values(APEX_APPS)) {
    const relative = app.entry === "/"
      ? "public/index.html"
      : "public" + app.entry;
    await access(resolve(relative));
  }
  await access(resolve("public/teevee.html"));
  await access(resolve("public/xshield.html"));
});


test("registry module metadata matches app locations", () => {
  assert.equal(getApexApp("korn-knob").module, "../core/korn-knob.mjs");
  assert.equal(getApexApp("teevee").module, "../core/teevee-broadcast.mjs");
  assert.equal(getApexApp("paypex").module, "../core/paypex-core.mjs");
  assert.equal(getApexApp("apex-studio").module, "../core/apex-universe.mjs");
  assert.equal(getApexApp("garden-of-apex").module, "../core/garden-of-apex.mjs");
  assert.equal(getApexApp("xshield").module, "./xshield.mjs");
});
