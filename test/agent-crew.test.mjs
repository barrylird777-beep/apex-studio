import test from "node:test";
import assert from "node:assert/strict";
import { createCrew, requestHumanApproval, approveCrewDecision, revokeCrewApproval, canRelease, auditCrew } from "../src/core/agent-crew.mjs";
import { releaseGate } from "../src/core/quality-gates.mjs";

test("crew defaults to recommendation-only agents and requires human approval",()=>{
  const crew=createCrew();
  assert.equal(crew.agents.length,9);
  assert.ok(crew.agents.every(a=>a.authority==="recommend-only"));
  assert.equal(canRelease(crew),false);
  assert.equal(auditCrew(crew).ready,true);
});

test("release gate blocks until a human approves",()=>{
  const crew=createCrew();
  const pending=requestHumanApproval(crew,{action:"release",reason:"Final release review"});
  assert.equal(releaseGate({releasePackage:{},agentCrew:pending}).ok,false);
  const approved=approveCrewDecision(pending,{approver:"human",decisionId:pending.approval.decisionId});
  assert.equal(canRelease(approved),true);
  assert.equal(releaseGate({releasePackage:{},agentCrew:approved}).ok,true);
  const revoked=revokeCrewApproval(approved,"Changed mind");
  assert.equal(canRelease(revoked),false);
  assert.equal(releaseGate({releasePackage:{},agentCrew:revoked}).ok,false);
});
