import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DeepPrivacyEngine, PROFILES, SALTS } from "../scripts/deep-privacy-engine.js";

async function tempMatrixPath() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "apex-deep-privacy-"));
  return {
    directory,
    matrixPath: path.join(directory, "routing-matrix.json")
  };
}

test("generateScrambledSignature creates salted uppercase token signatures", () => {
  const engine = new DeepPrivacyEngine({ startTimer: false });
  const signatures = engine.generateScrambledSignature("alpha beta gamma");

  assert.equal(signatures.length, 3);
  for (const signature of signatures) {
    assert.match(signature, /^\[TK_[0-9A-F]{6}\]$/);
  }
  assert.notDeepEqual(signatures, ["alpha", "beta", "gamma"]);
  assert.equal(SALTS.length, 4);
  engine.stop();
});

test("generateScrambledSignature is deterministic for the same token positions", () => {
  const engine = new DeepPrivacyEngine({ startTimer: false });
  assert.deepEqual(
    engine.generateScrambledSignature("alpha beta"),
    engine.generateScrambledSignature("alpha beta")
  );
  engine.stop();
});

test("rotateRoutingArchitecture cycles ALPHA, BRAVO, CHARLIE with modulo arithmetic", async () => {
  const { directory, matrixPath } = await tempMatrixPath();
  const engine = new DeepPrivacyEngine({ matrixPath, startTimer: false });

  try {
    assert.equal(engine.rotateRoutingArchitecture().profile, PROFILES[0]);
    assert.equal(engine.rotateRoutingArchitecture().profile, PROFILES[1]);
    assert.equal(engine.rotateRoutingArchitecture().profile, PROFILES[2]);
    assert.equal(engine.rotateRoutingArchitecture().profile, PROFILES[0]);

    const saved = JSON.parse(await fs.readFile(matrixPath, "utf8"));
    assert.equal(saved.profile, "ALPHA");
    assert.equal(saved.routing.externalConnections, false);
    assert.equal(saved.routing.mode, "local-profile");
  } finally {
    engine.stop();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("stop clears the rotation timer and exposes clearance metrics", async () => {
  const { directory, matrixPath } = await tempMatrixPath();
  const engine = new DeepPrivacyEngine({
    matrixPath,
    rotationIntervalMs: 10
  });

  try {
    assert.equal(engine.metrics().timerActive, true);
    const before = engine.metrics().rotationCount;
    const metrics = engine.stop();

    assert.equal(metrics.timerActive, false);
    assert.equal(metrics.timerClearCount, 1);

    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(engine.metrics().rotationCount, before);
    assert.equal(engine.stop().timerClearCount, 1);
  } finally {
    engine.stop();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("rotation write failures are captured without leaving a live timer", async () => {
  const { directory } = await tempMatrixPath();
  const engine = new DeepPrivacyEngine({
    matrixPath: path.join(directory, "missing-parent", "matrix.json"),
    startTimer: false
  });

  await assert.doesNotReject(async () => {
    engine.rotateRoutingArchitecture();
  });
  engine.stop();
  await fs.rm(directory, { recursive: true, force: true });
});
