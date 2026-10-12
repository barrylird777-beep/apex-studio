import crypto from "node:crypto";
import { uid, now } from "./id.mjs";

export function approvalFingerprint(input={}) {
  const payload=JSON.stringify({
    action:input.action??"release",
    artifactIds:Array.isArray(input.artifactIds)?[...input.artifactIds].sort():[],
    episodeId:input.episodeId??null,
    version:input.version??null
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export function createApprovalRecord(input={}) {
  return {
    id:input.id??uid("approval"),
    action:input.action??"release",
    episodeId:input.episodeId??null,
    artifactIds:Array.isArray(input.artifactIds)?input.artifactIds:[],
    version:input.version??null,
    fingerprint:approvalFingerprint(input),
    approver:input.approver??null,
    status:input.status??"pending",
    requestedAt:input.requestedAt??now(),
    approvedAt:input.approvedAt??null,
    revokedAt:null,
    reason:input.reason??""
  };
}

export function approveRecord(record={},approver) {
  if(!approver) throw new Error("Human approver is required");
  return {...record,status:"approved",approver,approvedAt:now()};
}

export function revokeRecord(record={},reason="Approval revoked") {
  return {...record,status:"revoked",revokedAt:now(),reason};
}

export function approvalMatches(record={},input={}) {
  return record.status==="approved" && record.approver &&
    record.fingerprint===approvalFingerprint(input);
}
