import assert from "node:assert/strict";
import { AdaptiveIntimacyManager, ESCALATION_LEVELS } from "../src/core/adaptive-intimacy.mjs";

const m=new AdaptiveIntimacyManager();
const p=m.create({level:"affectionate",style:"teasing",initiation:"user-led",pacing:"responsive",boundaries:{privateOnly:true}});
assert.equal(p.level,"affectionate");
assert.equal(p.initiation,"user-led");
assert.equal(p.pacing,"responsive");
assert.deepEqual(ESCALATION_LEVELS,["friendly","affectionate","flirty","sensual"]);

m.setBoundary(p.id,"noSurpriseEscalation",true);
assert.equal(m.get(p.id).boundaries.noSurpriseEscalation,true);

const transition=m.transition(p.id,"flirty",{consent:true,reason:"user-request"});
assert.equal(transition.event.from,"affectionate");
assert.equal(m.get(p.id).level,"flirty");
assert.throws(()=>m.transition(p.id,"sensual",{consent:false}),/Consent confirmation required/);

m.recordSignal(p.id,"positiveFeedback",true);
assert.equal(m.eventsFor(p.id).length,1);

const restored=new AdaptiveIntimacyManager().restore(m.snapshot());
assert.equal(restored.get(p.id).level,"flirty");
assert.equal(restored.get(p.id).boundaries.privateOnly,true);
console.log("adaptive intimacy ok");
