import assert from "node:assert/strict";
import { MatureContentManager } from "../src/core/mature-content.mjs";

const manager = new MatureContentManager({ passcode: "test-passcode" });

const initial = manager.status();
assert.equal(initial.label, "LAYERS");
assert.equal(initial.configured, true);
assert.equal(initial.locked, true);
assert.equal(initial.unlocked, false);

const unlocked = manager.unlock("test-passcode", 60_000);
assert.equal(unlocked.mode, undefined);
assert.equal(manager.status(unlocked.token).unlocked, true);
assert.equal(manager.requireUnlocked(unlocked.token), true);

manager.lock(unlocked.token);
assert.equal(manager.status(unlocked.token).unlocked, false);
assert.throws(() => manager.requireUnlocked(unlocked.token), /Layers is locked/);

assert.throws(() => manager.unlock("wrong-passcode"), /Invalid Layers passcode/);
console.log("layers runtime ok");
