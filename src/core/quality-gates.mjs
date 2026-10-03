import { canRelease } from "./agent-crew.mjs";

function result(name,ok,detail,blocker=false){return {name,ok,detail,blocker};}

export function productionGate(input={}){
  const checks=[
    result("source",Boolean(input.source||input.sourceRefs?.length),"Source/provenance is attached.",true),
    result("script",Boolean(String(input.script??"").trim()),"Production script exists.",true),
    result("media",Boolean(input.media||input.mediaAssets?.length),"Media assets exist.",true),
    result("audio",Boolean(input.audio||input.audioTracks?.length),"Audio exists.",true),
    result("timeline",Boolean(input.timeline),"Timeline exists.",true)
  ];
  const blockers=checks.filter(x=>!x.ok);
  return {name:"production",ok:blockers.length===0,blockers,checks};
}

export function productionDoctorGate(input={}){
  const gate=productionGate(input);
  return {name:"production-doctor",ok:gate.ok,blockers:gate.blockers,checks:gate.checks};
}

export function releaseGate(input={}){
  const pkg=input.releasePackage??input.release??null;
  const packageReady=Boolean(pkg);
  const approvalInput={action:"release",artifactIds:[pkg?.id].filter(Boolean),version:pkg?.version??input.version??null};
  const authorityReady=canRelease(input.agentCrew??{approval:{required:true,status:"pending"}},approvalInput);
  const blockers=[];
  if(!packageReady)blockers.push(result("release-package",false,"Release package is missing.",true));
  if(!authorityReady)blockers.push(result("human-approval",false,"Final human approval is required before release.",true));
  return {name:"release",ok:blockers.length===0,blockers};
}

export function episodeQualityGate(input={}){
  const production=productionGate(input);
  const gates=[production];
  const blockers=gates.flatMap(g=>g.blockers??[]);
  return {ready:blockers.length===0,gates,blockers,release:releaseGate(input),summary:{gateCount:gates.length,passed:gates.filter(g=>g.ok).length,blocked:gates.filter(g=>!g.ok).length}};
}
