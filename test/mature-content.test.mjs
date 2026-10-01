import assert from "node:assert/strict"; import { MatureContentManager } from "../src/core/mature-content.mjs";
const m=new MatureContentManager(); assert.equal(m.canAccess({category:"romance"}).reason,"mature workspace disabled");
m.updatePolicy({enabled:true,ageVerified:true,consentConfirmed:true}); m.setProject({projectId:"p1",categories:["romance"],media:{video:true}});
assert.equal(m.canAccess({projectId:"p1",category:"romance",mediaType:"video"}).allowed,true);
assert.equal(m.canAccess({projectId:"p1",category:"adult"}).allowed,false);
console.log("mature-content ok");