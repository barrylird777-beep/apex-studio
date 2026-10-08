import { getEngineSnapshot, buildEngineBrief, scoreOpportunity } from "../core/engine-apex.mjs";
import { getApexApp } from "./apex-six-apps.mjs";

const APP = getApexApp("paypex");

export async function opportunitySnapshot() {
  const snapshot = await getEngineSnapshot();
  return {
    app: { ...APP },
    ...snapshot,
    engine: "Paypex",
    decisionCore: "EngineApex",
    productionExecutionOwnedBy: "ApexStudio"
  };
}

export function createOpportunityBrief(input = {}) {
  return {
    app: { ...APP },
    ...buildEngineBrief(input),
    engine: "Paypex",
    executionOwner: "ApexStudio"
  };
}

export function evaluateOpportunity(input = {}) {
  return {
    appId: APP.id,
    engine: "Paypex",
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
