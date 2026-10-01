import assert from "node:assert/strict"; import { CompanionManager } from "../src/core/companion.mjs";
const m=new CompanionManager(); const c=m.create({name:"Nova",mode:"romantic",persona:"warm, witty, affectionate"});
assert.equal(c.media.chat,true); const s=m.startSession(c.id,"video"); assert.equal(s.active,true); assert.equal(m.endSession(s.id).active,false); m.setMedia(c.id,"voice",false); assert.throws(()=>m.startSession(c.id,"voice"),/Media disabled/);
console.log("companion ok");