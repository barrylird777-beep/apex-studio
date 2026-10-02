import test from "node:test";
import assert from "node:assert/strict";
import { createApprovalRecord, approveRecord, revokeRecord, approvalMatches } from "../src/core/approval-lineage.mjs";

test("approval lineage fingerprints the exact release intent",()=>{
  const r=createApprovalRecord({action:"release",episodeId:"ep1",artifactIds:["b","a"],version:"1"});
  assert.equal(r.fingerprint,createApprovalRecord({action:"release",episodeId:"ep1",artifactIds:["a","b"],version:"1"}).fingerprint);
  const a=approveRecord(r,"human");
  assert.equal(approvalMatches(a,{action:"release",episodeId:"ep1",artifactIds:["a","b"],version:"1"}),true);
  assert.equal(approvalMatches(a,{action:"release",episodeId:"ep1",artifactIds:["a","c"],version:"1"}),false);
  assert.equal(revokeRecord(a).status,"revoked");
});
