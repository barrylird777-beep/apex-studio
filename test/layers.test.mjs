import assert from "node:assert/strict";
import { MatureContentManager } from "../src/core/mature-content.mjs";

const m=new MatureContentManager({passcode:"test-layer-passcode"});
assert.equal(m.layerStatus().locked,true);
assert.equal(m.layerStatus().configured,true);
assert.throws(()=>m.unlock("wrong"),/Invalid Layers passcode/);
const session=m.unlock("test-layer-passcode",60000);
assert.equal(m.isUnlocked(session.token),true);
assert.equal(m.status(session.token).unlocked,true);
m.lock(session.token);
assert.equal(m.layerStatus().locked,true);
assert.equal(m.isUnlocked(session.token),false);
assert.throws(()=>m.configurePasscode("another-passcode"),/already configured/);
console.log("layers ok");
