import test from "node:test";
import assert from "node:assert/strict";
import { createCrew, requestHumanApproval, approveCrewDecision, revokeCrewApproval, canRelease, auditCrew } from "../src/core/agent-crew.mjs";
import { releaseGate } from "../src/core/quality-gates.mjs";

test("crew defaults to recommendation-only agents and requires human approval",()=>{
  const crew=createCrew();
  assert.equal(crew.agents.length,18);
  assert.ok(crew.agents.every(a=>a.authority==="recommend-only"));
  assert.equal(canRelease(crew),false);
  assert.equal(auditCrew(crew).ready,true);
});

test("release gate blocks until a human approves",()=>{
  const crew=createCrew();
  const releasePackage={id:"release_test_1",version:"1.0.0"};
  const approval={action:"release",artifactIds:[releasePackage.id],episodeId:"episode_test_1",version:releasePackage.version,reason:"Final release review"};
  const pending=requestHumanApproval(crew,approval);
  assert.equal(releaseGate({id:"episode_test_1",releasePackage,agentCrew:pending}).ok,false);
  const approved=approveCrewDecision(pending,{approver:"human",decisionId:pending.approval.decisionId});
  assert.equal(canRelease(approved,approval),true);
  assert.equal(releaseGate({id:"episode_test_1",releasePackage,agentCrew:approved}).ok,true);
  assert.equal(canRelease(approved,{...approval,artifactIds:["tampered"]}),false);
  assert.equal(canRelease(approved,{...approval,version:"2.0.0"}),false);
  const revoked=revokeCrewApproval(approved,"Changed mind");
  assert.equal(canRelease(revoked),false);
  assert.equal(releaseGate({id:"episode_test_1",releasePackage,agentCrew:revoked}).ok,false);
});
