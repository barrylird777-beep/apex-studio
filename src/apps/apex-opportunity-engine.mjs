import { getEngineSnapshot, buildEngineBrief, scoreOpportunity } from "../core/engine-apex.mjs";
import { getApexApp } from "./apex-six-apps.mjs";

const APP = getApexApp("apex-opportunity-engine");

export async function opportunitySnapshot() {
  const snapshot = await getEngineSnapshot();
  return {
    app: { ...APP },
    ...snapshot,
    engine: "ApexOpportunityEngine",
    decisionCore: "EngineApex",
    productionExecutionOwnedBy: "ApexStudio"
  };
}

export function createOpportunityBrief(input = {}) {
  return {
    app: { ...APP },
    ...buildEngineBrief(input),
    engine: "ApexOpportunityEngine",
    executionOwner: "ApexStudio"
  };
}

export function evaluateOpportunity(input = {}) {
  return {
    appId: APP.id,
    engine: "ApexOpportunityEngine",
    ...scoreOpportunity(input)
  };
}

export function opportunityStatus(snapshot = null) {
  return {
    app: { ...APP },
    state: snapshot?.state || "awaiting-evidence",
    evidenceBacked: snapshot?.state === "evidence-backed",
    productionSeparated: true,
    checkedAt: new Date().toISOString()
  };
}
