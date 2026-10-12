import { APEX_APPS, assertSixAppInvariant } from "./apex-six-apps.mjs";

const HANDOFFS=Object.freeze([
  Object.freeze({from:"planet-apex",to:"kernel-vision",purpose:"provide research context and source provenance for production"}),
  Object.freeze({from:"kernelodies",to:"kernel-vision",purpose:"provide authorized music and audio assets with provenance"}),
  Object.freeze({from:"kernel-vision",to:"kash-korner",purpose:"hand off customer orders and verified payment events"}),
  Object.freeze({from:"kash-korner",to:"kash-kobs",purpose:"provide confirmed commercial outcomes for opportunity analysis"}),
  Object.freeze({from:"kash-kobs",to:"planet-apex",purpose:"return evidence-labelled opportunity questions for research"}),
  Object.freeze({from:"xshield",to:"kernel-vision",purpose:"provide security and privacy policy signals without moving XShield ownership"})
]);

export function canonicalTrajectory(){
  assertSixAppInvariant();
  const apps=Object.values(APEX_APPS).map(app=>({id:app.id,name:app.name,role:app.role,entry:app.entry}));
  return {
    contractVersion:"apex-canonical-trajectory.v1",
    apps,
    handoffs:HANDOFFS.map(handoff=>({...handoff})),
    closedLoop:true,
    persistence:"durable app records use isolated sovereign namespaces; media objects remain separate",
    checkedAt:new Date().toISOString()
  };
}

export function validateCanonicalTrajectory(trajectory=canonicalTrajectory()){
  if(!trajectory||trajectory.contractVersion!=="apex-canonical-trajectory.v1")throw new Error("Invalid canonical trajectory contract");
  const ids=new Set(trajectory.apps.map(app=>app.id));
  if(ids.size!==6||ids.size!==Object.keys(APEX_APPS).length)throw new Error("Canonical trajectory must contain exactly six apps");
  for(const handoff of trajectory.handoffs){
    if(!ids.has(handoff.from)||!ids.has(handoff.to)||handoff.from===handoff.to)throw new Error("Canonical trajectory contains an invalid handoff");
    if(!String(handoff.purpose||"").trim())throw new Error("Canonical trajectory handoff requires a purpose");
  }
  for(const app of Object.values(APEX_APPS))if(!ids.has(app.id))throw new Error("Canonical trajectory is missing "+app.name);
  return true;
}

export function canonicalNeighbors(appId){
  const id=String(appId??"");
  if(!Object.values(APEX_APPS).some(app=>app.id===id))throw new Error("Unknown Apex app: "+id);
  return HANDOFFS.filter(h=>h.from===id||h.to===id).map(h=>({...h}));
}
