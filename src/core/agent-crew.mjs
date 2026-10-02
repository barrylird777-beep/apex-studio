import { uid, now } from "./id.mjs";
import { createApprovalRecord, approveRecord, revokeRecord, approvalMatches } from "./approval-lineage.mjs";

export const HUMAN_AUTHORITY=Object.freeze({
  finalDecisionRequired:true,
  releaseRequiresApproval:true,
  destructiveActionsRequireApproval:true
});

export const AGENT_ROLES=Object.freeze([
  ["scripture","Scripture Analyst","source analysis, provenance, context"],
  ["story","Story Architect","hooks, stakes, escalation, payoff"],
  ["director","Cinematic Director","shots, blocking, pacing, spectacle"],
  ["character","Character Director","identity, wardrobe, emotion, continuity"],
  ["visual","Visual Director","visual prompts, composition, style"],
  ["audio","Audio Director","voice, music, sound design"],
  ["continuity","Continuity Supervisor","canon, chronology, relationships"],
  ["editor","Editor","timeline, transitions, rhythm"],
  ["qa","Production QA","quality, provenance, release readiness"]
]);

const arr=v=>Array.isArray(v)?v:[];

export function createAgent(input={}) {
  return {id:input.id??uid("agent"),role:input.role??"qa",name:input.name??"Apex Agent",
    capabilities:arr(input.capabilities),status:"idle",authority:"recommend-only",createdAt:now()};
}

export function createCrew(input={}) {
  const agents=arr(input.agents).length?input.agents:AGENT_ROLES.map(([role,name,capabilities])=>createAgent({role,name,capabilities}));
  return {id:input.id??uid("crew"),episodeId:input.episodeId??null,agents,
    handoffs:[],decisions:[],approval:{status:"pending",required:true,approvedBy:null,approvedAt:null,decisionId:null,record:null},
    authority:HUMAN_AUTHORITY,createdAt:now(),updatedAt:now()};
}

export function createHandoff(input={}) {
  return {id:input.id??uid("handoff"),from:input.from??null,to:input.to??null,
    artifactIds:arr(input.artifactIds),sourceRefs:arr(input.sourceRefs),task:input.task??"",
    status:input.status??"queued",result:null,createdAt:now(),updatedAt:now()};
}

export function queueHandoff(crew={},handoff={}) {
  const x=handoff.id?handoff:createHandoff(handoff);
  return {...crew,handoffs:[...arr(crew.handoffs),{...x,status:"queued",updatedAt:now()}],updatedAt:now()};
}

export function completeHandoff(crew={},id,result=null) {
  return {...crew,handoffs:arr(crew.handoffs).map(x=>x.id===id?{...x,status:"completed",result,updatedAt:now()}:x),updatedAt:now()};
}

export function availableAgents(crew={}) {
  return arr(crew.agents).filter(x=>x.status==="idle"||x.status==="ready");
}

export function requestHumanApproval(crew={},input={}) {
  const decision={id:input.decisionId??uid("decision"),action:input.action??"release",
    artifactIds:arr(input.artifactIds),reason:input.reason??"",requestedAt:now(),status:"pending"};
  return {...crew,decisions:[...arr(crew.decisions),decision],
    approval:{...crew.approval,status:"pending",required:true,decisionId:decision.id,record:createApprovalRecord({action:decision.action,artifactIds:decision.artifactIds,episodeId:crew.episodeId,reason:decision.reason})},updatedAt:now()};
}

export function approveCrewDecision(crew={},input={}) {
  if(!input.approver) throw new Error("Human approver is required");
  const id=input.decisionId??crew.approval?.decisionId;
  return {...crew,decisions:arr(crew.decisions).map(x=>x.id===id?{...x,status:"approved",approvedBy:input.approver,approvedAt:now()}:x),
    approval:{...crew.approval,status:"approved",approvedBy:input.approver,approvedAt:now(),decisionId:id,record:approveRecord(crew.approval?.record??createApprovalRecord({action:"release",episodeId:crew.episodeId}),input.approver)},updatedAt:now()};
}

export function revokeCrewApproval(crew={},reason="Approval revoked") {
  return {...crew,approval:{...crew.approval,status:"revoked",approvedBy:null,approvedAt:null,record:revokeRecord(crew.approval?.record??{},reason)},
    decisions:arr(crew.decisions).map(x=>x.id===crew.approval?.decisionId?{...x,status:"revoked",reason,revokedAt:now()}:x),updatedAt:now()};
}

export function canRelease(crew={}) {
  return crew.approval?.required===true && crew.approval?.status==="approved" && Boolean(crew.approval?.approvedBy) && crew.approval?.record?.status==="approved";
}

export function auditCrew(crew={}) {
  const blockers=[];
  if(crew.authority?.finalDecisionRequired!==true) blockers.push("human-final-authority-disabled");
  if(crew.approval?.required!==true) blockers.push("release-approval-disabled");
  if(canRelease(crew) && !crew.approval?.approvedBy) blockers.push("approval-without-human");
  return {ready:blockers.length===0,blockers,agentCount:arr(crew.agents).length,handoffs:arr(crew.handoffs).length};
}
