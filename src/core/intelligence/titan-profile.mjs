export const TITAN_PROFILE=Object.freeze({
  id:"titan",
  role:"titan",
  name:"TITAN",
  authority:"recommend-only",
  capabilities:["software-engineering","architecture","security","data","reliability","testing","performance","product","repository-analysis","repair","verification"],
  tools:["repository-read","repository-write","isolated-worktree","test-runner","diff-inspector","credential-scanner"],
  permissions:["read-source","write-source","run-tests","create-branch","create-commit"],
  requiresHumanApproval:["release","merge","destructive-action","production-change"]
});

export const TITAN_SPECIALISTS=Object.freeze([
  ["security","security","security,threat-modeling,credential-audit"],
  ["data","data","schema,migrations,transactions,data-integrity"],
  ["reliability","reliability","crash-recovery,leases,retries,idempotency"],
  ["testing","testing","tests,coverage,regressions,adversarial-verification"],
  ["performance","performance","latency,concurrency,memory,resource-use"],
  ["product","product","requirements,ux,acceptance-criteria"],
  ["architecture","architecture","boundaries,dependencies,maintainability"]
]);

export function createTitanCrew({prefix="titan"}={}) {
  return TITAN_SPECIALISTS.map(([id,role,capabilities]) => ({
    id:`${prefix}-${id}`, role, capabilities:capabilities.split(","),
    status:"ready", authority:"recommend-only"
  }));
}
